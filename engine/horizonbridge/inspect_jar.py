"""Recover loader metadata and report evidence from an unexecuted JAR."""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

from .archive import JarArchive, open_jar
from .bytecode import MAX_CLASS_MAJOR, exact_fabric_client_message, integer_method, read_class

METADATA_LIMIT = 512 * 1024
CLASS_LIMIT = 2 * 1024 * 1024
CLASS_BUDGET = 32 * 1024 * 1024
CLASS_COUNT_LIMIT = 3000
METHOD_COUNT_LIMIT = 2400
INSTRUCTION_LIMIT = 18_000
_LICENSE = re.compile(r"(?i)^(?:meta-inf/)?(?:licen[cs]e|copying|notice|authors)(?:[._-][a-z0-9._-]+)?\Z")
_CLASS_NAME = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*(?:/[A-Za-z_$][A-Za-z0-9_$]*)*\Z")
_PLATFORM = {"minecraft", "java", "fabricloader", "quilt_loader", "forge", "neoforge"}
_FORGE_MOD_ANNOTATIONS = {
    "Lnet/minecraftforge/fml/common/Mod;",
    "Lnet/neoforged/fml/common/Mod;",
    "Lcpw/mods/fml/common/Mod;",
}
_FEATURES = {
    "Keybindings and input": ("keybinding", "keymapping", "key_binding", "client/input", "glfw"),
    "HUD and client UI": ("hudrender", "guihud", "ingamehud", "guitexture", "gui/overlay", "gui/render",
                          "hud/", "hudlayer", "drawcontext", "guigraphics", "gui/screens"),
    "Commands": ("brigadier/", "commandregistration", "registercommand", "commands/", "commandregistrationcallback"),
    "Events and callbacks": ("eventbus/", "event/", "events/", "callback", "clienttick", "tickevent"),
    "Rendering": ("render/", "renderer/", "blaze3d/", "rendertype", "renderlayer", "sodium/", "lwjgl/opengl"),
    "Networking": ("networking/", "netty/", "network/", "custompayload", "serversidenetwork"),
    "Configuration APIs": ("forgeconfigspec", "modconfigspec", "clothconfig", "config/", "nightconfig/"),
    "Registries and gameplay": ("registry/", "registries/", "net/minecraft/world/", "net/minecraft/block/",
                               "net/minecraft/item/", "net/minecraft/entity/", "net/minecraft/level/"),
    "Reflection, process or system access": ("java/lang/reflect/", "java/lang/processbuilder", "java/lang/runtime",
                                             "java/lang/invoke/methodhandles", "sun/misc/unsafe", "jdk/internal/"),
}


def _object(value) -> dict:
    return value if isinstance(value, dict) else {}


def _array(value) -> list:
    return value if isinstance(value, list) else [] if value is None else [value]


def _string(value, limit: int = 300) -> str:
    if not isinstance(value, str):
        return ""
    return "".join(char for char in value[:limit] if char.isprintable() or char in "\n\t").strip()


def _names(values) -> list[str]:
    return list(dict.fromkeys(name for item in _array(values)[:100] if (
        name := _string(item if isinstance(item, str) else _object(item).get("name"), 120)
    )))


def _version(value) -> str:
    if isinstance(value, list):
        return " | ".join(_version(item) for item in value[:8] if isinstance(item, (str, int)))[:160]
    return str(value)[:160] if type(value) is int else _string(value, 160)


def _json_object(pairs: list[tuple[str, object]]) -> dict:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON metadata key.")
        result[key] = value
    return result


def _json(jar: JarArchive, path: str):
    return json.loads(jar.read(path, limit=METADATA_LIMIT).decode("utf-8-sig"), object_pairs_hook=_json_object)


def _manifest(jar: JarArchive) -> dict[str, str]:
    path = "META-INF/MANIFEST.MF"
    if path not in jar.names:
        return {}
    result: dict[str, str] = {}
    main = jar.read(path, limit=METADATA_LIMIT).decode("utf-8", errors="replace")
    current = ""
    for line in main.splitlines():
        if not line:
            break
        if line.startswith(" ") and current:
            result[current] += line[1:]
        elif ": " in line:
            key, value = line.split(": ", 1)
            current = key.lower()
            result[current] = value
    return result


def _entrypoints(entries: dict) -> list[str]:
    return list(dict.fromkeys(
        f"{kind}: {target}" for key, values in list(entries.items())[:50] for item in _array(values)[:30]
        if (kind := _string(key, 60)) and (target := _string(item if isinstance(item, str) else _object(item).get("value"), 160))
    ))[:100]


