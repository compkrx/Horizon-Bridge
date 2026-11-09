"""Deterministic conversion for the browser worker. This module never runs tools or mod code."""

import io
import json
import re
import tempfile
import zipfile
from pathlib import Path

from .archive import open_jar
from .horizon import DEVICE_NAMES, ID_PATTERN, _native_source, _notices, target
from .inspect_jar import inspect_jar
from .translate import translate


ITEM = re.compile(r"minecraft:[a-z0-9_]+\Z")
RECIPE_PATH = re.compile(r"[a-z0-9_]+(?:/[a-z0-9_]+)*\.json\Z")
SEMVER = re.compile(r"[0-9]{1,8}\.[0-9]{1,8}\.[0-9]{1,8}\Z")


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=True) + "\n").encode()


def zip_bytes(files):
    result = io.BytesIO()
    with zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            item = zipfile.ZipInfo(name)
            item.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(item, data)
    return result.getvalue()


def vanilla_item(value):
    return isinstance(value, str) and ITEM.fullmatch(value) is not None


def vanilla_recipe(value):
    if not isinstance(value, dict):
        return False
    result = value.get("result")
    if not isinstance(result, dict) or result.keys() - {"id", "count"} or not vanilla_item(result.get("id")):
        return False
    count = result.get("count", 1)
    if type(count) is not int or not 1 <= count <= 64:
        return False
    if value.get("type") == "minecraft:crafting_shapeless":
        ingredients = value.get("ingredients")
        return (not value.keys() - {"type", "result", "ingredients"} and isinstance(ingredients, list)
                and 1 <= len(ingredients) <= 9 and all(vanilla_item(item) for item in ingredients))
    if value.get("type") == "minecraft:crafting_shaped":
        pattern, keys = value.get("pattern"), value.get("key")
        if (value.keys() - {"type", "result", "pattern", "key"} or not isinstance(pattern, list)
                or not 1 <= len(pattern) <= 3 or not isinstance(keys, dict)
                or any(not isinstance(row, str) or not 1 <= len(row) <= 3 for row in pattern)):
            return False
        symbols = set("".join(pattern)) - {" "}
        return (len({len(row) for row in pattern}) == 1 and bool(symbols) and symbols == set(keys)
                and all(re.fullmatch(r"[A-Za-z0-9]", key) and vanilla_item(item) for key, item in keys.items()))
    return False


def recipe_files(archive, resources, mod_id):
    prefix = f"data/{mod_id}/recipe/"
    selected = {}
    for name in resources:
        if len(selected) >= 200:
            break
        if not name.startswith(prefix) or not RECIPE_PATH.fullmatch(name[len(prefix):]) or archive.size(name) > 16_384:
            continue
        try:
            value = json.loads(archive.read(name, limit=16_384))
        except (ValueError, UnicodeError, RecursionError):
            continue
        if vanilla_recipe(value):
            selected[name] = json_bytes(value)
    return selected


