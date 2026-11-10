"""Read a Horizon source package without extracting or evaluating its code."""

import hashlib
import json
import re
import tomllib
from pathlib import Path, PurePosixPath

from .archive import open_jar


MANIFEST = "horizon-native.json"
REVISION = re.compile(r"[a-f0-9]{40}\Z")
ID = re.compile(r"[a-z0-9_]{1,64}\Z")
NOTICE = re.compile(r"(?:license|licence|notice|copying)(?:[. _-]|$)", re.I)
MANIFEST_LIMIT = 1024 * 1024


def text_field(mapping, key, limit):
    value = mapping.get(key)
    return value[:limit] if isinstance(value, str) else ""


def injection_summary(entry):
    hook_version = entry.get("hook_version")
    return {**{key: text_field(entry, key, 300) for key in ("id", "kind", "target", "hook")},
            "hookVersion": hook_version if type(hook_version) is int and 1 <= hook_version <= 0xFFFFFFFF else None,
            "cancellable": entry.get("cancellable") is True}


def inspect_native_package(path):
    path = Path(path)
    with open_jar(path, kind="Horizon package") as archive:
        names = sorted(archive.names)
        if MANIFEST not in names:
            raise ValueError("This package has no horizon-native.json manifest.")
        try:
            manifest = json.loads(archive.read(MANIFEST, limit=MANIFEST_LIMIT))
        except (ValueError, RecursionError) as error:
            raise ValueError("The native package manifest is not readable JSON within the size limit.") from error
        if not isinstance(manifest, dict) or type(manifest.get("schema")) is not int or manifest["schema"] != 1:
            raise ValueError("This inspector supports native package schema 1.")
        mod_id = manifest.get("id")
        if not isinstance(mod_id, str) or not ID.fullmatch(mod_id):
            raise ValueError("The native package has an invalid mod ID.")
        version, game = (manifest.get(key) for key in ("version", "game"))
        horizon, mixins = (manifest.get(key) for key in ("horizon", "mixins"))
        hooks = manifest.get("hooks")
        if (any(not isinstance(value, str) or not 0 < len(value) <= 128 for value in (version, game))
                or any(not isinstance(value, str) or not REVISION.fullmatch(value) for value in (horizon, mixins))
                or (hooks is not None and (type(hooks) is not int or not 1 <= hooks <= 0xFFFFFFFF))):
            raise ValueError("The manifest needs version, game and exact Horizon and Mixins revisions.")
        prefix = f"mixins/{mod_id}/"
        mixin_manifest = f"{prefix}horizon-mixin.toml"
        if mixin_manifest not in names:
            raise ValueError("The native package is missing its horizon-mixin.toml.")
        try:
            mixin = tomllib.loads(archive.read(mixin_manifest, limit=MANIFEST_LIMIT).decode("utf-8"))
        except (ValueError, RecursionError) as error:
            raise ValueError("The mixin manifest is not readable TOML within the size limit.") from error
        identity, compatibility = mixin.get("mod"), mixin.get("compatibility")
        if (not isinstance(identity, dict) or identity.get("id") != mod_id or identity.get("version") != version
                or not isinstance(compatibility, dict) or compatibility.get("horizon_revision") != horizon):
            raise ValueError("The package and mixin manifests disagree on identity or Horizon revision.")
        modules = mixin.get("module", [])
        injections = mixin.get("injection", [])
        if any(not isinstance(group, list) or any(not isinstance(entry, dict) for entry in group)
               for group in (modules, injections)):
            raise ValueError("The mixin module or injection declarations are malformed.")
        notices = [name for name in names if NOTICE.match(PurePosixPath(name).name)]
        with path.open("rb") as package:
            fingerprint = hashlib.file_digest(package, "sha256").hexdigest()
        return {
            "schema": 1, "scope": "static-inspection", "id": mod_id, "version": version, "game": game,
            "horizonRevision": horizon, "mixinsRevision": mixins, "hookApi": hooks, "sha256": fingerprint,
            "entries": len(names), "expandedBytes": archive.expanded_size,
            "rustFiles": sum(name.startswith(prefix) and name.endswith(".rs") for name in names),
            "modules": len(modules), "injections": len(injections),
            "declaredInjections": [injection_summary(entry) for entry in injections[:512]],
            "noticeFiles": notices[:100], "paths": names[:1000],
        }
