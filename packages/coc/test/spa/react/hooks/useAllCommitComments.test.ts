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
import { useAllCommitComments } from '../../../../src/server/spa/client/react/features/git/hooks/useAllCommitComments';
import type { DiffComment, DiffCommentContext } from '../../../../src/server/spa/client/comments/diff-comment-types';

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
    return { ok: true, status: 204 };
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

    it('copyAllCommentsAsPrompt groups comments by file and writes prompt to clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        const c1 = makeComment({ id: 'c1', context: { ...mockCtx, filePath: 'src/a.ts' }, comment: 'fix this' });
        const c2 = makeComment({ id: 'c2', context: { ...mockCtx, filePath: 'src/b.ts' }, comment: 'rename' });
        fetchMock.mockResolvedValueOnce(listResponse([c1, c2]));

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.copyAllCommentsAsPrompt());

        expect(writeText).toHaveBeenCalledOnce();
        const written: string = writeText.mock.calls[0][0];
        expect(written).toContain('commit abc123');
        expect(written).toContain('src/a.ts');
        expect(written).toContain('src/b.ts');
        expect(written).toContain('fix this');
        expect(written).toContain('rename');
    });

    it('copyAllCommentsAsPrompt does nothing when there are no comments', async () => {
        const writeText = vi.fn();
        Object.assign(navigator, { clipboard: { writeText } });

        fetchMock.mockResolvedValueOnce(listResponse([]));

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.copyAllCommentsAsPrompt());

        expect(writeText).not.toHaveBeenCalled();
    });

    it('copyAllCommentsAsPrompt prompt header references the commit hash', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText } });

        const c1 = makeComment({ id: 'c1', context: { ...mockCtx, oldRef: 'deadbeef^', newRef: 'deadbeef', filePath: 'src/x.ts' } });
        fetchMock.mockResolvedValueOnce(listResponse([c1]));

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'deadbeef'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => result.current.copyAllCommentsAsPrompt());

        const written: string = writeText.mock.calls[0][0];
        expect(written).toContain('deadbeef');
    });

    it('closes WebSocket on unmount', async () => {
        fetchMock.mockResolvedValue(listResponse([]));

        const { unmount } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => MockWebSocket.instances.length > 0);

        const ws = MockWebSocket.instances[0];
        unmount();

        expect(ws.closed).toBe(true);
    });

    // ── resolveWithAI — commit-level batch resolve ───────────────────

    it('resolveWithAI calls resolve-with-ai endpoint with oldRef/newRef and refreshes', async () => {
        const comment = makeComment();
        fetchMock
            .mockResolvedValueOnce(listResponse([comment]))        // initial fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ taskId: 'task-1' }) })  // resolve-with-ai POST
            .mockResolvedValueOnce({ ok: true, json: async () => ({ task: { status: 'completed', result: {} } }) }) // poll
            .mockResolvedValueOnce(listResponse([]));              // refresh

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.resolveWithAI();
        });

        // Verify resolve-with-ai was called
        const postCalls = fetchMock.mock.calls.filter(
            (c: any[]) => c[1]?.method === 'POST' && typeof c[0] === 'string' && c[0].includes('resolve-with-ai')
        );
        expect(postCalls).toHaveLength(1);
        const body = JSON.parse(postCalls[0][1].body);
        expect(body.oldRef).toBe('abc123^');
        expect(body.newRef).toBe('abc123');
        expect(body.filePath).toBeUndefined();
    });

    it('resolveWithAI sets and clears resolving state', async () => {
        let resolvePost: any;
        fetchMock
            .mockResolvedValueOnce(listResponse([makeComment()]))
            .mockImplementationOnce(() => new Promise(r => { resolvePost = r; }));

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let resolvePromise: Promise<void>;
        act(() => {
            resolvePromise = result.current.resolveWithAI();
        });

        await waitFor(() => expect(result.current.resolving).toBe(true));

        resolvePost!({ ok: true, json: async () => ({}) });
        fetchMock.mockResolvedValueOnce(listResponse([]));
        await act(async () => { await resolvePromise!; });

        expect(result.current.resolving).toBe(false);
    });

    // ── fixWithAI — single comment resolve ────────────────────────────

    it('fixWithAI calls resolve-with-ai with commentId and filePath from comment context', async () => {
        const comment = makeComment({ id: 'c1' });
        fetchMock
            .mockResolvedValueOnce(listResponse([comment]))        // initial fetch
            .mockResolvedValueOnce({ ok: true, json: async () => ({ taskId: 'task-2' }) })  // resolve-with-ai POST
            .mockResolvedValueOnce({ ok: true, json: async () => ({ task: { status: 'completed', result: {} } }) }) // poll
            .mockResolvedValueOnce(listResponse([]));              // refresh

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.fixWithAI('c1');
        });

        const postCalls = fetchMock.mock.calls.filter(
            (c: any[]) => c[1]?.method === 'POST' && typeof c[0] === 'string' && c[0].includes('resolve-with-ai')
        );
        expect(postCalls).toHaveLength(1);
        const body = JSON.parse(postCalls[0][1].body);
        expect(body.commentId).toBe('c1');
        expect(body.oldRef).toBe(comment.context.oldRef);
        expect(body.newRef).toBe(comment.context.newRef);
        expect(body.filePath).toBe(comment.context.filePath);
    });

    it('fixWithAI sets and clears aiLoadingIds', async () => {
        let resolvePost: any;
        fetchMock
            .mockResolvedValueOnce(listResponse([makeComment({ id: 'c1' })]))
            .mockImplementationOnce(() => new Promise(r => { resolvePost = r; }));

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        let fixPromise: Promise<void>;
        act(() => {
            fixPromise = result.current.fixWithAI('c1');
        });

        await waitFor(() => expect(result.current.aiLoadingIds.has('c1')).toBe(true));

        resolvePost!({ ok: true, json: async () => ({}) });
        fetchMock.mockResolvedValueOnce(listResponse([]));
        await act(async () => { await fixPromise!; });

        expect(result.current.aiLoadingIds.has('c1')).toBe(false);
    });

    it('fixWithAI sets aiErrors on failure', async () => {
        fetchMock
            .mockResolvedValueOnce(listResponse([makeComment({ id: 'c1' })]))
            .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) });

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.fixWithAI('c1');
        });

        expect(result.current.aiErrors.has('c1')).toBe(true);
    });

    it('fixWithAI no-ops when comment not found', async () => {
        fetchMock.mockResolvedValueOnce(listResponse([]));

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const fetchCountBefore = fetchMock.mock.calls.length;

        await act(async () => {
            await result.current.fixWithAI('nonexistent');
        });

        // No additional fetch calls
        expect(fetchMock.mock.calls.length).toBe(fetchCountBefore);
    });

    // ── clearAiError ─────────────────────────────────────────────────

    it('clearAiError removes error for a specific comment', async () => {
        fetchMock
            .mockResolvedValueOnce(listResponse([makeComment({ id: 'c1' })]))
            .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error', json: async () => ({}) });

        const { result } = renderHook(() => useAllCommitComments('ws-1', 'abc123'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.fixWithAI('c1');
        });

        expect(result.current.aiErrors.has('c1')).toBe(true);

        act(() => {
            result.current.clearAiError('c1');
        });

        expect(result.current.aiErrors.has('c1')).toBe(false);
    });
});
