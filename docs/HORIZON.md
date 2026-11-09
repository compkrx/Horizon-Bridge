# Horizon 26.3 compatibility

HorizonBridge targets the November 8, 2026 published Nightly (`fdc87aecdbd116bf1e08adcd062fcbaea8c2e2ca`) and Horizon Mixins `5a64af938ec86b00d53d16a408aabc0038fb3e57`. The pinned Nightly's `NATIVE_HOOKS_API` is 411. The Mixins planning schema is 6 and the native archive manifest schema is 1. On November 8 the upstream Horizon default branch was also observed at `9803a016c4718b154dfc7a1fedf3befadf0fb965` with API 415. The target uses the released Nightly for reproducibility. [Nightly source](https://github.com/horizon-rust/horizon/tree/fdc87aecdbd116bf1e08adcd062fcbaea8c2e2ca) · [Mixins plan schema](https://github.com/horizon-rust/horizon-mixins/blob/5a64af938ec86b00d53d16a408aabc0038fb3e57/crates/horizon-mixins-core/src/plan.rs) · [Native archive reader](https://github.com/horizon-rust/horizon/blob/fdc87aecdbd116bf1e08adcd062fcbaea8c2e2ca/crates/horizon-mods/src/index/native.rs)

The older direct-injection example in the official native-mod template is revision-specific. HorizonBridge uses the Nightly's named client startup hook and the existing native mod list and settings guard. The only automatic game-hook conversion is an exact, closed-world Fabric client initializer that prints one constant string to standard output. It emits that string once per Horizon process on the startup hook when the mod is enabled. Fabric's loader and Horizon call their lifecycle hooks at different points during startup. Other entrypoints, mixins and event callbacks remain manual porting work. [Hook definitions](https://github.com/horizon-rust/horizon/blob/fdc87aecdbd116bf1e08adcd062fcbaea8c2e2ca/crates/horizon-client/src/game/native_hooks.rs) · [Hook catalogue](https://github.com/horizon-rust/horizon/blob/fdc87aecdbd116bf1e08adcd062fcbaea8c2e2ca/native-hooks.json) · [Official native template](https://github.com/horizon-rust/horizon-native-mod-template) · [Make a mod](https://playhorizon.dev/docs/make-a-mod) · [The bundle](https://playhorizon.dev/docs/mod-manifest)

The Horizon-Translator README documents a workflow that reads a mod's license, analyzes Java classes and mixin targets, decompiles with Vineflower and checks mappings against Horizon source. Its code is unavailable for reuse under the repository's stated terms. HorizonBridge was implemented independently and uses upstream Horizon tooling for assets and packaging. [Horizon-Translator README](https://github.com/merenotnoonereal/Horizon-Translator)

## Native validation

The native profile checks or repairs generated formatting with `rustfmt`, applies the generated bundle with `horizon-mixins apply`, and runs `cargo check --locked --offline -p horizon-client --bin horizon-client` in the staged pinned game. HorizonBridge uses the official application and compile steps in a disposable working directory to keep them offline and prevent shared per-job build state. It then uses the unmodified `native/tools/native.py package` from the registry revision `e2e833d68c3d18ea75af537e73a3bd2bd2bd21fb` and `cargo horizon-mod check <file> --json`. A native download is available only after these checks pass. The downloaded source records the exact revisions and includes the original attribution. [Registry tooling](https://github.com/horizon-rust/horizon-mods/blob/e2e833d68c3d18ea75af537e73a3bd2bd2bd21fb/native/tools/native.py) · [Publishing instructions](https://playhorizon.dev/docs/publish-a-mod)

The resulting `.hnmod` contains `horizon-native.json` and the `mixins/<id>/` native source bundle. It has no game executable. The launcher compiles its Rust into the game for a selected instance after a trust prompt. Native source runs with the player's permissions. Review the download before you build it. A successful compiler and package check establishes technical validity for the pinned target. Game behavior remains a separate check. [Mods and data packs](https://playhorizon.dev/docs/mods)

## Content validation

The asset profile runs `horizon-port-pack check <jar> <scratch>` on a prevalidated archive and keeps the upstream reports. A meaningful carried project is built by `cargo horizon-mod build` and checked by `cargo horizon-mod check`. A content download contains supported data and assets and may coexist with a separate native source bundle. HorizonBridge reports a partial result when the official tool detects Java behaviors, unportable assets or approximated registries, or when source paths were renamed or omitted. Pure resource packs and unsupported data layouts may need a separate manual port. [Official asset-port pipeline](https://github.com/horizon-rust/horizon/blob/fdc87aecdbd116bf1e08adcd062fcbaea8c2e2ca/docs/modpacks.md#single-jar-check) · [Content tooling](https://github.com/horizon-rust/horizon/blob/fdc87aecdbd116bf1e08adcd062fcbaea8c2e2ca/docs/mods.md)

## Provision the offline toolchain

From the repository root:

```sh
docker build -f infra/Dockerfile.toolchain -t horizonbridge-toolchain:26.3 .
```

Build time needs network access for the trusted, pinned repositories, Rust components and Cargo dependencies. Conversion time needs a non-root worker with no network, a read-only image, no host or Docker socket mounts, and a writable per-job scratch directory with an enforced disk quota. Allocate approximately 8 GiB of scratch capacity for the first native check and at least 4 GiB of memory. An isolated disk-backed job volume can keep Cargo artifacts out of the memory budget. The native toolchain checks the pinned hook source, Cargo lockfile and packaging script before it runs. Tool binaries and the vendor store are trusted administrator inputs.

The base image exports these settings:

| Setting | Image default |
| --- | --- |
| `HORIZONBRIDGE_ENABLE_ASSETS` | `1` |
| `HORIZONBRIDGE_ENABLE_NATIVE` | `1` |
| `HORIZONBRIDGE_HORIZON_SOURCE` | `/opt/horizon/source` |
| `HORIZONBRIDGE_NATIVE_SCRIPT` | `/opt/horizon/native.py` |
| `HORIZONBRIDGE_CARGO_CONFIG` | `/opt/horizon/vendor-config.toml` |

`cargo-horizon-mod`, `horizon-port-pack`, `horizon-mixins`, `cargo` and `rustfmt` must be on `PATH`. Python must be 3.11 or newer. `TMPDIR` controls placement of the job-local staging, compiler target directory and offline Cargo configuration. The tooling profile is opt-in outside the toolchain image. Keep it disabled on a general-purpose host that accepts public uploads.

## Recheck a generated port

In a trusted checkout of the pinned Horizon registry repository, with Cargo, Rust and `rsync` installed, run these from the checkout root. The registry script may fetch the pinned tool and game sources when preparing the check.

```sh
python3 native/tools/native.py check /absolute/path/to/source/native
python3 native/tools/native.py package /absolute/path/to/source/native
cargo horizon-mod check native/target/<id>-<version>.hnmod --json
```

For the generated `content` project:

```sh
cd /absolute/path/to/source/content
cargo horizon-mod build
cargo horizon-mod check target/horizon-mod/<id>.hmod --json
```

Install into a dedicated launcher instance for behavioral testing. Verify the startup message in the process output or test carried assets in a disposable world. Source archives include the original license notices where present. Check the original license and permission before redistributing either archive.
