/**
 * Notes page — inline PDF embed resize (mocked notes API, E2E).
 *
 * Browser coverage for the PdfBlock resize handle: a seeded `.pdf` embed renders
 * as an inline <iframe>; dragging the bottom-edge handle taller changes the
 * iframe height and the resize persists through the autosave round-trip as a
 * `data-pdf-height` attribute on the raw `md-pdf-embed` div.
 *
 * Everything is served from the in-memory notes mock (fixtures/notes-fixtures.ts).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';
import { createNotesStore, mockNotesApi, type NoteTreeNode } from './fixtures/notes-fixtures';

const WS_ID = 'ws-pdf-resize-mock';

// Native PDF navigation requires full Chromium rather than the headless shell.
test.use({ channel: 'chromium' });

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

async function openFirstPage(page: import('@playwright/test').Page): Promise<void> {
    await page.locator('[data-testid="notes-tree-item-Journal"]').click();
    const pageRow = page.locator('[data-testid="notes-tree-item-getting-started.md"]');
    await expect(pageRow).toBeVisible({ timeout: 5_000 });
    await pageRow.click();
}

test.describe('Notes page — inline PDF embed resize', () => {
    test('drag-resizes the embed taller and persists data-pdf-height on autosave', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pdf-resize-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

            const store = createNotesStore({
                tree: seedTree(),
                content: {
                    'Journal/getting-started.md': '# Doc\n\n![Sample PDF](.attachments/sample.pdf)\n',
                },
            });
            await mockNotesApi(page, store);

            await openNotesPage(page, serverUrl, WS_ID);
            await openFirstPage(page);

            const pdfNode = page.locator('[data-testid="pdf-node-view"]');
            await expect(pdfNode).toBeVisible({ timeout: 10_000 });

            const iframe = page.locator('[data-testid="pdf-node-view-frame"]');
            await iframe.scrollIntoViewIfNeeded();
            const before = await iframe.boundingBox();
            expect(before).not.toBeNull();

            // The bottom-edge resize handle is always present (faint by default).
            const handle = page.locator('[data-testid="pdf-node-view-resize-handle"]');
            await expect(handle).toBeVisible({ timeout: 5_000 });

            // Register the autosave-PUT wait BEFORE dragging so the debounced
            // request carrying the serialized height is not missed.
            const putRequest = page.waitForRequest(
                (req) =>
                    req.method() === 'PUT' &&
                    /\/notes\/content(\?|$)/.test(req.url()) &&
                    (req.postData() ?? '').includes('data-pdf-height'),
                { timeout: 20_000 },
            );

            // Drag the handle downward by a known delta. pointer-events:none on the
            // iframe during drag (the `pdf-resizing` class) keeps the document-level
            // mousemove firing over the PDF.
            const box = await handle.boundingBox();
            expect(box).not.toBeNull();
            const startX = box!.x + box!.width / 2;
            const startY = box!.y + box!.height / 2;
            await page.mouse.move(startX, startY);
            await page.mouse.down();
            await page.mouse.move(startX, startY + 200, { steps: 10 });
            await page.mouse.up();

            // The iframe grew taller.
            await expect
                .poll(async () => (await iframe.boundingBox())?.height ?? 0, { timeout: 5_000 })
                .toBeGreaterThan((before?.height ?? 0) + 100);

            // The autosave PUT persisted the height as a raw md-pdf-embed div.
            const put = await putRequest;
            const body = put.postDataJSON() as { path?: string; content?: string };
            expect(body.path).toBe('Journal/getting-started.md');
            expect(body.content).toContain('data-pdf-height="');
            expect(body.content).toContain('class="md-pdf-embed"');
            expect(body.content).toContain('data-pdf-url=".attachments/sample.pdf"');
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
