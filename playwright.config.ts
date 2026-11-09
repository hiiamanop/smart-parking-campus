import { defineConfig } from '@playwright/test';

// Browser E2E tests target the already-running stack (docker compose or dev).
// Start it first:  docker compose up -d
//
// Optional overrides:
//   E2E_ADMIN_URL, E2E_DRIVER_URL, E2E_GATE_URL, E2E_API_URL
//   ADMIN_API_TOKEN, GATE_API_TOKEN
//   PLAYWRIGHT_CHROMIUM_PATH (use an existing Chromium binary)
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    headless: true,
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
