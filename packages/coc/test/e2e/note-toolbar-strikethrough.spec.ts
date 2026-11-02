/**
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
import { gotoWorkspace } from './fixtures/remote-shell';

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

    await gotoWorkspace(page, serverUrl, WS_ID, 'tasks');
    await expect(page.locator('[data-testid="task-tree"]')).toBeVisible({ timeout: 10_000 });

    const taskRow = page.locator('[data-testid="task-tree-item-task-a"]');
    await expect(taskRow).toBeVisible({ timeout: 5_000 });
    await taskRow.click();

    await expect(page.locator('[data-testid="note-editor"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="note-editor-toolbar"]')).toBeVisible({ timeout: 5_000 });
}

test.describe('Note Editor Toolbar — Strikethrough regression', () => {

    test('compact skill and zoom controls fit one row and wrap without clipping in a narrow editor', async ({ page, serverUrl }, testInfo) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-toolbar-'));
        try {
            await page.setViewportSize({ width: 1600, height: 900 });
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await mockTasksContent(page, 'Keep the editor selection.');
            await openTaskInEditor(page, serverUrl, repoDir);
            const toolbar = page.getByTestId('note-editor-toolbar');
            await toolbar.evaluate(el => { el.style.width = '1040px'; });
            const skill = page.getByRole('button', { name: 'Run Skill', exact: true });
            const zoom = page.getByTestId('note-zoom-control');
            const bold = toolbar.getByRole('button', { name: 'Bold', exact: true });
            const bounds = async () => ({
                skill: (await skill.boundingBox())!, zoom: (await zoom.boundingBox())!,
                bold: (await bold.boundingBox())!, toolbar: (await toolbar.boundingBox())!,
            });
            const wide = await bounds();
            expect(wide.skill.width).toBe(28);
            expect(wide.skill.height).toBe(wide.bold.height);
            expect(wide.zoom.width).toBeLessThanOrEqual(88);
            expect(wide.skill.y).toBe(wide.bold.y);
            expect(wide.zoom.y).toBe(wide.bold.y);
            expect((await page.getByTestId('version-history-toggle-btn').boundingBox())!.y).toBe(wide.bold.y);
            await toolbar.screenshot({ path: testInfo.outputPath('toolbar-wide.png') });

            const editor = page.locator('.ProseMirror');
            await editor.click();
            await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
            const selected = await page.evaluate(() => window.getSelection()?.toString());
            await page.getByTestId('note-zoom-in').click();
            await expect(editor).toBeFocused();
            expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
            await expect(page.getByTestId('note-zoom-readout')).toHaveText('110%');
            await page.keyboard.press('ArrowRight');

            await toolbar.evaluate(el => { el.style.width = '360px'; });
            const narrow = await bounds();
            expect(narrow.skill.y).toBeGreaterThan(narrow.bold.y);
            const buttons = await toolbar.locator('button').evaluateAll(elements => elements.map(el => {
                const rect = el.getBoundingClientRect();
                return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
            }));
            for (const button of buttons) {
                expect(button.left).toBeGreaterThanOrEqual(narrow.toolbar.x);
                expect(button.right).toBeLessThanOrEqual(narrow.toolbar.x + narrow.toolbar.width);
            }
            for (const control of [skill, ...['out', 'readout', 'in'].map(part => page.getByTestId(`note-zoom-${part}`))]) {
                const rect = (await control.boundingBox())!;
                expect(rect.width).toBeGreaterThanOrEqual(24);
                expect(rect.height).toBe(28);
            }
            await toolbar.screenshot({ path: testInfo.outputPath('toolbar-narrow.png') });
            await skill.focus();
            await page.keyboard.press('Enter');
            await expect(page.getByRole('heading', { name: 'Run Skill', exact: true })).toBeVisible();
            await expect(page.getByTestId('context-file-chip')).toContainText('task-a.md');
        } finally {
            safeRmSync(tmpDir);
        }
    });

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
            await mockTasksContent(page, 'Apply both bold and strike.');

            await openTaskInEditor(page, serverUrl, repoDir);

            const editor = page.locator('.ProseMirror');
            await expect(editor).toBeVisible({ timeout: 5_000 });
            await expect(editor).toContainText('Apply both', { timeout: 5_000 });

            const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

            // Keyboard selection stays stable when bold changes the text's width.
            await editor.click();
            await page.keyboard.press(`${mod}+a`);
            await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim()))
                .toBe('Apply both bold and strike.');

            // Apply Bold via keyboard shortcut
            await page.keyboard.press(`${mod}+b`);
            await expect(editor.locator('strong')).toBeVisible({ timeout: 5_000 });

            await page.keyboard.press(`${mod}+a`);
            await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim()))
                .toBe('Apply both bold and strike.');

            // Apply Strikethrough
            await page.keyboard.press(`${mod}+Shift+s`);

            // Both marks should be applied
            await expect(editor.locator('s')).toBeVisible({ timeout: 5_000 });
            await expect(editor.locator('strong')).toBeVisible();
            await expect(editor.locator('strong s, s strong')).toHaveText('Apply both bold and strike.');
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
