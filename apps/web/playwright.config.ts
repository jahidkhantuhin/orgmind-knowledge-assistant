import { defineConfig, devices } from '@playwright/test';

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: isCI ? 'list' : 'html',
  timeout: 6 * 60 * 1000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'pnpm --filter @orgmind/api dev',
      url: 'http://localhost:4000/health',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NODE_ENV: 'test' },
    },
    {
      command: 'pnpm --filter @orgmind/web dev',
      url: 'http://localhost:3000/login',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NODE_ENV: 'development' },
    },
  ],
});
