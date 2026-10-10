/**
 * Sentinel auto-compact section of the composer context-usage popover, driven
 * in a real browser against the isolated e2e server. The process record and the
 * auto-compact endpoints are route-stubbed, so no conversation is compacted.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace } from './fixtures/seed';
import type { Page, Route } from '@playwright/test';

const LIMIT = 922_000;

async function setup(serverUrl: string, prefix: string, mode: 'sentinel' | 'ask') {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-sac-${prefix}-`));
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
    const processBody = () => ({
        process: {
            id: processId, status: 'completed', type: 'chat', title: 'Sentinel', sdkSessionId: 'e2e-session', payload: { prompt: 'Watch the repo', mode },
            metadata: { type: 'chat', workspaceId: wsId, mode, model: 'claude-opus-4.8', ...(autoCompact ? { autoCompact } : {}) },
            tokenLimit: LIMIT, currentTokens: 720_000, systemTokens: 12_000, toolDefinitionsTokens: 30_000, conversationTokens: 650_000,
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
            writes.push({ method: request.method(), url, body: request.postDataJSON() });
            autoCompact = url.includes('/resume')
                ? { ...autoCompact, consecutiveFailures: 0, paused: undefined }
                : { ...(request.postDataJSON() as object), consecutiveFailures: 0 };
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ autoCompact }) });
        }
        if (request.method() !== 'GET') return route.fallback();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(processBody()) });
    });
    return { writes, processId };
}

async function gotoChat(page: Page, serverUrl: string, wsId: string, processId: string) {
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity/${encodeURIComponent(processId)}`);
    await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('[data-testid="composer-ctx-fuel"]')).toBeVisible({ timeout: 8_000 });
}

test.describe('Sentinel auto-compact popover', () => {
    test('SAC.1 saves an opt-in threshold through the owning workspace and marks the gauge', async ({ page, serverUrl }, testInfo) => {
        const { wsId, taskId, cleanup } = await setup(serverUrl, 'sac1', 'sentinel');
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
            const toggle = page.getByRole('switch', { name: /Auto-compact · this Sentinel chat/ });
            await expect(toggle).toHaveAttribute('aria-checked', 'false');
            await page.screenshot({ path: testInfo.outputPath('sentinel-auto-compact-off.png') });

            await toggle.click();
            await page.getByTestId('auto-compact-input').fill('85');
            await expect(page.getByTestId('auto-compact-token-equivalent')).toContainText('783.7k of 922.0k');
            await page.getByTestId('auto-compact-input').press('Enter');
            await expect(page.getByTestId('auto-compact-save-status')).toContainText('Saved');
            expect(writes).toHaveLength(1);
            expect(writes[0]).toMatchObject({ method: 'PUT', body: { enabled: true, thresholdPercent: 85 } });
            expect(new URL(writes[0].url).searchParams.get('workspace')).toBe(wsId);
            await expect(page.getByTestId('composer-ctx-threshold-marker')).toHaveAttribute('style', /left: 85%/);
            await expect(page.getByTestId('composer-ctx-autocompact-badge')).toHaveAttribute('data-state', 'enabled');
            await page.screenshot({ path: testInfo.outputPath('sentinel-auto-compact-saved.png') });

            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            await expect(trigger).toBeFocused();
        } finally { cleanup(); }
    });

    test('SAC.2 stays inside a narrow desktop pane', async ({ page, serverUrl }, testInfo) => {
        // The narrowest desktop layout that still shows the gauge (mobile hides it).
        await page.setViewportSize({ width: 820, height: 760 });
        const { wsId, taskId, cleanup } = await setup(serverUrl, 'sac2', 'sentinel');
        try {
            const { processId } = await stubProcess(page, wsId, taskId, 'sentinel');
            await gotoChat(page, serverUrl, wsId, processId);
            await page.getByRole('button', { name: /Context window/ }).click();
            const panel = page.getByTestId('auto-compact-panel');
            await expect(panel).toBeVisible();
            const box = (await page.getByRole('dialog', { name: 'Context usage' }).boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(820);
            await page.screenshot({ path: testInfo.outputPath('sentinel-auto-compact-narrow.png') });
        } finally { cleanup(); }
    });

    test('SAC.3 non-Sentinel chats get no auto-compact controls', async ({ page, serverUrl }) => {
        const { wsId, taskId, cleanup } = await setup(serverUrl, 'sac3', 'ask');
        try {
            const { writes, processId } = await stubProcess(page, wsId, taskId, 'ask');
            await gotoChat(page, serverUrl, wsId, processId);
            await page.getByRole('button', { name: /Context window/ }).click();
            await expect(page.getByTestId('composer-ctx-breakdown-popover')).toContainText('Total');
            await expect(page.getByTestId('auto-compact-panel')).toHaveCount(0);
            expect(writes).toHaveLength(0);
        } finally { cleanup(); }
    });
});
