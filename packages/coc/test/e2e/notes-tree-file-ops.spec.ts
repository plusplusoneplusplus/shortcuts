/**
 * Notes tree — file-explorer selection & file operations E2E.
 *
 * Exercises the four Notes-sidebar flows end-to-end against a real server with
 * an on-disk note tree (no route mocking): the notes API actually moves/renames/
 * duplicates files, so every assertion is verified against the filesystem as well
 * as the rendered tree.
 *
 *   - AC-01/AC-02  Shift+range and Ctrl/Cmd toggle select, including folders,
 *                  with a second Shift+Click that re-scopes (not union-grows).
 *   - AC-03        Bulk drag-move: dragging one row of a multi-selection moves
 *                  the whole selection into the drop-target folder.
 *   - AC-04        Cut→Paste moves; Copy→Paste duplicates with a de-duped name.
 *   - AC-06        Inline rename: double-click commits on Enter, cancels on Esc.
 *
 * The default managed notes root is <dataDir>/repos/<wsId>/notes (see
 * getRepoDataPath), so we seed markdown files there before navigating.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync, type Page } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';

const WS_ID = 'ws-notes-fileops';

/** Absolute path to the workspace's default managed notes root. */
function notesRootFor(dataDir: string, wsId = WS_ID): string {
    return path.join(dataDir, 'repos', wsId, 'notes');
}

/**
 * Seed a small note tree on disk:
 *   Work/         (notebook)   alpha.md, beta.md, gamma.md
 *   Personal/     (notebook)   diary.md
 *   readme.md     (page)
 * Returns the notes root directory.
 */
function seedNotesTree(dataDir: string, wsId = WS_ID): string {
    const root = notesRootFor(dataDir, wsId);
    fs.mkdirSync(path.join(root, 'Work'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Personal'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Work', 'alpha.md'), '# Alpha\n\nAlpha note.\n');
    fs.writeFileSync(path.join(root, 'Work', 'beta.md'), '# Beta\n\nBeta note.\n');
    fs.writeFileSync(path.join(root, 'Work', 'gamma.md'), '# Gamma\n\nGamma note.\n');
    fs.writeFileSync(path.join(root, 'Personal', 'diary.md'), '# Diary\n\nDiary note.\n');
    fs.writeFileSync(path.join(root, 'readme.md'), '# Readme\n\nRoot note.\n');
    return root;
}

/** Navigate to the workspace Notes sub-tab and wait for the tree to render. */
async function openNotesTree(page: Page, serverUrl: string, wsId = WS_ID): Promise<void> {
    await page.goto(serverUrl);
    await page.evaluate((id) => {
        location.hash = `#repos/${id}/notes`;
    }, wsId);
    await expect(page.locator('[data-testid="notes-sidebar"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-testid="notes-tree"]')).toBeVisible({ timeout: 10_000 });
}

/** A tree row located by its full node path (unique; names can collide). */
function row(page: Page, nodePath: string) {
    return page.locator(`[data-node-path="${nodePath}"]`);
}

/** A top-level context-menu item by exact label. */
function menuItem(page: Page, label: string) {
    return page.locator('[data-testid="context-menu"]').getByRole('menuitem', { name: label, exact: true });
}

/** Expand the "Work" notebook so its child pages mount into the DOM. */
async function expandWork(page: Page): Promise<void> {
    await row(page, 'Work').click();
    await expect(row(page, 'Work/alpha.md')).toBeVisible({ timeout: 5_000 });
    await expect(row(page, 'Work/gamma.md')).toBeVisible();
}

