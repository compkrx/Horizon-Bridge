"""Inspect and convert authorized JARs from a local terminal."""

import argparse
import json
import re
from pathlib import Path

from .browser import convert_browser
from .inspect_jar import inspect_jar


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="Print loader metadata and coverage as JSON.")
    inspect.add_argument("jar", type=Path)
    convert = commands.add_parser("convert", help="Generate portable source, reports, and recipe candidates.")
    convert.add_argument("jars", type=Path, nargs="+")
    convert.add_argument("--output", required=True, type=Path)
    convert.add_argument("--authorized", required=True, action="store_true", help="Confirm conversion rights for these JARs.")
    args = parser.parse_args()
    try:
        if args.command == "inspect":
            data = inspect_jar(args.jar)
            keys = ("metadata", "classCount", "methodCount", "resourceCount", "features", "warnings", "missingDependencies")
            print(json.dumps({key: data[key] for key in keys}, indent=2))
            return 0
        args.output.mkdir(parents=True, exist_ok=True)
        status = 0
        for index, jar in enumerate(args.jars, start=1):
            name = re.sub(r"[^A-Za-z0-9_-]", "_", jar.stem)[:60] or "mod"
            destination = args.output / f"{index:02d}-{name}"
            try:
                result = convert_browser(jar, destination, runtime="cli")
                print(f"{jar.name}: {result['report']['classification']} -> {destination}")
            except (ValueError, OSError) as exc:
                print(f"{jar.name}: {exc}")
                status = 1
        return status
    except (ValueError, OSError) as exc:
        parser.exit(1, f"{exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
