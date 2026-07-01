/**
 * Nested / Spawned Chat-Tree E2E Tests
 *
 * Covers the `SpawnedTreeRow` feature: when a chat spawns a child conversation
 * (server-side `send_to_conversation` tool → `AIProcess.parentProcessId`), the
 * child renders nested under its parent in the dashboard chat list, with
 * descendant-count badges and per-node collapse.
 *
 * Two tiers:
 *   - Tier A (this file): seed-driven rendering — deterministic, no executor.
 *     Nesting is produced by seeding `parentProcessId` links directly via
 *     `POST /api/processes` (completed status, so they surface through
 *     `GET /api/workspaces/:id/history`). Owns tree depth, badges, collapse,
 *     persistence, feature toggle, and orphan promotion.
 *   - Tier B (nested-spawn-tree tier B tests): one real 1-level spawn through the
 *     queue (`payload.context.spawnedFromProcessId`), hitting the identical
 *     `process-lifecycle-runner` path.
 *
 * Data flow (Tier A): seed workspace + completed chat processes with
 * `parentProcessId` links via REST → navigate to `#repos/<wsId>/activity` →
 * assert the spawned tree renders in the Completed Tasks section.
 *
 * DOM contract (from SpawnedTreeRow.tsx):
 *   Tree root:   [data-testid="spawned-tree-row"][data-root-id="<rootId>"]
 *   Node:        [data-testid="spawned-tree-node"][data-node-id="<id>"][data-depth="N"]
 *   Chevron:     [data-testid="spawned-tree-chevron"] (aria-expanded / aria-label)
 *   Children:    [data-testid="spawned-tree-children"]
 *   Badge:       [data-testid="spawned-tree-child-count"] (only when descendantCount > 0)
 *
 * A node's OWN chevron / badge live in its header (the node div's first <div>
 * child); descendants live under a sibling `spawned-tree-children` div. The
 * `> div > ...` direct-child combinator isolates a node's own controls from its
 * descendants'.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedProcess, seedWorkspace, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Provision a temporary workspace tied to a fresh temp directory. */
async function makeWorkspace(
    serverUrl: string,
    idPrefix: string,
): Promise<{ wsId: string; rootPath: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-spawn-${idPrefix}-`));
    const wsId = `${idPrefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, idPrefix, rootPath);
    return { wsId, rootPath, cleanup: () => safeRmSync(rootPath) };
}

/** Seed a completed chat process scoped to a workspace, optionally spawned from a parent. */
async function seedChat(
    serverUrl: string,
    wsId: string,
    id: string,
    parentProcessId?: string,
): Promise<void> {
    await seedProcess(serverUrl, id, {
        type: 'chat',
        status: 'completed',
        workspaceId: wsId,
        promptPreview: `Chat ${id}`,
        ...(parentProcessId ? { parentProcessId } : {}),
    });
}

/**
 * Seed the canonical 3-node chain: root → child (parent=root) → gc (parent=child).
 * Depths 0 / 1 / 2.
 */
async function seedCanonicalChain(serverUrl: string, wsId: string): Promise<void> {
    await seedChat(serverUrl, wsId, 'root');
    await seedChat(serverUrl, wsId, 'child', 'root');
    await seedChat(serverUrl, wsId, 'gc', 'child');
}

/** Fetch the workspace history list (the array the SPA groups into the tree). */
async function fetchHistory(serverUrl: string, wsId: string): Promise<Array<Record<string, any>>> {
    const res = await request(
        `${serverUrl}/api/workspaces/${encodeURIComponent(wsId)}/history?limit=100&offset=0`,
    );
    if (res.status !== 200) {
        throw new Error(`history fetch failed: ${res.status} ${res.body}`);
    }
    const json = JSON.parse(res.body);
    return (json.history ?? []) as Array<Record<string, any>>;
}

