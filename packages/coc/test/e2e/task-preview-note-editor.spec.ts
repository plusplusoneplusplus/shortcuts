/**
 * TaskPreview + NoteEditor Swap E2E Tests (011)
 *
 * Regression tests verifying that the TaskPreview component now renders
 * NoteEditor (backed by the tasks content API) instead of the old
 * MarkdownReviewEditor. Added as part of the task-preview-swap migration.
 *
 * Coverage:
 *  - Clicking a task file in the miller column opens NoteEditor
 *  - The tasks/content endpoint is called (not the notes endpoint)
 *  - The close button (task-preview-close) hides the editor
 *  - View-mode toggle (rich ↔ source) is available in NoteEditor
 *  - The notes/content endpoint is NOT called for task files
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Set up a repo with tasks, seed as a workspace, navigate to the Tasks sub-tab. */
async function setupTasksTab(
    page: import('@playwright/test').Page,
    serverUrl: string,
    wsId: string,
    repoDir: string,
): Promise<void> {
    await seedWorkspace(serverUrl, wsId, `${wsId}-repo`, repoDir);

    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10_000 });

    await page.locator('[data-testid="repo-tab"]').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10_000 });
}

/** Mock the tasks/content endpoint to return a fixed markdown string. */
async function mockTasksContent(
    page: import('@playwright/test').Page,
    content: string,
    onCalled?: () => void,
): Promise<void> {
    await page.route('**/api/workspaces/*/tasks/content*', (route) => {
        onCalled?.();
        return route.fulfill({
            status: 200,
            body: JSON.stringify({ content, path: 'task-a.md', mtime: 1_700_000_000_000 }),
            contentType: 'application/json',
        });
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('TaskPreview — NoteEditor swap (011)', () => {

    test('11.1 clicking a task file opens NoteEditor', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tp-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);

            let tasksApiCalled = false;
            await mockTasksContent(page, '# Task A\n\nRoot-level pending task.', () => {
                tasksApiCalled = true;
            });

            await setupTasksTab(page, serverUrl, 'ws-tp-1', repoDir);

            // Click task-a to open TaskPreview
            const taskRow = page.locator('[data-testid="task-tree-item-task-a"]');
            await expect(taskRow).toBeVisible({ timeout: 5_000 });
            await taskRow.click();

            // NoteEditor (not MarkdownReviewEditor) should render
            await expect(page.locator('[data-testid="note-editor"]')).toBeVisible({ timeout: 10_000 });

            // The close button injected by TaskPreview via toolbarRight should be present
            await expect(page.locator('[data-testid="task-preview-close"]')).toBeVisible({ timeout: 5_000 });

            // The tasks content API must have been called — not the notes API
            expect(tasksApiCalled).toBe(true);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('11.2 notes content API is NOT called when previewing a task file', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tp-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);

            let notesApiCalled = false;
            await page.route('**/api/workspaces/*/notes/content*', (route) => {
                notesApiCalled = true;
                return route.continue();
            });
            await mockTasksContent(page, '# Task A\n\nNotes API should not be hit.');

            await setupTasksTab(page, serverUrl, 'ws-tp-2', repoDir);

            const taskRow = page.locator('[data-testid="task-tree-item-task-a"]');
            await expect(taskRow).toBeVisible({ timeout: 5_000 });
            await taskRow.click();

            await expect(page.locator('[data-testid="note-editor"]')).toBeVisible({ timeout: 10_000 });

            // Give any in-flight requests time to settle
            await page.waitForTimeout(500);

            expect(notesApiCalled).toBe(false);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('11.3 task-preview-close button hides the editor', async ({ page, serverUrl, dataDir }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tp-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await mockTasksContent(page, '# Task A\n\nClose-button test.');

            await setupTasksTab(page, serverUrl, 'ws-tp-3', repoDir);

            const taskRow = page.locator('[data-testid="task-tree-item-task-a"]');
            await expect(taskRow).toBeVisible({ timeout: 5_000 });
            await taskRow.click();

            const closeBtn = page.locator('[data-testid="task-preview-close"]');
            await expect(closeBtn).toBeVisible({ timeout: 10_000 });

            await closeBtn.click();

            // After closing, the NoteEditor should no longer be in the DOM
            await expect(page.locator('[data-testid="note-editor"]')).toHaveCount(0, { timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('11.4 NoteEditor view-mode toggle renders in the toolbar', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tp-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await mockTasksContent(page, '# Feature Plan\n\nPlanning document.');

            await setupTasksTab(page, serverUrl, 'ws-tp-4', repoDir);

            // Use the plan file which has 'source' initialViewMode variant available
            const taskRow = page.locator('[data-testid="task-tree-item-task-a"]');
            await expect(taskRow).toBeVisible({ timeout: 5_000 });
            await taskRow.click();

            await expect(page.locator('[data-testid="note-editor"]')).toBeVisible({ timeout: 10_000 });

            // NoteEditor toolbar mode toggle should be present (NoteEditor-specific, not MarkdownReviewEditor)
            await expect(page.locator('[data-testid="note-mode-toggle"]')).toBeVisible({ timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('11.5 switching to another task re-loads content via tasks API', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-tp-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);

            // Return distinct content per file so we can distinguish them
            let callCount = 0;
            await page.route('**/api/workspaces/*/tasks/content*', (route) => {
                callCount++;
                const url = route.request().url();
                const isTaskB = url.includes('task-b');
                return route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        content: isTaskB ? '# Task B\n\nDone.' : '# Task A\n\nPending.',
                        path: isTaskB ? 'task-b.md' : 'task-a.md',
                        mtime: 1_700_000_000_000,
                    }),
                    contentType: 'application/json',
                });
            });

            await setupTasksTab(page, serverUrl, 'ws-tp-5', repoDir);

            // Open task-a
            await page.locator('[data-testid="task-tree-item-task-a"]').click();
            await expect(page.locator('[data-testid="note-editor"]')).toBeVisible({ timeout: 10_000 });
            const callsAfterFirst = callCount;
            expect(callsAfterFirst).toBeGreaterThanOrEqual(1);

            // Open task-b — should trigger a second tasks/content fetch
            await page.locator('[data-testid="task-tree-item-task-b"]').click();
            await expect(page.locator('[data-testid="note-editor"]')).toBeVisible({ timeout: 5_000 });
            expect(callCount).toBeGreaterThan(callsAfterFirst);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
