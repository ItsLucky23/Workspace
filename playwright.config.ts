//? Workspaces — Playwright foundation config for deterministic core-flow specs (tests/e2e/*.spec.ts).
//? Deliberately has NO `webServer` block: Vite (config.ports.frontend) + the backend
//? (config.ports.backend) must ALREADY be running (dev server is a developer action, Rule 8 /
//? AI_BROWSER_TESTING.md) — this config never starts or stops them.
//? `.test.mts` files under tests/e2e/ (e.g. httpControl.test.mts) belong to the separate
//? `@luckystack/test-runner` harness (`npm run test`), not Playwright — `testMatch` below
//? excludes them so a bare `npx playwright test` doesn't try to execute them as specs.
import { defineConfig, devices } from '@playwright/test';

import { ports } from './config.ports';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${String(ports.frontend)}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
