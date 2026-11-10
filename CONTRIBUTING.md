# Contributing to HorizonRelay

Use an original or openly licensed fixture when reporting a conversion issue. Include the source loader and game version, the Horizon revision, and the smallest reproducible conversion report. Keep private JARs and proprietary source out of public issues.

Add conversion rules to `engine/horizonrelay`, with tests that cover a successful input and a similar input the rule must skip. Use named hooks from the pinned Horizon source. Keep compiler and game checks separate in reports.

Run `python -m pytest -q` after installing the API and test requirements. For browser changes, build `frontend` with `npm run build:pages` and run `npm run test:pages`. See the [Pages guide](docs/PAGES.md) and [Horizon integration notes](docs/HORIZON.md) for setup.
