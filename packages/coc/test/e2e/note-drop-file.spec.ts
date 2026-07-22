/**
 * Notes page — drag-and-drop file insertion (mocked notes API, E2E).
 *
 * Browser coverage for dropping an OS file onto the Tiptap editor surface
 * (`.ProseMirror`): a dropped PDF uploads and inserts an inline PdfBlock at the
 * drop point and autosaves back to the `![label](.attachments/…​.pdf)` markdown
 * embed; a dropped image inserts the existing image node. The handler also calls
 * `preventDefault`, so the browser does NOT navigate away to open the file.
 *
 * jsdom's DataTransfer/File support is too thin for a reliable unit test (same
 * class of limitation as the clipboard-paste jsdom flake), so drop is covered
 * end-to-end here. Everything is served from the in-memory notes mock
 * (fixtures/notes-fixtures.ts): the image POST/GET routes are mocked, so no real
 * attachment files touch disk.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Page } from '@playwright/test';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';
import {
    createNotesStore,
    mockNotesApi,
    MOCK_UPLOADED_PDF_PATH,
    type NoteTreeNode,
} from './fixtures/notes-fixtures';

const WS_ID = 'ws-note-drop-file';

function seedTree(): NoteTreeNode[] {
    return [
        {
            name: 'Journal',
            path: 'Journal',
            type: 'notebook',
            children: [
                { name: 'getting-started.md', path: 'Journal/getting-started.md', type: 'page' },
            ],
        },
    ];
}

async function openNotesPage(page: Page, serverUrl: string, wsId: string): Promise<void> {
    await page.goto(serverUrl);
    await expect(page.locator('[data-testid="repo-tab"]')).toHaveCount(1, { timeout: 15_000 });
    await page.evaluate((id) => {
        location.hash = `#repos/${id}/notes`;
    }, wsId);
    await expect(page.locator('[data-testid="notes-sidebar"]')).toBeVisible({ timeout: 15_000 });
}

function trackPageErrors(page: Page): Error[] {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));
    return errors;
}

async function openFirstPage(page: Page): Promise<void> {
    await page.locator('[data-testid="notes-tree-item-Journal"]').click();
    const pageRow = page.locator('[data-testid="notes-tree-item-getting-started.md"]');
    await expect(pageRow).toBeVisible({ timeout: 5_000 });
    await pageRow.click();
}

/**
 * Synthesize an OS file drop onto the editor surface. There is no OS-level drag
 * in Playwright, so the DataTransfer (carrying a real File) and the
 * dragenter/dragover/drop DragEvents are built and dispatched entirely in-page —
 * this is the only way `dataTransfer.files` gets reliably populated. The drop
 * coordinates are placed inside the `.ProseMirror` rect so `posAtCoords` resolves.
 */
async function dropFileOnEditor(
    page: Page,
    file: { name: string; type: string; bytes: number[] },
): Promise<void> {
    await page.evaluate((f) => {
        const el = document.querySelector('.ProseMirror');
        if (!el) throw new Error('.ProseMirror not found');
        const rect = el.getBoundingClientRect();
        const clientX = rect.left + Math.min(rect.width / 2, 40);
        const clientY = rect.top + 10;
        const makeEvent = (type: string): DragEvent => {
            const dt = new DataTransfer();
            dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
            return new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                clientX,
                clientY,
                dataTransfer: dt,
            });
        };
        el.dispatchEvent(makeEvent('dragenter'));
        el.dispatchEvent(makeEvent('dragover'));
        el.dispatchEvent(makeEvent('drop'));
    }, file);
}

test.describe('Notes page — drag-and-drop file insertion', () => {
    test('dropping a PDF inserts an inline block and autosaves the markdown embed', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-note-drop-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

            const store = createNotesStore({
                tree: seedTree(),
                content: { 'Journal/getting-started.md': '# Doc\n' },
            });
            await mockNotesApi(page, store);

            const errors = trackPageErrors(page);
            await openNotesPage(page, serverUrl, WS_ID);
            await openFirstPage(page);

            await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });

            // Register the autosave-PUT wait BEFORE dropping so the debounced
            // request is not missed. The predicate matches the serialized markdown
            // embed pointing at the deterministic uploaded attachment path.
            const putRequest = page.waitForRequest(
                (req) =>
                    req.method() === 'PUT' &&
                    /\/notes\/content(\?|$)/.test(req.url()) &&
                    (req.postData() ?? '').includes(MOCK_UPLOADED_PDF_PATH),
                { timeout: 20_000 },
            );

            await dropFileOnEditor(page, {
                name: 'dropped.pdf',
                type: 'application/pdf',
                bytes: [0x25, 0x50, 0x44, 0x46], // %PDF
            });

            // The upload POST fired with a base64 PDF data URL.
            await expect
                .poll(() => store.requestsFor('image-post').length, { timeout: 10_000 })
                .toBeGreaterThanOrEqual(1);
            const post = store.lastRequest('image-post');
            expect((post?.body as { data?: string })?.data ?? '').toMatch(
                /^data:application\/pdf;base64,/,
            );

            // The inline PDF node appears in the editor.
            await expect(page.locator('[data-testid="pdf-node-view"]')).toBeVisible({
                timeout: 10_000,
            });

            // The autosave PUT carries the markdown embed for the dropped PDF.
            const put = await putRequest;
            const body = put.postDataJSON() as { path?: string; content?: string };
            expect(body.path).toBe('Journal/getting-started.md');
            expect(body.content).toContain(`![dropped.pdf](${MOCK_UPLOADED_PDF_PATH})`);

            expect(errors).toHaveLength(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('dropping a PDF does NOT navigate the browser away (preventDefault guard)', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-note-drop-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

            const store = createNotesStore({
                tree: seedTree(),
                content: { 'Journal/getting-started.md': '# Doc\n' },
            });
            await mockNotesApi(page, store);

            await openNotesPage(page, serverUrl, WS_ID);
            await openFirstPage(page);
            await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });

            const urlBefore = page.url();
            await dropFileOnEditor(page, {
                name: 'dropped.pdf',
                type: 'application/pdf',
                bytes: [0x25, 0x50, 0x44, 0x46],
            });

            // Wait until the drop was actually handled (upload fired), then prove
            // the tab did not navigate to open the file and the editor survives.
            await expect
                .poll(() => store.requestsFor('image-post').length, { timeout: 10_000 })
                .toBeGreaterThanOrEqual(1);
            expect(page.url()).toBe(urlBefore);
            await expect(page.locator('.ProseMirror')).toBeVisible();
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('dropping an image inserts an <img> with the rewritten API src', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-note-drop-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

            const store = createNotesStore({
                tree: seedTree(),
                content: { 'Journal/getting-started.md': '# Doc\n' },
            });
            await mockNotesApi(page, store);

            const errors = trackPageErrors(page);
            await openNotesPage(page, serverUrl, WS_ID);
            await openFirstPage(page);
            await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });

            await dropFileOnEditor(page, {
                name: 'photo.png',
                type: 'image/png',
                // 1x1 transparent PNG header bytes are enough for the mock upload.
                bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
            });

            await expect
                .poll(() => store.requestsFor('image-post').length, { timeout: 10_000 })
                .toBeGreaterThanOrEqual(1);

            // The image node renders as an <img> pointing at the notes image API.
            const img = page.locator('.ProseMirror img[src*="/notes/image"]');
            await expect(img.first()).toBeVisible({ timeout: 10_000 });

            expect(errors).toHaveLength(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
