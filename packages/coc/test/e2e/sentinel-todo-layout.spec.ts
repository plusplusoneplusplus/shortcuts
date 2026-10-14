import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let script: string;
let css: string;
test.beforeAll(async () => {
    css = await readFile(path.resolve('src/server/spa/client/dist/bundle.css'), 'utf8');
    const result = await build({
        stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { UnifiedTodoTab } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab';
            import { applyRuntimeConfigPatch } from './src/server/spa/client/react/utils/config';
            const at = '2026-10-12T00:00:00.000Z';
            const item = (id, extra = {}) => ({ id, title: 'Tracked item ' + id, notes: '', completionCondition: 'Reviewed outcome',
                status: 'todo', priority: 'regular', type: 'normal', archived: false, revision: 1,
                createdAt: at, updatedAt: at, createdBy: 'sentinel', updatedBy: 'sentinel', jobs: [], ...extra });
            const items = [item('first', {
                title: 'Keep selected work and its draft', priority: 'high', status: 'in_progress',
                notes: Array.from({ length: 50 }, (_, i) => 'Recorded detail line ' + i).join('\\n'),
                targetRepo: { workspaceId: 'child', label: 'Target repo' },
                jobs: [
                    { processId: 'earlier', workspaceId: 'child', kind: 'local', title: 'Earlier job', linkedAt: at,
                        openLink: '#repos/child/chats/earlier', execution: { state: 'completed' } },
                    { processId: 'latest', workspaceId: 'child', kind: 'local', title: 'Latest job', linkedAt: at,
                        openLink: '#repos/child/chats/latest', mode: 'autopilot', execution: { state: 'running' } }
                ],
                references: [{ processId: 'ref', workspaceId: 'parent', title: 'Reference only',
                    openLink: '#repos/parent/chats/ref', attachedAt: at, attachedBy: 'user' }]
            }), ...Array.from({ length: 25 }, (_, i) => item('row-' + i)),
                item('manual', { title: 'Manual reminder', type: 'manual' }),
                item('done', { title: 'Reviewed work', status: 'done' }),
                item('archived', { title: 'Archived work', archived: true })];
            window.todoFixtureItems = items;
            window.ownerWorkspaces = [{ id: 'parent', name: 'Parent repo' }, { id: 'child', name: 'Child repo' }];
            window.reads = [];
            window.todoReadCount = 0;
            window.fakeClient = {
                sentinelTodos: {
                    get: async () => { window.todoReadCount += 1; return { revision: 1, items }; },
                    update: async (workspace, process, id, patch) => {
                        window.reads.push(['update', workspace, process, id, patch]);
                        const found = items.find(item => item.id === id);
                        Object.assign(found, patch, { revision: found.revision + 1, updatedBy: 'user',
                            ...(typeof patch.outcome === 'string' ? {
                                outcome: { summary: patch.outcome, recordedAt: at, recordedBy: 'user' }
                            } : {}) });
                        return { item: found, ledgerRevision: 2 };
                    }
                },
                events: { connect: () => ({ close() {} }) },
                processes: { get: async (...args) => { window.reads.push(['preview', ...args]);
                    return { process: { id: args[0], workspaceId: 'child',
                        jobPreview: { excerpt: 'Recorded job result', source: 'progress', updatedAt: at } } }; } }
            };
            applyRuntimeConfigPatch({
                sentinelTodoDependenciesEnabled: false, sentinelTodoScrubberEnabled: false, triggersEnabled: false });
            createRoot(document.getElementById('fixture')).render(<UnifiedTodoTab scopeWorkspaceId="parent"
                chatId="sentinel" owner={{ ownerWorkspaceId: 'parent', ownerRoutingRef: null, processId: 'sentinel' }} />);
        ` },
        bundle: true, write: false, jsx: 'automatic', format: 'iife', platform: 'browser', loader: { '.css': 'empty' },
        plugins: [{ name: 'isolated-layout-client', setup(builder) {
            builder.onLoad({ filter: /[/\\]cloneRouting\.ts$/ }, () => ({ contents: 'export const useCocClient = () => window.fakeClient;', loader: 'ts' }));
            builder.onLoad({ filter: /[/\\]ReposContext\.tsx$/ }, () => ({ contents: 'export const useReposOptional = () => ({ repos: window.ownerWorkspaces.map(workspace => ({ workspace })), remoteGroupWorkspaces: [] });', loader: 'ts' }));
            builder.onLoad({ filter: /[/\\]AppContext\.tsx$/ }, () => ({ contents: 'export const useAppOptional = () => null; export const useApp = () => ({ state: { workspaces: window.ownerWorkspaces } });', loader: 'ts' }));
        } }],
    });
    script = result.outputFiles[0].text;
});

async function mount(page: Page, dark: boolean) {
    await page.route('http://layout.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }));
    await page.routeWebSocket('ws://layout.test/**', () => {});
    await page.goto('http://layout.test/');
    await page.setContent(`<html class="${dark ? 'dark' : ''}"><body style="margin:0;background:${dark ? '#1e1e1e' : 'white'}">
        <div id="fixture" style="position:absolute;left:16px;top:16px;width:800px;height:560px"></div></body></html>`);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await expect(page.getByTestId('sentinel-todo-row-first')).toBeVisible();
}
async function width(page: Page, pixels: number) {
    await page.locator('#fixture').evaluate((element, size) => { element.style.width = `${size}px`; }, pixels);
    await expect(page.getByTestId('sentinel-todo-tab')).toHaveAttribute('data-layout', pixels >= 660 ? 'split' : 'single');
}

for (const dark of [false, true]) {
    for (const type of ['normal', 'manual'] as const) {
        test(`selected ${type} completion stays navigable in ${dark ? 'dark' : 'light'} theme`, async ({ page }, info) => {
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
            await page.setViewportSize({ width: 1280, height: 720 });
            await mount(page, dark);
            const id = type === 'manual' ? 'manual' : 'first';
            await page.evaluate(selectedId => {
                const items = (window as Window & { todoFixtureItems: { id: string }[] }).todoFixtureItems;
                const retained = items.filter(item => item.id === selectedId || item.id === 'done');
                items.splice(0, items.length, ...retained);
            }, id);
            await page.getByRole('button', { name: 'Refresh to-do list' }).click();
            const row = page.getByTestId(`sentinel-todo-row-${id}`);
            const details = page.getByTestId('sentinel-todo-details');
            await row.locator('[data-todo-select]').click();
            await details.getByRole('button', { name: 'Done', exact: true }).click();
            await details.getByLabel('Reason for Done (optional)').fill('Fixture verified');
            await details.getByRole('button', { name: 'Set status' }).click();
            await expect(details.getByRole('button', { name: 'Reopen' })).toBeVisible();
            await expect(details.getByTestId(`sentinel-todo-outcome-${id}`)).toHaveText('Fixture verified (you)');
            const done = page.getByTestId(`sentinel-todo-${type === 'manual' ? 'manual-' : ''}done-section`);
            await expect(done.getByRole('button', { name: /^Done \(/ })).toHaveAttribute('aria-expanded', 'true');
            await expect(row.locator('[data-todo-select]')).toHaveAttribute('aria-pressed', 'true');
            await expect(row).toBeVisible();
            await expect(page.getByTestId(type === 'manual' ? 'sentinel-todo-manual-empty' : 'sentinel-todo-no-active')).toBeVisible();
            await page.screenshot({ path: info.outputPath('completed-selection.png') });
            await width(page, 360);
            await expect(row).toBeHidden();
            await page.getByRole('button', { name: 'Back to list' }).click();
            await expect(row).toBeVisible();
            await expect(row.locator('[data-todo-select]')).toBeFocused();
            expect(await page.getByTestId('sentinel-todo-tab').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
            await page.screenshot({ path: info.outputPath('narrow-completed-selection.png') });
            await width(page, 800);
            await done.getByRole('button', { name: /^Done \(/ }).click();
            await expect(row).toHaveCount(0);
            await expect(details.getByText('Select an item to view its details.')).toBeVisible();
            await page.getByRole('button', { name: 'Refresh to-do list' }).click();
            await expect(page.getByRole('button', { name: 'Refresh to-do list' })).toBeEnabled();
            await expect(done.getByRole('button', { name: /^Done \(/ })).toHaveAttribute('aria-expanded', 'false');
            await done.getByRole('button', { name: /^Done \(/ }).click();
            await row.locator('[data-todo-select]').click();
            await details.getByRole('button', { name: 'Reopen' }).click();
            await expect(details.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
            await expect(row.locator('[data-todo-select]')).toHaveAttribute('aria-pressed', 'true');
            await details.getByRole('button', { name: 'Archive' }).click();
            const archived = page.getByTestId(`sentinel-todo-${type === 'manual' ? 'manual-' : ''}archived-section`);
            await expect(archived.getByRole('button', { name: /^Archived \(/ })).toHaveAttribute('aria-expanded', 'true');
            await expect(row).toBeVisible();
            await details.getByRole('button', { name: 'Restore' }).click();
            await expect(details.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
            await expect(row.locator('[data-todo-select]')).toHaveAttribute('aria-pressed', 'true');
            const writes = await page.evaluate(() => (window as Window & { reads: unknown[][] }).reads.filter(read => read[0] === 'update'));
            expect(writes).toHaveLength(4);
            expect(writes[0]).toEqual(['update', 'parent', 'sentinel', id, {
                expectedRevision: 1, status: 'done', statusReason: 'Fixture verified', outcome: 'Fixture verified',
            }]);
            expect(errors).toEqual([]);
        });
    }

    test(`refresh stays beside Add item in narrow and wide layouts in ${dark ? 'dark' : 'light'} theme`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await mount(page, dark);
        const refresh = page.getByRole('button', { name: 'Refresh to-do list' });
        const add = page.getByTestId('sentinel-todo-add');
        const readCount = () => page.evaluate(() => (window as Window & { todoReadCount: number }).todoReadCount);
        for (const pixels of [220, 800]) {
            await page.locator('#fixture').evaluate((element, size) => { element.style.width = `${size}px`; }, pixels);
            await expect(page.getByTestId('sentinel-todo-tab')).toHaveAttribute('data-layout', pixels >= 660 ? 'split' : 'single');
            await expect(refresh).toBeVisible();
            await expect(refresh).toHaveAttribute('title', 'Refresh to-do list');
            await expect(add).toBeVisible();
            const refreshBox = (await refresh.boundingBox())!;
            const addBox = (await add.boundingBox())!;
            expect(refreshBox.x + refreshBox.width).toBeLessThanOrEqual(addBox.x);
            expect(Math.abs(refreshBox.y + refreshBox.height / 2 - addBox.y - addBox.height / 2)).toBeLessThan(1);
            expect(await page.getByTestId('sentinel-todo-tab').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
            const before = await readCount();
            await refresh.focus();
            await page.keyboard.press(pixels === 220 ? 'Enter' : 'Space');
            await expect.poll(readCount).toBe(before + 1);
            await expect(refresh).toHaveAttribute('aria-busy', 'false');
            await expect(refresh).toBeEnabled();
            await expect(page.getByTestId('sentinel-todo-row-first')).toBeVisible();
        }
        expect(await page.evaluate(() => (window as Window & { reads: unknown[] }).reads)).toEqual([]);
    });

    test(`selected detail and responsive drafts fit the actual panel in ${dark ? 'dark' : 'light'} theme`, async ({ page }, info) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewportSize({ width: 1280, height: 720 });
        await mount(page, dark);
        const tab = page.getByTestId('sentinel-todo-tab');
        await expect(tab).toHaveAttribute('data-layout', 'split');
        await expect(page.getByText('Select an item to view its details.')).toBeVisible();
        const row = page.getByTestId('sentinel-todo-row-first');
        const selection = row.locator('[data-todo-select]');
        await selection.focus();
        await page.keyboard.press('Enter');
        await expect(selection).toHaveAttribute('aria-pressed', 'true');
        const details = page.getByTestId('sentinel-todo-details');
        const list = page.getByTestId('sentinel-todo-list');
        const listBox = (await list.boundingBox())!;
        const detailBox = (await details.boundingBox())!;
        expect(listBox.x + listBox.width).toBeLessThan(detailBox.x);
        expect(detailBox.width).toBeGreaterThan(350);
        await expect(details.getByRole('heading', { name: /Keep selected/ })).toBeVisible();
        await expect(details.getByRole('link', { name: 'Earlier job', exact: true })).toBeVisible();
        await expect(details.getByTestId('sentinel-todo-job-owner').first()).toHaveText('Child repo');
        await expect(details.getByRole('link', { name: 'Reference only' })).toBeVisible();
        await details.getByRole('button', { name: 'Show notes (50 lines)' }).click();
        await details.evaluate(element => { element.scrollTop = 100; });
        expect(await details.evaluate(element => element.scrollTop)).toBe(100);
        expect(await list.evaluate(element => element.scrollTop)).toBe(0);
        await page.screenshot({ path: info.outputPath('split-layout.png') });
        await details.getByRole('button', { name: 'Edit', exact: true }).click();
        await details.getByLabel('Notes', { exact: true }).fill('Retain this draft across actual panel resizes');
        await width(page, 360);
        await expect(list).toBeHidden();
        await expect(details.getByLabel('Notes', { exact: true })).toHaveValue('Retain this draft across actual panel resizes');
        await expect(tab).toBeVisible();
        expect(await tab.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath('narrow-detail.png') });
        await page.getByRole('button', { name: 'Back to list' }).click();
        await expect(selection).toBeFocused();
        await expect(details).toBeHidden();
        await expect(list).toBeVisible();
        await page.keyboard.press('ArrowDown');
        const next = page.getByTestId('sentinel-todo-row-row-0').locator('[data-todo-select]');
        await expect(next).toBeFocused();
        await expect(next).toHaveAttribute('aria-pressed', 'false');
        await page.keyboard.press('Home');
        await page.keyboard.press('Space');
        await expect(details.getByRole('heading')).toBeFocused();
        await width(page, 659);
        await expect(list).toBeHidden();
        await width(page, 660);
        await expect(list).toBeVisible();
        await expect(details).toBeVisible();
        expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await expect(details.getByLabel('Notes', { exact: true })).toHaveValue('Retain this draft across actual panel resizes');
        expect(await page.evaluate(() => (window as Window & { reads: unknown[] }).reads)).toEqual([]);
        expect(errors).toEqual([]);
    });
}
