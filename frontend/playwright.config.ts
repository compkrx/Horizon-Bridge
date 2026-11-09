import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 75_000,
  expect: {timeout: 20_000},
  use: {
    baseURL: 'http://127.0.0.1:5173',
    channel: process.env.HB_E2E_CHANNEL || undefined,
  },
  webServer: {
    command: 'npm run dev -- --strictPort --port 5173',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
  },
})
