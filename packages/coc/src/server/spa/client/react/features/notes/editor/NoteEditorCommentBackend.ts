/**
 * NoteEditorCommentBackend — injectable comment-thread contract for NoteEditor.
 *
 * Decouples thread loading and anchor refresh from the notes-specific REST API
 * so the editor shell can be reused with either a notes backend or a no-op
 * backend (e.g. MarkdownReviewEditor).
 */

import { notesApi } from '../notesApi';
import type { CommentThread } from '../notesApi';

// ── Contract ────────────────────────────────────────────────────────────────

export interface NoteEditorCommentBackend {
    /** Load all comment threads for a given note. */
    loadThreads(workspaceId: string, notePath: string, root?: string): Promise<CommentThread[]>;
    /** Persist updated anchor/status for a single thread after a save. */
    updateThreadAnchor(
        workspaceId: string,
        notePath: string,
        threadId: string,
        status: 'open' | 'resolved',
        root?: string,
    ): Promise<void>;
}

// ── Default (notes-backed) implementation ───────────────────────────────────

export const defaultCommentBackend: NoteEditorCommentBackend = {
    async loadThreads(workspaceId, notePath, root) {
        const sidecar = await notesApi.getComments(workspaceId, notePath, root);
        return Object.values(sidecar.threads);
    },
    async updateThreadAnchor(workspaceId, notePath, threadId, status, root) {
        await notesApi.updateThread(workspaceId, notePath, threadId, status, root);
    },
};

// ── No-op implementation ────────────────────────────────────────────────────

/**
 * A comment backend that does nothing. Use when the host component does not
 * support Tiptap comment marks (e.g. a plain markdown preview).
 */
export const noopCommentBackend: NoteEditorCommentBackend = {
    async loadThreads() {
        return [];
    },
    async updateThreadAnchor() {
        // intentionally empty
    },
};
