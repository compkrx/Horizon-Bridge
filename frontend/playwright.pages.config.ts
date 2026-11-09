import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e-pages',
  timeout: 90_000,
  expect: {timeout: 40_000},
  use: {baseURL: 'http://127.0.0.1:5175/Horizon-Bridge/', channel: process.env.HB_E2E_CHANNEL || undefined},
  webServer: {
    command: 'npm run preview -- --port 5175 --base /Horizon-Bridge/ --strictPort',
    url: 'http://127.0.0.1:5175/Horizon-Bridge/',
  },
})
