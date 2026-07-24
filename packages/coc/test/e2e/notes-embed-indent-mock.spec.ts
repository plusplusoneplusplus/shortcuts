/**
 * Notes page — visual-embed indentation (mocked notes API, E2E). Covers AC-03.
 *
 * Browser coverage for the Notes indentation feature applied to block-level
 * visual embeds. Two flows:
 *   1. Indent a seeded image via the toolbar AND the keyboard, wait for autosave,
 *      reload the note, and verify the same visual offset plus the `data-indent`
 *      Markdown metadata round-trips; then outdent back to level 0 and confirm
 *      `data-indent` is removed from the persisted Markdown.
 *   2. In a narrowed pane, verify a wide, deeply-indented image stays inside the
 *      editor with no horizontal overflow and remains usable.
 *
 * Everything is served from the in-memory notes mock (fixtures/notes-fixtures.ts)
 * — no real note files touch disk. A small PNG is served for image GETs so the
 * seeded <img> loads cleanly; the workspace is seeded server-side so the page can
 * route to it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';
import { createNotesStore, mockNotesApi, type NoteTreeNode } from './fixtures/notes-fixtures';

const WS_ID = 'ws-embed-indent-mock';
const NOTE_PATH = 'Journal/getting-started.md';

/** A valid 1×1 PNG — the seeded <img>'s box size comes from its `width` attr. */
const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

function seedTree(): NoteTreeNode[] {
    return [
        {
            name: 'Journal',
            path: 'Journal',
            type: 'notebook',
            children: [{ name: 'getting-started.md', path: NOTE_PATH, type: 'page' }],
        },
    ];
}

/**
 * Serve a real PNG for image GETs so the seeded <img> loads (the shared notes
 * mock serves PDF bytes for every attachment). Registered AFTER mockNotesApi so
 * Playwright matches it first; non-GET image requests fall back to the mock.
 */
async function serveImagesAsPng(page: import('@playwright/test').Page): Promise<void> {
    await page.route('**/api/workspaces/*/notes/image**', async (route) => {
        if (route.request().method() === 'GET') {
            return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 });
        }
        return route.fallback();
    });
}

async function openNotesPage(
    page: import('@playwright/test').Page,
    serverUrl: string,
    wsId: string,
): Promise<void> {
    await page.goto(serverUrl);
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 15_000 });
    await page.evaluate((id) => {
        location.hash = `#repos/${id}/notes`;
    }, wsId);
    await expect(page.locator('[data-testid="notes-sidebar"]')).toBeVisible({ timeout: 15_000 });
}

function trackPageErrors(page: import('@playwright/test').Page): Error[] {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));
    return errors;
}

async function openFirstPage(page: import('@playwright/test').Page): Promise<void> {
    const pageRow = page.locator('[data-testid="notes-tree-item-getting-started.md"]');
    // Expand the Journal notebook only if the page row is not already visible.
    // The tree's expansion state persists across a reload, so an unconditional
    // click would collapse an already-expanded notebook and hide the page.
    if (!(await pageRow.isVisible().catch(() => false))) {
        await page.locator('[data-testid="notes-tree-item-Journal"]').click();
    }
    await expect(pageRow).toBeVisible({ timeout: 5_000 });
    await pageRow.click();
}

/** Numeric px value of a computed length (e.g. "64px" → 64). */
function px(value: string): number {
    return parseFloat(value) || 0;
}

