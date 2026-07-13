/**
 * Chat List Range Selection — E2E (visual layer)
 *
 * Verifies the multi-select / shift-range selection in the per-repo Activity
 * chat list across all grouped-row kinds (Ralph sessions, For Each runs, Map
 * Reduce runs, spawned sub-conversation trees) plus plain interleaved chats.
 *
 * Core visual invariant (from the goal spec): the set of rows rendered with the
 * selected style (`data-selected="true"` / a visible `selection-checkbox`)
 * exactly equals the selection set, and the `selection-count-pill` equals its
 * size. Group headers reflect their children's selection (fully selected →
 * `data-selected="true"`).
 *
 * DOM contract:
 *   Plain / child chat row:  [data-task-id="<id>"]  (data-selected, selection-checkbox)
 *   Ralph group header:      [data-testid="ralph-session-row"]  (data-selected, data-session-id)
 *   For Each group header:   [data-testid="for-each-run-row"]   (data-selected, data-run-id)
 *   Map Reduce group header: [data-testid="map-reduce-run-row"] (data-selected, data-run-id)
 *   Spawned tree root:       [data-testid="spawned-tree-row"][data-root-id="<rootId>"]
 *   Count pill:              [data-testid="selection-count-pill"]
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import {
    enableGroupFeatures,
    seedPlainChat,
    seedRalphSession,
    seedForEachRun,
    seedMapReduceRun,
    seedSpawnedTree,
} from './fixtures/chat-groups-seed';
import type { Page } from '@playwright/test';

/** Provision a temporary workspace tied to a fresh temp directory. */
async function makeWorkspace(
    serverUrl: string,
    idPrefix: string,
): Promise<{ wsId: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-chatlist-${idPrefix}-`));
    const wsId = `${idPrefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, idPrefix, rootPath);
    return { wsId, cleanup: () => safeRmSync(rootPath) };
}

/** Navigate to the per-repo Activity sub-tab and wait for its split panel. */
async function gotoActivity(page: Page, serverUrl: string, wsId: string): Promise<void> {
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity`);
    await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10_000 });
}

test.describe('Chat list range selection — group rendering (AC-02)', () => {
    // AC-02 — all four group kinds plus interleaved plain chats render together.
    test('AC-02 seeds render all group kinds and plain chats in the chat list', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac02');
        try {
            await enableGroupFeatures(serverUrl);

            // Interleave plain chats between each grouped run so the list mixes
            // kinds (offsets are minutes-from-base; higher = more recent = higher
            // in the list). Reserve wide offset bands per group to avoid overlap.
            await seedPlainChat(serverUrl, wsId, 'plain-1', 100);
            await seedRalphSession(serverUrl, wsId, 'rs-1', { iterations: 2, baseOffsetMinutes: 80 });
            await seedPlainChat(serverUrl, wsId, 'plain-2', 70);
            await seedForEachRun(serverUrl, wsId, { children: 2, baseOffsetMinutes: 50 });
            await seedPlainChat(serverUrl, wsId, 'plain-3', 40);
            await seedMapReduceRun(serverUrl, wsId, { children: 2, baseOffsetMinutes: 20 });
            await seedPlainChat(serverUrl, wsId, 'plain-4', 10);
            await seedSpawnedTree(serverUrl, wsId, 'spawn-root', { baseOffsetMinutes: 0 });

            await gotoActivity(page, serverUrl, wsId);

            // Plain chats.
            await expect(page.locator('[data-task-id="plain-1"]')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('[data-task-id="plain-2"]')).toBeVisible();
            await expect(page.locator('[data-task-id="plain-3"]')).toBeVisible();
            await expect(page.locator('[data-task-id="plain-4"]')).toBeVisible();

            // All four group kinds.
            await expect(page.locator('[data-testid="ralph-session-row"]')).toHaveCount(1);
            await expect(page.locator('[data-testid="for-each-run-row"]')).toHaveCount(1);
            await expect(page.locator('[data-testid="map-reduce-run-row"]')).toHaveCount(1);
            await expect(
                page.locator('[data-testid="spawned-tree-row"][data-root-id="spawn-root"]'),
            ).toBeVisible();

            // Group headers start unselected.
            await expect(page.locator('[data-testid="ralph-session-row"]')).toHaveAttribute('data-selected', 'false');
            await expect(page.locator('[data-testid="for-each-run-row"]')).toHaveAttribute('data-selected', 'false');
            await expect(page.locator('[data-testid="map-reduce-run-row"]')).toHaveAttribute('data-selected', 'false');

            // No selection pill before any interaction.
            await expect(page.locator('[data-testid="selection-count-pill"]')).toHaveCount(0);
        } finally {
            cleanup();
        }
    });

    // Interaction smoke — ctrl-toggle two plain chats builds a selection whose
    // highlighted-row set (selection-checkbox) == selection == count pill, and
    // leaves untouched group headers unselected. Layout-order-independent; the
    // deterministic foundation the AC-03 shift-range scenarios build on.
    test('ctrl-toggle selection satisfies the core visual invariant', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ctrltoggle');
        try {
            await enableGroupFeatures(serverUrl);
            await seedPlainChat(serverUrl, wsId, 'p-a', 30);
            await seedRalphSession(serverUrl, wsId, 'rs-x', { iterations: 2, baseOffsetMinutes: 15 });
            await seedPlainChat(serverUrl, wsId, 'p-b', 5);

            await gotoActivity(page, serverUrl, wsId);
            await expect(page.locator('[data-task-id="p-a"]')).toBeVisible({ timeout: 10_000 });

            const ctrl = { modifiers: ['ControlOrMeta' as const] };
            await page.locator('[data-task-id="p-a"]').click(ctrl);
            await page.locator('[data-task-id="p-b"]').click(ctrl);

            // Exactly the two toggled rows are highlighted (checkbox == selection).
            await expect(page.locator('[data-task-id="p-a"]')).toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-task-id="p-b"]')).toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(2);

            // Count pill mirrors the selection size.
            await expect(page.locator('[data-testid="selection-count-pill"]')).toContainText('2 selected');

            // The untouched Ralph group header stays unselected.
            await expect(page.locator('[data-testid="ralph-session-row"]')).toHaveAttribute('data-selected', 'false');

            // Ctrl-toggling p-a off drops it from every facet of the selection.
            await page.locator('[data-task-id="p-a"]').click(ctrl);
            await expect(page.locator('[data-task-id="p-a"]')).not.toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(1);
            await expect(page.locator('[data-testid="selection-count-pill"]')).toHaveCount(0);
        } finally {
            cleanup();
        }
    });
});
