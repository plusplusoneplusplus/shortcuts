/**
 * Tests for task-comments-client.ts
 *
 * Unit tests for the comment client module: API functions, event system,
 * error handling, and state management. Tests run in Node (no JSDOM),
 * so we mock fetch and DOM APIs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    // Event system
    onCommentEvent,
    emitCommentEvent,
    removeAllCommentListeners,
    // API functions
    fetchComments,
    fetchCommentCounts,
    createComment,
    updateComment,
    deleteComment,
    resolveComment,
    unresolveComment,
    // Error helpers
    CommentApiError,
    getErrorMessage,
    // State management
    initCommentState,
    disposeCommentState,
    getCommentState,
    // Types
    type CommentEvent,
    type CreateCommentRequest,
    type UpdateCommentRequest,
} from '../../../../src/server/spa/client/task-comments-client';
import type { TaskComment } from '../../../../src/server/spa/client/task-comments-types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeComment(overrides: Partial<TaskComment> = {}): TaskComment {
    return {
        id: 'c-' + Math.random().toString(36).substring(2, 8),
        taskId: 'task-1',
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello world',
        comment: 'Test comment',
        status: 'open',
        createdAt: '2026-01-15T10:00:00Z',
        updatedAt: '2026-01-15T10:00:00Z',
        ...overrides,
    };
}

function mockFetchResponse(status: number, body: any): void {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : status === 404 ? 'Not Found' : 'Error',
        json: () => Promise.resolve(body),
    });
}

function mockFetchNetworkError(): void {
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
}

// Stub getApiBase to avoid importing config module which references window
vi.mock('../../../../src/server/spa/client/config', () => ({
    getApiBase: () => '/api',
}));

// Stub task-comment-anchor since it's pure logic (no DOM)
vi.mock('../../../../src/server/spa/client/task-comment-anchor', () => ({
    createAnchor: vi.fn(() => ({
        selectedText: 'test',
        contextBefore: 'before',
        contextAfter: 'after',
        originalLine: 1,
        textHash: 'abc123',
    })),
    DEFAULT_ANCHOR_CONFIG: {
        contextCharsBefore: 100,
        contextCharsAfter: 100,
        minSimilarityThreshold: 0.6,
        maxLineSearchDistance: 50,
    },
}));

// Stub task-comments-ui to avoid DOM dependencies
vi.mock('../../../../src/server/spa/client/task-comments-ui', () => ({
    getPreviewSelection: vi.fn(),
}));

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
    removeAllCommentListeners();
    disposeCommentState();
    vi.restoreAllMocks();
});

afterEach(() => {
    removeAllCommentListeners();
    disposeCommentState();
});

// ============================================================================
// Event System
// ============================================================================

describe('Event System', () => {
    it('registers listener and receives events', () => {
        const events: CommentEvent[] = [];
        onCommentEvent((e) => events.push(e));

        const comment = makeComment();
        emitCommentEvent({ type: 'created', comment });

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('created');
    });

    it('unsubscribe stops receiving events', () => {
        const events: CommentEvent[] = [];
        const unsub = onCommentEvent((e) => events.push(e));

        emitCommentEvent({ type: 'deleted', commentId: 'c1' });
        expect(events).toHaveLength(1);

        unsub();
        emitCommentEvent({ type: 'deleted', commentId: 'c2' });
        expect(events).toHaveLength(1);
    });

    it('multiple listeners all receive events', () => {
        const events1: CommentEvent[] = [];
        const events2: CommentEvent[] = [];
        onCommentEvent((e) => events1.push(e));
        onCommentEvent((e) => events2.push(e));

        emitCommentEvent({ type: 'deleted', commentId: 'c1' });

        expect(events1).toHaveLength(1);
        expect(events2).toHaveLength(1);
    });

    it('listener error does not break other listeners', () => {
        const events: CommentEvent[] = [];
        onCommentEvent(() => { throw new Error('boom'); });
        onCommentEvent((e) => events.push(e));

        emitCommentEvent({ type: 'deleted', commentId: 'c1' });

        expect(events).toHaveLength(1);
    });

    it('removeAllCommentListeners clears all listeners', () => {
        const events: CommentEvent[] = [];
        onCommentEvent((e) => events.push(e));
        removeAllCommentListeners();

        emitCommentEvent({ type: 'deleted', commentId: 'c1' });
        expect(events).toHaveLength(0);
    });
});

// ============================================================================
// CommentApiError
// ============================================================================

describe('CommentApiError', () => {
    it('stores status code and message', () => {
        const err = new CommentApiError(404, 'Not found');
        expect(err.statusCode).toBe(404);
        expect(err.message).toBe('Not found');
        expect(err.name).toBe('CommentApiError');
    });

    it('is instanceof Error', () => {
        const err = new CommentApiError(500, 'Server error');
        expect(err instanceof Error).toBe(true);
    });
});

// ============================================================================
// getErrorMessage
// ============================================================================

describe('getErrorMessage', () => {
    it('returns user-friendly message for 400', () => {
        expect(getErrorMessage(400, 'Bad field')).toBe('Bad field');
        expect(getErrorMessage(400)).toBe('Invalid request');
    });

    it('returns specific message for 404', () => {
        expect(getErrorMessage(404)).toBe('Comment not found, may have been deleted');
    });

    it('returns specific message for 500', () => {
        expect(getErrorMessage(500)).toBe('Server error, please try again later');
    });

    it('returns server message for unknown status codes', () => {
        expect(getErrorMessage(429, 'Rate limited')).toBe('Rate limited');
        expect(getErrorMessage(429)).toBe('Request failed');
    });
});

// ============================================================================
// API Functions
// ============================================================================

describe('fetchComments', () => {
    it('returns array of comments on success', async () => {
        const comments = [makeComment(), makeComment()];
        mockFetchResponse(200, { comments });

        const result = await fetchComments('ws1', 'feature/task.md');

        expect(result).toHaveLength(2);
        expect((globalThis as any).fetch).toHaveBeenCalledWith(
            '/api/comments/ws1/feature%2Ftask.md'
        );
    });

    it('emits loaded event on success', async () => {
        const comments = [makeComment()];
        mockFetchResponse(200, { comments });

        const events: CommentEvent[] = [];
        onCommentEvent((e) => events.push(e));

        await fetchComments('ws1', 'task.md');

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('loaded');
    });

    it('returns empty array when no comments field', async () => {
        mockFetchResponse(200, {});

        const result = await fetchComments('ws1', 'task.md');
        expect(result).toEqual([]);
    });

    it('throws CommentApiError on HTTP error', async () => {
        mockFetchResponse(500, { error: 'Internal server error' });

        await expect(fetchComments('ws1', 'task.md')).rejects.toThrow(CommentApiError);
    });

    it('emits error event on HTTP error', async () => {
        mockFetchResponse(500, { error: 'Server error' });

        const events: CommentEvent[] = [];
        onCommentEvent((e) => events.push(e));

        await fetchComments('ws1', 'task.md').catch(() => {});

        expect(events.some(e => e.type === 'error')).toBe(true);
    });

    it('throws network error on fetch failure', async () => {
        mockFetchNetworkError();

        await expect(fetchComments('ws1', 'task.md')).rejects.toThrow('Network error, please try again');
    });

    it('emits error event on network failure', async () => {
        mockFetchNetworkError();

        const events: CommentEvent[] = [];
        onCommentEvent((e) => events.push(e));

        await fetchComments('ws1', 'task.md').catch(() => {});

        const errorEvent = events.find(e => e.type === 'error');
        expect(errorEvent).toBeDefined();
        if (errorEvent && errorEvent.type === 'error') {
            expect(errorEvent.error.message).toBe('Network error, please try again');
        }
    });
});

describe('createComment', () => {
    it('sends POST request with correct payload', async () => {
        const created = makeComment({ id: 'new-id' });
        mockFetchResponse(201, { comment: created });

        const request: CreateCommentRequest = {
            filePath: 'task.md',
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
            selectedText: 'hello',
            comment: 'Nice',
            status: 'open',
        };

        const result = await createComment('ws1', 'task.md', request);

        expect(result.id).toBe('new-id');
        expect((globalThis as any).fetch).toHaveBeenCalledWith(
            '/api/comments/ws1/task.md',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            })
        );
    });

    it('emits created event on success', async () => {
        const created = makeComment();
        mockFetchResponse(201, { comment: created });

        const events: CommentEvent[] = [];
        onCommentEvent((e) => events.push(e));

        await createComment('ws1', 'task.md', {
            filePath: 'task.md',
            selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
            selectedText: 'test',
            comment: 'Comment',
            status: 'open',
        });

        expect(events.some(e => e.type === 'created')).toBe(true);
    });

    it('throws on 400 validation error', async () => {
        mockFetchResponse(400, { error: 'Missing required field: comment' });

        await expect(
            createComment('ws1', 'task.md', {
                filePath: 'task.md',
                selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 5 },
                selectedText: 'test',
                comment: '',
                status: 'open',
            })
        ).rejects.toThrow(CommentApiError);
    });
});

describe('updateComment', () => {
    it('sends PATCH request with updates', async () => {
        const updated = makeComment({ comment: 'Updated text', status: 'resolved' });
        mockFetchResponse(200, { comment: updated });

        const result = await updateComment('ws1', 'task.md', 'c1', { comment: 'Updated text' });

        expect(result.comment).toBe('Updated text');
        expect((globalThis as any).fetch).toHaveBeenCalledWith(
            '/api/comments/ws1/task.md/c1',
            expect.objectContaining({ method: 'PATCH' })
        );
    });

    it('emits updated event on success', async () => {
        const updated = makeComment();
        mockFetchResponse(200, { comment: updated });

        const events: CommentEvent[] = [];
        onCommentEvent((e) => events.push(e));

        await updateComment('ws1', 'task.md', 'c1', { status: 'resolved' });

        expect(events.some(e => e.type === 'updated')).toBe(true);
    });

    it('throws on 404 not found', async () => {
        mockFetchResponse(404, { error: 'Comment not found' });

        await expect(updateComment('ws1', 'task.md', 'nonexistent', { comment: 'x' }))
            .rejects.toThrow(CommentApiError);
    });
});

describe('deleteComment', () => {
    it('sends DELETE request', async () => {
        // 204 No Content — json() won't be called
        (globalThis as any).fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 204,
            statusText: 'No Content',
            json: () => Promise.resolve({}),
        });

        await deleteComment('ws1', 'task.md', 'c1');

        expect((globalThis as any).fetch).toHaveBeenCalledWith(
            '/api/comments/ws1/task.md/c1',
            expect.objectContaining({ method: 'DELETE' })
        );
    });

    it('emits deleted event on success', async () => {
        (globalThis as any).fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 204,
            statusText: 'No Content',
            json: () => Promise.resolve({}),
        });

        const events: CommentEvent[] = [];
        onCommentEvent((e) => events.push(e));

        await deleteComment('ws1', 'task.md', 'c1');

        const deletedEvent = events.find(e => e.type === 'deleted');
        expect(deletedEvent).toBeDefined();
        if (deletedEvent && deletedEvent.type === 'deleted') {
            expect(deletedEvent.commentId).toBe('c1');
        }
    });

    it('throws on 404', async () => {
        mockFetchResponse(404, { error: 'Not found' });

        await expect(deleteComment('ws1', 'task.md', 'nonexistent'))
            .rejects.toThrow(CommentApiError);
    });
});

describe('resolveComment', () => {
    it('calls updateComment with status resolved', async () => {
        const resolved = makeComment({ status: 'resolved' });
        mockFetchResponse(200, { comment: resolved });

        const result = await resolveComment('ws1', 'task.md', 'c1');

        expect(result.status).toBe('resolved');
        const call = (globalThis as any).fetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.status).toBe('resolved');
    });
});

describe('unresolveComment', () => {
    it('calls updateComment with status open', async () => {
        const opened = makeComment({ status: 'open' });
        mockFetchResponse(200, { comment: opened });

        const result = await unresolveComment('ws1', 'task.md', 'c1');

        expect(result.status).toBe('open');
        const call = (globalThis as any).fetch.mock.calls[0];
        const body = JSON.parse(call[1].body);
        expect(body.status).toBe('open');
    });
});

// ============================================================================
// State Management
// ============================================================================

describe('Comment State Management', () => {
    it('initCommentState fetches and stores comments', async () => {
        const comments = [makeComment({ id: 'c1' }), makeComment({ id: 'c2' })];
        mockFetchResponse(200, { comments });

        const result = await initCommentState('ws1', 'task.md');

        expect(result).toHaveLength(2);
        const state = getCommentState();
        expect(state).not.toBeNull();
        expect(state!.wsId).toBe('ws1');
        expect(state!.taskPath).toBe('task.md');
        expect(state!.comments).toHaveLength(2);
    });

    it('disposeCommentState clears state', async () => {
        const comments = [makeComment()];
        mockFetchResponse(200, { comments });

        await initCommentState('ws1', 'task.md');
        expect(getCommentState()).not.toBeNull();

        disposeCommentState();
        expect(getCommentState()).toBeNull();
    });

    it('state tracks created events', async () => {
        mockFetchResponse(200, { comments: [] });
        await initCommentState('ws1', 'task.md');

        const newComment = makeComment({ id: 'new-1' });
        emitCommentEvent({ type: 'created', comment: newComment });

        const state = getCommentState();
        expect(state!.comments).toHaveLength(1);
        expect(state!.comments[0].id).toBe('new-1');
    });

    it('state tracks updated events', async () => {
        const comment = makeComment({ id: 'c1', comment: 'original' });
        mockFetchResponse(200, { comments: [comment] });
        await initCommentState('ws1', 'task.md');

        const updated = { ...comment, comment: 'modified' };
        emitCommentEvent({ type: 'updated', comment: updated });

        const state = getCommentState();
        expect(state!.comments[0].comment).toBe('modified');
    });

    it('state tracks deleted events', async () => {
        const c1 = makeComment({ id: 'c1' });
        const c2 = makeComment({ id: 'c2' });
        mockFetchResponse(200, { comments: [c1, c2] });
        await initCommentState('ws1', 'task.md');

        emitCommentEvent({ type: 'deleted', commentId: 'c1' });

        const state = getCommentState();
        expect(state!.comments).toHaveLength(1);
        expect(state!.comments[0].id).toBe('c2');
    });

    it('re-initializing disposes previous state', async () => {
        mockFetchResponse(200, { comments: [makeComment({ id: 'old' })] });
        await initCommentState('ws1', 'old-task.md');

        mockFetchResponse(200, { comments: [makeComment({ id: 'new' })] });
        await initCommentState('ws1', 'new-task.md');

        const state = getCommentState();
        expect(state!.taskPath).toBe('new-task.md');
        expect(state!.comments).toHaveLength(1);
        expect(state!.comments[0].id).toBe('new');
    });

    it('handles fetch error gracefully during init', async () => {
        mockFetchNetworkError();

        const result = await initCommentState('ws1', 'task.md');

        expect(result).toEqual([]);
        const state = getCommentState();
        expect(state).not.toBeNull();
        expect(state!.comments).toEqual([]);
    });
});

// ============================================================================
// URL Construction
// ============================================================================

describe('URL construction', () => {
    it('encodes workspace ID and task path', async () => {
        mockFetchResponse(200, { comments: [] });

        await fetchComments('my-workspace', 'folder/sub/task.md');

        expect((globalThis as any).fetch).toHaveBeenCalledWith(
            '/api/comments/my-workspace/folder%2Fsub%2Ftask.md'
        );
    });

    it('encodes comment ID in item URLs', async () => {
        const updated = makeComment();
        mockFetchResponse(200, { comment: updated });

        await updateComment('ws1', 'task.md', 'abc-123-def', { comment: 'x' });

        expect((globalThis as any).fetch).toHaveBeenCalledWith(
            '/api/comments/ws1/task.md/abc-123-def',
            expect.anything()
        );
    });
});

// ============================================================================
// fetchCommentCounts
// ============================================================================

describe('fetchCommentCounts', () => {
    beforeEach(() => {
        removeAllCommentListeners();
    });

    afterEach(() => {
        delete (globalThis as any).fetch;
    });

    it('returns counts from API response', async () => {
        mockFetchResponse(200, { counts: { 'task1.md': 3, 'task2.md': 1 } });
        const counts = await fetchCommentCounts('ws1');
        expect(counts).toEqual({ 'task1.md': 3, 'task2.md': 1 });
    });

    it('calls correct API URL', async () => {
        mockFetchResponse(200, { counts: {} });
        await fetchCommentCounts('my-workspace');
        expect((globalThis as any).fetch).toHaveBeenCalledWith(
            '/api/comment-counts/my-workspace'
        );
    });

    it('returns empty object on API error', async () => {
        mockFetchResponse(500, { error: 'Server error' });
        const counts = await fetchCommentCounts('ws1');
        expect(counts).toEqual({});
    });

    it('returns empty object on network error', async () => {
        mockFetchNetworkError();
        const counts = await fetchCommentCounts('ws1');
        expect(counts).toEqual({});
    });

    it('returns empty object when counts field is missing', async () => {
        mockFetchResponse(200, {});
        const counts = await fetchCommentCounts('ws1');
        expect(counts).toEqual({});
    });
});