test.describe('Notes page — visual embed indentation', () => {
    test('indents an image via toolbar + keyboard, autosaves data-indent, and preserves it on reload', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-embed-indent-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

            const store = createNotesStore({
                tree: seedTree(),
                // Seed a sized image (a solid, reliably-clickable box) at indent 0.
                content: {
                    [NOTE_PATH]: '# Doc\n\n<img src=".attachments/pic.png" alt="Pic" width="200" />\n',
                },
            });
            await mockNotesApi(page, store);
            await serveImagesAsPng(page);

            const errors = trackPageErrors(page);
            await openNotesPage(page, serverUrl, WS_ID);
            await openFirstPage(page);

            const wrapper = page.locator('.image-resize-wrapper');
            await expect(wrapper).toBeVisible({ timeout: 10_000 });
            // Level 0: no indent attribute and no left padding yet.
            expect(await wrapper.getAttribute('data-indent')).toBeNull();
            expect(px(await wrapper.evaluate((el) => getComputedStyle(el).paddingLeft))).toBe(0);

            // Select the image node (ProseMirror NodeSelection), then increase
            // its indent once with the toolbar button.
            await wrapper.locator('img').click();
            await page.locator('[aria-label="Increase indent"]').click();
            await expect(wrapper).toHaveAttribute('data-indent', '1', { timeout: 5_000 });

            // Increase once more with the keyboard (Tab). List-item Tab behaviour
            // is unaffected; a selected embed indents.
            await page.keyboard.press('Tab');
            await expect(wrapper).toHaveAttribute('data-indent', '2', { timeout: 5_000 });

            // The visual offset is a positive left padding from the shared CSS scale.
            const paddingIndent2 = px(await wrapper.evaluate((el) => getComputedStyle(el).paddingLeft));
            expect(paddingIndent2).toBeGreaterThan(0);

            // Autosave persists the indent as raw HTML `data-indent`, with the
            // image src rewritten back to its relative `.attachments/` path (never
            // a workspace-specific API URL).
            await expect
                .poll(() => store.content.get(NOTE_PATH) ?? '', { timeout: 15_000 })
                .toContain('data-indent="2"');
            const savedMarkdown = store.content.get(NOTE_PATH) ?? '';
            expect(savedMarkdown).toContain('src=".attachments/pic.png"');
            expect(savedMarkdown).not.toContain('/api/workspaces/');

            // Reload the whole page and reopen the note; the persisted indent
            // round-trips to the same visual offset.
            await page.reload();
            await expect(page.locator('[data-testid="notes-sidebar"]')).toBeVisible({ timeout: 15_000 });
            await openFirstPage(page);

            const reloaded = page.locator('.image-resize-wrapper');
            await expect(reloaded).toBeVisible({ timeout: 10_000 });
            await expect(reloaded).toHaveAttribute('data-indent', '2', { timeout: 5_000 });
            const paddingAfterReload = px(
                await reloaded.evaluate((el) => getComputedStyle(el).paddingLeft),
            );
            expect(paddingAfterReload).toBe(paddingIndent2);

            // Outdent with the keyboard (Shift+Tab) then the toolbar back to level
            // 0; returning to 0 drops `data-indent` from the persisted Markdown.
            await reloaded.locator('img').click();
            await page.keyboard.press('Shift+Tab');
            await expect(reloaded).toHaveAttribute('data-indent', '1', { timeout: 5_000 });
            await page.locator('[aria-label="Decrease indent"]').click();
            await expect
                .poll(() => reloaded.getAttribute('data-indent'), { timeout: 5_000 })
                .toBeNull();
            await expect
                .poll(() => store.content.get(NOTE_PATH) ?? '', { timeout: 15_000 })
                .not.toContain('data-indent');
            // The image itself is preserved (still a sized <img>), just un-indented.
            expect(store.content.get(NOTE_PATH) ?? '').toContain('src=".attachments/pic.png"');

            expect(errors).toHaveLength(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('a wide, deeply-indented image stays within a narrowed pane without horizontal overflow', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-embed-indent-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

            const store = createNotesStore({
                tree: seedTree(),
                // A wide custom-width image at the maximum indent (level 8 = 16rem).
                content: {
                    [NOTE_PATH]:
                        '# Doc\n\n<img src=".attachments/wide.png" alt="wide" width="1200" data-indent="8" />\n',
                },
            });
            await mockNotesApi(page, store);
            await serveImagesAsPng(page);

            const errors = trackPageErrors(page);
            await openNotesPage(page, serverUrl, WS_ID);
            await openFirstPage(page);

            const wrapper = page.locator('.image-resize-wrapper');
            await expect(wrapper).toBeVisible({ timeout: 10_000 });
            await expect(wrapper).toHaveAttribute('data-indent', '8', { timeout: 5_000 });

            // Narrow the pane so the deep indent (16rem) plus a 1200px image would
            // overflow a naive layout, then let it reflow.
            await page.setViewportSize({ width: 640, height: 900 });
            await page.waitForTimeout(300);

            // The editor content area has no horizontal overflow: its scroll width
            // does not exceed its client width (2px tolerance for subpixel rounding).
            const editor = page.locator('.ProseMirror');
            const metrics = await editor.evaluate((el) => ({
                scrollWidth: el.scrollWidth,
                clientWidth: el.clientWidth,
            }));
            expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 2);

            // The image stays usable: still rendered, still indented, and its box
            // is capped within the (shrunken) editor content width rather than
            // spilling out.
            const imgBox = await wrapper.locator('img').boundingBox();
            const editorBox = await editor.boundingBox();
            expect(imgBox).not.toBeNull();
            expect(editorBox).not.toBeNull();
            expect(imgBox!.width).toBeLessThanOrEqual(editorBox!.width + 2);
            // The deep indent still shifts the block right (positive left padding).
            expect(px(await wrapper.evaluate((el) => getComputedStyle(el).paddingLeft))).toBeGreaterThan(0);

            expect(errors).toHaveLength(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
