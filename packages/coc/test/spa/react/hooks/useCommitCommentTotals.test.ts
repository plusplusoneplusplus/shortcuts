/**
 * Tests for useCommitCommentTotals hook.
 *
 * Verifies initial fetch, re-fetch on dependency change, WebSocket subscription,
 * and silent failure on error. Mocks fetch and WebSocket globally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCommitCommentTotals } from '../../../../src/server/spa/client/react/hooks/useCommitCommentTotals';

// ============================================================================
// WebSocket Mock
// ============================================================================

type WsListener = (event: any) => void;

class MockWebSocket {
    static instances: MockWebSocket[] = [];
    private listeners: Record<string, WsListener[]> = {};
    closed = false;

    constructor(public url: string) {
        MockWebSocket.instances.push(this);
    }

    addEventListener(type: string, handler: WsListener): void {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(handler);
    }

    close(): void {
        this.closed = true;
    }

    emit(type: string, event: any): void {
        for (const handler of this.listeners[type] ?? []) {
            handler(event);
        }
    }
}

// ============================================================================
// Setup / Teardown
// ============================================================================

describe('useCommitCommentTotals', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        MockWebSocket.instances = [];
        vi.stubGlobal('WebSocket', MockWebSocket);
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    /** Helper: mock both open and resolved fetch responses */
    function mockOpenAndResolved(
        openTotals: Record<string, number>,
        resolvedTotals: Record<string, number>,
    ) {
        let callCount = 0;
        fetchMock.mockImplementation((url: string) => {
            callCount++;
            if (url.includes('status=open')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ totals: openTotals }),
                });
            }
            if (url.includes('status=resolved')) {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({ totals: resolvedTotals }),
                });
            }
            return Promise.resolve({ ok: true, json: async () => ({ totals: {} }) });
        });
    }

    // ── 1. returns empty map when no commits ─────────────────────────

    it('returns empty map when commitHashes is empty', async () => {
        const { result } = renderHook(() =>
            useCommitCommentTotals('ws-1', [])
        );
        await waitFor(() => {
            expect(result.current.size).toBe(0);
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // ── 2. fetches totals on mount ───────────────────────────────────

    it('fetches open and resolved totals on mount and populates map', async () => {
        mockOpenAndResolved({ 'abc123': 3, 'def456': 0 }, { 'abc123': 1 });

        const { result } = renderHook(() =>
            useCommitCommentTotals('ws-1', ['abc123', 'def456'])
        );

        await waitFor(() => {
            expect(result.current.get('abc123')).toEqual({ open: 3, resolved: 1 });
        });

        // Zero-count entries should not be in the map
        expect(result.current.has('def456')).toBe(false);
    });

    it('makes two fetch calls (open + resolved)', async () => {
        mockOpenAndResolved({ 'abc123': 1 }, {});

        renderHook(() => useCommitCommentTotals('ws-1', ['abc123']));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        const urls = fetchMock.mock.calls.map((c: any[]) => c[0] as string);
        expect(urls.some((u: string) => u.includes('status=open'))).toBe(true);
        expect(urls.some((u: string) => u.includes('status=resolved'))).toBe(true);
    });

    it('returns only resolved counts when open is zero', async () => {
        mockOpenAndResolved({}, { 'abc123': 2 });

        const { result } = renderHook(() =>
            useCommitCommentTotals('ws-1', ['abc123'])
        );

        await waitFor(() => {
            expect(result.current.get('abc123')).toEqual({ open: 0, resolved: 2 });
        });
    });

    // ── 3. WebSocket triggers re-fetch on diff-comment-updated ───────

    it('re-fetches totals when diff-comment-updated WS event matches wsId', async () => {
        mockOpenAndResolved({ 'abc123': 1 }, {});

        renderHook(() => useCommitCommentTotals('ws-1', ['abc123']));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        // Simulate server broadcasting diff-comment-updated
        mockOpenAndResolved({ 'abc123': 2 }, { 'abc123': 1 });

        act(() => {
            const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
            ws.emit('message', {
                data: JSON.stringify({ type: 'diff-comment-updated', workspaceId: 'ws-1' }),
            });
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    });

    // ── 4. WS event with different workspaceId is ignored ────────────

    it('does not re-fetch when diff-comment-updated WS event has different workspaceId', async () => {
        mockOpenAndResolved({ 'abc123': 1 }, {});

        renderHook(() => useCommitCommentTotals('ws-1', ['abc123']));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        act(() => {
            const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
            ws.emit('message', {
                data: JSON.stringify({ type: 'diff-comment-updated', workspaceId: 'ws-OTHER' }),
            });
        });

        // Should still be only 2 calls (open + resolved)
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    // ── 5. WS is closed on unmount ───────────────────────────────────

    it('closes WebSocket on unmount', async () => {
        mockOpenAndResolved({}, {});

        const { unmount } = renderHook(() =>
            useCommitCommentTotals('ws-1', ['abc123'])
        );

        await waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(0));

        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        unmount();

        expect(ws.closed).toBe(true);
    });

    // ── 6. fetch error is handled silently ──────────────────────────

    it('handles fetch error silently and returns empty map', async () => {
        fetchMock.mockRejectedValue(new Error('network error'));

        const { result } = renderHook(() =>
            useCommitCommentTotals('ws-1', ['abc123'])
        );

        await waitFor(() => expect(fetchMock).toHaveBeenCalled());

        expect(result.current.size).toBe(0);
    });

    // ── 7. malformed WS message is ignored ──────────────────────────

    it('ignores malformed WebSocket messages without throwing', async () => {
        mockOpenAndResolved({ 'abc123': 1 }, {});

        renderHook(() => useCommitCommentTotals('ws-1', ['abc123']));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        expect(() => {
            act(() => {
                const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
                ws.emit('message', { data: 'not-json' });
            });
        }).not.toThrow();

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
