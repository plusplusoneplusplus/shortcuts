/**
 * Tests for useDiffComments hook.
 *
 * Verifies CRUD operations, AI flows, WebSocket subscription, and
 * isEphemeral flag. Mocks fetch, WebSocket, and crypto.subtle.digest
 * to avoid real network and crypto calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDiffComments } from '../../../../src/server/spa/client/react/hooks/useDiffComments';
import type { DiffCommentContext, DiffCommentSelection, DiffComment } from '../../../../src/server/spa/client/diff-comment-types';

// ============================================================================
// Test Data
// ============================================================================

const mockContextA: DiffCommentContext = {
    repositoryId: 'repo-1',
    oldRef: 'abc123',
    newRef: 'def456',
    filePath: 'src/index.ts',
};

const mockContextB: DiffCommentContext = {
    repositoryId: 'repo-1',
    oldRef: 'aaa111',
    newRef: 'bbb222',
    filePath: 'src/other.ts',
};

const mockSelection: DiffCommentSelection = {
    diffLineStart: 1,
    diffLineEnd: 3,
    side: 'added',
    startColumn: 0,
    endColumn: 10,
};

function makeComment(overrides: Partial<DiffComment> = {}): DiffComment {
    return {
        id: 'comment-1',
        context: mockContextA,
        selection: mockSelection,
        selectedText: 'hello world',
        comment: 'This needs review',
        status: 'open',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        ...overrides,
    };
}

// ============================================================================
// WebSocket Mock
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

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.closed = true;
    }

    /** Emit an event to all registered listeners. */
    emit(type: string, event: any): void {
        for (const handler of this.listeners[type] ?? []) {
            handler(event);
        }
    }
}

// ============================================================================
// Setup / Teardown
// ============================================================================

