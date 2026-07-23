/**
 * Notes page — inline PDF embed (mocked notes API, E2E).
 *
 * Browser coverage for the PdfBlock node: a `.pdf` attachment referenced from a
 * note renders as an inline <iframe> in the Tiptap editor, and inserting a PDF
 * via the toolbar picker uploads it and autosaves the note back to the
 * `![label](.attachments/…​.pdf)` markdown embed syntax.
 *
 * Everything is served from the in-memory notes mock (fixtures/notes-fixtures.ts)
 * — the image POST/GET routes are mocked, so no real attachment files touch disk.
 * The workspace is still seeded server-side so the page can route to it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';
import {
    createNotesStore,
    mockNotesApi,
    MOCK_UPLOADED_PDF_PATH,
    type NoteTreeNode,
} from './fixtures/notes-fixtures';

const WS_ID = 'ws-pdf-embed-mock';

// Native PDF navigation requires full Chromium rather than the headless shell.
test.use({ channel: 'chromium' });

/** A tiny valid PDF payload used for the upload path. */
const TINY_PDF = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    'utf-8',
);

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

function trackPageErrors(page: import('@playwright/test').Page): Error[] {
    const errors: Error[] = [];
    page.on('pageerror', (err) => errors.push(err));
    return errors;
}

function isSeededPdfUrl(rawUrl: string): boolean {
    try {
        const parsed = new URL(rawUrl);
        return parsed.pathname === `/api/workspaces/${encodeURIComponent(WS_ID)}/notes/image`
            && parsed.searchParams.get('path') === '.attachments/sample.pdf';
    } catch {
        return false;
    }
}

function trackSeededPdfNavigation(page: import('@playwright/test').Page): {
    committedFrameUrls: string[];
    failedRequestUrls: string[];
} {
    const committedFrameUrls: string[] = [];
    const failedRequestUrls: string[] = [];

    page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame() && isSeededPdfUrl(frame.url())) {
            committedFrameUrls.push(frame.url());
        }
    });
    page.on('requestfailed', (request) => {
        if (isSeededPdfUrl(request.url())) {
            failedRequestUrls.push(request.url());
        }
    });

    return { committedFrameUrls, failedRequestUrls };
}

async function openFirstPage(page: import('@playwright/test').Page): Promise<void> {
    await page.locator('[data-testid="notes-tree-item-Journal"]').click();
    const pageRow = page.locator('[data-testid="notes-tree-item-getting-started.md"]');
    await expect(pageRow).toBeVisible({ timeout: 5_000 });
    await pageRow.click();
}

test.describe('Notes page — inline PDF embed', () => {
    test('renders a seeded PDF embed with the rewritten iframe src', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pdf-embed-'));
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

            const errors = trackPageErrors(page);
            await openNotesPage(page, serverUrl, WS_ID);
            const pdfNavigation = trackSeededPdfNavigation(page);
            await openFirstPage(page);

            // The PdfBlock node view renders in the editor.
            const pdfNode = page.locator('[data-testid="pdf-node-view"]');
            await expect(pdfNode).toBeVisible({ timeout: 10_000 });

            // Its <iframe> src is the relative `.attachments/…` path rewritten to
            // the notes image API URL (proving rewriteHtmlImageSrc handled data-pdf-url).
            const iframe = page.locator('[data-testid="pdf-node-view-frame"]');
            await expect(iframe).toHaveAttribute(
                'src',
                /\/api\/workspaces\/[^/]+\/notes\/image\?path=\.attachments%2Fsample\.pdf/,
            );

            // The iframe fetched the attachment through the mocked image-get route.
            await iframe.scrollIntoViewIfNeeded();
            await expect
                .poll(
                    () =>
                        store
                            .requestsFor('image-get')
                            .some((r) => r.query.path === '.attachments/sample.pdf'),
                    { timeout: 10_000 },
                )
                .toBe(true);

            // The child frame must commit the PDF URL, not merely request it.
            await expect
                .poll(() => pdfNavigation.committedFrameUrls.length, { timeout: 10_000 })
                .toBeGreaterThan(0);
            expect(pdfNavigation.failedRequestUrls).toEqual([]);
            expect(
                page.frames().some((frame) => frame.url().startsWith('chrome-error://chromewebdata/')),
            ).toBe(false);

            // No uncaught page errors — the embed renders as a handled state.
            expect(errors).toHaveLength(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('inserts a PDF via the toolbar and autosaves the markdown embed', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pdf-embed-'));
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

            // Editor and the Insert PDF toolbar button are present.
            await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 10_000 });
            await expect(page.locator('[data-testid="insert-pdf-btn"]')).toBeVisible();

            // Register the autosave-PUT wait BEFORE inserting so the debounced
            // request is not missed. The predicate matches the serialized markdown
            // embed pointing at the deterministic uploaded attachment path.
            const putRequest = page.waitForRequest(
                (req) =>
                    req.method() === 'PUT' &&
                    /\/notes\/content(\?|$)/.test(req.url()) &&
                    (req.postData() ?? '').includes(MOCK_UPLOADED_PDF_PATH),
                { timeout: 20_000 },
            );

            // Drive the hidden file input directly (Playwright sets files on hidden
            // inputs and fires `change`, running the same upload+insert flow the
            // toolbar button triggers).
            await page.locator('[data-testid="insert-pdf-input"]').setInputFiles({
                name: 'my-doc.pdf',
                mimeType: 'application/pdf',
                buffer: TINY_PDF,
            });

            // The upload POST fired with a base64 PDF data URL.
            await expect
                .poll(() => store.requestsFor('image-post').length, { timeout: 10_000 })
                .toBeGreaterThanOrEqual(1);
            const post = store.lastRequest('image-post');
            expect((post?.body as { data?: string })?.data ?? '').toMatch(/^data:application\/pdf;base64,/);

            // The inline PDF node appears in the editor.
            await expect(page.locator('[data-testid="pdf-node-view"]')).toBeVisible({ timeout: 10_000 });

            // The autosave PUT carries the markdown embed for the uploaded PDF.
            const put = await putRequest;
            const body = put.postDataJSON() as { path?: string; content?: string };
            expect(body.path).toBe('Journal/getting-started.md');
            expect(body.content).toContain(`![my-doc.pdf](${MOCK_UPLOADED_PDF_PATH})`);

            // The save-indicator reaches its saved state.
            await expect(page.locator('[data-testid="save-indicator"]')).toContainText('Saved', {
                timeout: 10_000,
            });

            expect(errors).toHaveLength(0);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
