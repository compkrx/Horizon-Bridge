# HorizonRelay

**[Open the browser studio](https://horizonrelay.github.io/)** · [MIT license](LICENSE) · [Report a bug](https://github.com/compkrx/Horizon-Bridge/issues)

HorizonRelay analyzes Minecraft Java mod JARs and attempts a native or content port for a selected Horizon Nightly. The browser studio tracks the rolling 30-day window and keeps older source targets in its archive.

## Browser studio

Open the GitHub Pages site, add up to 12 JARs, confirm conversion rights, and start a batch. The WebAssembly worker runs the same bounded JAR inspector and bytecode translator as the self-hosted edition. The studio offers original example JARs, a searchable resource inventory, a source explorer, and JSON reports. Input JARs and generated artifacts stay in the current tab.

The browser produces standalone Rust, a pinned native source project for the supported Fabric startup pattern, and candidate `.hmod` bundles for supported shaped or shapeless recipes. Use the self-hosted edition to validate native `.hnmod` output with Horizon’s official tools. See the [GitHub Pages build and capabilities](docs/PAGES.md).

## Self-hosted edition

The web app queues bounded, static inspection and conversion jobs. A separate processor reconstructs Java when Vineflower is configured, lowers a small JVM instruction subset to Rust, and applies verified Horizon-specific mappings. Each result includes `PORTING.md`, a JSON report, and a reviewable source archive. A native or content bundle appears only when its applicable official tools succeed. The self-hosted build image targets Horizon Nightly `fdc87ae` (Minecraft 26.3, hook API 411).

## Run locally

Use Python 3.11 or newer, Node.js 22.12 or newer, and npm. Java and Rust tools are optional for the basic local analysis workflow. The toolchain profile below enables official bundle checks.

```sh
python -m venv .venv
# Activate .venv using your shell, then run the following commands.
python -m pip install -r api/requirements.txt -r tests/requirements.txt
npm --prefix frontend ci
python scripts/dev.py
```

Open `http://127.0.0.1:5173`. Use only test or trusted JARs with the host-native development command. Local jobs are held in `.horizonbridge/` unless `HB_DATA_DIR` is set. The app runs without AI credentials.

To generate original fixtures with a JDK on `PATH`, run `python tests/make_fixtures.py ./fixture-output`. Use `logic.jar` to see standalone Rust and unsupported Java behavior, or `startup.jar` for the narrow Fabric client-startup mapping. The official toolchain is required for `.hnmod` output. The fixture generator also produces a data and texture JAR that demonstrates content analysis and partial export.

## Full isolated processor

Build and run the Docker profile on a Linux host with Landlock ABI 3 or newer. Build-time network access fetches pinned tools and Cargo sources. Job processing has no network access.

```sh
docker build -f infra/Dockerfile.toolchain -t horizonrelay-toolchain:26.3 .
docker compose up --build -d
npm --prefix frontend ci
npm --prefix frontend run dev
```

See [Deployment](docs/DEPLOYMENT.md) for the Pages build, API origin, persistent volume, and deployment checks. See [Security](docs/SECURITY.md) for runtime isolation, retention, and operating assumptions.

## Conversion coverage

| Input behavior | Result |
| --- | --- |
| Fabric, Forge, NeoForge, Quilt, and recoverable legacy metadata | Loader, game and Java version evidence, entry points, resource inventory, dependency hints, and recognized API usage |
| Supported static integer and boolean bytecode | Standalone Rust functions with explicit unsupported instruction and integration notes |
| A narrowly matched Fabric client initializer that prints a constant string | Horizon client-start hook and an official `.hnmod` when structural and compilation checks succeed |
| Allowlisted assets and data accepted by the pinned official porting workflow | Official `.hmod`, with unported files listed |
| General Java Mixins, callbacks, HUD, keybinds, custom commands, configuration persistence, rendering, and networking | Detected where recognizable, reported for manual porting |

`Verified package` means the reported technical checks passed. `Partial port` means useful code or content exists alongside incomplete work. `Unsupported` provides analysis and review materials. Game behavior and launcher trust require separate testing and source review. The launcher builds `.hnmod` Rust source into its client with the player's account permissions.

[Horizon integration](docs/HORIZON.md) · [Engine and translation limits](docs/ENGINE.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)

## Tests

```sh
python -m pytest -q
npm --prefix frontend run build
```

Run the Rust arithmetic fixture with `rustc` on `PATH` or set `HB_RUSTC` to an absolute compiler path. Official-tool tests require the pinned toolchain. Enable them with `HORIZONBRIDGE_ENABLE_ASSETS=1` and `HORIZONBRIDGE_ENABLE_NATIVE=1` after configuring the appropriate tools. The [browser tests](frontend/README.md) use the live API and worker.

Local verification covered desktop and mobile browser flows, malformed archives, loader metadata, Rust arithmetic and control flow, and the pinned official packaging tools. The original startup fixture went through the API and passed native mixin application, the patched Horizon client compilation check, official native packaging, and `cargo horizon-mod check`. A recipe fixture passed the official content build and package check and was downloaded through the browser. The Windows verification used host-local toolchains. Cloudflare deployment, Linux Docker runtime, and in-game behavior require separate checks.