describe('useDiffComments', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        MockWebSocket.instances = [];
        vi.stubGlobal('WebSocket', MockWebSocket);

        // Stable mock for crypto.subtle.digest — returns a deterministic 32-byte
        // buffer so storage-key computations are synchronous in effect order.
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

    // ── 1. returns empty state when context is null ──────────────────

    it('returns empty state when context is null', async () => {
        const { result } = renderHook(() => useDiffComments('ws-1', null));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.comments).toEqual([]);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // ── 2. fetches comments on mount ─────────────────────────────────

    it('fetches comments on mount', async () => {
        const comment = makeComment();
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ comments: [comment] }),
        });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.comments).toHaveLength(1);
        expect(result.current.comments[0].id).toBe('comment-1');
        expect(fetchMock).toHaveBeenCalled();
        const url: string = fetchMock.mock.calls[0][0];
        expect(url).toContain('/diff-comments/ws-1');
    });

    // ── 3. re-fetches when context changes ───────────────────────────

    it('re-fetches when context changes', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ comments: [] }),
        });

        const { rerender } = renderHook(
            (ctx: DiffCommentContext) => useDiffComments('ws-1', ctx),
            { initialProps: mockContextA }
        );

        await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
        const firstCount = fetchMock.mock.calls.length;

        rerender(mockContextB);

        await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(firstCount));

        // Both context URLs should have appeared
        const urls: string[] = fetchMock.mock.calls.map((c: any[]) => c[0] as string);
        const diffUrls = urls.filter(u => u.includes('diff-comments'));
        expect(diffUrls.some(u => u.includes('src%2Findex.ts') || u.includes('src/index.ts'))).toBe(true);
        expect(diffUrls.some(u => u.includes('src%2Fother.ts') || u.includes('src/other.ts'))).toBe(true);
    });

    // ── 4. addComment posts and appends to state ─────────────────────

    it('addComment posts and appends to state', async () => {
        const newComment = makeComment({ id: 'new-1', comment: 'New comment' });
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comment: newComment }) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.addComment(mockSelection, 'hello world', 'New comment');
        });

        expect(result.current.comments).toHaveLength(1);
        expect(result.current.comments[0].id).toBe('new-1');

        // POST should include context + selection in body
        const postCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'POST');
        expect(postCall).toBeDefined();
        const body = JSON.parse(postCall[1].body);
        expect(body.context).toEqual(mockContextA);
        expect(body.selection).toEqual(mockSelection);
        expect(body.selectedText).toBe('hello world');
        expect(body.comment).toBe('New comment');
    });

    // ── 5. resolveComment patches status to resolved ─────────────────

    it('resolveComment patches status to resolved', async () => {
        const comment = makeComment();
        const resolved = { ...comment, status: 'resolved' as const };
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comment: resolved }) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.resolveComment('comment-1');
        });

        expect(result.current.comments[0].status).toBe('resolved');
        const patchCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'PATCH');
        expect(patchCall).toBeDefined();
        expect(JSON.parse(patchCall[1].body)).toEqual({ status: 'resolved' });
    });

    // ── 6. unresolveComment patches status to open ───────────────────

    it('unresolveComment patches status to open', async () => {
        const comment = makeComment({ status: 'resolved' });
        const unresolved = { ...comment, status: 'open' as const };
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comment: unresolved }) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.unresolveComment('comment-1');
        });

        expect(result.current.comments[0].status).toBe('open');
        const patchCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'PATCH');
        expect(patchCall).toBeDefined();
        expect(JSON.parse(patchCall[1].body)).toEqual({ status: 'open' });
    });

    // ── 7. deleteComment removes comment from state ──────────────────

    it('deleteComment removes comment from state', async () => {
        const comment = makeComment();
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.deleteComment('comment-1');
        });

        expect(result.current.comments).toHaveLength(0);
        const deleteCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'DELETE');
        expect(deleteCall).toBeDefined();
    });

    // ── 8. askAI sets aiLoadingIds during request ────────────────────

    it('askAI sets aiLoadingIds during request', async () => {
        const comment = makeComment();
        let resolveAsk!: (val: any) => void;
        const askPromise = new Promise(resolve => { resolveAsk = resolve; });

        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment] }) })
            .mockReturnValueOnce({ ok: true, json: () => askPromise });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        // Start askAI without awaiting
        act(() => {
            void result.current.askAI('comment-1');
        });

        await waitFor(() => expect(result.current.aiLoadingIds.has('comment-1')).toBe(true));

        // Resolve the AI request
        await act(async () => {
            resolveAsk({ aiResponse: 'AI says hello' });
            await new Promise(r => setTimeout(r, 0));
        });

        await waitFor(() => expect(result.current.aiLoadingIds.has('comment-1')).toBe(false));
    });

    // ── 9. askAI stores error on failure ─────────────────────────────

    it('askAI stores error on failure', async () => {
        const comment = makeComment();
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment] }) })
            .mockResolvedValueOnce({ ok: false, json: async () => ({}) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.askAI('comment-1');
        });

        expect(result.current.aiErrors.get('comment-1')).toBeDefined();
        expect(result.current.aiLoadingIds.has('comment-1')).toBe(false);
    });

    // ── 10. clearAiError removes error entry ──────────────────────────

    it('clearAiError removes error entry', async () => {
        const comment = makeComment();
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment] }) })
            .mockResolvedValueOnce({ ok: false, json: async () => ({}) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => { await result.current.askAI('comment-1'); });
        expect(result.current.aiErrors.size).toBe(1);

        act(() => { result.current.clearAiError('comment-1'); });
        expect(result.current.aiErrors.size).toBe(0);
    });

    // ── 11. isEphemeral ───────────────────────────────────────────────

    it('isEphemeral is true when newRef is working-tree', () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ comments: [] }) });
        const ephemeralCtx: DiffCommentContext = { ...mockContextA, newRef: 'working-tree' };
        const { result } = renderHook(() => useDiffComments('ws-1', ephemeralCtx));
        expect(result.current.isEphemeral).toBe(true);
    });

    it('isEphemeral is false when newRef is not working-tree', () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ comments: [] }) });
        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        expect(result.current.isEphemeral).toBe(false);
    });

    it('isEphemeral is false when context is null', () => {
        const { result } = renderHook(() => useDiffComments('ws-1', null));
        expect(result.current.isEphemeral).toBe(false);
    });

    // ── 12. WebSocket triggers refresh on diff-comment-updated ────────

    it('WebSocket triggers refresh on diff-comment-updated for matching context', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ comments: [] }) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        expect(ws).toBeDefined();

        // Simulate WebSocket open → sends subscribe message
        act(() => { ws.emit('open', {}); });
        expect(ws.sent.some(s => s.includes('subscribe-diff'))).toBe(true);

        const fetchCountBefore = fetchMock.mock.calls.length;

        // Simulate matching diff-comment-updated
        await act(async () => {
            ws.emit('message', {
                data: JSON.stringify({ type: 'diff-comment-updated', context: mockContextA }),
            });
            await new Promise(r => setTimeout(r, 0));
        });

        await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(fetchCountBefore));
    });

    it('WebSocket does not trigger refresh for non-matching context', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ comments: [] }) });

        renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));

        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        act(() => { ws.emit('open', {}); });

        const fetchCountBefore = fetchMock.mock.calls.length;

        act(() => {
            ws.emit('message', {
                data: JSON.stringify({
                    type: 'diff-comment-updated',
                    context: { ...mockContextA, filePath: 'other/file.ts' },
                }),
            });
        });

        // Allow a tick to pass; no extra fetch should have been triggered
        await new Promise(r => setTimeout(r, 20));
        expect(fetchMock.mock.calls.length).toBe(fetchCountBefore);
    });

    it('WebSocket closes on unmount', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ comments: [] }) });

        const { unmount } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(0));

        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        unmount();

        expect(ws.closed).toBe(true);
    });

    // ── 13. askAI handles async { taskId } response via pollTaskResult ─

    it('askAI merges aiResponse into comment state (sync path)', async () => {
        const comment = makeComment();
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ aiResponse: 'AI analysis' }) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.askAI('comment-1');
        });

        expect(result.current.comments[0].aiResponse).toBe('AI analysis');
    });

    // ── 14. error state is set when fetch fails ────────────────────────

    it('sets error state when fetch fails', async () => {
        fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBeTruthy();
        expect(result.current.comments).toHaveLength(0);
    });

    // ── 15. updateComment updates the comment in state ─────────────────

    it('updateComment replaces comment in state', async () => {
        const comment = makeComment();
        const updated = { ...comment, comment: 'Updated text' };
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comment: updated }) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.updateComment('comment-1', { comment: 'Updated text' });
        });

        expect(result.current.comments[0].comment).toBe('Updated text');
        const patchCall = fetchMock.mock.calls.find((c: any[]) => c[1]?.method === 'PATCH');
        expect(JSON.parse(patchCall[1].body)).toEqual({ comment: 'Updated text' });
    });
});

