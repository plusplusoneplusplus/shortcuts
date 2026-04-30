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
    loadContent(workspaceId: string, path: string): Promise<{ content: string; path: string; mtime: number }>;
    /** Persist markdown content at the given path. */
    saveContent(workspaceId: string, path: string, markdown: string, expectedMtime?: number): Promise<{ path: string; updated: boolean; mtime: number }>;
    /** Upload an image (base64 data-URL) and return the relative path to reference it. */
    uploadImage(workspaceId: string, fileName: string, dataUrl: string): Promise<{ path: string }>;
    /** Build a fully-qualified URL the browser can use to fetch an image by its relative path. */
    imageApiUrl(workspaceId: string, relativePath: string): string;
    /** Build a URL to serve a local image file (absolute path) via the server proxy. */
    localImageApiUrl(workspaceId: string, absolutePath: string): string;
}

// ── Default (notes-backed) implementation ───────────────────────────────────

export const defaultNoteEditorIO: NoteEditorIO = {
    loadContent: (workspaceId, path) =>
        notesApi.getContent(workspaceId, path),
    saveContent: (workspaceId, path, markdown, expectedMtime?) =>
        notesApi.saveContent(workspaceId, path, markdown, expectedMtime),
    uploadImage: (workspaceId, fileName, dataUrl) =>
        notesApi.uploadImage(workspaceId, fileName, dataUrl),
    imageApiUrl: (workspaceId, relativePath) =>
        `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/image?path=${encodeURIComponent(relativePath)}`,
    localImageApiUrl: (workspaceId, absolutePath) =>
        `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/local-image?path=${encodeURIComponent(absolutePath)}`,
};

// ── HTML image-src rewriter ─────────────────────────────────────────────────

/**
 * Rewrite relative `.attachments/…` image paths and absolute local file paths
 * inside HTML to backend-provided API URLs.
 *
 * Called after markdown→HTML conversion when loading content into the
 * rich-text editor.
 */
export function rewriteHtmlImageSrc(html: string, io: NoteEditorIO, workspaceId: string): string {
    if (!html) return html;

    return html.replace(
        /(<img\s[^>]*?)src="([^"]+)"/gi,
        (_match, prefix: string, src: string) => {
            if (/^\.attachments\//i.test(src)) {
                return `${prefix}src="${io.imageApiUrl(workspaceId, src)}"`;
            }
            if (/^[A-Za-z]:/.test(src) || /^\/(?!api\/)/.test(src)) {
                const decoded = decodeURIComponent(src);
                return `${prefix}src="${io.localImageApiUrl(workspaceId, decoded)}"`;
            }
            return `${prefix}src="${src}"`;
        },
    );
}
