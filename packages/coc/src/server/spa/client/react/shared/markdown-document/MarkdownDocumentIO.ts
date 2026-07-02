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
}