def _bounded_strings(values: list[str], warnings: list[str], field: str) -> list[str]:
    kept = []
    budget = 14 * 1024
    for value in values:
        budget -= len(json.dumps(value)) + 2
        if budget < 0:
            warnings.append(f"The {field} inventory exceeded the display budget and was shortened.")
            break
        kept.append(value)
    return kept


def _dependency(identifier, versions, required: bool = True) -> dict | None:
    identifier = _string(identifier, 120)
    return {"id": identifier, "versions": _version(versions), "required": required} if identifier else None


def _quilt_dependencies(value) -> list[dict]:
    result = []
    pending = [(item, False) for item in reversed(_array(value)[:200])]
    for _ in range(800):
        if not pending or len(result) == 200:
            break
        item, alternative = pending.pop()
        if isinstance(item, list):
            pending.extend((entry, True) for entry in reversed(item[:30]))
            continue
        if isinstance(item, str):
            dependency = _dependency(item, "", not alternative)
        else:
            entry = _object(item)
            dependency = _dependency(entry.get("id"), entry.get("versions"), not alternative and not entry.get("optional", False))
        if dependency:
            result.append(dependency)
    return result


def _fabric(jar: JarArchive):
    raw = _object(_json(jar, "fabric.mod.json"))
    if not _string(raw.get("id")):
        raise ValueError("Fabric descriptor is missing its mod ID.")
    dependencies = [
        dependency for field in ("depends", "recommends", "suggests") for key, value in
        list(_object(raw.get(field)).items())[:200] if (dependency := _dependency(key, value, field == "depends"))
    ]
    result = {
        "id": raw.get("id"), "version": raw.get("version"), "name": raw.get("name"),
        "author": _names(raw.get("authors")), "license": _names(raw.get("license")),
        "description": raw.get("description"), "entrypoints": _entrypoints(_object(raw.get("entrypoints"))),
    }
    mixins = [_string(item if isinstance(item, str) else _object(item).get("config")) for item in _array(raw.get("mixins"))[:100]]
    return "Fabric", result, dependencies, mixins, raw


def _quilt(jar: JarArchive):
    raw = _object(_json(jar, "quilt.mod.json"))
    loader = _object(raw.get("quilt_loader"))
    if not _string(loader.get("id")):
        raise ValueError("Quilt descriptor is missing its mod ID.")
    metadata = _object(loader.get("metadata"))
    result = {
        "id": loader.get("id"), "version": loader.get("version"), "name": metadata.get("name"),
        "description": metadata.get("description"), "license": _names(metadata.get("license")),
        "author": _names(list(_object(metadata.get("contributors")))),
        "entrypoints": _entrypoints(_object(loader.get("entrypoints"))),
    }
    return "Quilt", result, _quilt_dependencies(loader.get("depends")), _names(raw.get("mixin")), raw


def _forge(jar: JarArchive, path: str, manifest: dict[str, str]):
    raw = tomllib.loads(jar.read(path, limit=METADATA_LIMIT).decode("utf-8-sig"))
    mods = _array(raw.get("mods"))
    primary = _object(mods[0]) if mods else {}
    if not _string(primary.get("modId")):
        raise ValueError("Forge-family descriptor is missing its mod ID.")
    identifiers = [_string(_object(mod).get("modId"), 120) for mod in mods[:100]]
    dependencies = []
    for id_ in identifiers:
        for item in _array(_object(raw.get("dependencies")).get(id_))[:200]:
            item = _object(item)
            required = item.get("type", "required") == "required" and item.get("mandatory", True) is not False
            if dependency := _dependency(item.get("modId"), item.get("versionRange"), required):
                dependencies.append(dependency)
        if len(dependencies) >= 200:
            break
    loader = "NeoForge" if path.endswith("neoforge.mods.toml") or any(
        dependency["id"] == "neoforge" for dependency in dependencies
    ) else "Forge"
    version = primary.get("version")
    if version == "${file.jarVersion}":
        version = manifest.get("implementation-version")
    result = {
        "id": primary.get("modId"), "version": version, "name": primary.get("displayName"),
        "description": primary.get("description"), "license": _names(raw.get("license")),
        "author": _names(primary.get("authors")), "entrypoints": [],
        "otherModIds": identifiers[1:],
    }
    mixins = [_string(_object(item).get("config")) for item in _array(raw.get("mixins"))[:100]]
    return loader, result, dependencies[:200], mixins, raw


