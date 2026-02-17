/**
 * Task Comments Client
 *
 * Client-side logic layer that bridges the comment UI components
 * (task-comments-ui.ts) with the server REST API (task-comments-handler.ts).
 *
 * Provides:
 *   - CRUD API functions for comments
 *   - Pub-sub event system for comment lifecycle events
 *   - Selection capture and anchor creation helpers
 *
 * Browser-compatible — no Node.js or VS Code dependencies.
 */

import { getApiBase } from './config';
import type {
    TaskComment,
    TaskCommentStatus,
    CommentAnchor,
    CommentSelection,
} from './task-comments-types';
import {
    createAnchor,
    type AnchorMatchConfig,
    DEFAULT_ANCHOR_CONFIG,
} from './task-comment-anchor';
import {
    getPreviewSelection,
    type SelectionInfo,
} from './task-comments-ui';

// ============================================================================
// Types
// ============================================================================

/** Request payload for creating a comment. */
export interface CreateCommentRequest {
    filePath: string;
    selection: CommentSelection;
    selectedText: string;
    comment: string;
    status?: TaskCommentStatus;
    author?: string;
    anchor?: CommentAnchor;
}

/** Request payload for updating a comment. */
export interface UpdateCommentRequest {
    comment?: string;
    status?: TaskCommentStatus;
    author?: string;
    anchor?: CommentAnchor;
}

/** Comment lifecycle event types. */
export type CommentEvent =
    | { type: 'created'; comment: TaskComment }
    | { type: 'updated'; comment: TaskComment }
    | { type: 'deleted'; commentId: string }
    | { type: 'loaded'; comments: TaskComment[] }
    | { type: 'error'; error: Error };

/** Listener function for comment events. */
export type CommentEventListener = (event: CommentEvent) => void;

/** API error with status code and message. */
export class CommentApiError extends Error {
    constructor(
        public readonly statusCode: number,
        message: string
    ) {
        super(message);
        this.name = 'CommentApiError';
    }
}

// ============================================================================
// Event System
// ============================================================================

let listeners: CommentEventListener[] = [];

/** Register a listener for comment events. Returns an unsubscribe function. */
export function onCommentEvent(listener: CommentEventListener): () => void {
    listeners.push(listener);
    return () => {
        listeners = listeners.filter(l => l !== listener);
    };
}

/** Emit a comment event to all registered listeners. */
export function emitCommentEvent(event: CommentEvent): void {
    for (const listener of listeners) {
        try {
            listener(event);
        } catch {
            // Prevent one listener from breaking others
        }
    }
}

/** Remove all event listeners (useful for testing). */
export function removeAllCommentListeners(): void {
    listeners = [];
}

// ============================================================================
// API Helpers
// ============================================================================

/**
 * Build the base API URL for comments on a specific task file.
 * Server routes: /api/comments/:wsId/:taskPath
 */
function commentsUrl(wsId: string, taskPath: string): string {
    return getApiBase() + '/comments/' + encodeURIComponent(wsId) + '/' + encodeURIComponent(taskPath);
}

/**
 * Build the API URL for a specific comment.
 * Server routes: /api/comments/:wsId/:taskPath/:commentId
 */
function commentUrl(wsId: string, taskPath: string, commentId: string): string {
    return commentsUrl(wsId, taskPath) + '/' + encodeURIComponent(commentId);
}

/**
 * Parse an API error response into a user-friendly message.
 */
async function parseErrorResponse(res: Response): Promise<string> {
    try {
        const body = await res.json();
        return body.error || body.message || res.statusText;
    } catch {
        return res.statusText || 'Unknown error';
    }
}

/**
 * Get a user-friendly error message based on HTTP status code.
 */
export function getErrorMessage(statusCode: number, serverMessage?: string): string {
    switch (statusCode) {
        case 400: return serverMessage || 'Invalid request';
        case 404: return 'Comment not found, may have been deleted';
        case 500: return 'Server error, please try again later';
        default: return serverMessage || 'Request failed';
    }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch all comments for a task file.
 */
export async function fetchComments(wsId: string, taskPath: string): Promise<TaskComment[]> {
    try {
        const res = await fetch(commentsUrl(wsId, taskPath));
        if (!res.ok) {
            const msg = await parseErrorResponse(res);
            throw new CommentApiError(res.status, msg);
        }
        const data = await res.json();
        const comments = data.comments || [];
        emitCommentEvent({ type: 'loaded', comments });
        return comments;
    } catch (err) {
        if (err instanceof CommentApiError) {
            emitCommentEvent({ type: 'error', error: err });
            throw err;
        }
        const networkError = new Error('Network error, please try again');
        emitCommentEvent({ type: 'error', error: networkError });
        throw networkError;
    }
}

/**
 * Fetch comment counts for all task files in a workspace.
 * Returns a map of filePath → comment count.
 */
export async function fetchCommentCounts(wsId: string): Promise<Record<string, number>> {
    try {
        const res = await fetch(getApiBase() + '/comment-counts/' + encodeURIComponent(wsId));
        if (!res.ok) {
            return {};
        }
        const data = await res.json();
        return data.counts || {};
    } catch {
        return {};
    }
}

/**
 * Create a new comment on a task file.
 */
export async function createComment(
    wsId: string,
    taskPath: string,
    request: CreateCommentRequest
): Promise<TaskComment> {
    try {
        const res = await fetch(commentsUrl(wsId, taskPath), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });
        if (!res.ok) {
            const msg = await parseErrorResponse(res);
            throw new CommentApiError(res.status, getErrorMessage(res.status, msg));
        }
        const data = await res.json();
        const comment: TaskComment = data.comment;
        emitCommentEvent({ type: 'created', comment });
        return comment;
    } catch (err) {
        if (err instanceof CommentApiError) {
            emitCommentEvent({ type: 'error', error: err });
            throw err;
        }
        const networkError = new Error('Network error, please try again');
        emitCommentEvent({ type: 'error', error: networkError });
        throw networkError;
    }
}