def convert_browser(path, destination, progress=lambda _: None, *, runtime="browser"):
    path, destination = Path(path), Path(destination)
    progress("inspecting")
    inspection = inspect_jar(path)
    metadata = inspection["metadata"]
    progress("translating")
    translation = translate(inspection)
    features = [*inspection["features"], *translation["features"]]
    checks = [{"name": "Bounded JAR inspection", "status": "passed",
               "detail": "ZIP entries and class structures were inspected by the portable engine."}]
    warnings = list(inspection["warnings"])
    source = {name: text.encode() for name, text in translation["files"].items()}
    if source:
        source["Cargo.toml"] = (b'[package]\nname = "horizonbridge_port"\nversion = "0.1.0"\n'
                                b'edition = "2021"\n\n[lib]\npath = "src/translated.rs"\n')
    if translation.get("ir"):
        source["bytecode-ir.json"] = json_bytes(translation["ir"])
    with tempfile.TemporaryDirectory() as directory:
        scratch = Path(directory)
        notices = None
        try:
            notices = _notices(path, scratch, metadata)
        except ValueError as exc:
            warnings.append(str(exc))
        native = translation.get("native")
        if native and notices is not None:
            _native_source(scratch / "native", metadata, native["startupMessage"], notices)
            features.append({"name": "Native startup project", "status": "partial",
                             "detail": "Pinned Horizon mixin source is available. Build and validate it with the self-hosted toolchain."})
        for file in scratch.rglob("*"):
            if file.is_file():
                source[file.relative_to(scratch).as_posix()] = file.read_bytes()

    progress("packaging")
    artifacts = {}
    resources = inspection["resources"]
    mod_id = str(metadata.get("id") or "")
    recipes = {}
    if notices is not None and ID_PATTERN.fullmatch(mod_id) and mod_id not in DEVICE_NAMES:
        with open_jar(path, verify=False) as archive:
            recipes = recipe_files(archive, resources, mod_id)
    if recipes:
        version = str(metadata.get("version") or "")
        if not SEMVER.fullmatch(version):
            version = "0.1.0"
        manifest = (f'id = "{mod_id}"\nname = "{mod_id}"\nversion = "{version}"\napi = "0.2"\n'
                    'side = "both"\ncapabilities = ["registries"]\n').encode()
        content = {"horizon-mod.toml": manifest, **recipes}
        source.update({f"content/{name}": value for name, value in content.items()})
        artifacts[f"{mod_id}.hmod"] = ("hmod", zip_bytes(content))
        checks.append({"name": "Recipe export rules", "status": "passed",
                       "detail": "The candidate contains only the manifest and supported vanilla recipe JSON."})
    if resources:
        features.append({"name": "Minecraft assets and data", "status": "partial" if recipes else "unsupported",
                         "detail": f"Exported {len(recipes)} of {len(resources)} resource entries. Portable export supports vanilla-item shaped and shapeless recipes in the mod's namespace."})
    checks.extend([
        {"name": "Official Horizon tools and Rust compilation", "status": "skipped", "detail": "Use the self-hosted edition to run the pinned tools."},
        {"name": "Game behavior", "status": "skipped", "detail": "Test recipes and mods in a disposable Horizon instance."},
    ])
    report = {
        "classification": "partial" if recipes or translation["files"] or (native and notices is not None) else "unsupported",
        "metadata": metadata, "target": target(), "features": features, "validation": checks,
        "diagnostics": [], "warnings": warnings, "missingDependencies": inspection["missingDependencies"],
        "inputBytes": path.stat().st_size,
        "inspection": {key: inspection[key] for key in ("classCount", "methodCount", "javaVersion", "resourceCount", "expandedSize")},
        "resources": {"count": len(resources), "entries": [{"path": name, "exported": name in recipes} for name in sorted(resources)[:1000]]},
        "runtime": runtime,
    }
    report_bytes = json_bytes(report)
    source["conversion-report.json"] = report_bytes
    source["PORTING.md"] = (
        f"# HorizonBridge porting notes\n\nTarget: Minecraft {target()['minecraft']}, Horizon `{target()['horizonRevision']}`.\n\n"
        "The portable engine generates candidate artifacts. Review `conversion-report.json` and the original attribution.\n"
        "Run `cargo check --offline` for the standalone Rust library when present. Use the self-hosted edition for native validation.\n"
        "For recipe bundles, run `cargo horizon-mod check <file.hmod> --json` and test in a disposable world.\n"
    ).encode()
    artifacts["conversion-report.json"] = ("report", report_bytes)
    artifacts["horizonbridge-source.zip"] = ("source", zip_bytes(source))
    destination.mkdir()
    for name, (_, content) in artifacts.items():
        (destination / name).write_bytes(content)
    previews = {name: data.decode("utf-8", errors="replace") for name, data in source.items()
                if name not in {"conversion-report.json", "bytecode-ir.json"} and len(data) <= 100_000
                and name.endswith((".md", ".txt", ".rs", ".toml", ".json"))}
    return {"report": report, "files": dict(list(sorted(previews.items()))[:70]),
            "artifacts": [{"name": name, "kind": kind, "size": len(content)} for name, (kind, content) in artifacts.items()]}