def _legacy(jar: JarArchive, manifest: dict[str, str]):
    metadata = {}
    if "mcmod.info" in jar.names:
        raw = _json(jar, "mcmod.info")
        entries = _array(raw if isinstance(raw, list) else _object(raw).get("modList", _object(raw).get("modlist", raw)))
        metadata = next((_object(entry) for entry in entries[:100] if _object(entry).get("modid")), {})
        if not metadata:
            raise ValueError("Legacy mod descriptor does not contain a mod ID.")
    result = {
        "id": metadata.get("modid"), "version": metadata.get("version") or manifest.get("implementation-version"),
        "name": metadata.get("name") or manifest.get("implementation-title"),
        "description": metadata.get("description"), "license": _names(metadata.get("license")),
        "author": _names(metadata.get("authorList") or metadata.get("authors") or manifest.get("implementation-vendor")),
        "minecraft": metadata.get("mcversion"), "entrypoints": [],
    }
    for key in ("fmlcoreplugin", "tweakclass", "main-class"):
        if entry := _string(manifest.get(key)):
            result["entrypoints"].append(f"{key}: {entry}")
    deps = [
        dependency for name in _names(metadata.get("requiredMods") or metadata.get("dependencies"))
        if (dependency := _dependency(*name.partition("@")[::2]))
    ]
    return "Legacy Java", result, deps, [], metadata


def _metadata(jar: JarArchive, manifest: dict[str, str], warnings: list[str]):
    choices = [
        name for name in ("quilt.mod.json", "fabric.mod.json", "META-INF/neoforge.mods.toml", "META-INF/mods.toml")
        if name in jar.names
    ]
    if len(choices) > 1:
        warnings.append(f"Multiple loader descriptors were found. Metadata is based on {choices[0]}.")
    try:
        if "quilt.mod.json" in choices:
            result = _quilt(jar)
        elif "fabric.mod.json" in choices:
            result = _fabric(jar)
        elif choices:
            result = _forge(jar, choices[0], manifest)
        else:
            result = _legacy(jar, manifest)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise ValueError(f"The mod metadata in {choices[0] if choices else 'mcmod.info'} is invalid.") from error
    loader, raw_metadata, dependencies, mixins, descriptor = result
    game = next((entry["versions"] for entry in dependencies if entry["id"] == "minecraft"), "")
    fields = {
        "loader": loader,
        "name": _string(raw_metadata.get("name")) or _string(raw_metadata.get("id")) or "Unknown mod",
        "id": _string(raw_metadata.get("id"), 128),
        "version": _string(raw_metadata.get("version"), 128) or "Unknown",
        "minecraft": game or _string(raw_metadata.get("minecraft"), 160) or "Unknown",
        "description": _string(raw_metadata.get("description"), 1200),
        "author": ", ".join(raw_metadata.get("author", []))[:600],
        "license": ", ".join(raw_metadata.get("license", []))[:600],
        "entrypoints": _bounded_strings(raw_metadata.get("entrypoints", []), warnings, "entrypoint"),
        "dependencies": [f"{entry['id']} {entry['versions']}".strip() + (" (optional)" if not entry["required"] else "")
                         for entry in dependencies],
        "otherModIds": raw_metadata.get("otherModIds", []),
    }
    fields["dependencies"] = _bounded_strings(fields["dependencies"], warnings, "dependency")
    fields["otherModIds"] = _bounded_strings(fields["otherModIds"], warnings, "additional mod ID")
    return fields, dependencies, [name for name in mixins if name], descriptor


def _startup_candidate(jar: JarArchive, descriptor: dict, path: str, cls, missing_dependencies: list[str]) -> str | None:
    entries = _object(descriptor.get("entrypoints"))
    targets = _array(entries.get("client"))
    if (
        missing_dependencies
        or type(descriptor.get("schemaVersion")) is not int or descriptor["schemaVersion"] != 1
        or descriptor.get("environment") not in ("client", "*", None)
        or set(entries) != {"client"}
        or len(targets) != 1 or not isinstance(targets[0], str)
        or targets[0].replace(".", "/") != cls.name or path != f"{cls.name}.class"
        or any(descriptor.get(key) for key in (
            "mixins", "accessWidener", "languageAdapters", "jars", "provides", "custom", "recommends", "suggests",
            "breaks", "conflicts"
        ))
        or set(_object(descriptor.get("depends"))) - {"minecraft", "java", "fabricloader"}
        or any(name not in {path, "fabric.mod.json", "META-INF/MANIFEST.MF"} and not _LICENSE.match(name)
               for name in jar.names)
    ):
        return None
    return exact_fabric_client_message(cls)


