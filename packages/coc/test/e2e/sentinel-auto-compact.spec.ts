/**
 * Sentinel auto-compact section of the composer context-usage popover, driven
 * in a real browser against the isolated e2e server. The process record and the
 * auto-compact endpoints are route-stubbed, so no conversation is compacted.
 */

import * as fs from 'fs';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace } from './fixtures/seed';
import type { Locator, Page, Route } from '@playwright/test';

const LIMIT = 922_000;
// The dashboard's seen-state routes require the product's SQLite store.
test.use({ processStoreBackend: 'sqlite' });

async function setup(serverUrl: string, dataDir: string, prefix: string, mode: 'sentinel' | 'ask') {
    const rootPath = fs.mkdtempSync(path.join(dataDir, `e2e-sac-${prefix}-`));
    const wsId = `${prefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, prefix, rootPath);
    const task = await seedQueueTask(serverUrl, { type: 'chat', repoId: wsId, payload: { workspaceId: wsId, prompt: 'Watch the repo', mode } });
    return { wsId, taskId: task.id as string, cleanup: () => safeRmSync(rootPath) };
}

/** Stub the process record and the auto-compact endpoints; returns captured writes. */
async function stubProcess(page: Page, wsId: string, taskId: string, mode: 'sentinel' | 'ask') {
    const processId = `queue_${taskId}`;
    const writes: { method: string; url: string; body: unknown }[] = [];
    let autoCompact: Record<string, unknown> | undefined;
    let tokenLimit: number | undefined = LIMIT;
    let model = 'claude-opus-4.8';
    let failNext = false;
    let nextWrite: Promise<void> | undefined;
    const processBody = () => ({
        process: {
            id: processId, status: 'completed', type: 'chat', title: 'Sentinel', sdkSessionId: 'e2e-session', payload: { prompt: 'Watch the repo', mode },
            metadata: { type: 'chat', workspaceId: wsId, mode, model, ...(autoCompact ? { autoCompact } : {}) },
            tokenLimit, currentTokens: 720_000, systemTokens: 12_000, toolDefinitionsTokens: 30_000, conversationTokens: 650_000,
            conversationTurns: [
                { role: 'user', content: 'Watch the repo', timestamp: new Date().toISOString(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'Watching.', timestamp: new Date().toISOString(), turnIndex: 1, timeline: [] },
            ],
            startTime: new Date().toISOString(),
        },
    });
    await page.route(`**/api/processes/${processId}**`, async (route: Route) => {
        const request = route.request();
        const url = request.url();
        if (url.includes('/stream')) return route.fallback();
        if (url.includes('/auto-compact')) {
            expect(request.method()).toBe('PUT');
            expect(new URL(url).searchParams.getAll('workspace')).toEqual([wsId]);
            writes.push({ method: request.method(), url, body: request.postDataJSON() });
            const pending = nextWrite;
            nextWrite = undefined;
            if (pending) await pending;
            if (failNext) {
                failNext = false;
                return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Isolated save failure' }) });
            }
            autoCompact = url.includes('/resume')
                ? { ...autoCompact, consecutiveFailures: 0, paused: undefined }
                : { ...(request.postDataJSON() as object), consecutiveFailures: 0 };
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ autoCompact }) });
        }
        if (request.method() !== 'GET') return route.fallback();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(processBody()) });
    });
    return {
        writes, processId,
        failNextWrite: () => { failNext = true; },
        delayNextWrite: () => {
            let release!: () => void;
            nextWrite = new Promise<void>(resolve => { release = resolve; });
            return release;
        },
        setContext: (limit: number | undefined, name: string) => { tokenLimit = limit; model = name; },
        getSaved: () => autoCompact,
    };
}

async function gotoChat(page: Page, serverUrl: string, wsId: string, processId: string) {
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity/${encodeURIComponent(processId)}`);
    await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="composer-ctx-fuel"]')).toBeVisible({ timeout: 8_000 });
}