// ============================================================================
// runRelocation tests
// ============================================================================

import type { DiffLine } from '../../../../src/server/spa/client/react/repos/UnifiedDiffViewer';

/** Build a DiffLine with the given content. */
function makeDiffLine(content: string, index: number): DiffLine {
    return { index, type: 'context', content };
}

/** djb2 hash — mirrors relocateDiffAnchor's hashText */
function hashText(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash) + text.charCodeAt(i);
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

describe('useDiffComments — runRelocation', () => {
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

    // ── A. Comment without anchor is skipped ─────────────────────────

    it('skips comments without an anchor field', async () => {
        const comment = makeComment(); // no anchor
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ comments: [comment] }) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.runRelocation([makeDiffLine('+foo', 0)]);
        });

        // No PATCH should be issued and status should be unchanged
        expect(fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'PATCH')).toHaveLength(0);
        expect(result.current.comments[0].status).toBe('open');
    });

    // ── B. Anchor match at same index → no PATCH ────────────────────

    it('does not issue PATCH when relocated index equals current diffLineStart', async () => {
        const targetContent = '+const x = 1;';
        const comment = makeComment({
            selection: { diffLineStart: 0, diffLineEnd: 0, side: 'added', startColumn: 0, endColumn: 5 },
            anchor: {
                selectedText: 'const x = 1',
                contextBefore: '',
                contextAfter: '',
                originalLine: 0,
                textHash: hashText(targetContent),
            },
        });
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ comments: [comment] }) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            // Line 0 has the target content → same index, no PATCH
            await result.current.runRelocation([makeDiffLine(targetContent, 0), makeDiffLine('+bar', 1)]);
        });

        expect(fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'PATCH')).toHaveLength(0);
    });

    // ── C. Anchor match at different index → PATCH fired ────────────

    it('issues PATCH and updates diffLineStart when relocated index differs', async () => {
        const targetContent = '+moved content here';
        const comment = makeComment({
            selection: { diffLineStart: 0, diffLineEnd: 0, side: 'added', startColumn: 0, endColumn: 5 },
            anchor: {
                selectedText: 'moved content',
                contextBefore: '',
                contextAfter: '',
                originalLine: 0,
                textHash: hashText(targetContent),
            },
        });
        const updated = { ...comment, selection: { ...comment.selection, diffLineStart: 2, diffLineEnd: 2 } };
        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [comment] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comment: updated }) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.runRelocation([
                makeDiffLine('+other line', 0),
                makeDiffLine('+another line', 1),
                makeDiffLine(targetContent, 2),
            ]);
        });

        const patchCalls = fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'PATCH');
        expect(patchCalls).toHaveLength(1);
        const body = JSON.parse(patchCalls[0][1].body);
        expect(body.selection.diffLineStart).toBe(2);
    });

    // ── D. No match → sets status orphaned, no PATCH ─────────────────

    it('sets comment status to orphaned locally and does not issue PATCH when no match found', async () => {
        const comment = makeComment({
            anchor: {
                selectedText: 'completely removed',
                contextBefore: 'nonexistent',
                contextAfter: 'nonexistent',
                originalLine: 1,
                textHash: 'no-match-hash',
            },
        });
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ comments: [comment] }) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.runRelocation([
                makeDiffLine('+foo', 0),
                makeDiffLine('+bar', 1),
            ]);
        });

        expect(result.current.comments[0].status).toBe('orphaned');
        expect(fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'PATCH')).toHaveLength(0);
    });

    // ── E. Processes all comments in one call ─────────────────────────

    it('processes all anchored comments in a single runRelocation call', async () => {
        const contentA = '+line a content';
        const contentB = '+line b content';
        const commentA = makeComment({
            id: 'ca',
            selection: { diffLineStart: 5, diffLineEnd: 5, side: 'added', startColumn: 0, endColumn: 5 },
            anchor: {
                selectedText: 'line a content',
                contextBefore: '',
                contextAfter: '',
                originalLine: 5,
                textHash: hashText(contentA),
            },
        });
        const commentB = makeComment({
            id: 'cb',
            selection: { diffLineStart: 6, diffLineEnd: 6, side: 'added', startColumn: 0, endColumn: 5 },
            anchor: {
                selectedText: 'line b content',
                contextBefore: '',
                contextAfter: '',
                originalLine: 6,
                textHash: hashText(contentB),
            },
        });
        const updatedA = { ...commentA, selection: { ...commentA.selection, diffLineStart: 0, diffLineEnd: 0 } };
        const updatedB = { ...commentB, selection: { ...commentB.selection, diffLineStart: 1, diffLineEnd: 1 } };

        fetchMock
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comments: [commentA, commentB] }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comment: updatedA }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ comment: updatedB }) });

        const { result } = renderHook(() => useDiffComments('ws-1', mockContextA));
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.runRelocation([
                makeDiffLine(contentA, 0),
                makeDiffLine(contentB, 1),
            ]);
        });

        const patchCalls = fetchMock.mock.calls.filter((c: any[]) => c[1]?.method === 'PATCH');
        expect(patchCalls).toHaveLength(2);
    });
});
