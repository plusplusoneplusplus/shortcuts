import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
    const result = await build({
        entryPoints: [path.join(__dirname, 'fixtures/repo-group-chat-list.tsx')],
        bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
        loader: { '.css': 'empty', '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
        define: { 'process.env.NODE_ENV': '"test"' },
    });
    script = result.outputFiles[0].text;
    css = await readFile(path.join(__dirname, '../../src/server/spa/client/dist/bundle.css'), 'utf8');
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test(`compact group chat layout at ${viewport.width}px`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize(viewport);
        await page.route('https://group-chat.test/**', route => {
            const url = route.request().url();
            if (url.endsWith('/bundle.js')) return route.fulfill({ contentType: 'text/javascript', body: script });
            if (url.endsWith('/bundle.css')) return route.fulfill({ contentType: 'text/css', body: css });
            return route.fulfill({ contentType: 'text/html', body: '<html><head><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
        });
        await page.goto('https://group-chat.test/');
        await expect(page.getByTestId('repo-group-chat-row')).toHaveCount(32);
        const groupRow = page.getByTestId('repo-group-chat-row').filter({ hasText: 'Group plan' });
        await expect(groupRow.getByTestId('repo-group-chat-owner-prefix')).toHaveCount(0);
        const first = page.getByTestId('repo-group-chat-row').filter({ hasText: 'Fix relay routing' });
        await expect(first.getByTestId('repo-group-chat-owner-prefix')).toHaveText('Connector /');
        const rowBox = await first.boundingBox();
        const prefixBox = await first.getByTestId('repo-group-chat-owner-prefix').boundingBox();
        expect(prefixBox!.y).toBeGreaterThanOrEqual(rowBox!.y);
        expect(prefixBox!.y).toBeLessThan(rowBox!.y + rowBox!.height);
        await page.getByRole('searchbox').fill('saved query');
        const results = page.getByTestId('repo-group-chat-row');
        await expect(results.first()).toHaveAttribute('data-chat-key', 'local|group-demo|group-plan');
        await expect(results.nth(1)).toHaveAttribute('data-chat-key', 'local|repo-a|queue_active');
        await expect(results.last()).toHaveAttribute('data-chat-key', 'local|repo-a|history-29');
        await expect(page.getByRole('group', { name: 'Search results' })).toBeVisible();
        await expect(page.getByRole('group', { name: 'Pinned', exact: true })).toHaveCount(0);
        await first.focus();
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('owner-header')).toHaveText('Connector / repo-a');
        if (viewport.width < 768) {
            await page.getByRole('button', { name: 'Back to group chats' }).click();
            await expect(page.getByRole('searchbox')).toHaveValue('saved query');
            await expect(page.getByText('Filters', { exact: true })).toBeVisible();
        } else await expect(page.getByTestId('member-git')).toBeVisible();
        expect(errors).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`group-chats-${viewport.width}.png`), fullPage: true });
    });
}