/**
 * Update an existing comment.
 */
export async function updateComment(
    wsId: string,
    taskPath: string,
    commentId: string,
    updates: UpdateCommentRequest
): Promise<TaskComment> {
    try {
        const res = await fetch(commentUrl(wsId, taskPath, commentId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates),
        });
        if (!res.ok) {
            const msg = await parseErrorResponse(res);
            throw new CommentApiError(res.status, getErrorMessage(res.status, msg));
        }
        const data = await res.json();
        const comment: TaskComment = data.comment;
        emitCommentEvent({ type: 'updated', comment });
        return comment;
    } catch (err) {
        if (err instanceof CommentApiError) {
            emitCommentEvent({ type: 'error', error: err });
            throw err;
        }
        const networkError = new Error('Network error, please try again');
        emitCommentEvent({ type: 'error', error: networkError });
        throw networkError;
    }
}

/**
 * Delete a comment.
 */
export async function deleteComment(
    wsId: string,
    taskPath: string,
    commentId: string
): Promise<void> {
    try {
        const res = await fetch(commentUrl(wsId, taskPath, commentId), {
            method: 'DELETE',
        });
        if (!res.ok) {
            const msg = await parseErrorResponse(res);
            throw new CommentApiError(res.status, getErrorMessage(res.status, msg));
        }
        emitCommentEvent({ type: 'deleted', commentId });
    } catch (err) {
        if (err instanceof CommentApiError) {
            emitCommentEvent({ type: 'error', error: err });
            throw err;
        }
        const networkError = new Error('Network error, please try again');
        emitCommentEvent({ type: 'error', error: networkError });
        throw networkError;
    }
}

/**
 * Resolve a comment (set status to 'resolved').
 */
export async function resolveComment(
    wsId: string,
    taskPath: string,
    commentId: string
): Promise<TaskComment> {
    return updateComment(wsId, taskPath, commentId, { status: 'resolved' });
}

/**
 * Unresolve a comment (set status to 'open').
 */
export async function unresolveComment(
    wsId: string,
    taskPath: string,
    commentId: string
): Promise<TaskComment> {
    return updateComment(wsId, taskPath, commentId, { status: 'open' });
}

// ============================================================================
// Selection Capture
// ============================================================================

/**
 * Capture the current text selection from a preview body element
 * and create a CommentAnchor for robust location tracking.
 *
 * Returns null if no valid selection exists.
 */
export function captureSelectionWithAnchor(
    previewBody: HTMLElement,
    documentContent: string,
    config: AnchorMatchConfig = DEFAULT_ANCHOR_CONFIG
): { selection: SelectionInfo; anchor: CommentAnchor } | null {
    const selectionInfo = getPreviewSelection(previewBody);
    if (!selectionInfo) return null;

    const anchor = createAnchor(documentContent, {
        startLine: selectionInfo.startLine,
        startColumn: selectionInfo.startColumn,
        endLine: selectionInfo.endLine,
        endColumn: selectionInfo.endColumn,
    }, config);

    return { selection: selectionInfo, anchor };
}

// ============================================================================
// Comment State Management
// ============================================================================

/** In-memory comment state for the currently viewed task. */
export interface CommentState {
    wsId: string;
    taskPath: string;
    comments: TaskComment[];
    unsubscribe: (() => void) | null;
}

let currentState: CommentState | null = null;

/** Get the current comment state (or null if no task is active). */
export function getCommentState(): CommentState | null {
    return currentState;
}

/**
 * Initialize comment state for a task file.
 * Fetches comments from the server and sets up event listeners.
 */
export async function initCommentState(wsId: string, taskPath: string): Promise<TaskComment[]> {
    // Clean up previous state
    disposeCommentState();

    const state: CommentState = {
        wsId,
        taskPath,
        comments: [],
        unsubscribe: null,
    };

    // Set up event listener to keep local state in sync
    state.unsubscribe = onCommentEvent((event) => {
        if (event.type === 'created') {
            state.comments.push(event.comment);
        } else if (event.type === 'updated') {
            const idx = state.comments.findIndex(c => c.id === event.comment.id);
            if (idx >= 0) state.comments[idx] = event.comment;
        } else if (event.type === 'deleted') {
            state.comments = state.comments.filter(c => c.id !== event.commentId);
        } else if (event.type === 'loaded') {
            state.comments = event.comments;
        }
    });

    currentState = state;

    // Fetch comments from server
    try {
        state.comments = await fetchComments(wsId, taskPath);
    } catch {
        // Error already emitted by fetchComments
        state.comments = [];
    }

    return state.comments;
}

/** Clean up comment state and event listeners. */
export function disposeCommentState(): void {
    if (currentState) {
        currentState.unsubscribe?.();
        currentState = null;
    }
}
