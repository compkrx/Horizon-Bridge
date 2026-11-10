"""Compatibility entry point for the original offline command."""

from engine.horizonrelay.__main__ import main


if __name__ == "__main__":
    raise SystemExit(main())
