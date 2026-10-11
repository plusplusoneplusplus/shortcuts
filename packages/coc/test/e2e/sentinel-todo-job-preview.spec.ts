import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Real ledger card, preview, positioning and compiled native styles; read-only fixtures.
let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { UnifiedTodoTab } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
            const at = new Date().toISOString();
            const job = (id, kind, execution) => ({ processId: id, workspaceId: 'repo1', kind, execution,
                title: id, sessionId: kind === 'ralph' ? 'session' : undefined,
                openLink: '#repos/repo1/chats/' + id, linkedAt: at });
            const item = { id: 'item', title: 'Keep selection', notes: '', completionCondition: 'Checks pass',
                type: 'normal', priority: 'regular', status: 'in_progress', archived: false, revision: 1,
                createdAt: at, updatedAt: at, createdBy: 'sentinel', updatedBy: 'sentinel',
                jobs: [job('Earlier job', 'local', { state: 'failed', reason: 'Previous attempt failed' }),
                    job('Ralph job', 'ralph', { state: 'running' })],
                references: [{ processId: 'ref', workspaceId: 'repo1', title: 'Reference only', openLink: '#ref', attachedAt: at, attachedBy: 'user' }] };
            window.reads = [];
            window.fakeClient = {
                sentinelTodos: { get: async () => ({ revision: 1, items: [item] }) },
                events: { connect: () => ({ close() {} }) },
                processes: { get: async (...args) => { window.reads.push(args); return { process: { id: args[0], workspaceId: 'repo1', jobPreview: { excerpt: 'Verified keyboard focus. '.repeat(100), source: 'progress', updatedAt: at } } }; } },
                taskGroups: { get: async (...args) => { window.reads.push(args); return { groupId: 'session', workspaceId: 'repo1', type: 'ralph', status: 'running', updatedAt: at, extra: { detailStatus: 'executing', currentIteration: 3, maxIterations: 10 } }; } }
            };
            createRoot(document.getElementById('fixture')).render(<UnifiedTodoTab owner={{ ownerWorkspaceId: 'repo1', ownerRoutingRef: null, processId: 'sentinel' }} />);
        ` },
        bundle: true, write: false, jsx: 'automatic', format: 'iife', platform: 'browser', loader: { '.css': 'empty' },
        plugins: [{ name: 'read-only-owner-client', setup(builder) {
            builder.onLoad({ filter: /[/\\]cloneRouting\.ts$/ }, () => ({ contents: 'export const useCocClient = () => window.fakeClient;', loader: 'ts' }));
        } }],
    });
    script = result.outputFiles[0].text;
});
async function mount(page: Page, dark = false) {
    page.on('pageerror', error => console.error('Fixture page error:', error.message));
    await page.route('http://preview.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.goto('http://preview.test/');
    await page.setContent(`<html class="${dark ? 'dark' : ''}"><body style="margin:0;background:${dark ? '#1e1e1e' : 'white'}"><div id="fixture" style="position:absolute;left:16px;top:40px;width:calc(100vw - 32px);max-width:380px;height:340px"></div><button id="outside" style="position:absolute;top:420px">Outside</button></body></html>`);
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
    await expect(page.getByRole('link', { name: 'Ralph job', exact: true })).toBeVisible();
}
for (const dark of [false, true]) {
    test(`native compact preview fits narrow pane in ${dark ? 'dark' : 'light'} theme`, async ({ page }, info) => {
        const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize({ width: 360, height: 500 }); await mount(page, dark);
        const title = page.getByRole('link', { name: 'Ralph job', exact: true });
        const before = await title.boundingBox();
        await title.hover(); const panel = page.getByRole('dialog'); await expect(panel).toBeVisible();
        await expect(panel).toContainText('Iteration 3 of 10 · executing');
        await expect(panel.getByRole('link', { name: 'Open job ↗' })).toBeInViewport();
        expect(await title.boundingBox()).toEqual(before);
        const box = (await panel.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(24); expect(box.x + box.width).toBeLessThanOrEqual(336);
        expect(box.y).toBeGreaterThanOrEqual(48); expect(box.y + box.height).toBeLessThanOrEqual(372);
        const bg = await panel.evaluate(el => getComputedStyle(el).backgroundColor);
        expect(bg).toBe(dark ? 'rgb(37, 37, 38)' : 'rgb(255, 255, 255)');
        await page.mouse.move(box.x + box.width / 2, box.y + 10); await page.waitForTimeout(300); await expect(panel).toBeVisible();
        await page.screenshot({ path: info.outputPath('native-preview.png') });
        await panel.getByRole('button', { name: 'Close job preview' }).click(); await expect(panel).toBeHidden();
        await expect(title).toBeFocused(); await page.waitForTimeout(300); await expect(panel).toBeHidden();
        await page.getByRole('button', { name: 'In progress Keep selection' }).click();
        const earlier = page.getByRole('link', { name: 'Earlier job', exact: true }); await expect(earlier).toBeVisible();
        await earlier.focus(); await expect(panel).toBeVisible(); await expect(panel).toContainText('Previous attempt failed');
        await expect(panel).toContainText('Verified keyboard focus.');
        await expect(page.getByRole('link', { name: 'Reference only' })).toBeVisible();
        expect(await panel.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
        await earlier.press('ArrowDown'); await expect(panel.getByRole('button', { name: 'Close job preview' })).toBeFocused();
        await page.keyboard.press('Tab'); await expect(panel.getByRole('link', { name: 'Open job ↗' })).toBeFocused();
        await page.keyboard.press('Escape'); await expect(earlier).toBeFocused(); await expect(panel).toBeHidden();
        await page.getByRole('button', { name: 'Preview job: Earlier job' }).click(); await expect(panel).toBeVisible();
        await page.locator('#outside').focus(); await expect(panel).toBeHidden();
        expect(errors).toEqual([]);
    });
}
test('touch info persists and title links preserve native modifier navigation', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 360, height: 500 } });
    const page = await context.newPage(); await mount(page);
    await page.getByRole('button', { name: 'Preview job: Ralph job' }).tap();
    await expect(page.getByRole('dialog')).toBeVisible(); await page.waitForTimeout(300);
    await expect(page.getByRole('dialog')).toBeVisible(); await page.locator('#outside').tap();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('link', { name: 'Ralph job', exact: true }).click({ modifiers: ['Control'] });
    await expect(page).not.toHaveURL(/chats/); await context.close();
});
