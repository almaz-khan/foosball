import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end: the production build in a real Chromium, signed in through a
 * fake login hub (see e2e/serve.ts). `bun run e2e` builds first.
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
    // The address the fake hub sends the browser back to (FOOSBALL_ORIGIN in e2e/serve.ts).
    baseURL: `http://localhost:${PORT}`,
    // Plain http to a production build: say so, as a proxy would (see e2e/serve.ts).
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' },
    trace: 'retain-on-failure',
  },
  projects: [
    // Ann, the org's admin, joins through her invite once; the app specs start signed in as her.
    { name: 'sign-in', testMatch: /sign-in\.setup\.ts/ },
    { name: 'accounts', testMatch: /auth\.spec\.ts/, dependencies: ['sign-in'] },
    {
      name: 'app',
      testIgnore: [/auth\.spec\.ts/, /\.setup\.ts/],
      dependencies: ['sign-in'],
      use: { storageState: 'e2e/.auth/ann.json' },
    },
  ],
  webServer: {
    command: 'bun e2e/serve.ts',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { E2E_PORT: String(PORT) },
  },
});
