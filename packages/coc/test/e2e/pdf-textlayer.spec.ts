/**
 * Notes page — pdf.js text-layer selection (real-PDF E2E). Goal 0 AC-02 / AC-03.
 *
 * Unlike pdf-embed-mock.spec.ts / pdf-resize-mock.spec.ts, which serve a tiny
 * INVALID PDF and therefore exercise the native `<iframe>` fallback, this spec
 * serves a genuinely valid arXiv-style PDF (fixtures/pdf-fixtures.ts) so the
 * host renders it through the pdf.js `PdfJsRenderer` path — a `<canvas>` page
 * overlaid by a real, host-selectable `.textLayer`.
 *
 * It proves the thing the whole paper-reading feature rests on: that dragging /
 * selecting across a passage yields a live `window.getSelection()` Range whose
 * text matches the visible passage — impossible with the opaque iframe. Coverage:
 *   1. Inline embed renders `.pdfjs-page[data-page-number]` with a populated
 *      `.textLayer`, and NOT the iframe fallback.
 *   2. A programmatic Range and a real mouse drag over the text layer both yield
 *      a selection matching the visible passage (single-column page).
 *   3. A two-column page keeps both columns independently selectable.
 *   4. The full-window PdfPopupDialog (AC-03) keeps the text layer selectable.
 *
 * The notes API is served from the in-memory mock (fixtures/notes-fixtures.ts);
 * only the served PDF bytes differ from the existing iframe-fallback specs.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync, type Page } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture } from './fixtures/repo-fixtures';
import { createNotesStore, mockNotesApi, type NoteTreeNode } from './fixtures/notes-fixtures';
import {
    buildArxivStylePdf,
    PDF_TITLE_PASSAGE,
    PDF_ABSTRACT_PASSAGE,
    PDF_LEFT_COLUMN_PASSAGE,
    PDF_RIGHT_COLUMN_PASSAGE,
} from './fixtures/pdf-fixtures';

const WS_ID = 'ws-pdf-textlayer';

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

async function openFirstPage(page: Page): Promise<void> {
    await page.locator('[data-testid="notes-tree-item-Journal"]').click();
    const pageRow = page.locator('[data-testid="notes-tree-item-getting-started.md"]');
    await expect(pageRow).toBeVisible({ timeout: 5_000 });
    await pageRow.click();
}

/** Programmatically select the span carrying `passage` inside `scopeSelector`. */
async function selectPassage(page: Page, scopeSelector: string, passage: string): Promise<string> {
    return page.evaluate(
        ({ scope, text }) => {
            const root = document.querySelector(scope);
            if (!root) return '__no-scope__';
            const spans = Array.from(root.querySelectorAll('.textLayer span')) as HTMLElement[];
            const span = spans.find((s) => (s.textContent ?? '').includes(text));
            if (!span) return '__no-span__';
            const range = document.createRange();
            range.selectNodeContents(span);
            const selection = window.getSelection();
            if (!selection) return '__no-selection__';
            selection.removeAllRanges();
            selection.addRange(range);
            return selection.getRangeAt(0).toString();
        },
        { scope: scopeSelector, text: passage },
    );
}