/** Navigate to the per-repo Activity sub-tab and wait for the split panel. */
async function gotoActivity(page: Page, serverUrl: string, wsId: string): Promise<void> {
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity`);
    await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10_000 });
}

// Locator builders --------------------------------------------------------

const treeRow = (page: Page, rootId: string) =>
    page.locator(`[data-testid="spawned-tree-row"][data-root-id="${rootId}"]`);

const treeNode = (page: Page, nodeId: string) =>
    page.locator(`[data-testid="spawned-tree-node"][data-node-id="${nodeId}"]`);

/** A node's OWN chevron (its header, not a descendant's). */
const nodeChevron = (page: Page, nodeId: string) =>
    page.locator(
        `[data-testid="spawned-tree-node"][data-node-id="${nodeId}"] > div > [data-testid="spawned-tree-chevron"]`,
    );

/** A node's OWN descendant-count badge (its header, not a descendant's). */
const nodeBadge = (page: Page, nodeId: string) =>
    page.locator(
        `[data-testid="spawned-tree-node"][data-node-id="${nodeId}"] > div > [data-testid="spawned-tree-child-count"]`,
    );

// ---------------------------------------------------------------------------
// Tier A — seed-driven rendering
// ---------------------------------------------------------------------------

test.describe('Nested spawn tree — Tier A (seed-driven)', () => {
    // AC-01 — Spec scaffolding & workspace navigation + parentProcessId round-trip.
    test('AC-01 seeded spawned chats round-trip and appear in the workspace list', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac01');
        try {
            await seedCanonicalChain(serverUrl, wsId);

            // Setup-time guard: parentProcessId links round-trip through the
            // history API the SPA reads (Tier A assumption).
            const history = await fetchHistory(serverUrl, wsId);
            const byId = Object.fromEntries(history.map(h => [h.id, h]));
            expect(byId['root']).toBeTruthy();
            expect(byId['child']?.parentProcessId).toBe('root');
            expect(byId['gc']?.parentProcessId).toBe('child');

            await gotoActivity(page, serverUrl, wsId);

            // Smoke: the root seeded chat row is visible for the workspace.
            await expect(page.locator('[data-task-id="root"]')).toBeVisible({ timeout: 10_000 });
        } finally {
            cleanup();
        }
    });

    // AC-02 — 3-deep chain renders nested at depths 0/1/2, no duplicate flat rows.
    test('AC-02 three-deep chain renders nested', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac02');
        try {
            await seedCanonicalChain(serverUrl, wsId);
            await gotoActivity(page, serverUrl, wsId);

            const row = treeRow(page, 'root');
            await expect(row).toBeVisible({ timeout: 10_000 });
            // Exactly one spawned-tree-row (rooted at root).
            await expect(page.locator('[data-testid="spawned-tree-row"]')).toHaveCount(1);

            // Depths 0 / 1 / 2, each nested inside the row.
            await expect(row.locator('[data-testid="spawned-tree-node"][data-node-id="root"]')).toHaveAttribute('data-depth', '0');
            await expect(row.locator('[data-testid="spawned-tree-node"][data-node-id="child"]')).toHaveAttribute('data-depth', '1');
            await expect(row.locator('[data-testid="spawned-tree-node"][data-node-id="gc"]')).toHaveAttribute('data-depth', '2');

            // child + gc nest inside spawned-tree-children containers.
            await expect(row.locator('[data-testid="spawned-tree-children"]')).toHaveCount(2);

            // No duplicate flat rows: each chat's card renders exactly once
            // (inside the tree); descendants are hidden from the flat list.
            await expect(page.locator('[data-task-id="child"]')).toHaveCount(1);
            await expect(page.locator('[data-task-id="gc"]')).toHaveCount(1);
        } finally {
            cleanup();
        }
    });

    // AC-03 — descendant-count badges: root=2, child=1, leaf none.
    test('AC-03 descendant-count badges', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac03');
        try {
            await seedCanonicalChain(serverUrl, wsId);
            await gotoActivity(page, serverUrl, wsId);

            await expect(treeRow(page, 'root')).toBeVisible({ timeout: 10_000 });

            await expect(nodeBadge(page, 'root')).toHaveText('2');
            await expect(nodeBadge(page, 'child')).toHaveText('1');
            await expect(nodeBadge(page, 'gc')).toHaveCount(0);
        } finally {
            cleanup();
        }
    });

    // AC-04 — collapse / expand the root hides / restores all descendants.
    test('AC-04 collapse and re-expand the root', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac04');
        try {
            await seedCanonicalChain(serverUrl, wsId);
            await gotoActivity(page, serverUrl, wsId);

            await expect(treeRow(page, 'root')).toBeVisible({ timeout: 10_000 });
            const chevron = nodeChevron(page, 'root');
            await expect(chevron).toHaveAttribute('aria-expanded', 'true');
            await expect(treeNode(page, 'child')).toBeVisible();
            await expect(treeNode(page, 'gc')).toBeVisible();

            // Collapse: descendants disappear, chevron reports collapsed.
            await chevron.click();
            await expect(chevron).toHaveAttribute('aria-expanded', 'false');
            await expect(treeNode(page, 'child')).toHaveCount(0);
            await expect(treeNode(page, 'gc')).toHaveCount(0);

            // Re-expand: descendants return.
            await chevron.click();
            await expect(chevron).toHaveAttribute('aria-expanded', 'true');
            await expect(treeNode(page, 'child')).toBeVisible();
            await expect(treeNode(page, 'gc')).toBeVisible();
        } finally {
            cleanup();
        }
    });

    // AC-05 — collapse a middle node hides only its subtree.
    test('AC-05 collapse a middle node hides only its subtree', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac05');
        try {
            await seedCanonicalChain(serverUrl, wsId);
            await gotoActivity(page, serverUrl, wsId);

            await expect(treeRow(page, 'root')).toBeVisible({ timeout: 10_000 });
            const childChevron = nodeChevron(page, 'child');
            await expect(childChevron).toHaveAttribute('aria-expanded', 'true');

            await childChevron.click();

            // gc (child's subtree) hidden; root and child remain visible.
            await expect(treeNode(page, 'gc')).toHaveCount(0);
            await expect(treeNode(page, 'root')).toBeVisible();
            await expect(treeNode(page, 'child')).toBeVisible();
            await expect(childChevron).toHaveAttribute('aria-expanded', 'false');
        } finally {
            cleanup();
        }
    });

    // AC-06 — collapse state persists across reload (localStorage).
    test('AC-06 collapse state persists across reload', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac06');
        try {
            await seedCanonicalChain(serverUrl, wsId);
            await gotoActivity(page, serverUrl, wsId);

            await expect(treeRow(page, 'root')).toBeVisible({ timeout: 10_000 });
            await nodeChevron(page, 'root').click();
            await expect(treeNode(page, 'child')).toHaveCount(0);

            // localStorage records the collapsed root id.
            const collapsed = await page.evaluate(() => localStorage.getItem('coc-spawned-tree-collapsed'));
            expect(collapsed).toBeTruthy();
            expect(JSON.parse(collapsed as string)).toContain('root');

            await page.reload();
            await expect(page.locator('[data-testid="activity-split-panel"]')).toBeVisible({ timeout: 10_000 });

            // Still collapsed after reload.
            await expect(treeRow(page, 'root')).toBeVisible({ timeout: 10_000 });
            await expect(nodeChevron(page, 'root')).toHaveAttribute('aria-expanded', 'false');
            await expect(treeNode(page, 'child')).toHaveCount(0);
            await expect(treeNode(page, 'gc')).toHaveCount(0);
        } finally {
            cleanup();
        }
    });

    // AC-07 — feature toggle off → flat rendering.
    test('AC-07 feature toggle off renders flat rows', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac07');
        try {
            await seedCanonicalChain(serverUrl, wsId);

            // Disable the spawned-tree view before the SPA loads.
            await page.addInitScript(() => {
                try { localStorage.setItem('coc-spawned-tree-enabled', 'false'); } catch { /* ignore */ }
            });

            await gotoActivity(page, serverUrl, wsId);

            // No tree; all three chats render as flat sibling rows.
            await expect(page.locator('[data-task-id="root"]')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('[data-testid="spawned-tree-row"]')).toHaveCount(0);
            await expect(page.locator('[data-task-id="root"]')).toHaveCount(1);
            await expect(page.locator('[data-task-id="child"]')).toHaveCount(1);
            await expect(page.locator('[data-task-id="gc"]')).toHaveCount(1);
        } finally {
            cleanup();
        }
    });

    // AC-08 — orphan child (parent not loaded) is promoted to its own root.
    test('AC-08 orphan child becomes its own root', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac08');
        try {
            // Seed only child (parent=root) and gc (parent=child); root is absent.
            await seedChat(serverUrl, wsId, 'child', 'root');
            await seedChat(serverUrl, wsId, 'gc', 'child');

            await gotoActivity(page, serverUrl, wsId);

            // Tree rooted at the orphan `child`, with gc nested at depth 1.
            const row = treeRow(page, 'child');
            await expect(row).toBeVisible({ timeout: 10_000 });
            await expect(row.locator('[data-testid="spawned-tree-node"][data-node-id="child"]')).toHaveAttribute('data-depth', '0');
            await expect(row.locator('[data-testid="spawned-tree-node"][data-node-id="gc"]')).toHaveAttribute('data-depth', '1');

            // No row / node references the absent root.
            await expect(page.locator('[data-testid="spawned-tree-row"][data-root-id="root"]')).toHaveCount(0);
            await expect(treeNode(page, 'root')).toHaveCount(0);
        } finally {
            cleanup();
        }
    });
});
