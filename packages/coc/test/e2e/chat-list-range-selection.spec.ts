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
    seedPlainChatAt,
    nowRelativeIso,
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

/** Current selection-count-pill value (0 when the pill is absent, i.e. <2 selected). */
async function selectionPillCount(page: Page): Promise<number> {
    const pill = page.locator('[data-testid="selection-count-pill"]');
    if ((await pill.count()) === 0) return 0;
    const m = (await pill.innerText()).match(/(\d+)\s+selected/);
    return m ? Number(m[1]) : 0;
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

/**
 * AC-03 / AC-05 — shift-range selection across group kinds.
 *
 * The invariant these pin: after a shift-range, the rows drawn selected exactly
 * equal `selectedHistoryIds`, and the count pill equals its size. A COLLAPSED
 * group/tree contributes one visible header/root row that stands in for every
 * hidden child — so its children are counted in the pill (and in
 * `selectedHistoryIds`) without a per-child checkbox. When a group is EXPANDED,
 * every selected child is a real chat row, so `selection-checkbox` count ==
 * pill == selection size.
 *
 * subId sizes (verified against the grouping engine): a Ralph session = grill +
 * N iterations; a For Each / Map Reduce run absorbs its generation chat into
 * `children` (it matches the run tag), so For Each = generation + children and
 * Map Reduce = generation + map children + reduce.
 *
 * Anchor/target snap rule this suite documents: shift-range endpoints that land
 * on (or inside) a Ralph / For Each / Map Reduce group snap out to the WHOLE
 * group — the three run kinds are atomic. Spawned-tree rows deliberately do NOT
 * snap: an expanded tree is independently sub-rangeable (AC-05).
 */
test.describe('Chat list shift-range selection (AC-03 / AC-05)', () => {
    // AC-03(a) collapsed — plain→plain spanning a collapsed Ralph group pulls in
    // the whole hidden group; the header stands in for its 3 children.
    test('AC-03a plain→plain over a collapsed Ralph group selects the hidden group', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac03a');
        try {
            await enableGroupFeatures(serverUrl);
            await seedPlainChat(serverUrl, wsId, 'top', 40);
            const ralph = await seedRalphSession(serverUrl, wsId, 'rs-a', { iterations: 2, baseOffsetMinutes: 20 });
            await seedPlainChat(serverUrl, wsId, 'bot', 5);

            await gotoActivity(page, serverUrl, wsId);
            await expect(page.locator('[data-task-id="top"]')).toBeVisible({ timeout: 10_000 });
            // Collapsed by default: no child rows rendered.
            await expect(page.locator(`[data-task-id="${ralph.grillId}"]`)).toHaveCount(0);

            await page.locator('[data-task-id="top"]').click();
            await page.locator('[data-task-id="bot"]').click({ modifiers: ['Shift'] });

            await expect(page.locator('[data-task-id="top"]')).toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-task-id="bot"]')).toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-testid="ralph-session-row"]')).toHaveAttribute('data-selected', 'true');
            // Only the two visible plain rows carry a checkbox; the 3 group children stay hidden.
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(2);
            // Pill counts the FULL set: top + bot + grill + 2 iterations = 5.
            expect(await selectionPillCount(page)).toBe(5);
        } finally {
            cleanup();
        }
    });

    // AC-03(a) expanded — the same range with the Ralph group EXPANDED selects
    // each child as its own row: checkbox count == pill == selection size.
    test('AC-03a plain→plain over an expanded Ralph group selects each child row', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac03a-exp');
        try {
            await enableGroupFeatures(serverUrl);
            await seedPlainChat(serverUrl, wsId, 'top', 40);
            const ralph = await seedRalphSession(serverUrl, wsId, 'rs-a', { iterations: 2, baseOffsetMinutes: 20 });
            await seedPlainChat(serverUrl, wsId, 'bot', 5);

            await gotoActivity(page, serverUrl, wsId);
            await expect(page.locator('[data-testid="ralph-session-row"]')).toBeVisible({ timeout: 10_000 });

            // Expand the group so its children render as individual rows.
            await page.locator('[data-testid="ralph-session-chevron"]').click();
            await expect(page.locator('[data-testid="ralph-session-children"]')).toBeVisible();
            await expect(page.locator(`[data-task-id="${ralph.grillId}"]`)).toBeVisible();

            await page.locator('[data-task-id="top"]').click();
            await page.locator('[data-task-id="bot"]').click({ modifiers: ['Shift'] });

            for (const id of ['top', ralph.grillId, ...ralph.iterationIds, 'bot']) {
                await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
            }
            // Header still reads fully-selected; every selected id is its own visible row.
            await expect(page.locator('[data-testid="ralph-session-row"]')).toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(5);
            expect(await selectionPillCount(page)).toBe(5);
        } finally {
            cleanup();
        }
    });

    // AC-03(b) — plain → group-header. Shift-clicking a collapsed group header as
    // the range target pulls the whole group in as the far endpoint.
    test('AC-03b plain→group-header selects up to and including the whole group', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac03b');
        try {
            await enableGroupFeatures(serverUrl);
            await seedPlainChat(serverUrl, wsId, 'top', 40);
            await seedForEachRun(serverUrl, wsId, { children: 2, baseOffsetMinutes: 20 });

            await gotoActivity(page, serverUrl, wsId);
            await expect(page.locator('[data-task-id="top"]')).toBeVisible({ timeout: 10_000 });

            await page.locator('[data-task-id="top"]').click();
            await page.locator('[data-testid="for-each-run-body"]').click({ modifiers: ['Shift'] });

            await expect(page.locator('[data-task-id="top"]')).toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-testid="for-each-run-row"]')).toHaveAttribute('data-selected', 'true');
            // Only the plain chat is a visible individual row; the group is collapsed.
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(1);
            // top + (generation + 2 children) = 4.
            expect(await selectionPillCount(page)).toBe(4);
        } finally {
            cleanup();
        }
    });

    // AC-03(c) — group-header → plain. Anchoring on a group header (a plain click
    // that also opens the run) then shift-clicking a plain row snaps the anchor
    // out to the whole group.
    test('AC-03c group-header→plain snaps the anchor to the whole group', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac03c');
        try {
            await enableGroupFeatures(serverUrl);
            await seedForEachRun(serverUrl, wsId, { children: 2, baseOffsetMinutes: 20 });
            await seedPlainChat(serverUrl, wsId, 'bot', 5);

            await gotoActivity(page, serverUrl, wsId);
            await expect(page.locator('[data-testid="for-each-run-row"]')).toBeVisible({ timeout: 10_000 });

            // Anchor on the header (also opens the run detail), then shift-click the plain row.
            await page.locator('[data-testid="for-each-run-body"]').click();
            await page.locator('[data-task-id="bot"]').click({ modifiers: ['Shift'] });

            await expect(page.locator('[data-testid="for-each-run-row"]')).toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-task-id="bot"]')).toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(1);
            // (generation + 2 children) + bot = 4.
            expect(await selectionPillCount(page)).toBe(4);
        } finally {
            cleanup();
        }
    });

    // AC-03(d) — a range INSIDE an expanded For Each group. Endpoints that are
    // group children snap out to the whole run (the run is atomic), so a partial
    // inner range still selects every child.
    test('AC-03d inner range in an expanded For Each group snaps to the whole run', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac03d-fe');
        try {
            await enableGroupFeatures(serverUrl);
            await seedPlainChat(serverUrl, wsId, 'top', 40);
            const fe = await seedForEachRun(serverUrl, wsId, { children: 3, baseOffsetMinutes: 20 });
            await seedPlainChat(serverUrl, wsId, 'bot', 5);

            await gotoActivity(page, serverUrl, wsId);
            await expect(page.locator('[data-testid="for-each-run-row"]')).toBeVisible({ timeout: 10_000 });
            await page.locator('[data-testid="for-each-run-chevron"]').click();
            await expect(page.locator('[data-testid="for-each-run-children"]')).toBeVisible();

            // Anchor + target are a strict subset of the children (child 1 → child 2);
            // the snap must still select all four rows (generation + 3 children).
            await page.locator(`[data-task-id="${fe.childIds[0]}"]`).click();
            await page.locator(`[data-task-id="${fe.childIds[1]}"]`).click({ modifiers: ['Shift'] });

            await expect(page.locator('[data-testid="for-each-run-row"]')).toHaveAttribute('data-selected', 'true');
            for (const id of [fe.generationId, ...fe.childIds]) {
                await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
            }
            // Plain rows outside the group stay untouched.
            await expect(page.locator('[data-task-id="top"]')).not.toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-task-id="bot"]')).not.toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(4);
            expect(await selectionPillCount(page)).toBe(4);
        } finally {
            cleanup();
        }
    });

    // AC-03(d) — expanded Map Reduce variant, so both remaining run kinds have an
    // expanded-state assertion (Ralph is covered above).
    test('AC-03d inner range in an expanded Map Reduce group snaps to the whole run', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac03d-mr');
        try {
            await enableGroupFeatures(serverUrl);
            await seedPlainChat(serverUrl, wsId, 'top', 40);
            const mr = await seedMapReduceRun(serverUrl, wsId, { children: 2, baseOffsetMinutes: 20 });
            await seedPlainChat(serverUrl, wsId, 'bot', 5);

            await gotoActivity(page, serverUrl, wsId);
            await expect(page.locator('[data-testid="map-reduce-run-row"]')).toBeVisible({ timeout: 10_000 });
            await page.locator('[data-testid="map-reduce-run-chevron"]').click();
            await expect(page.locator('[data-testid="map-reduce-run-children"]')).toBeVisible();

            await page.locator(`[data-task-id="${mr.childIds[0]}"]`).click();
            await page.locator(`[data-task-id="${mr.childIds[1]}"]`).click({ modifiers: ['Shift'] });

            await expect(page.locator('[data-testid="map-reduce-run-row"]')).toHaveAttribute('data-selected', 'true');
            for (const id of [mr.generationId, ...mr.childIds, mr.reduceId]) {
                await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
            }
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(4);
            // generation + 2 map children + reduce = 4.
            expect(await selectionPillCount(page)).toBe(4);
        } finally {
            cleanup();
        }
    });

    // AC-03(e) — a mixed range spanning plain chats and TWO different collapsed
    // group kinds (For Each + Map Reduce).
    test('AC-03e mixed range spans plain chats and two collapsed group kinds', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac03e');
        try {
            await enableGroupFeatures(serverUrl);
            // For Each / Map Reduce groups are run-backed, so they sort to ≈now
            // regardless of seeded child offsets. Bracket them with a newer + older
            // plain chat on the real-now clock so the range spans
            // plain → For Each → Map Reduce → plain.
            await seedPlainChatAt(serverUrl, wsId, 'p-top', nowRelativeIso(10));
            await seedForEachRun(serverUrl, wsId, { children: 2 });
            await seedMapReduceRun(serverUrl, wsId, { children: 2 });
            await seedPlainChatAt(serverUrl, wsId, 'p-bot', nowRelativeIso(-10));

            await gotoActivity(page, serverUrl, wsId);
            await expect(page.locator('[data-task-id="p-top"]')).toBeVisible({ timeout: 10_000 });

            await page.locator('[data-task-id="p-top"]').click();
            await page.locator('[data-task-id="p-bot"]').click({ modifiers: ['Shift'] });

            for (const id of ['p-top', 'p-bot']) {
                await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
            }
            await expect(page.locator('[data-testid="for-each-run-row"]')).toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-testid="map-reduce-run-row"]')).toHaveAttribute('data-selected', 'true');
            // Only the two plain endpoints carry checkboxes; both groups are collapsed.
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(2);
            // 2 plain + For Each (3) + Map Reduce (4) = 9.
            expect(await selectionPillCount(page)).toBe(9);
        } finally {
            cleanup();
        }
    });

    // AC-05 — a COLLAPSED spawned tree selects root + every descendant as a unit.
    test('AC-05 collapsed spawned tree selects root and descendants as one unit', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac05-collapsed');
        try {
            await enableGroupFeatures(serverUrl);
            await seedPlainChat(serverUrl, wsId, 'top', 20);
            const tree = await seedSpawnedTree(serverUrl, wsId, 'spawn-root', { baseOffsetMinutes: 0 });

            await gotoActivity(page, serverUrl, wsId);
            await expect(page.locator(`[data-task-id="${tree.rootId}"]`)).toBeVisible({ timeout: 10_000 });
            // Default expanded → descendants visible; collapse the root.
            await expect(page.locator(`[data-task-id="${tree.child1Id}"]`)).toBeVisible();
            await page.locator('[data-testid="spawned-tree-row"] [data-testid="spawned-tree-chevron"]').first().click();
            await expect(page.locator(`[data-task-id="${tree.child1Id}"]`)).toHaveCount(0);

            await page.locator('[data-task-id="top"]').click();
            await page.locator(`[data-task-id="${tree.rootId}"]`).click({ modifiers: ['Shift'] });

            await expect(page.locator('[data-task-id="top"]')).toHaveAttribute('data-selected', 'true');
            await expect(page.locator(`[data-task-id="${tree.rootId}"]`)).toHaveAttribute('data-selected', 'true');
            // Root stands in for its hidden subtree: only top + root have checkboxes.
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(2);
            // top + root + child1 + grandchild + child2 = 5.
            expect(await selectionPillCount(page)).toBe(5);
        } finally {
            cleanup();
        }
    });

    // AC-05 — an EXPANDED spawned tree is independently sub-rangeable: a range
    // between two inner nodes does NOT snap to the whole tree (the key divergence
    // from the atomic run kinds).
    test('AC-05 expanded spawned tree sub-range does not snap to the whole tree', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac05-subrange');
        try {
            await enableGroupFeatures(serverUrl);
            const tree = await seedSpawnedTree(serverUrl, wsId, 'spawn-root', { baseOffsetMinutes: 0 });

            await gotoActivity(page, serverUrl, wsId);
            await expect(page.locator(`[data-task-id="${tree.rootId}"]`)).toBeVisible({ timeout: 10_000 });
            await expect(page.locator(`[data-task-id="${tree.grandchildId}"]`)).toBeVisible();

            // Range child1 → grandchild only.
            await page.locator(`[data-task-id="${tree.child1Id}"]`).click();
            await page.locator(`[data-task-id="${tree.grandchildId}"]`).click({ modifiers: ['Shift'] });

            await expect(page.locator(`[data-task-id="${tree.child1Id}"]`)).toHaveAttribute('data-selected', 'true');
            await expect(page.locator(`[data-task-id="${tree.grandchildId}"]`)).toHaveAttribute('data-selected', 'true');
            // Root and the sibling child are OUTSIDE the range — not snapped in.
            await expect(page.locator(`[data-task-id="${tree.rootId}"]`)).not.toHaveAttribute('data-selected', 'true');
            await expect(page.locator(`[data-task-id="${tree.child2Id}"]`)).not.toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(2);
            expect(await selectionPillCount(page)).toBe(2);
        } finally {
            cleanup();
        }
    });

    // AC-05 — a mixed range including a spawned tree: plain → collapsed group →
    // through an expanded spawned tree, ending on its last node.
    test('AC-05 mixed range spans a plain chat, a collapsed group and a spawned tree', async ({ page, serverUrl }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ac05-mixed');
        try {
            await enableGroupFeatures(serverUrl);
            // The For Each group is run-backed → sorts to ≈now, so seed the plain
            // anchor NEWER than now to keep it above the group; the spawned tree
            // uses its seeded (past) time and sits below the group.
            await seedPlainChatAt(serverUrl, wsId, 'top', nowRelativeIso(10));
            await seedForEachRun(serverUrl, wsId, { children: 2 });
            const tree = await seedSpawnedTree(serverUrl, wsId, 'spawn-root', { baseOffsetMinutes: 0 });

            await gotoActivity(page, serverUrl, wsId);
            await expect(page.locator('[data-task-id="top"]')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator(`[data-task-id="${tree.child2Id}"]`)).toBeVisible();

            await page.locator('[data-task-id="top"]').click();
            await page.locator(`[data-task-id="${tree.child2Id}"]`).click({ modifiers: ['Shift'] });

            await expect(page.locator('[data-task-id="top"]')).toHaveAttribute('data-selected', 'true');
            await expect(page.locator('[data-testid="for-each-run-row"]')).toHaveAttribute('data-selected', 'true');
            for (const id of tree.allIds) {
                await expect(page.locator(`[data-task-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
            }
            // top + 4 spawned nodes carry checkboxes; the collapsed For Each header does not.
            await expect(page.locator('[data-testid="selection-checkbox"]')).toHaveCount(5);
            // top + For Each (3) + spawned tree (4) = 8.
            expect(await selectionPillCount(page)).toBe(8);
        } finally {
            cleanup();
        }
    });
});
