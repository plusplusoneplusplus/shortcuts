/**
 * NoteEditorIO — injectable content I/O contract for NoteEditor.
 *
 * Decouples loading/saving markdown, uploading images, and resolving image
 * URLs from the notes-specific REST API so the editor shell can be reused
 * by other backends (e.g. MarkdownReviewEditor).
 */

import { notesApi } from '../notesApi';

// ── Contract ────────────────────────────────────────────────────────────────

export interface NoteEditorIO {
    /** Fetch the markdown content for a given path. */
    loadContent(workspaceId: string, path: string): Promise<{ content: string; path: string }>;
    /** Persist markdown content at the given path. */
    saveContent(workspaceId: string, path: string, markdown: string): Promise<{ path: string; updated: boolean }>;
    /** Upload an image (base64 data-URL) and return the relative path to reference it. */
    uploadImage(workspaceId: string, fileName: string, dataUrl: string): Promise<{ path: string }>;
    /** Build a fully-qualified URL the browser can use to fetch an image by its relative path. */
    imageApiUrl(workspaceId: string, relativePath: string): string;
}

// ── Default (notes-backed) implementation ───────────────────────────────────

export const defaultNoteEditorIO: NoteEditorIO = {
    loadContent: (workspaceId, path) =>
        notesApi.getContent(workspaceId, path),
    saveContent: (workspaceId, path, markdown) =>
        notesApi.saveContent(workspaceId, path, markdown),
    uploadImage: (workspaceId, fileName, dataUrl) =>
        notesApi.uploadImage(workspaceId, fileName, dataUrl),
    imageApiUrl: (workspaceId, relativePath) =>
        `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/image?path=${encodeURIComponent(relativePath)}`,
};

// ── HTML image-src rewriter ─────────────────────────────────────────────────

/**
 * Rewrite relative `.attachments/…` image paths inside HTML to the
 * backend-provided API URLs via {@link NoteEditorIO.imageApiUrl}.
 *
 * Called after markdown→HTML conversion when loading content into the
 * rich-text editor.
 */
export function rewriteHtmlImageSrc(html: string, io: NoteEditorIO, workspaceId: string): string {
    if (!html) return html;
    return html.replace(
        /(<img\s[^>]*?)src="(\.attachments\/[^"]+)"/gi,
        (_match, prefix: string, relPath: string) => {
            return `${prefix}src="${io.imageApiUrl(workspaceId, relPath)}"`;
        },
    );
}
