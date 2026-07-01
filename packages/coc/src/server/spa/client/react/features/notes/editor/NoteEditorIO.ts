/**
 * NoteEditorIO — notes-era compatibility alias for MarkdownDocumentIO.
 *
 * Decouples loading/saving markdown, uploading images, and resolving image
 * URLs from the notes-specific REST API. New markdown editor surfaces should
 * depend on the generic shared MarkdownDocumentIO contract directly.
 */

import { notesApi } from '../notesApi';
import type { MarkdownDocumentIO } from '../../../shared/markdown-document/MarkdownDocumentIO';

// ── Contract ────────────────────────────────────────────────────────────────

export type NoteEditorIO = MarkdownDocumentIO;

// ── Default (notes-backed) implementation ───────────────────────────────────

export const defaultNoteEditorIO: NoteEditorIO = {
    loadContent: (workspaceId, path, root?) =>
        notesApi.getContent(workspaceId, path, root),
    saveContent: (workspaceId, path, markdown, expectedMtime?, root?) =>
        notesApi.saveContent(workspaceId, path, markdown, expectedMtime, root),
    uploadImage: (workspaceId, fileName, dataUrl, root?) =>
        notesApi.uploadImage(workspaceId, fileName, dataUrl, root),
    imageApiUrl: (workspaceId, relativePath, root?) => {
        const base = `/api/workspaces/${encodeURIComponent(workspaceId)}/notes/image?path=${encodeURIComponent(relativePath)}`;
        return root ? `${base}&root=${encodeURIComponent(root)}` : base;
    },
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
export function rewriteHtmlImageSrc(html: string, io: NoteEditorIO, workspaceId: string, root?: string): string {
    if (!html) return html;

    return html.replace(
        /(<img\s[^>]*?)src="([^"]+)"/gi,
        (_match, prefix: string, src: string) => {
            if (/^\.attachments\//i.test(src) || /^\.images\//i.test(src)) {
                return `${prefix}src="${io.imageApiUrl(workspaceId, src, root)}"`;
            }
            if (/^[A-Za-z]:/.test(src) || /^\/(?!api\/)/.test(src)) {
                const decoded = decodeURIComponent(src);
                return `${prefix}src="${io.localImageApiUrl(workspaceId, decoded)}"`;
            }
            return `${prefix}src="${src}"`;
        },
    );
}
