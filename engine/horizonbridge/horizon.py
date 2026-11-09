"""Official Horizon build and package tools for the pinned 26.3 target."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from pathlib import Path
from typing import Callable

from .archive import open_jar

HORIZON = "fdc87aecdbd116bf1e08adcd062fcbaea8c2e2ca"
MIXINS = "5a64af938ec86b00d53d16a408aabc0038fb3e57"
REGISTRY = "e2e833d68c3d18ea75af537e73a3bd2bd2bd21fb"
HOOK_API = 411
MINECRAFT = "26.3"
HOOK_FILE = "crates/horizon-client/src/game/native_hooks.rs"
HOOK_FILE_SHA256 = "037f761ed32667825680bd0b607d04138fb466a6080772310dd304003aeb6ef9"
LOCK_SHA256 = "ed70b2aa7ff3ad35a40aee8e65c4471670551dd11d02ac0269ff9fff7c6be068"
PACKAGER_SHA256 = "40aebf8f87d90fad0db7a6a34fdd95fd3a2f88330681053b6d74751860a3077b"
ID_PATTERN = re.compile(r"[a-z0-9_]{1,64}\Z")
VERSION_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,62}[A-Za-z0-9+_-]\Z|[A-Za-z0-9]\Z")
DEVICE_NAMES = {"con", "prn", "aux", "nul"} | {f"{prefix}{n}" for prefix in ("com", "lpt") for n in range(1, 10)}
NOTICE_PATTERN = re.compile(r"(?:META-INF/)?(?:LICEN[CS]E|COPYING|NOTICE|AUTHORS)(?:[-._][A-Z0-9._-]+)?\Z", re.I)


def target() -> dict:
    return {
        "id": "26.3-fdc87ae",
        "label": "Horizon Nightly · Nov 8, 2026 · fdc87ae",
        "minecraft": MINECRAFT,
        "horizonRevision": HORIZON,
        "mixinsRevision": MIXINS,
        "hookApi": HOOK_API,
    }


def _feature(result: dict, name: str, status: str, detail: str) -> None:
    result["features"].append({"name": name, "status": status, "detail": detail})


def _validation(result: dict, name: str, status: str, detail: str) -> None:
    result["validation"].append({"name": name, "status": status, "detail": detail})


def _tool_env(scratch: Path) -> dict[str, str]:
    # PATH and system variables are provisioned by the deployment, never a job.
    keep = {"PATH", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "PATHEXT", "RUSTUP_HOME", "CARGO_HOME"}
    env = {key: value for key, value in os.environ.items() if key.upper() in keep}
    env.update({"CARGO_NET_OFFLINE": "true", "HOME": str(scratch), "TMPDIR": str(scratch),
                "TMP": str(scratch), "TEMP": str(scratch)})
    return env


def _run(result: dict, name: str, argv: list[str], cwd: Path, env: dict[str, str],
         timeout: int, detail: str) -> bool:
    # Bound diagnostics in memory and reports. The isolated processor limits disk and process lifetime.
    log = Path(env["TMPDIR"]) / "horizon-tool.log"
    try:
        with log.open("wb") as output:
            completed = subprocess.run(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=subprocess.STDOUT, timeout=timeout, check=False)
        if completed.returncode == 0:
            _validation(result, name, "passed", detail)
            return True
        with log.open("rb") as output:
            output.seek(max(0, log.stat().st_size - 12_000))
            message = output.read().decode("utf-8", errors="replace").strip()
        # Avoid disclosing internal scratch paths and strip terminal control characters.
        message = message.replace(str(cwd), "<project>").replace(str(log.parent), "<scratch>")
        message = "".join(char for char in message if char.isprintable() or char in "\n\t")
        result["diagnostics"].append(f"{name} (exit {completed.returncode})\n{message}")
    except subprocess.TimeoutExpired:
        result["diagnostics"].append(f"{name} exceeded its {timeout}-second tool deadline.")
    except OSError as error:
        result["diagnostics"].append(f"{name} could not start ({type(error).__name__}).")
    finally:
        log.unlink(missing_ok=True)
    _validation(result, name, "failed", "The tool did not pass. See diagnostics.")
    return False


def _rust_string(value: str) -> str:
    escaped = []
    for char in value:
        if char in ('"', "\\"):
            escaped.append("\\" + char)
        elif 32 <= ord(char) <= 126:
            escaped.append(char)
        else:
            escaped.append(f"\\u{{{ord(char):x}}}")
    return '"' + "".join(escaped) + '"'


def _notices(path: Path, source_dir: Path, metadata: dict) -> bytes:
    lines = ["Source mod attribution", "", f"Name: {metadata.get('name', '')}",
             f"ID: {metadata.get('id', '')}", f"Version: {metadata.get('version', '')}",
             f"Author: {metadata.get('author', '')}", f"License: {metadata.get('license', '')}",
             "", "Port created with HorizonBridge. The original license and any permissions apply.", ""]
    parts = ["\n".join(lines).encode("utf-8", errors="replace")]
    with open_jar(path, verify=False) as archive:
        names = [name for name in archive.names if NOTICE_PATTERN.fullmatch(name)]
        if sum(archive.size(name) for name in names) > 512 * 1024 or len(names) > 24:
            raise ValueError("The original notices exceed the attribution export limit.")
        for name in names:
            data = archive.read(name, limit=512 * 1024)
            destination = source_dir / "notices" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)
            parts.extend([f"\n--- {name} ---\n".encode("utf-8"), data, b"\n"])
    notice = b"".join(parts)
    (source_dir / "ATTRIBUTION.txt").write_bytes(notice)
    return notice


def _native_source(project: Path, metadata: dict, message: str, notices: bytes) -> tuple[str, str]:
    original_id = str(metadata.get("id") or "")
    mod_id = original_id
    if not ID_PATTERN.fullmatch(mod_id) or mod_id in DEVICE_NAMES:
        mod_id = "hb_" + hashlib.sha256(original_id.encode("utf-8", errors="replace")).hexdigest()[:24]
    version = str(metadata.get("version") or "")
    if not VERSION_PATTERN.fullmatch(version):
        version = "0.1.0"
    bundle = project / "mixins" / mod_id
    bundle.mkdir(parents=True, exist_ok=True)
    (project / "LICENSE").write_bytes(notices)
    compatibility = {
        "game": MINECRAFT, "hooks": HOOK_API, "horizon_revision": HORIZON,
        "horizon_repository": "https://github.com/horizon-rust/horizon",
        "horizon_mixins_revision": MIXINS,
        "horizon_mixins_repository": "https://github.com/horizon-rust/horizon-mixins",
        "mixin_schema": 6,
    }
    (project / "compatibility.json").write_text(json.dumps(compatibility, indent=2) + "\n", encoding="utf-8")
    (bundle / "horizon-mixin.toml").write_text(f'''[mod]
id = "{mod_id}"
version = "{version}"
priority = 100

[compatibility]
horizon_revision = "{HORIZON}"

[[injection]]
id = "client-start"
kind = "HEAD"
target = "horizon_client::game::native_hooks::Game<'_>::native_client_start"
helper = "client_start.rs"
bindings = [{{ name = "game", ty = "&mut crate::game::Game<'_>", value = "&mut *self" }}]

[[injection]]
id = "list"
kind = "HEAD"
target = "horizon_client::game::native_hooks::Game<'_>::native_mods"
helper = "list.rs"
bindings = [{{ name = "mods", ty = "&mut Vec<crate::game::native_hooks::NativeMod>", value = "&mut *mods" }}]
''', encoding="utf-8", newline="\n")
    name = _rust_string(str(metadata.get("name") or mod_id)[:200])
    (bundle / "client_start.rs").write_text(f'''fn client_start(game: &mut crate::game::Game<'_>) {{
    static STARTED: std::sync::Once = std::sync::Once::new();
    if game.native_on("{mod_id}") {{
        STARTED.call_once(|| println!("{{}}", {_rust_string(message)}));
    }}
}}
''', encoding="utf-8", newline="\n")
    (bundle / "list.rs").write_text(f'''fn list_mod(mods: &mut Vec<crate::game::native_hooks::NativeMod>) {{
    mods.push(crate::game::native_hooks::NativeMod {{
        id: "{mod_id}".into(),
        title: {name}.into(),
        description: "Prints the original Fabric mod's startup message.".into(),
        keys: Vec::new(),
    }});
}}
''', encoding="utf-8", newline="\n")
    return mod_id, version


def _hash_matches(path: Path, sha256: str) -> bool:
    return path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == sha256


def _publish(result: dict, package: Path, artifact_dir: Path, kind: str) -> None:
    destination = artifact_dir / package.name
    shutil.copyfile(package, destination)
    result["artifacts"].append({"name": destination.name, "kind": kind, "size": destination.stat().st_size})


def _native_tools(result: dict, project: Path, mod_id: str, version: str, scratch: Path,
                  env: dict[str, str], artifact_dir: Path, progress: Callable[[str], None]) -> None:
    source = Path(os.environ.get("HORIZONBRIDGE_HORIZON_SOURCE", "/opt/horizon/source"))
    packager = Path(os.environ.get("HORIZONBRIDGE_NATIVE_SCRIPT", "/opt/horizon/native.py"))
    tools = {name: shutil.which(name) for name in ("horizon-mixins", "cargo", "cargo-horizon-mod", "rustfmt")}
    enabled = os.environ.get("HORIZONBRIDGE_ENABLE_NATIVE") == "1"
    toolchain_ok = enabled and all(tools.values()) and _hash_matches(source / HOOK_FILE, HOOK_FILE_SHA256)
    if not (toolchain_ok and _hash_matches(source / "Cargo.lock", LOCK_SHA256)
            and _hash_matches(packager, PACKAGER_SHA256)):
        detail = "The pinned isolated native toolchain is unavailable. The source project can be checked manually."
        _validation(result, "Native toolchain", "skipped", detail)
        _feature(result, "Native package", "partial", detail)
        return

    config = os.environ.get("HORIZONBRIDGE_CARGO_CONFIG")
    if config:
        home = scratch / "cargo-home"
        home.mkdir()
        shutil.copyfile(config, home / "config.toml")
        env["CARGO_HOME"] = str(home)
    env["CARGO_TARGET_DIR"] = str(scratch / "cargo-target")
    env["CARGO_BUILD_JOBS"] = "2"
    env["CARGO_PROFILE_DEV_DEBUG"] = "0"
    env["CARGO_INCREMENTAL"] = "0"
    progress("checking")
    files = sorted(str(file) for file in (project / "mixins" / mod_id).glob("*.rs"))
    if not _run(result, "Native Rust formatting", [tools["rustfmt"], "--edition", "2024", "--check", *files],
                project, env, 15, "Generated Rust passed rustfmt."):
        initial_check = result["validation"][-1]
        initial_diagnostic = len(result["diagnostics"]) - 1
        # Formatting is the only automatic repair. No arbitrary Rust is accepted from the input or AI.
        progress("repairing")
        if not _run(result, "Native formatting repair", [tools["rustfmt"], "--edition", "2024", *files],
                    project, env, 15, "Applied rustfmt to the generated source."):
            return
        if not _run(result, "Native Rust formatting recheck", [tools["rustfmt"], "--edition", "2024", "--check", *files],
                    project, env, 15, "Repaired source passed rustfmt."):
            return
        initial_check.update(status="skipped", detail="The first format check requested changes. The repaired source passed its recheck.")
        del result["diagnostics"][initial_diagnostic]
        progress("checking")
    staged = scratch / "staged"
    if not _run(result, "Native mixin application", [tools["horizon-mixins"], "apply", "--workspace", str(source),
                 "--mods", str(project / "mixins"), "--out", str(staged)], scratch, env, 120,
                f"The pinned mixins applied to Horizon {HORIZON[:7]} (hook API {HOOK_API})."):
        return
    if not _run(result, "Horizon client compilation check", [tools["cargo"], "check", "--locked", "--offline",
                 "-p", "horizon-client", "--bin", "horizon-client"], staged, env, 1200,
                f"cargo check passed for the patched Horizon {HORIZON[:7]} client."):
        return

    progress("packaging")
    # The official script places output relative to itself. Its scratch-local copy prevents job collisions.
    script = scratch / "native" / "tools" / "native.py"
    script.parent.mkdir(parents=True)
    shutil.copyfile(packager, script)
    if not _run(result, "Official native packaging", [sys.executable, str(script), "package", str(project)], scratch,
                env, 30, "The pinned horizon-mods packager wrote the native source archive."):
        return
    package = scratch / "native" / "target" / f"{mod_id}-{version}.hnmod"
    if _run(result, "Native registry package check", [tools["cargo-horizon-mod"], "check", str(package), "--json"],
            scratch, env, 30, "cargo horizon-mod check accepted the native source bundle."):
        _publish(result, package, artifact_dir, "hnmod")


def _content_tools(path: Path, names: list[str], source_dir: Path, artifact_dir: Path, result: dict,
                   scratch: Path, env: dict[str, str], progress: Callable[[str], None], metadata: dict) -> None:
    port = shutil.which("horizon-port-pack")
    package_cli = shutil.which("cargo-horizon-mod")
    if os.environ.get("HORIZONBRIDGE_ENABLE_ASSETS") != "1" or not (port and package_cli):
        detail = "Enable the isolated toolchain profile to carry over assets with Horizon's official tools."
        _validation(result, "Content toolchain", "skipped", detail)
        _feature(result, "Asset and data carry-over", "unsupported", detail)
        return

    # The official CLI writes the original licence into a single-line TOML comment.
    license_value = str(metadata.get("license") or "")
    if any(not char.isprintable() for char in license_value):
        _feature(result, "Asset and data carry-over", "unsupported", "The declared license contains control characters.")
        return

    progress("checking")
    carry = scratch / "carry-work"
    if not _run(result, "Official asset carry-over", [port, "check", str(path), str(carry)], scratch, env, 180,
                "horizon-port-pack inspected the JAR and reported portable content."):
        _feature(result, "Asset and data carry-over", "unsupported", "Horizon's carry-over tool could not read this input.")
        return
    check_path = carry / "check.json"
    check = json.loads(check_path.read_text(encoding="utf-8"))
    shutil.copyfile(check_path, source_dir / "horizon-content-check.json")
    if any(not char.isprintable() for char in check.get("license", "")):
        _feature(result, "Asset and data carry-over", "unsupported", "The original license declaration is not a single line.")
        return
    report_path = carry / "carry-report.json"
    if report_path.is_file():
        shutil.copyfile(report_path, source_dir / "horizon-carry-report.json")
    manifest_path = carry / "carry" / "horizon-mod.toml"
    if check.get("verdict") == "no" or not manifest_path.is_file():
        _feature(result, "Asset and data carry-over", "unsupported", check.get("summary", "No supported content was found."))
        return
    manifest = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
    mod_id = str(manifest.get("id", ""))
    if (mod_id != check.get("mod_id") or mod_id != metadata.get("id")
            or not ID_PATTERN.fullmatch(mod_id) or mod_id in DEVICE_NAMES):
        _feature(result, "Asset and data carry-over", "unsupported", "The carried mod did not retain a safe, consistent mod ID.")
        return

    staged = manifest_path.parent
    content = source_dir / "content"
    content.mkdir()
    shutil.copyfile(manifest_path, content / "horizon-mod.toml")
    for subtree in ("assets", "data"):
        if (staged / subtree).is_dir():
            shutil.copytree(staged / subtree, content / subtree)
    kept = {file.relative_to(content).as_posix() for file in content.rglob("*") if file.is_file()}
    omitted = set(names) - kept
    detail = str(check.get("summary", "Horizon produced a content project."))
    if omitted:
        detail += f" {len(omitted)} input paths were renamed or omitted. See the carry-over report."
    if report_path.is_file():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        approximated = bool(report.get("blocks") or report.get("items") or report.get("recipes_kept"))
    else:
        approximated = True
    if approximated:
        detail += " Some registries use inferred vanilla templates or retain unsupported recipe types."
    status = "partial" if check.get("verdict") != "works" or omitted or approximated else "translated"
    _feature(result, "Asset and data carry-over", status, detail)
    if check.get("skipped"):
        result["warnings"].extend(str(item)[:500] for item in check["skipped"][:30])

    progress("packaging")
    if not _run(result, "Official content packaging", [package_cli, "build"], staged, env, 120,
                "cargo horizon-mod build wrote the code-free content package."):
        return
    package = staged / "target" / "horizon-mod" / f"{mod_id}.hmod"
    if _run(result, "Content registry package check", [package_cli, "check", str(package), "--json"],
            staged, env, 60, "cargo horizon-mod check accepted the package's content fence and manifest."):
        _publish(result, package, artifact_dir, "hmod")
        result["warnings"].append("The source download includes original attribution and license notices. Keep those with the content package where required.")


def convert(path: Path, inspection: dict, translation: dict, source_dir: Path, artifact_dir: Path,
            progress: Callable[[str], None]) -> dict:
    """Prepare official-tool candidates. Publish a package only after its applicable checks pass."""
    path = path.resolve()
    source_dir = source_dir.resolve()
    artifact_dir = artifact_dir.resolve()
    source_dir.mkdir(parents=True, exist_ok=True)
    artifact_dir.mkdir(parents=True, exist_ok=True)
    result = {"features": [], "validation": [], "diagnostics": [], "warnings": [], "artifacts": []}
    metadata = inspection.get("metadata", inspection)
    startup = translation.get("native") or {}
    message = startup.get("startupMessage")
    with open_jar(path, verify=False) as jar:
        content_names = [name for name in jar.names if name.startswith(("assets/", "data/"))]
    try:
        notices = _notices(path, source_dir, metadata)
    except ValueError as error:
        _feature(result, "Horizon packaging", "unsupported", str(error))
        return result

    with tempfile.TemporaryDirectory(prefix="hb-horizon-") as directory:
        scratch = Path(directory).resolve()
        env = _tool_env(scratch)
        if isinstance(message, str) and not any(0xD800 <= ord(char) <= 0xDFFF for char in message):
            native = source_dir / "native"
            mod_id, version = _native_source(native, metadata, message, notices)
            if mod_id != metadata.get("id") or version != metadata.get("version"):
                result["warnings"].append(f"Native package identity normalized to {mod_id} {version}; original identity is in the attribution.")
            _native_tools(result, native, mod_id, version, scratch, env, artifact_dir, progress)
            result["warnings"].append("The launcher compiles native Rust into Horizon with the player's permissions. Review the source and trust its origin before building it.")
        if content_names:
            _content_tools(path, content_names, source_dir, artifact_dir, result, scratch, env, progress, metadata)
    if result["artifacts"]:
        _validation(result, "Game behavior", "skipped", "No game runtime or multiplayer behavior was tested for this upload.")
    return result
