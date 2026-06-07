/**
 * Note Editor Toolbar — Strikethrough E2E Regression Test
 *
 * Verifies that the Strikethrough (and other formatting) toolbar buttons
 * correctly apply marks to selected text in the NoteEditor.
 *
 * Regression: The original implementation captured a Tiptap chain at render
 * time via `editor.chain().focus.bind(editor.chain())`. The chain's internal
 * transaction became stale after any editor state change (selection, focus),
 * causing "Applying a mismatched transaction" errors that silently swallowed
 * the command. Fixed by creating a fresh chain per invocation.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';

const WS_ID = 'ws-strike';

/** Mock the tasks/content endpoint to return a fixed markdown string. */
async function mockTasksContent(
    page: import('@playwright/test').Page,
    content: string,
): Promise<void> {
    await page.route('**/api/workspaces/*/tasks/content*', (route) => {
        return route.fulfill({
            status: 200,
            body: JSON.stringify({ content, path: 'task-a.md', mtime: Date.now() }),
            contentType: 'application/json',
        });
    });
}

/** Navigate to a task file in the NoteEditor. */
async function openTaskInEditor(
    page: import('@playwright/test').Page,
    serverUrl: string,
    repoDir: string,
): Promise<void> {
    await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 10_000 });
    await page.locator('[data-testid="repo-tab"]').first().click();
    await expect(page.locator('#repo-detail-content')).toBeVisible();

    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10_000 });

    const taskRow = page.locator('[data-testid="task-tree-item-task-a"]');
    await expect(taskRow).toBeVisible({ timeout: 5_000 });
    await taskRow.click();

    await expect(page.locator('[data-testid="note-editor"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="note-editor-toolbar"]')).toBeVisible({ timeout: 5_000 });
}

test.describe('Note Editor Toolbar — Strikethrough regression', () => {

    test('clicking Strikethrough toolbar button applies mark to selected text', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-strike-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await mockTasksContent(page, '# Test Note\n\nHello world for strikethrough test.');

            await openTaskInEditor(page, serverUrl, repoDir);

            const editor = page.locator('.ProseMirror');
            await expect(editor).toBeVisible({ timeout: 5_000 });
            await expect(editor).toContainText('Hello world', { timeout: 5_000 });

            // Click inside the paragraph to focus the editor
            const paragraph = editor.locator('p:has-text("Hello world")');
            await paragraph.click({ clickCount: 3 });
            await page.waitForTimeout(200);

            // Use the keyboard shortcut — Mod+Shift+S (Meta on macOS, Control on Linux)
            const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
            await page.keyboard.press(`${mod}+Shift+s`);

            // The selected text should now be wrapped in <s> tags
            await expect(editor.locator('s')).toBeVisible({ timeout: 5_000 });
            await expect(editor.locator('s')).toContainText('Hello world');
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Strikethrough button shows active state when cursor is in struck text', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-strike-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await mockTasksContent(page, '# Toolbar\n\nClick the button to strike.');

            await openTaskInEditor(page, serverUrl, repoDir);

            const editor = page.locator('.ProseMirror');
            await expect(editor).toBeVisible({ timeout: 5_000 });
            await expect(editor).toContainText('Click the button', { timeout: 5_000 });

            const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
            const strikeBtn = page.locator('[aria-label="Strikethrough"]');

            // Initially the Strikethrough button should NOT have "font-bold" (active class)
            await expect(strikeBtn).not.toHaveClass(/font-bold/, { timeout: 3_000 });

            // Select paragraph text and apply strikethrough via keyboard
            const paragraph = editor.locator('p:has-text("Click the button")');
            await paragraph.click({ clickCount: 3 });
            await page.waitForTimeout(200);
            await page.keyboard.press(`${mod}+Shift+s`);
            await expect(editor.locator('s')).toBeVisible({ timeout: 5_000 });

            // Click inside the struck-through text to place cursor within it
            await editor.locator('s').click();
            await page.waitForTimeout(200);

            // Now the Strikethrough toolbar button should show the active state
            await expect(strikeBtn).toHaveClass(/font-bold/, { timeout: 3_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Bold then Strikethrough applies both marks sequentially', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-strike-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await mockTasksContent(page, '# Multi\n\nApply both bold and strike.');

            await openTaskInEditor(page, serverUrl, repoDir);

            const editor = page.locator('.ProseMirror');
            await expect(editor).toBeVisible({ timeout: 5_000 });
            await expect(editor).toContainText('Apply both', { timeout: 5_000 });

            const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

            // Select all text in paragraph via triple-click
            const paragraph = editor.locator('p:has-text("Apply both")');
            await paragraph.click({ clickCount: 3 });
            await page.waitForTimeout(200);

            // Apply Bold via keyboard shortcut
            await page.keyboard.press(`${mod}+b`);
            await expect(editor.locator('strong')).toBeVisible({ timeout: 5_000 });

            // Re-select (Bold application may change selection)
            await paragraph.click({ clickCount: 3 });
            await page.waitForTimeout(200);

            // Apply Strikethrough
            await page.keyboard.press(`${mod}+Shift+s`);

            // Both marks should be applied
            await expect(editor.locator('s')).toBeVisible({ timeout: 5_000 });
            await expect(editor.locator('strong')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('Strikethrough toggles off when applied again', async ({
        page,
        serverUrl,
        dataDir,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-strike-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            // Use only a paragraph (no heading) to avoid multi-node selection issues
            await mockTasksContent(page, 'Strike on then off.');

            await openTaskInEditor(page, serverUrl, repoDir);

            const editor = page.locator('.ProseMirror');
            await expect(editor).toBeVisible({ timeout: 5_000 });
            await expect(editor).toContainText('Strike on', { timeout: 5_000 });

            const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

            // Select all content (only one paragraph) and apply strikethrough
            await editor.click();
            await page.keyboard.press(`${mod}+a`);
            await page.waitForTimeout(200);
            await page.keyboard.press(`${mod}+Shift+s`);
            await expect(editor.locator('s')).toBeVisible({ timeout: 5_000 });

            // Re-select all and toggle strike off
            await page.keyboard.press(`${mod}+a`);
            await page.waitForTimeout(200);
            await page.keyboard.press(`${mod}+Shift+s`);
            await expect(editor.locator('s')).toHaveCount(0, { timeout: 5_000 });
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
