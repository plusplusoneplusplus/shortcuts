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

    test('dark mode adds "dark" class to html element', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Switch to dark
        await page.click('#theme-toggle');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

        const hasDarkClass = await page.evaluate(() => document.documentElement.classList.contains('dark'));
        expect(hasDarkClass).toBe(true);

        // Switch to light removes the dark class
        await page.click('#theme-toggle');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

        const hasDarkClassAfterLight = await page.evaluate(() => document.documentElement.classList.contains('dark'));
        expect(hasDarkClassAfterLight).toBe(false);
    });

    test('light mode restores light background color', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);
        const themeBtn = page.locator('#theme-toggle');

        // Cycle to dark then to light
        await themeBtn.click(); // auto → dark
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await themeBtn.click(); // dark → light
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

        const bgColor = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        // Light theme: body is transparent (renders over white) or explicitly white
        expect(['rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)']).toContain(bgColor);
    });

    test('theme toggle sends PATCH /api/preferences', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        const patchRequest = page.waitForRequest(
            req => req.method() === 'PATCH' && req.url().includes('/api/preferences'),
        );

        await page.click('#theme-toggle');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

        const req = await patchRequest;
        const body = JSON.parse(req.postData() ?? '{}');
        expect(body.theme).toBe('dark');
    });

    test('highlight.js stylesheets toggle disabled property with theme', async ({ page, serverUrl }) => {
        await page.goto(serverUrl);

        // Switch to dark — hljs-light disabled, hljs-dark enabled
        await page.click('#theme-toggle');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

        const darkState = await page.evaluate(() => {
            const light = document.getElementById('hljs-light') as HTMLLinkElement | null;
            const dark = document.getElementById('hljs-dark') as HTMLLinkElement | null;
            return { lightDisabled: light?.disabled, darkDisabled: dark?.disabled };
        });
        expect(darkState.lightDisabled).toBe(true);
        expect(darkState.darkDisabled).toBe(false);

        // Switch to light — reversed
        await page.click('#theme-toggle');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

        const lightState = await page.evaluate(() => {
            const light = document.getElementById('hljs-light') as HTMLLinkElement | null;
            const dark = document.getElementById('hljs-dark') as HTMLLinkElement | null;
            return { lightDisabled: light?.disabled, darkDisabled: dark?.disabled };
        });
        expect(lightState.lightDisabled).toBe(false);
        expect(lightState.darkDisabled).toBe(true);
    });
});
