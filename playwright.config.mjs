import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    // A stale locator must fail fast and loudly. Without an action timeout a
    // single missing selector waits for the whole test budget (90 s) and a
    // stale spec can burn the 45-minute CI job before reporting anything.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: 'en-GB',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 0.0.0.0 --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: '1280x720', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: '1366x768', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: '1600x900', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } },
    { name: '1920x1080', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    { name: '2560x1440', use: { ...devices['Desktop Chrome'], viewport: { width: 2560, height: 1440 } } },
    { name: '3840x2160', use: { ...devices['Desktop Chrome'], viewport: { width: 3840, height: 2160 } } }
  ]
});
