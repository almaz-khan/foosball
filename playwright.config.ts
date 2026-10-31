import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: the production build in a real Chromium, with passkeys from
 * Chromium's virtual authenticator. `bun run e2e` builds first.
 */
const PORT = Number(process.env.E2E_PORT ?? 5182);

export default defineConfig({
  testDir: 'e2e',
  // One database, changed by the tests: one at a time, in order.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    // Passkeys are bound to a hostname; localhost is the one browsers allow over http.
    baseURL: `http://localhost:${PORT}`,
    // Plain http to a production build: say so, as a proxy would (see e2e/serve.ts).
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'bun e2e/serve.ts',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { E2E_PORT: String(PORT) },
  },
});
