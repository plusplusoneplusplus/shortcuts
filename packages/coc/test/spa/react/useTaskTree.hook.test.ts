/**
 * renderHook-based tests for the useTaskTree hook.
 * Covers fetch on mount, loading/error states, refresh, WebSocket event handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import { useTaskTree } from '../../../src/server/spa/client/react/tasks/hooks/useTaskTree';
import type { TaskFolder } from '../../../src/server/spa/client/react/tasks/hooks/useTaskTree';

const mockFetch = vi.fn();

function jsonResponse(data: unknown): Partial<Response> {
    return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => data,
        text: async () => JSON.stringify(data),
    };
}

function mockTaskTreeApi(tree: unknown, counts: Record<string, number> | Error = {}): void {
    mockFetch.mockImplementation((input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('comment-counts')) {
            if (counts instanceof Error) return Promise.reject(counts);
            return Promise.resolve(jsonResponse({ counts }));
        }
        return Promise.resolve(jsonResponse({ workflows: [], tasks: tree }));
    });
}

function makeTree(overrides?: Partial<TaskFolder>): TaskFolder {
    return {
        name: 'tasks',
        relativePath: '',
        children: [],
        documentGroups: [],
        singleDocuments: [],
        ...overrides,
    };
}

const countsData: Record<string, number> = { 'task1.md': 3 };

describe('useTaskTree hook', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // ─── Mount and loading ───────────────────────────────────────

    it('loads tree and comment counts on mount', async () => {
        const tree = makeTree();
        mockTaskTreeApi(tree, countsData);

        const { result } = renderHook(() => useTaskTree('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.tree).toEqual(tree);
        expect(result.current.commentCounts).toEqual(countsData);
        expect(result.current.error).toBeNull();
    });

    it('sets loading=true initially then false after load', async () => {
        mockTaskTreeApi(makeTree());

        const { result } = renderHook(() => useTaskTree('ws-1'));

        // Initial state before resolution
        expect(result.current.loading).toBe(true);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
    });

    // ─── Error handling ──────────────────────────────────────────

    it('sets error when task tree fetch rejects', async () => {
        mockFetch.mockRejectedValue(new Error('Network failure'));

        const { result } = renderHook(() => useTaskTree('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.error).toBe('Network failure');
        expect(result.current.tree).toBeNull();
    });

    // ─── Git metadata filtering ──────────────────────────────────

    it('filters .git metadata folders from API response', async () => {
        const treeWithGit = makeTree({
            children: [
                makeTree({ name: '.git', relativePath: '.git' }),
                makeTree({ name: 'feature', relativePath: 'feature' }),
            ],
        });
        mockTaskTreeApi(treeWithGit);

        const { result } = renderHook(() => useTaskTree('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.tree!.children).toHaveLength(1);
        expect(result.current.tree!.children[0].name).toBe('feature');
    });

    // ─── Comment-counts fault tolerance ──────────────────────────

    it('comment-counts failure does not block tree load', async () => {
        const tree = makeTree();
        mockTaskTreeApi(tree, new Error('counts failed'));

        const { result } = renderHook(() => useTaskTree('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.tree).toEqual(tree);
        expect(result.current.commentCounts).toEqual({});
        expect(result.current.error).toBeNull();
    });

    // ─── Refresh ─────────────────────────────────────────────────

    it('refresh() re-fetches data', async () => {
        const tree = makeTree();
        mockTaskTreeApi(tree);

        const { result } = renderHook(() => useTaskTree('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const callsBefore = mockFetch.mock.calls.length;

        act(() => {
            result.current.refresh();
        });

        await waitFor(() => {
            expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore);
        });
    });

    it('does not set loading=true on subsequent refresh', async () => {
        const tree = makeTree();
        mockTaskTreeApi(tree);

        const { result } = renderHook(() => useTaskTree('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // After first load, hasLoadedOnce is true — subsequent refresh should not set loading
        act(() => {
            result.current.refresh();
        });

        // loading should stay false (hasLoadedOnce prevents it)
        expect(result.current.loading).toBe(false);

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });
    });

    // ─── WebSocket / CustomEvent ─────────────────────────────────

    it('responds to tasks-changed CustomEvent for matching wsId', async () => {
        const tree = makeTree();
        mockTaskTreeApi(tree);

        const { result } = renderHook(() => useTaskTree('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const callsBefore = mockFetch.mock.calls.length;

        act(() => {
            window.dispatchEvent(new CustomEvent('tasks-changed', { detail: { wsId: 'ws-1' } }));
        });

        await waitFor(() => {
            expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore);
        });
    });

    it('ignores tasks-changed event for different wsId', async () => {
        const tree = makeTree();
        mockTaskTreeApi(tree);

        const { result } = renderHook(() => useTaskTree('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        const callsBefore = mockFetch.mock.calls.length;

        act(() => {
            window.dispatchEvent(new CustomEvent('tasks-changed', { detail: { wsId: 'ws-other' } }));
        });

        // No extra calls should have been made
        expect(mockFetch.mock.calls.length).toBe(callsBefore);
    });

    // ─── Edge cases ──────────────────────────────────────────────

    it('returns null tree when API returns non-object', async () => {
        mockTaskTreeApi(null);

        const { result } = renderHook(() => useTaskTree('ws-1'));

        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        expect(result.current.tree).toBeNull();
    });

    it('handles empty wsId gracefully', async () => {
        const { result } = renderHook(() => useTaskTree(''));

        // With empty wsId, refresh short-circuits — no fetch calls
        expect(mockFetch).not.toHaveBeenCalled();
        // loading remains true since refresh never runs
        expect(result.current.tree).toBeNull();
    });
});