async function expectTableInsidePadding(dialog: Locator) {
    const geometry = await dialog.evaluate(element => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const bounds = {
            left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
            right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
        };
        const table = element.querySelector('table')!;
        const nodes = [table, ...table.querySelectorAll('th, td')];
        const rectangles = nodes.flatMap(node => {
            const rect = node.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(node);
            return [
                { label: node.tagName, left: rect.left, right: rect.right },
                ...Array.from(range.getClientRects(), text => ({ label: node.textContent, left: text.left, right: text.right })),
            ];
        });
        return { bounds, rectangles };
    });
    for (const rect of geometry.rectangles) {
        expect(rect.left, `${rect.label} stays inside left padding`).toBeGreaterThanOrEqual(geometry.bounds.left - 1);
        expect(rect.right, `${rect.label} stays inside right padding`).toBeLessThanOrEqual(geometry.bounds.right + 1);
    }
}

test.describe('Sentinel auto-compact popover', () => {
    const logs = new WeakMap<Page, { console: string[]; errors: string[] }>();
    test.beforeEach(async ({ page }) => {
        const log = { console: [] as string[], errors: [] as string[] };
        logs.set(page, log);
        page.on('console', message => {
            log.console.push(`${message.type()}: ${message.text()}`);
            // Failure regressions deliberately return HTTP 503; it is not a JS error.
            if (message.type() === 'error' && !/Failed to load resource:.*503/.test(message.text())) log.errors.push(message.text());
        });
        page.on('pageerror', error => log.errors.push(error.message));
    });
    test.afterEach(async ({ page }, testInfo) => {
        const log = logs.get(page)!;
        await testInfo.attach('browser-console', { body: JSON.stringify(log, null, 2), contentType: 'application/json' });
        expect(log.errors, 'No console JavaScript errors or page errors').toEqual([]);
    });

    test('SAC.1 immediately opts in at 700k and autosaves absolute tokens on Enter and blur', async ({ page, serverUrl, dataDir }, testInfo) => {
        const { wsId, taskId, cleanup } = await setup(serverUrl, dataDir, 'sac1', 'sentinel');
        try {
            const { writes, processId } = await stubProcess(page, wsId, taskId, 'sentinel');
            await gotoChat(page, serverUrl, wsId, processId);
            const trigger = page.getByRole('button', { name: /Context window/ });
            await trigger.focus();
            await page.keyboard.press('Enter');
            const dialog = page.getByRole('dialog', { name: 'Context usage' });
            await expect(dialog).toBeVisible();
            await expect(dialog).toContainText('Tool definitions');
            await expect(page.getByTestId('composer-ctx-model-name')).toHaveText('claude-opus-4.8');
            const toggle = page.getByRole('switch', { name: 'Auto-compact', exact: true });
            const input = page.getByTestId('auto-compact-input');
            const status = page.getByTestId('auto-compact-status');
            await expect(toggle).toHaveAttribute('aria-checked', 'false');
            await expect(input).toHaveValue('700');
            await expect(input).toBeDisabled();
            expect(writes).toHaveLength(0);
            await expect(page.getByTestId('auto-compact-row')).toHaveCount(1);
            await expect(status).toHaveCount(1);
            await expect(dialog.getByRole('slider')).toHaveCount(0);
            await expect(dialog.getByRole('button', { name: /^(Save|Discard)$/ })).toHaveCount(0);
            await expect(dialog).toContainText('System prompt');
            await expect(dialog).toContainText('Conversation');
            await expect(dialog).toContainText('Total');
            const rowBox = (await page.getByTestId('auto-compact-row').boundingBox())!;
            const switchBox = (await toggle.boundingBox())!;
            const inputBox = (await input.boundingBox())!;
            const statusBox = (await status.boundingBox())!;
            const modelBox = (await page.getByTestId('composer-ctx-model-name').boundingBox())!;
            expect(Math.abs(switchBox.y + switchBox.height / 2 - inputBox.y - inputBox.height / 2)).toBeLessThan(2);
            expect(statusBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height);
            expect(modelBox.y).toBeGreaterThanOrEqual(statusBox.y + statusBox.height);
            await expectTableInsidePadding(dialog);
            await page.screenshot({ path: testInfo.outputPath('sentinel-auto-compact-off.png') });

            await toggle.click();
            await expect(status).toContainText('Saved');
            expect(writes).toHaveLength(1);
            expect(writes[0]).toMatchObject({ method: 'PUT', body: { enabled: true, thresholdTokens: 700_000 } });
            await expect(input).toBeEnabled();
            await input.fill('850');
            await input.press('Enter');
            await expect(status).toContainText('Saved');
            expect(writes).toHaveLength(2);
            expect(writes[1].body).toEqual({ enabled: true, thresholdTokens: 850_000 });
            expect(new URL(writes[0].url).searchParams.get('workspace')).toBe(wsId);
            const markerPercent = await page.getByTestId('composer-ctx-threshold-marker').evaluate(element => parseFloat((element as HTMLElement).style.left));
            expect(markerPercent).toBeCloseTo(850_000 / LIMIT * 100);
            await expect(page.getByTestId('composer-ctx-autocompact-badge')).toHaveAttribute('data-state', 'enabled');
            await page.screenshot({ path: testInfo.outputPath('sentinel-auto-compact-saved.png') });

            // Enter followed by blur must not write the same saved value twice.
            await input.press('Tab');
            await expect(status).toContainText('Saved');
            await input.fill('851.125');
            await input.press('Tab');
            await expect(status).toContainText('Saved');
            expect(writes.map(write => write.body)).toEqual([
                { enabled: true, thresholdTokens: 700_000 },
                { enabled: true, thresholdTokens: 850_000 },
                { enabled: true, thresholdTokens: 851_125 },
            ]);
            await input.focus();
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            await expect(trigger).toBeFocused();
        } finally { cleanup(); }
    });

    test('SAC.2 stays inside a narrow desktop pane', async ({ page, serverUrl, dataDir }, testInfo) => {
        // The narrowest desktop layout that still shows the gauge (mobile hides it).
        await page.setViewportSize({ width: 820, height: 760 });
        const { wsId, taskId, cleanup } = await setup(serverUrl, dataDir, 'sac2', 'sentinel');
        try {
            const { processId } = await stubProcess(page, wsId, taskId, 'sentinel');
            await gotoChat(page, serverUrl, wsId, processId);
            await page.getByRole('button', { name: /Context window/ }).click();
            const panel = page.getByTestId('auto-compact-panel');
            await expect(panel).toBeVisible();
            const box = (await page.getByRole('dialog', { name: 'Context usage' }).boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(820);
            await expectTableInsidePadding(page.getByRole('dialog', { name: 'Context usage' }));
            await expect(page.getByRole('switch', { name: 'Auto-compact', exact: true })).toHaveAttribute('aria-checked', 'false');
            await expect(page.getByTestId('auto-compact-input')).toHaveValue('700');
            await page.screenshot({ path: testInfo.outputPath('sentinel-auto-compact-narrow.png') });
        } finally { cleanup(); }
    });

    test('SAC.3 non-Sentinel chats get no auto-compact controls', async ({ page, serverUrl, dataDir }) => {
        const { wsId, taskId, cleanup } = await setup(serverUrl, dataDir, 'sac3', 'ask');
        try {
            const { writes, processId } = await stubProcess(page, wsId, taskId, 'ask');
            await gotoChat(page, serverUrl, wsId, processId);
            await page.getByRole('button', { name: /Context window/ }).click();
            await expect(page.getByTestId('composer-ctx-breakdown-popover')).toContainText('Total');
            await expect(page.getByTestId('auto-compact-panel')).toHaveCount(0);
            expect(writes).toHaveLength(0);
        } finally { cleanup(); }
    });

    test('SAC.4 failed threshold draft survives closing and retries without reverting', async ({ page, serverUrl, dataDir }) => {
        const { wsId, taskId, cleanup } = await setup(serverUrl, dataDir, 'sac4', 'sentinel');
        try {
            const transport = await stubProcess(page, wsId, taskId, 'sentinel');
            await gotoChat(page, serverUrl, wsId, transport.processId);
            const trigger = page.getByRole('button', { name: /Context window/ });
            await trigger.click();
            await page.getByRole('switch', { name: 'Auto-compact', exact: true }).click();
            const status = page.getByTestId('auto-compact-status');
            await expect(status).toContainText('Saved');
            transport.failNextWrite();
            const input = page.getByTestId('auto-compact-input');
            await input.fill('850');
            await input.press('Enter');
            await expect(status).toContainText('Could not save');
            await expect(input).toHaveValue('850');
            expect(transport.getSaved()).toMatchObject({ enabled: true, thresholdTokens: 700_000 });
            await page.keyboard.press('Escape');
            await expect(page.getByTestId('auto-compact-panel')).toHaveCount(0);
            await trigger.click();
            await expect(input).toHaveValue('850');
            await input.press('Enter');
            await expect(status).toContainText('Saved');
            expect(transport.getSaved()).toMatchObject({ enabled: true, thresholdTokens: 850_000 });
            expect(transport.writes.map(write => write.body)).toEqual([
                { enabled: true, thresholdTokens: 700_000 },
                { enabled: true, thresholdTokens: 850_000 },
                { enabled: true, thresholdTokens: 850_000 },
            ]);
        } finally { cleanup(); }
    });

    test('SAC.5 delayed save preserves a newer draft and deduplicates inflight Enter plus blur', async ({ page, serverUrl, dataDir }) => {
        const { wsId, taskId, cleanup } = await setup(serverUrl, dataDir, 'sac5', 'sentinel');
        let release: (() => void) | undefined;
        try {
            const transport = await stubProcess(page, wsId, taskId, 'sentinel');
            await gotoChat(page, serverUrl, wsId, transport.processId);
            await page.getByRole('button', { name: /Context window/ }).click();
            await page.getByRole('switch', { name: 'Auto-compact', exact: true }).click();
            const input = page.getByTestId('auto-compact-input');
            const status = page.getByTestId('auto-compact-status');
            await expect(status).toContainText('Saved');
            release = transport.delayNextWrite();
            await input.fill('850');
            await input.press('Enter');
            await expect.poll(() => transport.writes.length).toBe(2);
            await expect(status).toContainText('Saving');
            await input.fill('875');
            release();
            await expect(status).toContainText('Unsaved');
            await expect(input).toHaveValue('875');
            expect(transport.writes).toHaveLength(2);
            expect(transport.getSaved()).toMatchObject({ thresholdTokens: 850_000 });
            release = transport.delayNextWrite();
            await input.press('Enter');
            await input.press('Tab');
            await expect.poll(() => transport.writes.length).toBe(3);
            await expect(status).toContainText('Saving');
            release();
            await expect(status).toContainText('Saved');
            expect(transport.writes).toHaveLength(3);
            expect(transport.getSaved()).toMatchObject({ thresholdTokens: 875_000 });
        } finally { release?.(); cleanup(); }
    });

    test('SAC.6 model limits never rescale or cap the saved absolute threshold', async ({ page, serverUrl, dataDir }, testInfo) => {
        const { wsId, taskId, cleanup } = await setup(serverUrl, dataDir, 'sac6', 'sentinel');
        try {
            const transport = await stubProcess(page, wsId, taskId, 'sentinel');
            await gotoChat(page, serverUrl, wsId, transport.processId);
            await page.getByRole('button', { name: /Context window/ }).click();
            await page.getByRole('switch', { name: 'Auto-compact', exact: true }).click();
            await expect(page.getByTestId('auto-compact-status')).toContainText('Saved');
            await page.getByTestId('auto-compact-input').fill('850');
            await page.getByTestId('auto-compact-input').press('Enter');
            await expect(page.getByTestId('auto-compact-status')).toContainText('Saved');
            for (const limit of [1_000_000, 850_000, 800_000]) {
                transport.setContext(limit, 'e2e-model');
                await page.reload();
                await expect(page.getByTestId('composer-ctx-fuel')).toBeVisible();
                await page.getByRole('button', { name: /Context window/ }).click();
                await expect(page.getByTestId('auto-compact-input')).toHaveValue('850');
                await expect(page.getByTestId('composer-ctx-model-name')).toHaveText('e2e-model');
                if (limit <= 850_000) await expect(page.getByTestId('auto-compact-status')).toContainText('Threshold meets/exceeds');
                else await expect(page.getByTestId('auto-compact-status')).toContainText('850k');
                expect(transport.getSaved()).toMatchObject({ enabled: true, thresholdTokens: 850_000 });
                expect(transport.writes).toHaveLength(2);
            }
            await page.screenshot({ path: testInfo.outputPath('sentinel-auto-compact-model-warning.png') });
        } finally { cleanup(); }
    });

    test('SAC.7 unknown limit retains visible working controls without capping', async ({ page, serverUrl, dataDir }, testInfo) => {
        const { wsId, taskId, cleanup } = await setup(serverUrl, dataDir, 'sac7', 'sentinel');
        try {
            const transport = await stubProcess(page, wsId, taskId, 'sentinel');
            transport.setContext(undefined, 'e2e-unknown-model');
            await gotoChat(page, serverUrl, wsId, transport.processId);
            await page.getByRole('button', { name: /Context window/ }).click();
            await expect(page.getByTestId('auto-compact-input')).toHaveValue('700');
            await expect(page.getByTestId('auto-compact-status')).toContainText('Context limit unknown');
            await page.getByRole('switch', { name: 'Auto-compact', exact: true }).click();
            await expect.poll(() => transport.writes.length).toBe(1);
            await expect(page.getByTestId('auto-compact-input')).toBeEnabled();
            await page.getByTestId('auto-compact-input').fill('850');
            await page.getByTestId('auto-compact-input').press('Tab');
            await expect.poll(() => transport.getSaved()?.thresholdTokens).toBe(850_000);
            await expect(page.getByTestId('auto-compact-status')).toContainText('Context limit unknown');
            await page.screenshot({ path: testInfo.outputPath('sentinel-auto-compact-unknown-limit.png') });
        } finally { cleanup(); }
    });

    test('SAC.8 a newer committed draft saves after the inflight older draft fails', async ({ page, serverUrl, dataDir }) => {
        const { wsId, taskId, cleanup } = await setup(serverUrl, dataDir, 'sac8', 'sentinel');
        let release: (() => void) | undefined;
        try {
            const transport = await stubProcess(page, wsId, taskId, 'sentinel');
            await gotoChat(page, serverUrl, wsId, transport.processId);
            await page.getByRole('button', { name: /Context window/ }).click();
            await page.getByRole('switch', { name: 'Auto-compact', exact: true }).click();
            const input = page.getByTestId('auto-compact-input');
            const status = page.getByTestId('auto-compact-status');
            await expect(status).toContainText('Saved');
            release = transport.delayNextWrite();
            transport.failNextWrite();
            await input.fill('850');
            await input.press('Enter');
            await expect.poll(() => transport.writes.length).toBe(2);
            await input.fill('875');
            await input.press('Enter');
            await input.press('Tab');
            expect(transport.writes).toHaveLength(2);
            release();
            await expect(status).toContainText('Saved');
            await expect(input).toHaveValue('875');
            expect(transport.getSaved()).toMatchObject({ enabled: true, thresholdTokens: 875_000 });
            expect(transport.writes.map(write => write.body)).toEqual([
                { enabled: true, thresholdTokens: 700_000 },
                { enabled: true, thresholdTokens: 850_000 },
                { enabled: true, thresholdTokens: 875_000 },
            ]);
        } finally { release?.(); cleanup(); }
    });
});
