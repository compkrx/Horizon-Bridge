"""Snapshot Horizon's published Nightly refs and retain earlier known targets."""

import argparse
import concurrent.futures
import json
import re
import subprocess
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPO = "https://github.com/horizon-rust/horizon"
RAW = "https://raw.githubusercontent.com/horizon-rust/horizon"
SHA = re.compile(r"[0-9a-f]{40}\Z")
SOURCE_REF = re.compile(r"nightly-source/(\d{4}-\d{2}-\d{2})-([0-9a-f]{7,40})\Z")
DATE_REF = re.compile(r"nightly-(\d{4}-\d{2}-\d{2})\Z")
MAX_RESPONSE = 4 * 1024 * 1024


def get_text(url):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=18) as response:
                raw = response.read(MAX_RESPONSE + 1)
            if len(raw) > MAX_RESPONSE:
                raise ValueError(f"Oversized metadata response for {url}")
            return raw.decode("utf-8")
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if attempt == 2 or error.code < 500:
                raise
        except (TimeoutError, urllib.error.URLError):
            if attempt == 2:
                raise
        time.sleep(1 + attempt)


def discover(ref_text):
    refs = {}
    for line in ref_text.splitlines():
        revision, _, ref = line.partition("\t")
        if SHA.fullmatch(revision) and ref.startswith("refs/tags/"):
            refs[ref.removeprefix("refs/tags/")] = revision
    current = refs.get("nightly^{}", refs.get("nightly"))
    releases = {}
    for name, oid in refs.items():
        revision = refs.get(f"{name}^{{}}", oid)
        source = SOURCE_REF.fullmatch(name)
        dated = DATE_REF.fullmatch(name)
        if source and revision.startswith(source[2]):
            day = date.fromisoformat(source[1]).isoformat()
            releases[(day, revision)] = f"{REPO}/tree/{name}"
        elif dated:
            day = date.fromisoformat(dated[1]).isoformat()
            releases.setdefault((day, revision), f"{REPO}/releases/tag/{name}")
    if not current or not any(revision == current for _, revision in releases):
        raise ValueError("The published Nightly does not yet have a dated source or release tag. Retry after upstream publication finishes.")
    return current, releases


def details(revision):
    prefix = f"{RAW}/{revision}"
    version = get_text(f"{prefix}/crates/horizon-core/src/version.rs") or ""
    manifest = get_text(f"{prefix}/crates/horizon-mods/src/manifest.rs") or ""
    hooks = get_text(f"{prefix}/crates/horizon-client/src/game/native_hooks.rs") or ""
    minecraft = re.search(r'const\s+VANILLA_VERSION:\s*&str\s*=\s*"([\w.\-]+)"', version)
    content = re.search(r'const\s+APIS:\s*[^=]+?=\s*\[[^;]*"0\.2"[^;]*\]', manifest)
    hook = re.search(r'const\s+NATIVE_HOOKS_API:\s*u32\s*=\s*(\d+)', hooks)
    # These are the three game methods called by or injected into by our current template.
    has_startup = all(re.search(pattern, hooks) for pattern in (
        r"fn\s+native_client_start\(\s*&mut self\s*\)\s*\{",
        r"fn\s+native_mods\(\s*&mut self\s*,\s*mods:\s*&mut Vec<NativeMod>\s*\)\s*\{",
        r"fn\s+native_on\(\s*&self\s*,\s*mod_id:\s*&str\s*\)\s*->\s*bool\s*\{",
    ))
    mixins = None
    if has_startup and hook:
        launcher = get_text(f"{prefix}/launcher/src/native_mods.rs") or ""
        mixins = re.search(r'const\s+MIXINS_REV:\s*&str\s*=\s*"([0-9a-f]{40})"', launcher)
    return {
        "minecraft": minecraft[1] if minecraft else None,
        "contentApi": "0.2" if content else None,
        "hookApi": int(hook[1]) if hook else None,
        "mixinsRevision": mixins[1] if mixins else None,
        "nativeStartup": bool(minecraft and hook and mixins and has_startup),
    }


def merge(current, discoveries, previous, read_details=details):
    targets = {(row["date"], row["horizonRevision"]): row for row in previous}
    known = {row["horizonRevision"]: row for row in previous}
    new_shas = set(revision for _, revision in discoveries) - known.keys()
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        known.update(zip(sorted(new_shas), pool.map(read_details, sorted(new_shas))))
    for (day, revision), evidence in discoveries.items():
        detail = known[revision]
        targets[(day, revision)] = {
            "id": f"{day}-{revision}", "label": f"Nightly {day} · {revision[:7]}",
            "date": day, "horizonRevision": revision, "evidence": evidence,
            **{key: detail[key] for key in ("minecraft", "contentApi", "hookApi", "mixinsRevision", "nativeStartup")},
        }
    ordered = sorted(targets.values(), key=lambda row: (row["date"], row["horizonRevision"] == current, row["id"]), reverse=True)
    latest = next(row["id"] for row in ordered if row["horizonRevision"] == current)
    return {"schema": 1, "current": latest, "targets": ordered}


def read_catalog(text):
    if text is None:
        return None
    catalog = json.loads(text)
    if catalog.get("schema") != 1 or not isinstance(catalog.get("targets"), list):
        raise ValueError("Unsupported nightly catalog format.")
    return catalog


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "catalog/nightlies.json")
    parser.add_argument("--previous-url")
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    previous = read_catalog(get_text(args.previous_url)) if args.previous_url else None
    seed = read_catalog(args.output.read_text(encoding="utf-8")) if args.output.is_file() else None
    kept = (seed or {}).get("targets", []) + (previous or {}).get("targets", [])
    ref_text = subprocess.check_output([
        "git", "ls-remote", "--tags", f"{REPO}.git", "refs/tags/nightly*",
    ], text=True, timeout=40)
    current, found = discover(ref_text)
    for item in json.loads((ROOT / "catalog/legacy-nightlies.json").read_text(encoding="utf-8")):
        found.setdefault((item["date"], item["revision"]), item["evidence"])
    result = merge(current, found, kept)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.github_output:
        with args.github_output.open("a", encoding="utf-8") as file:
            file.write(f"changed={str(result != previous).lower()}\n")
    print(f"{len(result['targets'])} Nightly targets. Current: {result['current']}")


if __name__ == "__main__":
    main()