test.describe('Notes page — pdf.js text-layer selection (real PDF)', () => {
    test('inline embed renders a selectable text layer, not the iframe fallback', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pdf-textlayer-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

            const store = createNotesStore({
                tree: seedTree(),
                content: {
                    'Journal/getting-started.md': '# Doc\n\n![Sample PDF](.attachments/sample.pdf)\n',
                },
                pdfBytes: buildArxivStylePdf(),
            });
            await mockNotesApi(page, store);

            await openNotesPage(page, serverUrl, WS_ID);
            await openFirstPage(page);

            const pdfNode = page.locator('[data-testid="pdf-node-view"]');
            await expect(pdfNode).toBeVisible({ timeout: 10_000 });

            // The pdf.js renderer mounted (canvas + text-layer viewport), so the
            // native iframe fallback must NOT be present.
            const viewport = page.locator('[data-testid="pdfjs-render-viewport"]');
            await expect(viewport).toBeVisible({ timeout: 15_000 });
            await expect(page.locator('[data-testid="pdf-node-view-frame"]')).toHaveCount(0);

            // Page 1 rendered as a .pdfjs-page[data-page-number] with a populated
            // .textLayer — proof the host has real, selectable DOM for the paper.
            const page1 = page.locator('.pdfjs-page[data-page-number="1"]');
            await expect(page1).toBeVisible({ timeout: 15_000 });
            const page1TitleSpan = page1
                .locator('.textLayer span')
                .filter({ hasText: PDF_TITLE_PASSAGE });
            await expect(page1TitleSpan).toHaveCount(1, { timeout: 15_000 });

            // The renderer reports it finished (data-status=ready).
            await expect(viewport).toHaveAttribute('data-status', 'ready', { timeout: 15_000 });

            // A programmatic Range over the text layer yields the visible passage
            // — the host `window.getSelection()` can read inside the paper, which
            // is impossible with the opaque iframe. (Inside the ProseMirror editor
            // a raw mouse-drag DOM selection over the atom node is reconciled away
            // by the editor's selection sync, so the faithful real-drag proof lives
            // in the full-window dialog test below; here we assert the Range API.)
            const selectedTitle = await selectPassage(
                page,
                '.pdfjs-page[data-page-number="1"]',
                PDF_TITLE_PASSAGE,
            );
            expect(selectedTitle).toContain(PDF_TITLE_PASSAGE);

            // The abstract line is likewise selectable.
            const selectedAbstract = await selectPassage(
                page,
                '.pdfjs-page[data-page-number="1"]',
                PDF_ABSTRACT_PASSAGE,
            );
            expect(selectedAbstract).toContain(PDF_ABSTRACT_PASSAGE);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('two-column page keeps both columns independently selectable', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pdf-textlayer-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

            const store = createNotesStore({
                tree: seedTree(),
                content: {
                    'Journal/getting-started.md': '# Doc\n\n![Sample PDF](.attachments/sample.pdf)\n',
                },
                pdfBytes: buildArxivStylePdf(),
            });
            await mockNotesApi(page, store);

            await openNotesPage(page, serverUrl, WS_ID);
            await openFirstPage(page);

            // Wait for the second (multi-column) page to finish rendering.
            const page2 = page.locator('.pdfjs-page[data-page-number="2"]');
            await expect(page2).toBeVisible({ timeout: 15_000 });
            await expect(
                page2.locator('.textLayer span').filter({ hasText: PDF_LEFT_COLUMN_PASSAGE }),
            ).toHaveCount(1, { timeout: 15_000 });
            await expect(
                page2.locator('.textLayer span').filter({ hasText: PDF_RIGHT_COLUMN_PASSAGE }),
            ).toHaveCount(1, { timeout: 15_000 });

            // Each column is its own selectable passage.
            const leftSel = await selectPassage(
                page,
                '.pdfjs-page[data-page-number="2"]',
                PDF_LEFT_COLUMN_PASSAGE,
            );
            expect(leftSel).toContain(PDF_LEFT_COLUMN_PASSAGE);

            const rightSel = await selectPassage(
                page,
                '.pdfjs-page[data-page-number="2"]',
                PDF_RIGHT_COLUMN_PASSAGE,
            );
            expect(rightSel).toContain(PDF_RIGHT_COLUMN_PASSAGE);
        } finally {
            safeRmSync(tmpDir);
        }
    });

    test('full-window PdfPopupDialog keeps the text layer selectable (AC-03)', async ({
        page,
        serverUrl,
    }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-pdf-textlayer-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            await seedWorkspace(serverUrl, WS_ID, `${WS_ID}-repo`, repoDir);

            const store = createNotesStore({
                tree: seedTree(),
                content: {
                    'Journal/getting-started.md': '# Doc\n\n![Sample PDF](.attachments/sample.pdf)\n',
                },
                pdfBytes: buildArxivStylePdf(),
            });
            await mockNotesApi(page, store);

            await openNotesPage(page, serverUrl, WS_ID);
            await openFirstPage(page);

            await expect(page.locator('[data-testid="pdf-node-view"]')).toBeVisible({ timeout: 10_000 });

            // Open the full-window reader.
            const fullWindowBtn = page.locator('[data-testid="pdf-node-view-fullwindow"]');
            await expect(fullWindowBtn).toBeEnabled({ timeout: 10_000 });
            await fullWindowBtn.click();

            const popupWrap = page.locator('[data-testid="pdf-popup-frame-wrap"]');
            await expect(popupWrap).toBeVisible({ timeout: 10_000 });

            // The popup renders via pdf.js (text layer), not the iframe fallback.
            await expect(popupWrap.locator('[data-testid="pdfjs-render-viewport"]')).toBeVisible({
                timeout: 15_000,
            });
            await expect(page.locator('[data-testid="pdf-popup-frame"]')).toHaveCount(0);

            const popupPage1 = popupWrap.locator('.pdfjs-page[data-page-number="1"]');
            const popupTitleSpan = popupPage1
                .locator('.textLayer span')
                .filter({ hasText: PDF_TITLE_PASSAGE });
            await expect(popupTitleSpan).toHaveCount(1, { timeout: 15_000 });

            // Programmatic Range selection works over the full-window text layer.
            const selected = await selectPassage(
                page,
                '[data-testid="pdf-popup-frame-wrap"] .pdfjs-page[data-page-number="1"]',
                PDF_TITLE_PASSAGE,
            );
            expect(selected).toContain(PDF_TITLE_PASSAGE);

            // And a REAL mouse drag across the passage — the host-side drag AC-02
            // requires — yields the same live `getSelection().getRangeAt(0)` text.
            // The dialog is a portal outside the editor, so the DOM selection is
            // not reconciled away.
            const box = await popupTitleSpan.first().boundingBox();
            expect(box).not.toBeNull();
            await page.mouse.move(box!.x + 2, box!.y + box!.height / 2);
            await page.mouse.down();
            await page.mouse.move(box!.x + box!.width - 2, box!.y + box!.height / 2, { steps: 12 });
            await page.mouse.up();
            const draggedText = await page.evaluate(() => {
                const sel = window.getSelection();
                return sel && sel.rangeCount > 0 ? sel.getRangeAt(0).toString() : '';
            });
            expect(draggedText).toContain(PDF_TITLE_PASSAGE);
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
