import { test, expect, type Locator, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

declare global {
    interface Window {
        sentinelTodoSelectionFixture: {
            remote: boolean;
            writes: unknown[][];
            attachments: unknown[];
            clientRefs: (string | undefined)[];
            dragSources: string[];
            copiedSelection?: string;
        };
    }
}

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
            import { subscribeActiveChatAttach } from './src/server/spa/client/react/features/chat/activeChatAttach';
            import { registerCloneBaseUrls } from './src/server/spa/client/react/repos/cloneRegistry';
            const at = '2026-10-12T00:00:00.000Z';
            const item = (id, extra = {}) => ({ id, title: 'Fixture prerequisite', notes: '',
                completionCondition: 'Fixture completion condition', status: 'todo', priority: 'regular',
                type: 'normal', archived: false, revision: 1, createdAt: at, updatedAt: at,
                createdBy: 'sentinel', updatedBy: 'sentinel', jobs: [], ...extra });
            const items = [item('selected', {
                title: 'Selectable fixture title',
                notes: Array.from({ length: 40 }, (_, i) => 'Selectable fixture note ' + i).join('\\n'),
                dependsOn: [{ itemId: 'prerequisite', condition: { kind: 'done' } }],
                references: [{ processId: 'reference', workspaceId: 'parent', title: 'Fixture reference',
                    openLink: '#repos/parent/chats/reference', attachedAt: at, attachedBy: 'user' }],
            }), item('prerequisite')];
            const state = window.sentinelTodoSelectionFixture;
            document.addEventListener('dragstart', event => state.dragSources.push(event.target.tagName), true);
            const remote = state.remote;
            registerCloneBaseUrls(remote ? [{ workspaceId: 'remote-parent', baseUrl: 'http://remote.fixture.test' }] : []);
            const destination = remote ? 'remote-parent' : 'parent';
            subscribeActiveChatAttach(destination, payload => { state.attachments.push(payload); });
            window.fakeClient = {
                sentinelTodos: {
                    get: async () => ({ revision: 1, items }),
                    evaluateDependencies: async (workspace, process, id) =>
                        ({ itemId: id, itemRevision: 1, state: 'waiting', edges: [] }),
                    update: async (workspace, process, id, patch) => {
                        state.writes.push([workspace, process, id, patch]);
                        const found = items.find(item => item.id === id);
                        Object.assign(found, patch, { revision: found.revision + 1 });
                        return { item: found, ledgerRevision: 2 };
                    },
                },
                events: { connect: () => ({ close() {} }) },
            };
            applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true,
                sentinelTodoDependenciesEnabled: true, sentinelTodoScrubberEnabled: false, triggersEnabled: false });
            createRoot(document.getElementById('fixture')).render(<UnifiedTodoTab scopeWorkspaceId="parent"
                chatId="sentinel" owner={{ ownerWorkspaceId: 'parent',
                    ownerRoutingRef: remote ? 'remote-parent' : null, processId: 'sentinel' }} />);
        ` },
        bundle: true, write: false, jsx: 'automatic', format: 'iife', platform: 'browser', loader: { '.css': 'empty' },
        plugins: [{ name: 'isolated-selection-client', setup(builder) {
            builder.onLoad({ filter: /[/\\]cloneRouting\.ts$/ }, () => ({
                contents: 'export const useCocClient = ref => { window.sentinelTodoSelectionFixture.clientRefs.push(ref); return window.fakeClient; };', loader: 'ts',
            }));
            builder.onLoad({ filter: /[/\\]ReposContext\.tsx$/ }, () => ({
                contents: 'export const useReposOptional = () => null;', loader: 'ts',
            }));
            builder.onLoad({ filter: /[/\\]AppContext\.tsx$/ }, () => ({
                contents: 'export const useAppOptional = () => null; export const useApp = () => ({ state: { workspaces: [] } });', loader: 'ts',
            }));
        } }],
    });
    script = result.outputFiles[0].text;
});

async function mount(page: Page, pixels: number, remote = false) {
    await page.route('http://selection.fixture.test/**', route => route.fulfill({
        contentType: 'text/html', body: '<html><body></body></html>',
    }));
    await page.routeWebSocket(/.*/, () => {});
    await page.goto('http://selection.fixture.test/');
    await page.setContent(`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0">
        <div id="fixture" style="position:absolute;left:8px;top:8px;width:${pixels}px;height:560px"></div>
        </body></html>`);
    await page.evaluate(value => {
        window.sentinelTodoSelectionFixture = { remote: value, writes: [], attachments: [], clientRefs: [], dragSources: [] };
    }, remote);
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: script });
    await page.getByTestId('sentinel-todo-row-selected').locator('[data-todo-select]').click();
    await expect(page.getByTestId('sentinel-todo-detail-selected')).toBeVisible();
}

async function selectText(page: Page, locator: Locator, text: string, doubleClick = false) {
    await locator.evaluate(element => {
        element.scrollIntoView({ block: 'start', inline: 'nearest' });
        const pane = element.closest('[data-testid="sentinel-todo-details"]');
        // Keep the gesture away from the scroll pane's native drag auto-scroll edge.
        if (pane) pane.scrollTop = Math.max(0, pane.scrollTop - 80);
    });
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const points = await locator.evaluate((element, target) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
            const index = node.textContent?.indexOf(target) ?? -1;
            if (index < 0) continue;
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + target.length);
            const rect = range.getClientRects()[0];
            return { x: rect.x + 0.5, end: rect.right - 0.5, y: rect.y + rect.height / 2 };
        }
        throw new Error('Fixture text not found');
    }, text);
    if (doubleClick) {
        await page.mouse.dblclick(points.x + 4, points.y);
    } else {
        await page.mouse.move(points.x, points.y);
        await page.mouse.down();
        await page.mouse.move(points.end, points.y, { steps: 12 });
        await page.mouse.up();
    }
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe(text);
}

for (const remote of [false, true]) {
    for (const pixels of [800, 360]) {
        test(`detail text selection preserves controls (${remote ? 'remote' : 'local'}, ${pixels}px)`, async ({ page }) => {
            const errors: string[] = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setViewportSize({ width: 1280, height: 720 });
            await mount(page, pixels, remote);
            const detail = page.getByTestId('sentinel-todo-detail-selected');
            const details = page.getByTestId('sentinel-todo-details');
            const row = page.getByTestId('sentinel-todo-row-selected');
            const originalHash = await page.evaluate(() => location.hash);
            await selectText(page, detail.getByRole('heading').locator('span').first(), 'Selectable fixture title');
            await selectText(page, detail.getByRole('heading').locator('span').first(), 'Selectable', true);
            await selectText(page, detail.locator('dd').first(), 'Fixture completion condition');
            await selectText(page, detail.getByTestId('sentinel-todo-updated-selected'), 'Updated');
            await selectText(page, detail.getByText('Dependencies - ALL required', { exact: true }), 'Dependencies - ALL required');
            await detail.getByRole('button', { name: 'Show notes (40 lines)' }).click();
            const notes = detail.locator('[id$="-notes"]');
            await selectText(page, notes, 'Selectable fixture note 0');
            await page.evaluate(() => {
                document.addEventListener('copy', event => {
                    event.preventDefault();
                    window.sentinelTodoSelectionFixture.copiedSelection = window.getSelection()?.toString() ?? '';
                }, { once: true });
            });
            await page.keyboard.press('ControlOrMeta+c');
            expect(await page.evaluate(() => window.sentinelTodoSelectionFixture.copiedSelection)).toBe('Selectable fixture note 0');
            await selectText(page, notes, 'Selectable', true);
            expect(await page.evaluate(() => location.hash)).toBe(originalHash);
            expect(await page.evaluate(() => window.sentinelTodoSelectionFixture.writes)).toEqual([]);
            expect(await page.evaluate(() => window.sentinelTodoSelectionFixture.dragSources)).toEqual([]);
            await expect(detail.getByTestId('sentinel-todo-notes-toggle-selected')).toHaveAttribute('aria-expanded', 'true');
            await expect(row.locator('[data-todo-select]')).toHaveAttribute('aria-pressed', 'true');
            await expect(row).toHaveAttribute('draggable', 'true');
            await expect(detail).not.toHaveAttribute('draggable', 'true');
            await details.evaluate(element => { element.scrollTop = 100; });
            expect(await details.evaluate(element => element.scrollTop)).toBe(100);
            await detail.getByRole('button', { name: 'Hide notes' }).click();
            await expect(notes).toHaveCount(0);
            await detail.getByRole('button', { name: 'Edit', exact: true }).click();
            await expect(detail.getByLabel('Title', { exact: true })).toHaveValue('Selectable fixture title');
            await detail.getByRole('button', { name: 'Cancel', exact: true }).click();
            const attach = detail.getByRole('button', { name: 'Attach Selectable fixture title as context' });
            await attach.click();
            expect(await page.evaluate(() => window.sentinelTodoSelectionFixture.attachments)).toHaveLength(1);
            await expect(attach).toHaveAttribute('draggable', 'true');
            const transfer = await page.evaluateHandle(() => new DataTransfer());
            await attach.dispatchEvent('dragstart', { dataTransfer: transfer });
            expect(await page.evaluate(() => window.sentinelTodoSelectionFixture.dragSources)).toEqual(['BUTTON']);
            expect(await transfer.evaluate(data => data.getData('text/plain'))).toContain('Selectable fixture title');
            await transfer.dispose();
            await detail.getByRole('link', { name: 'Fixture reference' }).click();
            await expect.poll(() => page.evaluate(() => location.hash)).toBe('#repos/parent/chats/reference');
            await detail.getByRole('button', { name: 'Done', exact: true }).click();
            await detail.getByRole('button', { name: 'Set status' }).click();
            await expect(detail.getByRole('button', { name: 'Reopen' })).toBeVisible();
            await detail.getByRole('button', { name: 'Archive', exact: true }).click();
            await expect(detail.getByRole('button', { name: 'Restore' })).toBeVisible();
            const writes = await page.evaluate(() => window.sentinelTodoSelectionFixture.writes);
            expect(writes).toHaveLength(2);
            expect(writes.every(write => write[0] === 'parent' && write[1] === 'sentinel' && write[2] === 'selected')).toBe(true);
            const clientRefs = await page.evaluate(() => window.sentinelTodoSelectionFixture.clientRefs);
            expect(clientRefs.length).toBeGreaterThan(0);
            expect(clientRefs.every(ref => ref === (remote ? 'remote-parent' : undefined))).toBe(true);
            expect(errors).toEqual([]);
        });
    }
}

test('touch detail retains native selection and scrolling affordances', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 720 }, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    try {
        await mount(page, 360);
        const detail = page.getByTestId('sentinel-todo-detail-selected');
        await detail.getByRole('button', { name: 'Show notes (40 lines)' }).tap();
        const title = detail.getByRole('heading').locator('span').first();
        expect(await title.evaluate(element => {
            const style = getComputedStyle(element);
            return { select: style.userSelect, touch: style.touchAction, draggable: !!element.closest('[draggable="true"]') };
        })).toEqual({ select: 'text', touch: 'auto', draggable: false });
        await title.tap();
        expect(await page.evaluate(() => window.sentinelTodoSelectionFixture.writes)).toEqual([]);
        const details = page.getByTestId('sentinel-todo-details');
        const box = (await details.boundingBox())!;
        const session = await context.newCDPSession(page);
        const x = box.x + box.width / 2;
        const y = box.y + box.height * 0.7;
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 6; step++) {
            await session.send('Input.dispatchTouchEvent', {
                type: 'touchMove', touchPoints: [{ x, y: y - step * 30 }],
            });
            await page.waitForTimeout(30);
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect.poll(() => details.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        await session.detach();
    } finally {
        await context.close();
    }
});
