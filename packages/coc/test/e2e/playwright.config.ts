import { defineConfig, devices } from '@playwright/test';
import { resolvePlaywrightWorkers } from './playwright-workers';

export default defineConfig({
    testDir: '.',
    testMatch: '**/*.spec.ts',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: 1,
    workers: resolvePlaywrightWorkers(),
    reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['html', { open: 'never' }]],
    timeout: 30_000,
    use: {
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    // No webServer — each test manages its own server via fixture
});
