# HorizonRelay frontend

The React, TypeScript and Tailwind site uses a same-origin `/api` connection. Vite development and preview forward that path to `http://127.0.0.1:8788` by default. Set `HB_DEV_API_ORIGIN` in the shell to target a different local API. In production, Cloudflare Pages serves the SPA and the Pages Function forwards API requests to the configured backend.

## Run locally

Start the API and worker from the project root as described in the main README. Run these commands in `frontend/` with Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The target picker loads from the API. The browser previews supported loader descriptors using bounded local reads before upload. The service performs the full archive and bytecode inspection.

Use `npm run build` to type-check and build the production bundle in `dist/`. The Cloudflare Pages settings are in the deployment guide.

## Browser tests

Run the API and worker first. In `frontend/`, generate the project’s original Java fixtures with a JDK containing `javac`.

```sh
python ../tests/make_fixtures.py ../.test-fixtures
npx playwright install chromium
npm run test:e2e
```

The test runner starts Vite on port 5173 if that port is free. It uses a new browser context for each case. By default, the tests cover local metadata preview, permissions, Java upload, processor results, highlighted source, authenticated JSON report download, reload and mobile navigation. They use real API responses and a running worker.

On Windows PowerShell, use an installed Edge browser instead of installing Playwright Chromium by setting `$env:HB_E2E_CHANNEL = 'msedge'` before running the tests. Set `$env:HB_E2E_ASSET_FIXTURE = (Resolve-Path ../.test-fixtures/asset.jar).Path` to also test `.hmod` download on a worker with the pinned Horizon content tool installed. `HB_E2E_FIXTURES` optionally points at a different directory containing the generated JARs.