def _feature(name: str, detail: str, status: str = "unsupported") -> dict[str, str]:
    return {"name": name, "status": status, "detail": detail}


def inspect_jar(path: Path) -> dict:
    warnings = [
        "JAR contents were inspected without executing the original mod.",
        "Declared licences are informational. The uploader must have permission to translate and use the code and assets.",
    ]
    features: list[dict[str, str]] = []
    with open_jar(path) as jar:
        manifest = _manifest(jar)
        metadata, dependencies, mixins, descriptor = _metadata(jar, manifest, warnings)
        assets = [name for name in jar.names if name.startswith("assets/")]
        data = [name for name in jar.names if name.startswith("data/")]
        configs = [
            name for name in jar.names if name.startswith(("config/", "configs/"))
            or name.endswith((".cfg", ".properties")) and not name.startswith(("assets/", "data/"))
        ]
        embedded = [name for name in jar.names if name.lower().endswith(".jar")]
        licence_files = [name for name in jar.names if _LICENSE.match(name)]
        class_paths = [name for name in jar.names if name.endswith(".class")]
        mixins = list(dict.fromkeys([
            *mixins, *manifest.get("mixinconfigs", "").split(","),
            *(name for name in jar.names if name.endswith(".json") and "mixin" in name.lower())
        ]))
        mixins = [name.strip() for name in mixins if name.strip()]
        missing = sorted({
            dep["id"] for dep in dependencies if dep["required"]
            and dep["id"] not in _PLATFORM and dep["id"] not in {metadata["id"], *metadata["otherModIds"]}
        })
        if missing:
            warnings.append("Required third-party Java dependencies are reported as unmapped. Embedded libraries are not loaded.")
        if embedded:
            features.append(_feature("Embedded Java libraries", f"{len(embedded)} nested JARs need separate review."))
        if mixins:
            features.append(_feature("Java Mixins", f"{len(mixins)} Mixin configuration(s) require native hook mapping."))
        if (
            descriptor.get("accessWidener") or descriptor.get("access_widener")
            or any(name.lower().endswith((".accesswidener", "accesstransformer.cfg")) for name in jar.names)
        ):
            features.append(_feature("Java access changes", "An access widener or transformer requires manual review of each target."))
        if "META-INF/coremods.json" in jar.names or "fmlcoreplugin" in manifest:
            features.append(_feature("Java coremods", "A class transformer or legacy loader plugin requires manual native mapping."))
        if configs:
            features.append(_feature("Configuration files", f"{len(configs)} candidate file(s). Persistence semantics need review."))
        if metadata["otherModIds"]:
            warnings.append("The JAR contains multiple mod IDs. Metadata highlights the first one.")
        if not metadata["license"] and not licence_files:
            warnings.append("No original licence metadata or licence file was found.")
        classes = []
        unsupported_classes = 0
        max_major = 0
        preview = 0
        bytes_analyzed = 0
        inspected_methods = 0
        instructions = 0
        skipped_methods = 0
        class_issues: list[str] = []
        hints: dict[str, set[str]] = {key: set() for key in _FEATURES}
        class_references: set[str] = set()
        startup_message = None
        for name in class_paths[:CLASS_COUNT_LIMIT]:
            if name.startswith("META-INF/versions/"):
                unsupported_classes += 1
                if len(class_issues) < 8:
                    class_issues.append(f"{name}: multi-release class is not translated")
                continue
            try:
                size = jar.size(name)
                if size > CLASS_LIMIT or bytes_analyzed + size > CLASS_BUDGET:
                    raise ValueError("Class inspection budget exceeded.")
                bytes_analyzed += size
                cls = read_class(jar.read(name, limit=CLASS_LIMIT))
                max_major = max(max_major, cls.major)
                preview += cls.minor == 65535
                if not _CLASS_NAME.fullmatch(cls.name) or name != f"{cls.name}.class":
                    raise ValueError("Class name is not a conventional JVM archive path.")
            except ValueError as error:
                unsupported_classes += 1
                if len(class_issues) < 8:
                    class_issues.append(f"{name}: {error}")
                continue
            for reference in sorted(cls.references):
                lowered = reference.lower()
                for feature_name, patterns in _FEATURES.items():
                    if len(hints[feature_name]) < 4 and any(pattern in lowered for pattern in patterns):
                        hints[feature_name].add(_string(reference, 160))
                if len(class_references) < 300 and "/" in reference and reference != cls.name:
                    class_references.add(_string(reference, 160))
            for annotation, declared_id in cls.annotations.items():
                if annotation in _FORGE_MOD_ANNOTATIONS and len(metadata["entrypoints"]) < 100:
                    metadata["entrypoints"].append(f"@Mod({_string(declared_id, 120)}): {cls.name.replace('/', '.')}")
            if len(class_paths) == 1 and metadata["loader"] == "Fabric" and not any(
                key in manifest for key in ("fmlcoreplugin", "tweakclass", "main-class", "mixinconfigs", "multi-release")
            ):
                startup_message = _startup_candidate(jar, descriptor, name, cls, missing)
            method_results = []
            for method in cls.methods:
                if inspected_methods >= METHOD_COUNT_LIMIT or instructions >= INSTRUCTION_LIMIT:
                    skipped_methods += 1
                    continue
                result = integer_method(cls, method)
                instructions += len(result.get("instructions", []))
                inspected_methods += 1
                method_results.append(result)
            classes.append({
                "name": cls.name, "superclass": _string(cls.superclass, 180),
                "interfaces": [_string(item, 180) for item in cls.interfaces[:25]], "fieldCount": cls.field_count,
                "major": cls.major, "methodCount": len(cls.methods), "methods": method_results,
            })
        if (
            metadata["loader"] == "Legacy Java" and not metadata["id"] and "mcmod.info" not in jar.names
            and not any(entry.startswith(("@Mod(", "fmlcoreplugin:", "tweakclass:")) for entry in metadata["entrypoints"])
            and not any(reference.startswith(("net/minecraft/", "cpw/mods/fml/")) for reference in class_references)
        ):
            if class_paths:
                raise ValueError("No recognized Minecraft mod metadata or legacy classes were found in the JAR.")
            if not assets and not data:
                raise ValueError("No Minecraft mod metadata, assets or data were found in the JAR.")
            metadata["loader"] = "Resource archive"
        unsupported_classes += max(0, len(class_paths) - CLASS_COUNT_LIMIT)
        for feature_name, evidence in hints.items():
            if evidence:
                features.append(_feature(feature_name, "Class reference evidence: " + ", ".join(sorted(evidence))))
        if any("/class_" in ref or ref.startswith("net/minecraft/src/") for ref in class_references):
            warnings.append("Minecraft intermediary or legacy names were found. Symbol mapping requires the original game version.")
        if max_major > MAX_CLASS_MAJOR or preview:
            features.append(_feature("Java class-file compatibility", f"Class-file major {max_major}; {preview} preview classes. "
                                     f"Deterministic translation supports up to major {MAX_CLASS_MAJOR}, excluding previews."))
        if unsupported_classes:
            warnings.append(f"{unsupported_classes} class file(s) could not be fully inspected.")
        if skipped_methods:
            warnings.append(f"{skipped_methods} method(s) were outside the inspection budget.")
        if class_paths and metadata["entrypoints"] and startup_message is None:
            features.append(_feature("Java loader entrypoints", "Entry-point lifecycle and side effects need a manual Horizon mapping."))
        if class_paths and not metadata["entrypoints"]:
            features.append(_feature("Java initialization", "No complete loader entry-point behavior could be recovered."))
        if metadata["loader"] == "Legacy Java" and not metadata["id"]:
            metadata["id"] = next(
                (entry.split("(", 1)[1].split(")", 1)[0] for entry in metadata["entrypoints"] if entry.startswith("@Mod(")),
                ""
            )
        metadata["entrypoints"] = _bounded_strings(metadata["entrypoints"], warnings, "entrypoint")
        return {
            "metadata": metadata, "features": features, "warnings": warnings,
            "missingDependencies": _bounded_strings(missing, warnings, "required Java dependency"),
            "classes": classes, "classCount": len(class_paths), "classIssues": class_issues,
            "javaMajor": max_major or None, "javaVersion": max_major - 44 if max_major > 44 else None,
            "methodCount": sum(item["methodCount"] for item in classes), "skippedMethods": skipped_methods,
            "resourceCount": len(assets) + len(data), "resources": assets + data,
            "assets": assets, "dataFiles": data, "mixins": mixins[:100], "configurationFiles": configs[:200],
            "textures": [name for name in assets if "/textures/" in name][:200],
            "jsonResources": [name for name in [*assets, *data] if name.endswith(".json")][:200],
            "licenseFiles": licence_files[:50], "embeddedJars": embedded[:100],
            "classReferences": sorted(class_references), "expandedSize": jar.expanded_size,
            "startupMessage": startup_message,
        }
