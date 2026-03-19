/**
 * Tests for useAllCommitComments hook.
 *
 * Verifies:
 *  - initial fetch on mount
 *  - resolve / unresolve / delete / update operations dispatch correct PATCH/DELETE calls
 *  - state updates after each operation
 *  - WebSocket refresh on diff-comment-updated
 *  - no-op when wsId or hash is empty
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAllCommitComments } from '../../../../src/server/spa/client/react/hooks/useAllCommitComments';
import type { DiffComment, DiffCommentContext } from '../../../../src/server/spa/client/diff-comment-types';

// ============================================================================
// Shared test data
// ============================================================================

const mockCtx: DiffCommentContext = {
    repositoryId: 'repo-1',
    oldRef: 'abc123^',
    newRef: 'abc123',
    filePath: 'src/index.ts',
};

function makeComment(overrides: Partial<DiffComment> = {}): DiffComment {
    return {
        id: 'c1',
        context: mockCtx,
        selection: { diffLineStart: 1, diffLineEnd: 1, side: 'added', startColumn: 0, endColumn: 5 },
        selectedText: 'foo',
        comment: 'review this',
        status: 'open',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        ...overrides,
    };
}

// ============================================================================
// WebSocket mock
// ============================================================================

type WsListener = (event: any) => void;

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    private listeners: Record<string, WsListener[]> = {};
    sent: string[] = [];
    closed = false;

    constructor(public url: string) {
        MockWebSocket.instances.push(this);
    }

    addEventListener(type: string, handler: WsListener): void {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
    }

    send(data: string): void { this.sent.push(data); }
    close(): void { this.closed = true; }

    emit(type: string, event: any): void {
        for (const handler of this.listeners[type] ?? []) handler(event);
    }
}

// ============================================================================
// Setup / Teardown
// ============================================================================

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);

    vi.stubGlobal('crypto', {
        subtle: {
            digest: vi.fn().mockImplementation(async () =>
                new Uint8Array(32).fill(0xab).buffer
            ),
        },
    });

    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

// ============================================================================
// Helpers
// ============================================================================

function listResponse(comments: DiffComment[] = []) {
    return { ok: true, json: async () => ({ comments }) };
}

function patchResponse(comment: DiffComment) {
    return { ok: true, json: async () => ({ comment }) };
}

function deleteResponse() {
    return { ok: true };
}

// ============================================================================
// Tests
// ============================================================================

describe('useAllCommitComments', () => {
    it('returns empty state initially and fetches on mount', async () => {
        const comment = makeComment();
        fetchMock.mockResolvedValueOnce(listResponse([comment]));

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));

        expect(result.current.loading).toBe(true);
        expect(result.current.comments).toEqual([]);

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.comments).toHaveLength(1);
        expect(result.current.comments[0].id).toBe('c1');

        // Verify path used for fetch (via fetchApi → /diff-comments/...)
        // fetchApi is not stubbed here — we check via raw fetch since getApiBase() returns ''
        // in test env; we verify URL contains the essential parts
        const url: string = fetchMock.mock.calls[0][0];
        expect(url).toContain('diff-comments');
        expect(url).toContain('abc123');
    });

    it('returns empty comments when wsId is empty', async () => {
        const { result } = renderHook(() => useAllCommitComments('', 'abc123'));

        // Should not trigger a fetch
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.current.comments).toEqual([]);
    });

    it('returns empty comments when hash is empty', async () => {
        const { result } = renderHook(() => useAllCommitComments('ws-1', ''));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(fetchMock).not.toHaveBeenCalled();
        expect(result.current.comments).toEqual([]);
    });

    it('resolveComment sends PATCH with status resolved and updates state', async () => {
        const comment = makeComment({ status: 'open' });
        const resolved = { ...comment, status: 'resolved' as const };

        fetchMock
            .mockResolvedValueOnce(listResponse([comment])) // initial fetch
            .mockResolvedValueOnce(patchResponse(resolved)); // PATCH

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.resolveComment(comment);
        });

        // Verify PATCH request was sent
        const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
        expect(patchCall).toBeTruthy();
        expect(JSON.parse(patchCall![1].body)).toEqual({ status: 'resolved' });

        // Verify state updated
        expect(result.current.comments[0].status).toBe('resolved');
    });

    it('unresolveComment sends PATCH with status open and updates state', async () => {
        const comment = makeComment({ status: 'resolved' });
        const reopened = { ...comment, status: 'open' as const };

        fetchMock
            .mockResolvedValueOnce(listResponse([comment]))
            .mockResolvedValueOnce(patchResponse(reopened));

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.unresolveComment(comment);
        });

        const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
        expect(JSON.parse(patchCall![1].body)).toEqual({ status: 'open' });
        expect(result.current.comments[0].status).toBe('open');
    });

    it('deleteComment sends DELETE and removes comment from state', async () => {
        const comment = makeComment();

        fetchMock
            .mockResolvedValueOnce(listResponse([comment]))
            .mockResolvedValueOnce(deleteResponse());

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.comments).toHaveLength(1);

        await act(async () => {
            await result.current.deleteComment(comment);
        });

        const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
        expect(deleteCall).toBeTruthy();
        expect(result.current.comments).toHaveLength(0);
    });

    it('updateComment sends PATCH with given updates', async () => {
        const comment = makeComment();
        const updated = { ...comment, comment: 'updated text' };

        fetchMock
            .mockResolvedValueOnce(listResponse([comment]))
            .mockResolvedValueOnce(patchResponse(updated));

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateComment(comment, { comment: 'updated text' });
        });

        const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
        expect(JSON.parse(patchCall![1].body)).toEqual({ comment: 'updated text' });
        expect(result.current.comments[0].comment).toBe('updated text');
    });

    it('handles fetch error gracefully and returns empty comments', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Network error'));

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.comments).toEqual([]);
    });

    it('re-fetches on diff-comment-updated WebSocket event matching the commit', async () => {
        const comment = makeComment();
        const updated = makeComment({ comment: 'after ws update' });

        fetchMock
            .mockResolvedValueOnce(listResponse([comment]))    // initial fetch
            .mockResolvedValueOnce(listResponse([updated]));   // after WS refresh

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const ws = MockWebSocket.instances[0];
        expect(ws).toBeTruthy();

        await act(async () => {
            ws.emit('message', {
                data: JSON.stringify({
                    type: 'diff-comment-updated',
                    context: { oldRef: 'abc123^', newRef: 'abc123' },
                }),
            });
        });

        await waitFor(() => expect(result.current.comments[0].comment).toBe('after ws update'));
    });

    it('ignores diff-comment-updated events for a different commit', async () => {
        const comment = makeComment();

        fetchMock.mockResolvedValue(listResponse([comment]));

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const fetchCountAfterMount = fetchMock.mock.calls.length;

        const ws = MockWebSocket.instances[0];
        await act(async () => {
            ws.emit('message', {
                data: JSON.stringify({
                    type: 'diff-comment-updated',
                    context: { oldRef: 'other^', newRef: 'other' }, // different commit
                }),
            });
        });

        // No additional fetches triggered
        expect(fetchMock.mock.calls.length).toBe(fetchCountAfterMount);
    });

    it('closes WebSocket on unmount', async () => {
        fetchMock.mockResolvedValue(listResponse([]));

        const { unmount } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => MockWebSocket.instances.length > 0);

        const ws = MockWebSocket.instances[0];
        unmount();

        expect(ws.closed).toBe(true);
    });
});
