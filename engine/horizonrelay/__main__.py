"""Inspect Java JARs and Horizon packages or convert authorized JARs locally."""

import argparse
import json
import re
from pathlib import Path

from .browser import convert_browser
from .inspect_jar import inspect_jar
from .native_package import inspect_native_package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="Print JAR metadata or a native package inspection as JSON.")
    inspect.add_argument("archive", type=Path)
    convert = commands.add_parser("convert", help="Generate portable source, reports, and recipe candidates.")
    convert.add_argument("jars", type=Path, nargs="+")
    convert.add_argument("--output", required=True, type=Path)
    convert.add_argument("--authorized", required=True, action="store_true", help="Confirm conversion rights for these JARs.")
    convert.add_argument("--target", help="Nightly catalog ID or full Horizon revision. Defaults to the catalog's current Nightly.")
    convert.add_argument("--mode", choices=("all", "basic", "inspect"), default="all", help="Choose all supported ports, basic Rust, or inspection only.")
    commands.add_parser("targets", help="Print all recorded Nightly targets as JSON.")
    args = parser.parse_args()
    try:
        if args.command == "inspect":
            if args.archive.suffix.lower() == ".hnmod":
                print(json.dumps(inspect_native_package(args.archive), indent=2))
                return 0
            data = inspect_jar(args.archive)
            keys = ("metadata", "classCount", "methodCount", "resourceCount", "features", "warnings", "missingDependencies")
            print(json.dumps({key: data[key] for key in keys}, indent=2))
            return 0
        catalog_path = Path(__file__).resolve().parents[2] / "catalog/nightlies.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        if args.command == "targets":
            print(json.dumps(catalog, indent=2))
            return 0
        chosen = args.target or catalog["current"]
        selected = next((row for row in catalog["targets"] if chosen in (row["id"], row["horizonRevision"])), None)
        if selected is None:
            parser.error("Unknown Nightly. Run `python -m engine.horizonrelay targets` for the recorded targets.")
        args.output.mkdir(parents=True, exist_ok=True)
        status = 0
        for index, jar in enumerate(args.jars, start=1):
            name = re.sub(r"[^A-Za-z0-9_-]", "_", jar.stem)[:60] or "mod"
            destination = args.output / f"{index:02d}-{name}"
            try:
                result = convert_browser(jar, destination, runtime="cli", target_info=selected, mode=args.mode)
                print(f"{jar.name}: {result['report']['classification']} -> {destination}")
            except (ValueError, OSError) as exc:
                print(f"{jar.name}: {exc}")
                status = 1
        return status
    except (ValueError, OSError) as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
