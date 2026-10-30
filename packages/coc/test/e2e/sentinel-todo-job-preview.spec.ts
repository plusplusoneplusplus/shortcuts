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
            import { registerCloneBaseUrls } from './src/server/spa/client/react/repos/cloneRegistry';
            const at = new Date().toISOString();
            const job = (id, kind, execution) => ({ processId: id, workspaceId: 'repo1', kind, execution,
                title: id, sessionId: kind === 'ralph' ? 'session' : undefined,
                openLink: '#repos/repo1/chats/' + id, linkedAt: at });
            window.ownerWorkspaces = [
                { id: 'parent', name: 'shortcuts' },
                { id: 'repo1', name: 'shortcuts-2' },
                { id: 'repo1', name: 'remote-checkout-with-a-long-friendly-name',
                    remote: { serverId: 'build-server', serverLabel: 'Build machine with a long configured display name' } }
            ];
            registerCloneBaseUrls([{ workspaceId: 'repo1', serverId: 'build-server', baseUrl: 'https://owner.example' }]);
            const item = { id: 'item', title: 'Keep selection', notes: '', completionCondition: 'Checks pass',
                type: 'normal', priority: 'regular', status: 'in_progress', archived: false, revision: 1,
                createdAt: at, updatedAt: at, createdBy: 'sentinel', updatedBy: 'sentinel',
                targetRepo: { workspaceId: 'repo1', serverId: 'build-server', label: 'Wrong current target' },
                jobs: [{ ...job('Earlier job', 'remote', { state: 'failed', reason: 'Previous attempt failed' }),
                        serverId: 'build-server', openLink: '#repos/remote:build-server:repo1/chats/Earlier-job' },
                    job('Ralph job', 'ralph', { state: 'running' })],
                references: [{ processId: 'ref', workspaceId: 'repo1', title: 'Reference only', openLink: '#ref', attachedAt: at, attachedBy: 'user' }] };
            window.reads = [];
            window.fakeClient = {
                sentinelTodos: { get: async () => ({ revision: 1, items: [item] }) },
                events: { connect: () => ({ close() {} }) },
                processes: { get: async (...args) => { window.reads.push(args); return { process: { id: args[0], workspaceId: 'repo1', jobPreview: { excerpt: 'Verified keyboard focus. '.repeat(100), source: 'progress', updatedAt: at } } }; } },
                taskGroups: { get: async (...args) => { window.reads.push(args); return { groupId: 'session', workspaceId: 'repo1', type: 'ralph', status: 'running', updatedAt: at, extra: { detailStatus: 'executing', currentIteration: 3, maxIterations: 10 } }; } }
            };
            createRoot(document.getElementById('fixture')).render(<UnifiedTodoTab scopeWorkspaceId="parent" owner={{ ownerWorkspaceId: 'parent', ownerRoutingRef: null, processId: 'sentinel' }} />);
        ` },
        bundle: true, write: false, jsx: 'automatic', format: 'iife', platform: 'browser', loader: { '.css': 'empty' },
        plugins: [{ name: 'read-only-owner-client', setup(builder) {
            builder.onLoad({ filter: /[/\\]cloneRouting\.ts$/ }, () => ({ contents: 'export const useCocClient = () => window.fakeClient; export const useCloneBaseUrl = () => undefined;', loader: 'ts' }));
            builder.onLoad({ filter: /[/\\]ReposContext\.tsx$/ }, () => ({ contents: 'export const useReposOptional = () => ({ repos: window.ownerWorkspaces.map(workspace => ({ workspace })), remoteGroupWorkspaces: [] });', loader: 'ts' }));
            builder.onLoad({ filter: /[/\\]AppContext\.tsx$/ }, () => ({ contents: 'export const useApp = () => ({ state: { workspaces: window.ownerWorkspaces } }); export const useAppOptional = () => null;', loader: 'ts' }));
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
        const ownerBadge = page.getByTestId('sentinel-todo-job-owner');
        await expect(ownerBadge).toHaveText('shortcuts-2');
        await expect(page.getByTestId('sentinel-todo-job-mode')).toHaveText('Ralph');
        expect(await page.evaluate(() => (window as Window & { reads: unknown[] }).reads.length)).toBe(0);
        expect(await ownerBadge.evaluate(el => getComputedStyle(el).color)).toBe(dark ? 'rgb(187, 187, 187)' : 'rgb(97, 97, 97)');
        expect(await page.getByTestId('sentinel-todo-row-item').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
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
        const earlierOwner = earlier.locator('..').getByTestId('sentinel-todo-job-owner');
        const fullOwner = 'Build machine with a long configured display name / remote-checkout-with-a-long-friendly-name';
        await expect(earlierOwner).toHaveText(fullOwner);
        await expect(earlierOwner).toHaveAttribute('title', `Job owner: ${fullOwner}`);
        await expect(earlierOwner).toHaveAttribute('aria-label', `Job owner: ${fullOwner}`);
        expect(await earlierOwner.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
        expect(await page.getByTestId('sentinel-todo-row-item').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath('native-owner-badges.png') });
        await earlier.focus(); await expect(panel).toBeVisible(); await expect(panel).toContainText('Previous attempt failed');
        await expect(panel).toContainText('Verified keyboard focus.');
        await expect(page.getByRole('link', { name: 'Reference only' })).toBeVisible();
        expect(await panel.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
        await earlier.press('ArrowDown'); await expect(panel.getByRole('button', { name: 'Close job preview' })).toBeFocused();
        await page.keyboard.press('Tab'); await expect(panel.getByRole('link', { name: 'Open job ↗' })).toBeFocused();
        await page.keyboard.press('Escape'); await expect(earlier).toBeFocused(); await expect(panel).toBeHidden();
        await expect(page.getByRole('button', { name: /^Preview job:/ })).toHaveCount(0);
        await earlier.press('ArrowDown'); await expect(panel).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Close job preview' })).toBeFocused();
        await page.locator('#outside').focus(); await expect(panel).toBeHidden();
        expect(errors).toEqual([]);
    });
}
test('touch title links preserve native and modifier navigation without an info button', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 360, height: 500 } });
    try {
        const page = await context.newPage(); await mount(page);
        const title = page.getByRole('link', { name: 'Ralph job', exact: true });
        await expect(page.getByRole('button', { name: /^Preview job:/ })).toHaveCount(0);
        await expect(title).toHaveAttribute('href', '#repos/repo1/chats/Ralph job');
        await title.click({ modifiers: ['Control'] });
        await expect(page).not.toHaveURL(/chats/);
        await title.tap();
        await expect(page).toHaveURL(/#repos\/repo1\/chats\/Ralph%20job$/);
    } finally {
        await context.close();
    }
});