test.describe('Notes tree — selection & file operations', () => {
    test('AC-01/AC-02: shift-range includes folders, re-scopes, and Cmd toggles', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-sel-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);
            seedNotesTree(dataDir);

            await openNotesTree(page, serverUrl);
            await expandWork(page);

            const badge = page.locator('[data-testid="notes-selection-badge"]');

            // expandWork() already plain-clicked Work → it is expanded and is the
            // single-selected anchor (a second click would collapse it).

            // Shift+Click gamma → contiguous range Work..gamma, spanning the folder
            // row plus its three page rows = 4 selected. The folder Work is part of
            // the selection (AC-02: folders count toward range/bulk ops).
            await row(page, 'Work/gamma.md').click({ modifiers: ['Shift'] });
            await expect(badge).toContainText('4 selected');
            await expect(row(page, 'Work')).toHaveAttribute('aria-selected', 'true');
            await expect(row(page, 'Work/beta.md')).toHaveAttribute('aria-selected', 'true');

            // Second Shift+Click above the anchor → RE-SCOPE (replace) the range:
            // the page rows below Work that were in the previous range are dropped.
            // A union-only grow bug (the old behaviour) would keep them selected.
            // Row-level asserts avoid depending on the exact count, since the E2E
            // config injects a "Plans" system folder between Personal and Work.
            await row(page, 'Personal').click({ modifiers: ['Shift'] });
            await expect(row(page, 'Personal')).toHaveAttribute('aria-selected', 'true');
            await expect(row(page, 'Work')).toHaveAttribute('aria-selected', 'true');
            await expect(row(page, 'Work/alpha.md')).toHaveAttribute('aria-selected', 'false');
            await expect(row(page, 'Work/beta.md')).toHaveAttribute('aria-selected', 'false');
            await expect(row(page, 'Work/gamma.md')).toHaveAttribute('aria-selected', 'false');

            // Cmd/Ctrl+Click toggles a single row in and back out without disturbing
            // the rest of the selection, and moves the anchor to it.
            await row(page, 'Work/gamma.md').click({ modifiers: ['Meta'] });
            await expect(row(page, 'Work/gamma.md')).toHaveAttribute('aria-selected', 'true');
            await expect(row(page, 'Work')).toHaveAttribute('aria-selected', 'true');
            await row(page, 'Work/gamma.md').click({ modifiers: ['Meta'] });
            await expect(row(page, 'Work/gamma.md')).toHaveAttribute('aria-selected', 'false');
            await expect(row(page, 'Work')).toHaveAttribute('aria-selected', 'true');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('AC-03: dragging one row of a multi-selection moves the whole selection', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-drag-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);
            const root = seedNotesTree(dataDir);

            await openNotesTree(page, serverUrl);
            await expandWork(page);

            // Build a clean {alpha, beta} selection: plain-click resets first, then
            // Cmd+Click each (the folder-expand click otherwise pollutes the set).
            await row(page, 'Work/alpha.md').click();
            await row(page, 'Work/alpha.md').click({ modifiers: ['Meta'] });
            await row(page, 'Work/beta.md').click({ modifiers: ['Meta'] });
            await expect(page.locator('[data-testid="notes-selection-badge"]')).toContainText('2 selected');

            // Drag alpha (part of the selection) onto the Personal folder → both move.
            await row(page, 'Work/alpha.md').dragTo(row(page, 'Personal'));

            await expect(async () => {
                expect(fs.existsSync(path.join(root, 'Personal', 'alpha.md'))).toBe(true);
                expect(fs.existsSync(path.join(root, 'Personal', 'beta.md'))).toBe(true);
                expect(fs.existsSync(path.join(root, 'Work', 'alpha.md'))).toBe(false);
                expect(fs.existsSync(path.join(root, 'Work', 'beta.md'))).toBe(false);
            }).toPass({ timeout: 10_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('AC-04: Cut then Paste moves a note into another folder', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-cut-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);
            const root = seedNotesTree(dataDir);

            await openNotesTree(page, serverUrl);
            await expandWork(page);

            // Cut alpha via its context menu.
            await row(page, 'Work/alpha.md').click({ button: 'right' });
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5_000 });
            await menuItem(page, 'Cut').click();

            // The cut row shows the pending/dimmed affordance until pasted.
            await expect(row(page, 'Work/alpha.md')).toHaveAttribute('data-cut', 'true');

            // Paste into the Personal folder.
            await row(page, 'Personal').click({ button: 'right' });
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5_000 });
            await menuItem(page, 'Paste').click();

            await expect(async () => {
                expect(fs.existsSync(path.join(root, 'Personal', 'alpha.md'))).toBe(true);
                expect(fs.existsSync(path.join(root, 'Work', 'alpha.md'))).toBe(false);
            }).toPass({ timeout: 10_000 });

            // The moved note appears under Personal in the tree.
            await row(page, 'Personal').click();
            await expect(row(page, 'Personal/alpha.md')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('AC-04: Copy then Paste duplicates a note with a de-duped name', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-copy-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);
            const root = seedNotesTree(dataDir);

            await openNotesTree(page, serverUrl);
            await expandWork(page);

            // Copy alpha, then paste back into the same Work folder → "alpha copy".
            await row(page, 'Work/alpha.md').click({ button: 'right' });
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5_000 });
            await menuItem(page, 'Copy').click();

            await row(page, 'Work').click({ button: 'right' });
            await expect(page.locator('[data-testid="context-menu"]')).toBeVisible({ timeout: 5_000 });
            await menuItem(page, 'Paste').click();

            await expect(async () => {
                // Original stays; a de-duped duplicate is created alongside it.
                expect(fs.existsSync(path.join(root, 'Work', 'alpha.md'))).toBe(true);
                expect(fs.existsSync(path.join(root, 'Work', 'alpha copy.md'))).toBe(true);
            }).toPass({ timeout: 10_000 });

            await expect(row(page, 'Work/alpha copy.md')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('AC-06: inline rename commits on Enter and cancels on Esc', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-rename-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);
            const root = seedNotesTree(dataDir);

            await openNotesTree(page, serverUrl);
            await expandWork(page);

            // Commit: double-click the name → inline input → type → Enter.
            await row(page, 'Work/alpha.md').locator('[data-testid="notes-tree-item-name"]').dblclick();
            const input = page.locator('[data-testid="notes-inline-rename-input"]');
            await expect(input).toBeVisible({ timeout: 5_000 });
            await input.fill('renamed-alpha');
            await input.press('Enter');

            await expect(async () => {
                expect(fs.existsSync(path.join(root, 'Work', 'renamed-alpha.md'))).toBe(true);
                expect(fs.existsSync(path.join(root, 'Work', 'alpha.md'))).toBe(false);
            }).toPass({ timeout: 10_000 });
            await expect(row(page, 'Work/renamed-alpha.md')).toBeVisible({ timeout: 5_000 });

            // Cancel: double-click beta → type → Esc → original name restored on disk.
            await row(page, 'Work/beta.md').locator('[data-testid="notes-tree-item-name"]').dblclick();
            await expect(input).toBeVisible({ timeout: 5_000 });
            await input.fill('should-not-apply');
            await input.press('Escape');

            await expect(input).toBeHidden({ timeout: 5_000 });
            await expect(row(page, 'Work/beta.md')).toBeVisible();
            expect(fs.existsSync(path.join(root, 'Work', 'beta.md'))).toBe(true);
            expect(fs.existsSync(path.join(root, 'Work', 'should-not-apply.md'))).toBe(false);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
