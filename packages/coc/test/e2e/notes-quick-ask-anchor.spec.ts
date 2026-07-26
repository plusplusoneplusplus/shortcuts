import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';
import { createNotesStore, mockNotesApi, type NoteTreeNode } from './fixtures/notes-fixtures';

const WS_ID = 'ws-notes-quick-ask';
const NOTE_PATH = 'Journal/quick-ask.md';
const SELECTED_TEXT = 'gradient descent';

function seedTree(): NoteTreeNode[] {
    return [{
        name: 'Journal',
        path: 'Journal',
        type: 'notebook',
        children: [{ name: 'quick-ask.md', path: NOTE_PATH, type: 'page' }],
    }];
}

async function enableQuickAsk(page: import('@playwright/test').Page): Promise<void> {
    await page.route('**/api/config/runtime', async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        const features = { ...(json.features ?? {}), quickAskSidenotesEnabled: true };
        await route.fulfill({
            status: response.status(),
            headers: { ...response.headers(), 'content-type': 'application/json' },
            body: JSON.stringify({ ...json, features }),
        });
    });
    await page.route('**/api/quick-ask/answer?**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                answer: 'An iterative first-order optimization method.',
                model: 'mock-model',
            }),
        });
    });
}

async function openNote(page: import('@playwright/test').Page, serverUrl: string): Promise<void> {
    await page.goto(serverUrl);
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 15_000 });
    await page.evaluate((id) => {
        location.hash = `#repos/${id}/notes`;
    }, WS_ID);
    await expect(page.locator('[data-testid="notes-sidebar"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="notes-tree-item-Journal"]').click();
    await page.locator('[data-testid="notes-tree-item-quick-ask.md"]').click();
    await expect(page.locator('.ProseMirror')).toContainText(SELECTED_TEXT, { timeout: 10_000 });
}

async function selectText(page: import('@playwright/test').Page, text: string): Promise<void> {
    await page.locator('.ProseMirror').evaluate((root, selectedText) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const node = walker.currentNode;
            const start = node.textContent?.indexOf(selectedText) ?? -1;
            if (start < 0) continue;
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, start + selectedText.length);
            const selection = window.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(range);
            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            return;
        }
        throw new Error(`Text not found: ${selectedText}`);
    }, text);
}

test('Notes Quick Ask persists, reloads, reopens, and deletes its source underline', async ({
    page,
    serverUrl,
}) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-notes-quick-ask-'));
    try {
        const repoDir = createRepoFixture(tmpDir);
        await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);
        const store = createNotesStore({
            tree: seedTree(),
            content: {
                [NOTE_PATH]: '# Optimization\n\nWe use gradient descent over many epochs.',
            },
        });
        await enableQuickAsk(page);
        await mockNotesApi(page, store);
        await openNote(page, serverUrl);

        await selectText(page, SELECTED_TEXT);
        await expect(page.getByTestId('quick-ask-pill')).toBeVisible();
        await page.getByTestId('quick-ask-pill').click();
        await page.getByTestId('quick-ask-input-field').press('Enter');

        const anchor = page.locator('.note-quick-ask-anchor');
        const chip = page.locator('.qa-sidenote-ref');
        await expect(anchor).toHaveText(SELECTED_TEXT);
        await expect(chip).toBeVisible();
        await expect(anchor).toHaveCSS('border-bottom-style', 'dotted');
        await expect(anchor).toHaveCSS('border-bottom-width', '2px');

        await expect.poll(() => store.content.get(NOTE_PATH) ?? '', {
            timeout: 10_000,
        }).toContain('"s":"gradient descent"');

        await page.reload();
        await expect(page.locator('.ProseMirror')).toContainText(SELECTED_TEXT, { timeout: 15_000 });
        await expect(page.locator('.note-quick-ask-anchor')).toHaveText(SELECTED_TEXT);
        await expect(page.locator('.qa-sidenote-ref')).toBeVisible();

        await page.locator('.qa-sidenote-ref').click();
        await expect(page.getByTestId('quick-ask-popover')).toContainText(SELECTED_TEXT);
        await expect(page.getByTestId('quick-ask-popover')).toContainText(
            'An iterative first-order optimization method.',
        );

        await page.getByTestId('quick-ask-popover-dismiss').click();
        await expect(page.locator('.qa-sidenote-ref')).toHaveCount(0);
        await expect(page.locator('.note-quick-ask-anchor')).toHaveCount(0);
        await expect.poll(() => store.content.get(NOTE_PATH) ?? '', {
            timeout: 10_000,
        }).not.toContain('[^qa-');
    } finally {
        safeRmSync(tmpDir);
    }
});
