export interface MarkdownDocumentLoadResult {
    content: string;
    path: string;
    mtime: number;
}

export interface MarkdownDocumentSaveResult {
    path: string;
    updated: boolean;
    mtime: number;
}

/**
 * Result of ingesting a pasted arXiv URL: the PDF has been fetched and cached
 * locally under the notes root (`.papers/<id>.pdf`), with a one-time text
 * sidecar extracted for whole-paper grounding.
 */
export interface PaperIngestResult {
    /** Canonical arXiv identifier (e.g. "1802.05799v3"). */
    arxivId: string;
    /** Cached PDF path relative to the notes root (e.g. ".papers/1802.05799v3.pdf"). */
    pdfPath: string;
    /** Extracted text sidecar path, or null when extraction failed. */
    textPath: string | null;
    /** True when the PDF was already cached (no re-fetch happened). */
    cached: boolean;
}

/**
 * Generic markdown-document I/O contract for editor surfaces.
 *
 * Notes, task files, workspace previews, and future markdown hosts should
 * provide this adapter instead of wiring REST calls directly into editor state.
 */
export interface MarkdownDocumentIO {
    loadContent(
        workspaceId: string,
        path: string,
        root?: string,
    ): Promise<MarkdownDocumentLoadResult>;

    saveContent(
        workspaceId: string,
        path: string,
        markdown: string,
        expectedMtime?: number,
        root?: string,
    ): Promise<MarkdownDocumentSaveResult>;

    uploadImage(
        workspaceId: string,
        fileName: string,
        dataUrl: string,
        root?: string,
    ): Promise<{ path: string }>;

    imageApiUrl(workspaceId: string, relativePath: string, root?: string): string;

    localImageApiUrl(workspaceId: string, absolutePath: string): string;

    /**
     * Ingest a pasted arXiv URL: fetch + cache the PDF and extract its text
     * server-side. Optional — surfaces that do not support paper ingest (task
     * files, previews) omit it.
     */
    ingestPaper?(
        workspaceId: string,
        url: string,
        root?: string,
    ): Promise<PaperIngestResult>;
}
