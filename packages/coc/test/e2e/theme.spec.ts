/**
 * Theme E2E Tests
 *
 * Tests the theme toggle button cycles through auto → dark → light.
 */

import { test, expect } from './fixtures/server-fixture';

test.describe('Theme toggle', () => {
    test('starts with auto theme (uses system preference)', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        const themeBtn = page.locator('#theme-toggle');
        await expect(themeBtn).toBeVisible();

        // In auto mode, data-theme is set based on system preference
        const dataTheme = await page.locator('html').getAttribute('data-theme');
        expect(['light', 'dark']).toContain(dataTheme);
    });

    test('clicking theme button cycles auto → dark → light → auto', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        const themeBtn = page.locator('#theme-toggle');

        // Click 1: auto → dark
        await themeBtn.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

        // Click 2: dark → light
        await themeBtn.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

        // Click 3: light → auto (resolves to system pref)
        await themeBtn.click();
        const dataTheme = await page.locator('html').getAttribute('data-theme');
        expect(['light', 'dark']).toContain(dataTheme);
    });

    test('theme persists across page reload via localStorage', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        const themeBtn = page.locator('#theme-toggle');

        // Set to dark
        await themeBtn.click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

        // Reload page
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    });

    test('dark mode applies dark background color', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Switch to dark
        await page.click('#theme-toggle');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

        // Verify a CSS custom property or computed background changed
        const bgColor = await page.evaluate(() => {
            return getComputedStyle(document.body).backgroundColor;
        });
        // Dark theme should have a dark background (not white)
        expect(bgColor).not.toBe('rgb(255, 255, 255)');
    });
});
