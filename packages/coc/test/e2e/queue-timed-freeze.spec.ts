/**
 * Timed freeze on a single queued task — the headless stand-in for AC-03's
 * manual demo ("Definition of Done 1").
 *
 * The jsdom suites already cover the menu shape and the badge arithmetic, and
 * the forge suites cover lazy expiry. What only a real browser plus a real
 * server can show is the whole path agreeing end to end: right-click a queued
 * row, pick a preset out of the submenu, and have the SPA → REST → queue
 * manager → SQLite round trip come back as a badge, a skipped dispatch, and a
 * clean unfreeze.
 *
 * DOM contract (kept in sync with ChatListPane.tsx):
 *   Queued section: [data-section="queued"]
 *   Queued row:     [data-testid="queued-task-row"][data-task-id="<queue task id>"]
 *   Menu:           [data-testid="context-menu"], items are [role="menuitem"]
 *   Frozen badge:   a span titled "Frozen" or "Frozen <remaining>"
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function makeWorkspace(
    serverUrl: string,
    prefix: string,
): Promise<{ wsId: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-freeze-${prefix}-`));
    const wsId = `${prefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, prefix, rootPath);
    return { wsId, cleanup: () => safeRmSync(rootPath) };
}

/**
 * Seed an exclusive (autopilot-mode) chat task. Autopilot routes through the
 * exclusive queue (max 1 concurrent), which is what lets one hanging task hold
 * everything behind it queued while the browser part of the test runs.
 */
function seedExclusiveTask(serverUrl: string, wsId: string, prompt: string) {
    return seedQueueTask(serverUrl, {
        type: 'chat',
        repoId: wsId,
        payload: { workspaceId: wsId, prompt, mode: 'autopilot' },
    });
}

async function getTask(serverUrl: string, taskId: string): Promise<Record<string, unknown>> {
    const res = await request(`${serverUrl}/api/queue/${taskId}`);
    expect(res.status).toBe(200);
    const json = JSON.parse(res.body);
    return (json.task ?? json) as Record<string, unknown>;
}

async function waitForTaskStatus(
    serverUrl: string,
    taskId: string,
    targetStatuses: string[],
    timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
    const start = Date.now();
    let last: string | undefined;
    while (Date.now() - start < timeoutMs) {
        const task = await getTask(serverUrl, taskId);
        last = task.status as string;
        if (targetStatuses.includes(last)) return task;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
        `Task ${taskId} was "${last}", not ${targetStatuses.join('|')}, within ${timeoutMs}ms`,
    );
}

/** The queued row for a task id, inside the queued section. */
function queuedRow(page: Page, taskId: string) {
    return page.locator(
        `[data-section="queued"] [data-testid="queued-task-row"][data-task-id="${taskId}"]`,
    );
}

/** Right-click a queued row and wait for the real portal menu. */
async function openQueuedRowMenu(page: Page, taskId: string) {
    await queuedRow(page, taskId).click({ button: 'right' });
    const menu = page.locator('[data-testid="context-menu"]');
    await expect(menu).toBeVisible({ timeout: 5_000 });
    return menu;
}

/* ------------------------------------------------------------------ */
/*  Test                                                              */
/* ------------------------------------------------------------------ */

test.describe('Queue — freeze a task for a preset number of hours', () => {
    test.describe.configure({ retries: 2 });

    test('freeze for 1h holds a task, the next one runs, and unfreeze releases it', async ({
        page,
        serverUrl,
        mockAI,
    }) => {
        test.setTimeout(90_000);

        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'timedfreeze');
        try {
            // A blocker task hangs until we resolve it, so A and B stay queued
            // while the browser drives the menu.
            let releaseBlocker!: (v: unknown) => void;
            let releaseB!: (v: unknown) => void;
            let releaseA!: (v: unknown) => void;
            mockAI.mockSendMessage.mockImplementationOnce(
                () => new Promise((r) => { releaseBlocker = r; }),
            );
            mockAI.mockSendMessage.mockImplementationOnce(
                () => new Promise((r) => { releaseB = r; }),
            );
            mockAI.mockSendMessage.mockImplementationOnce(
                () => new Promise((r) => { releaseA = r; }),
            );

            const blocker = await seedExclusiveTask(serverUrl, wsId, 'Blocker task');
            await waitForTaskStatus(serverUrl, blocker.id as string, ['running']);

            const taskA = await seedExclusiveTask(serverUrl, wsId, 'Freeze me first');
            const taskB = await seedExclusiveTask(serverUrl, wsId, 'Run me instead');
            const idA = taskA.id as string;
            const idB = taskB.id as string;
            expect((await getTask(serverUrl, idA)).status).toBe('queued');
            expect((await getTask(serverUrl, idB)).status).toBe('queued');

            // (a) open the chat list with at least two queued tasks
            await page.goto(`${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity`);
            await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({
                timeout: 10_000,
            });
            await expect(queuedRow(page, idA)).toBeVisible({ timeout: 10_000 });
            await expect(queuedRow(page, idB)).toBeVisible();

            // (b) + (c) context menu on the first queued task → Freeze for… → 1h
            const menu = await openQueuedRowMenu(page, idA);
            const freezeFor = menu.getByRole('menuitem', { name: /Freeze for/ });
            await expect(freezeFor).toBeVisible();
            await freezeFor.hover();
            const preset = page
                .locator('[data-submenu-panel="true"] [role="menuitem"]', { hasText: /1h$/ })
                .first();
            await expect(preset).toBeVisible({ timeout: 5_000 });
            await preset.click();

            // (d) the row shows a frozen badge with remaining time…
            const badge = queuedRow(page, idA).locator('[title="Frozen 1h"]');
            await expect(badge).toBeVisible({ timeout: 10_000 });
            await expect(badge).toHaveText(/1h/);

            // …and the server really recorded a bounded freeze.
            const frozenA = await getTask(serverUrl, idA);
            expect(frozenA.frozen).toBe(true);
            const frozenUntil = frozenA.frozenUntil as number;
            expect(typeof frozenUntil).toBe('number');
            const hoursOut = (frozenUntil - Date.now()) / 3_600_000;
            expect(hoursOut).toBeGreaterThan(0.9);
            expect(hoursOut).toBeLessThanOrEqual(1.01);

            // …and the second task runs first once the blocker finishes.
            releaseBlocker({ success: true, response: 'blocker done', sessionId: 'sess-blocker' });
            await waitForTaskStatus(serverUrl, blocker.id as string, ['completed']);
            await waitForTaskStatus(serverUrl, idB, ['running']);
            expect((await getTask(serverUrl, idA)).status).toBe('queued');

            // (e) Unfreeze → badge clears and the task is runnable again.
            const menu2 = await openQueuedRowMenu(page, idA);
            await expect(menu2.getByRole('menuitem', { name: /Freeze/ })).toHaveCount(0);
            await menu2.getByRole('menuitem', { name: /Unfreeze/ }).click();

            await expect(queuedRow(page, idA).locator('[title^="Frozen"]')).toHaveCount(0, {
                timeout: 10_000,
            });
            const thawedA = await getTask(serverUrl, idA);
            expect(thawedA.frozen).toBeFalsy();
            expect(thawedA.frozenUntil).toBeUndefined();

            releaseB({ success: true, response: 'B done', sessionId: 'sess-b' });
            await waitForTaskStatus(serverUrl, idB, ['completed']);
            await waitForTaskStatus(serverUrl, idA, ['running']);
            releaseA({ success: true, response: 'A done', sessionId: 'sess-a' });
            await waitForTaskStatus(serverUrl, idA, ['completed']);
        } finally {
            cleanup();
        }
    });
});
