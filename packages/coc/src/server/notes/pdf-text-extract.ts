/**
 * Server-side PDF text extraction (Goal 3, AC-02).
 *
 * Extracts the full text of a PDF once, page by page, so it can be cached as a
 * sidecar and used for whole-paper grounding (the `NoteChatExecutor` agentic
 * pattern reads the file). Uses the pdfjs-dist **legacy** build to stay safe on
 * older runtimes, and imports it lazily so tests that inject a stub extractor
 * never load pdfjs at all.
 *
 * Cross-platform, Node-only.
 */

/** Page separator written between page texts in the extracted sidecar. */
export const PDF_PAGE_SEPARATOR = '\n\n';

/**
 * Extract all text from a PDF buffer using pdfjs-dist (legacy build).
 * Pages are joined with {@link PDF_PAGE_SEPARATOR}. Returns the concatenated text.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
    // Lazy import: keeps pdfjs out of the module graph for unit tests that inject
    // their own extractor, and avoids paying the load cost unless ingest runs.
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // Node has no DOM worker; disabling the worker runs parsing on the main thread.
    if (pdfjs.GlobalWorkerOptions) {
        pdfjs.GlobalWorkerOptions.workerSrc = '';
    }

    const data = new Uint8Array(buffer);
    const loadingTask = pdfjs.getDocument({ data, disableWorker: true, isEvalSupported: false });
    const doc = await loadingTask.promise;
    try {
        const pages: string[] = [];
        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
            const page = await doc.getPage(pageNum);
            const content = await page.getTextContent();
            const pageText = content.items
                .map((item: any) => (typeof item.str === 'string' ? item.str : ''))
                .join(' ')
                .replace(/[ \t]+/g, ' ')
                .trim();
            pages.push(pageText);
            page.cleanup?.();
        }
        return pages.join(PDF_PAGE_SEPARATOR).trim();
    } finally {
        await doc.cleanup?.();
        await loadingTask.destroy?.();
    }
}
