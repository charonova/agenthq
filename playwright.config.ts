import { defineConfig, devices } from '@playwright/test'

const port = 4799

// End-to-end tests run the built app (`pnpm build`) on a made-up ~/.claude.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    // Use the installed Chrome locally; CI installs Playwright's Chromium.
    ...(process.env.CI ? devices['Desktop Chrome'] : { channel: 'chrome' }),
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `node e2e/serve.mjs`,
    env: { PORT: String(port) },
    url: `http://localhost:${port}/api/offices`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
})
