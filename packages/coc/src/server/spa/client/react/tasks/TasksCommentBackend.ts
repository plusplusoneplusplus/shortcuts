/**
 * TasksCommentBackend — NoteEditorCommentBackend adapter backed by the tasks
 * comment API.
 *
 * Maps the tasks API's `TaskComment[]` model into the notes-style
 * `CommentThread[]` model expected by the shared `NoteEditor`.
 *
 * One TaskComment ↔ one CommentThread:
 *  - thread.id = comment.id
 *  - thread.anchor = TextAnchor reconstructed from the comment's anchor
 *    (preferring stored prefix/suffix metadata, falling back to selectedText).
 *  - thread.comments = [primary comment, ...replies] flattened into Comment[].
 *  - thread.status / createdAt / resolvedAt mirror the TaskComment fields.
 */

import { getSpaCocClient, translateSpaCocClientError } from '../api/cocClient';
import type { Comment, CommentThread, TextAnchor } from '../features/notes/notesApi';
import type { NoteEditorCommentBackend } from '../features/notes/editor/NoteEditorCommentBackend';
import type { TaskComment } from '@plusplusoneplusplus/coc-client';

async function withSpaErrors<T>(request: Promise<T>): Promise<T> {
    try {
        return await request;
    } catch (error) {
        translateSpaCocClientError(error);
    }
}

/** Map a TaskComment into the notes-style CommentThread shape. */
export function taskCommentToThread(tc: TaskComment): CommentThread {
    const quotedText =
        (typeof tc.anchor?.selectedText === 'string' && tc.anchor.selectedText) ||
        tc.selectedText ||
        '';
    const prefix = typeof tc.anchor?.prefix === 'string' ? tc.anchor.prefix : '';
    const suffix = typeof tc.anchor?.suffix === 'string' ? tc.anchor.suffix : '';
    const anchor: TextAnchor = { quotedText, prefix, suffix };

    const primary: Comment = {
        id: tc.id,
        content: tc.comment,
        createdAt: tc.createdAt,
        updatedAt: tc.updatedAt,
    };
    const replies: Comment[] = (tc.replies || []).map((r) => ({
        id: r.id,
        content: r.text,
        createdAt: r.createdAt,
    }));

    const thread: CommentThread = {
        id: tc.id,
        anchor,
        status: tc.status,
        comments: [primary, ...replies],
        createdAt: tc.createdAt,
    };
    if (tc.status === 'resolved') {
        thread.resolvedAt = tc.updatedAt;
    }
    return thread;
}

/**
 * Create a comment backend that loads/updates threads via the tasks comment API.
 *
 * Read/update only — thread creation is not exposed because the floating
 * markdown dialog's NoteEditor instance has comments disabled at the UI level
 * (no `commentsEnabled` flag is set). Callers that opt into comment authoring
 * should add `createThread` / `deleteThread` here in a follow-up.
 */
export function createTasksCommentBackend(): NoteEditorCommentBackend {
    return {
        async loadThreads(workspaceId, notePath) {
            if (!notePath) return [];
            const comments = await withSpaErrors(
                getSpaCocClient().tasks.listComments(workspaceId, notePath),
            );
            return (comments || []).map(taskCommentToThread);
        },

        async updateThreadAnchor(workspaceId, notePath, threadId, status) {
            if (!notePath) return;
            await withSpaErrors(
                getSpaCocClient().tasks.updateComment(workspaceId, notePath, threadId, { status }),
            );
        },
    };
}

/** Singleton convenience for callers that don't need per-instance state. */
export const tasksCommentBackend: NoteEditorCommentBackend = createTasksCommentBackend();
