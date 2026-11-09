# GitHub Pages edition

The [HorizonBridge studio](https://compkrx.github.io/Horizon-Bridge/) serves static assets. It starts a WebAssembly worker on demand and performs conversion on the device. The site downloads the worker, the pinned Pyodide runtime, and the Python modules from the same origin. The three optional examples are original fixtures generated at build time. The studio makes no upload requests, stores no JARs across sessions, and needs no service account or API key.

## Capabilities

| Feature | Browser studio | Self-hosted edition |
| --- | --- | --- |
| JAR inspection and static bytecode translation | Up to 12 JARs per batch | One JAR per queued job |
| Files and reports | Source ZIP, resource inventory, highlighted source, JSON | Source ZIP, reports, and authenticated previews |
| Native Fabric startup conversion | Pinned Rust and mixin source | Official mixin application, Cargo checks, and `.hnmod` packaging |
| Content conversion | Candidate `.hmod` for supported shaped or shapeless vanilla-item recipes | Official Horizon asset conversion tools and package validation |
| Java reconstruction and model suggestions | — | Optional Vineflower and administrator-configured Ollama |

Browser recipe export accepts only supported 26.3 JSON forms within the source mod namespace. It skips tags, ingredient alternatives, Java registries, result components, and unknown recipe fields. The browser reports these packages as candidates because the official Horizon checker and game runtime are available separately. Inspect the exported manifest and run `cargo horizon-mod check <bundle.hmod> --json` with the pinned toolchain before testing the recipes.

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

The production build uses relative static asset paths. In repository **Settings → Pages**, choose **GitHub Actions**. The workflow tests the engine and the built studio before deploying. The app and self-hosted code are under MIT. The runtime is separately licensed under MPL-2.0. [Pyodide source and notices](https://github.com/pyodide/pyodide/tree/314.0.7)

## Offline CLI

From the repository root, run the same portable rules with Python 3.11 or later. Each successful input receives a separate result directory.

```sh
python -m engine.horizonbridge inspect mod.jar
python -m engine.horizonbridge convert --authorized --output converted mod.jar recipes.jar
```
