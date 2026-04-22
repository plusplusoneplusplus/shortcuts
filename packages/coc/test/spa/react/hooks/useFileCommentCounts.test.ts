/**
 * Tests for useFileCommentCounts hook.
 *
 * Verifies initial fetch, re-fetch on dependency change, WebSocket subscription,
 * and silent failure on error. Mocks fetch and WebSocket globally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useFileCommentCounts } from '../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts';

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

describe('useFileCommentCounts', () => {
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

    // ── 1. returns empty map when refs are null ──────────────────────

    it('returns empty map when oldRef is null', async () => {
        const { result } = renderHook(() =>
            useFileCommentCounts('ws-1', null, 'def456')
        );
        await waitFor(() => {
            expect(result.current.size).toBe(0);
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns empty map when newRef is null', async () => {
        const { result } = renderHook(() =>
            useFileCommentCounts('ws-1', 'abc123', null)
        );
        await waitFor(() => {
            expect(result.current.size).toBe(0);
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // ── 2. fetches counts on mount ───────────────────────────────────

    it('fetches counts on mount and populates map', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ counts: { 'key-a': 2, 'key-b': 0 } }),
        });

        const { result } = renderHook(() =>
            useFileCommentCounts('ws-1', 'abc123', 'def456')
        );

        await waitFor(() => {
            expect(result.current.get('key-a')).toBe(2);
        });

        // Zero-count entries should not be in the map
        expect(result.current.has('key-b')).toBe(false);
    });

    // ── 3. WebSocket triggers re-fetch on diff-comment-updated ───────

    it('re-fetches counts when diff-comment-updated WS event matches wsId', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ counts: { 'key-a': 1 } }),
        });

        renderHook(() => useFileCommentCounts('ws-1', 'abc123', 'def456'));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ counts: { 'key-a': 2 } }),
        });

        act(() => {
            const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
            ws.emit('message', {
                data: JSON.stringify({ type: 'diff-comment-updated', workspaceId: 'ws-1' }),
            });
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });

    // ── 4. WS event with different workspaceId is ignored ────────────

    it('does not re-fetch when diff-comment-updated WS event has different workspaceId', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ counts: { 'key-a': 1 } }),
        });

        renderHook(() => useFileCommentCounts('ws-1', 'abc123', 'def456'));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        act(() => {
            const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
            ws.emit('message', {
                data: JSON.stringify({ type: 'diff-comment-updated', workspaceId: 'ws-OTHER' }),
            });
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // ── 5. WS is closed on unmount ───────────────────────────────────

    it('closes WebSocket on unmount', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ counts: {} }),
        });

        const { unmount } = renderHook(() =>
            useFileCommentCounts('ws-1', 'abc123', 'def456')
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
            useFileCommentCounts('ws-1', 'abc123', 'def456')
        );

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        expect(result.current.size).toBe(0);
    });

    // ── 7. malformed WS message is ignored ──────────────────────────

    it('ignores malformed WebSocket messages without throwing', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ counts: { 'key-a': 1 } }),
        });

        renderHook(() => useFileCommentCounts('ws-1', 'abc123', 'def456'));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

        expect(() => {
            act(() => {
                const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
                ws.emit('message', { data: 'not-json' });
            });
        }).not.toThrow();

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
