# GitHub Pages edition

The [HorizonRelay studio](https://horizonrelay.github.io/) serves static assets. It starts a WebAssembly worker on demand and performs conversion on the device. The site downloads the worker, the pinned Pyodide runtime, and the Python modules from the same origin. The three optional examples are original fixtures generated at build time. The studio makes no upload requests, stores no JARs across sessions, and needs no service account or API key.

Studio, Versions, Packages, AI, Guide, and Look have direct URLs at `/studio/`, `/versions/`, `/packages/`, `/ai/`, `/guide/`, and `/look/`. A persistent sidebar on desktop and a compact navigation bar on mobile identify the current page. Older hash bookmarks still work. Switching pages keeps the current tab’s queue, package inspection, AI drafts, and results. Reloading starts a new conversion session.

Versions has a searchable build list and selected-build details. Packages collects generated downloads from the session alongside the existing native package inspector. AI includes an explicit WebGPU adapter check. Guide has seven searchable walkthroughs. Look includes presets, glass and background controls, a motion preference, and reset.

## Capabilities

| Feature | Browser studio | Self-hosted edition |
| --- | --- | --- |
| JAR inspection and static bytecode translation | Up to 12 JARs per batch | One JAR per queued job |
| Files and reports | Source ZIP, resource inventory, highlighted source, JSON | Source ZIP, reports, and authenticated previews |
| Native Fabric startup conversion | Pinned Rust and mixin source | Official mixin application, Cargo checks, and `.hnmod` packaging |
| Content conversion | Candidate `.hmod` for supported shaped or shapeless vanilla-item recipes | Official Horizon asset conversion tools and package validation |
| Existing `.hnmod` inspection | Revision pins, declared mixins, notices and SHA-256 | Same inspection through the offline CLI |
| AI Rust drafts | WebGPU on the selected JVM method | Optional Vineflower and an administrator-configured inference server |

Browser recipe export accepts only supported 26.3 JSON forms within the source mod namespace. It skips tags, ingredient alternatives, Java registries, result components, and unknown recipe fields. The browser reports these packages as candidates because the official Horizon checker and game runtime are available separately. Inspect the exported manifest and run `cargo horizon-mod check <bundle.hmod> --json` with the pinned toolchain before testing the recipes.

## Choosing a Nightly

The target picker defaults to Horizon's current published Nightly. It shows the last 30 UTC calendar days, including today. A day can contain several builds or none. Enable **Show archived Nightlies** or search by hash, date, or Minecraft version to select older targets. The catalog download includes all records. Each report, porting guide, and generated native project records the exact selected commit. The native startup template is available only for revisions with the required source signatures and a known mixins revision. The self-hosted compiler image targets the revision documented in [Horizon integration](HORIZON.md).

GitHub Actions checks upstream hourly and deploys when the catalog changes. The refresh merges immutable `nightly-source` tags, surviving dated release tags, confirmed early announcements, and records from the previous deployment. The archive retains dates, commit IDs, and source links. Horizon controls binary downloads and may prune older release files. [Horizon release and retention policy](https://github.com/horizon-rust/horizon/blob/main/docs/release-flow.md)

## Local build and verification

Use Node.js 24, Python 3.12, and a JDK with `javac` on the path. From `frontend/`, run the following commands.

```sh
npm ci
npm run dev:pages
```

Build the production files and test them at the repository path.

```sh
npm run build:pages
npx playwright install chromium
npm run test:pages
```

The production build uses relative static asset paths and writes an HTML entry for each page so direct links and reloads work at organization and repository paths. In repository **Settings → Pages**, choose **GitHub Actions**. The workflow tests the engine and the built studio before deploying. The app and self-hosted code are under MIT. The runtime is separately licensed under MPL-2.0. [Pyodide source and notices](https://github.com/pyodide/pyodide/tree/314.0.7)

## Offline CLI

From the repository root, run the same portable rules with Python 3.11 or later. Each successful input receives a separate result directory.

```sh
python -m engine.horizonrelay inspect mod.jar
python -m engine.horizonrelay inspect mod.hnmod
python -m engine.horizonrelay targets
python -m engine.horizonrelay convert --authorized --output converted mod.jar recipes.jar
python -m engine.horizonrelay convert --authorized --mode basic --output basic mod.jar
```

Pass `--target` with a catalog ID or full Horizon commit to choose a specific Nightly.

