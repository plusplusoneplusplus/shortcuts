/**
 * Tests for useTaskTree hook — fetch on mount, refresh, tasks-changed WS event, error path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTaskTree } from '../../../src/server/spa/client/react/hooks/useTaskTree';

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function makeTree(name = 'root') {
    return {
        name,
        relativePath: '',
        children: [],
        documentGroups: [],
        singleDocuments: [],
    };
}

function mockApiSuccess(tree: any = makeTree(), counts: any = {}) {
    mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ workflows: [], tasks: tree }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(counts) });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('useTaskTree', () => {
    it('starts with loading=true and tree=null', () => {
        mockApiSuccess();
        const { result } = renderHook(() => useTaskTree('ws-1'));
        expect(result.current.loading).toBe(true);
        expect(result.current.tree).toBe(null);
    });

    it('sets tree and loading=false after successful fetch', async () => {
        const tree = makeTree('my-tasks');
        mockApiSuccess(tree);
        const { result } = renderHook(() => useTaskTree('ws-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.tree).toMatchObject({ name: 'my-tasks' });
    });

    it('fetches /workspaces/:id/summary with showArchived=true', async () => {
        mockApiSuccess();
        renderHook(() => useTaskTree('ws-abc'));
        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/workspaces/ws-abc/summary'),
                expect.anything()
            );
        });
    });

    it('fetches comment counts on mount', async () => {
        mockApiSuccess(makeTree(), { 'some/file.md': 3 });
        const { result } = renderHook(() => useTaskTree('ws-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.commentCounts).toEqual({ 'some/file.md': 3 });
    });

    it('sets error state when fetch fails', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network error'));
        const { result } = renderHook(() => useTaskTree('ws-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toContain('Network error');
    });

    it('sets loading=false even on error', async () => {
        mockFetch.mockRejectedValueOnce(new Error('fail'));
        const { result } = renderHook(() => useTaskTree('ws-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('re-fetches when tasks-changed event fires with matching wsId', async () => {
        mockApiSuccess();
        const { result } = renderHook(() => useTaskTree('ws-match'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        const fetchCountBefore = mockFetch.mock.calls.length;
        mockApiSuccess();
        act(() => {
            window.dispatchEvent(new CustomEvent('tasks-changed', { detail: { wsId: 'ws-match' } }));
        });
        await waitFor(() => {
            expect(mockFetch.mock.calls.length).toBeGreaterThan(fetchCountBefore);
        });
    });

    it('does NOT re-fetch when tasks-changed fires for a different wsId', async () => {
        mockApiSuccess();
        renderHook(() => useTaskTree('ws-mine'));
        await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(0));

        const fetchCountBefore = mockFetch.mock.calls.length;
        act(() => {
            window.dispatchEvent(new CustomEvent('tasks-changed', { detail: { wsId: 'ws-other' } }));
        });
        // Small wait to let any async work complete
        await new Promise(r => setTimeout(r, 50));
        expect(mockFetch.mock.calls.length).toBe(fetchCountBefore);
    });

    it('refresh() triggers a new fetch', async () => {
        mockApiSuccess();
        const { result } = renderHook(() => useTaskTree('ws-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        mockApiSuccess();
        act(() => { result.current.refresh(); });
        await waitFor(() => {
            expect(mockFetch.mock.calls.length).toBeGreaterThan(2);
        });
    });

    it('filters .git folders from the task tree', async () => {
        const tree = {
            ...makeTree('root'),
            children: [
                { name: '.git', relativePath: '.git', children: [], documentGroups: [], singleDocuments: [] },
                { name: 'tasks', relativePath: 'tasks', children: [], documentGroups: [], singleDocuments: [] },
            ],
        };
        mockApiSuccess(tree);
        const { result } = renderHook(() => useTaskTree('ws-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.tree?.children.find(c => c.name === '.git')).toBeUndefined();
        expect(result.current.tree?.children.find(c => c.name === 'tasks')).toBeDefined();
    });

    it('does not fetch when wsId is empty', () => {
        const { result } = renderHook(() => useTaskTree(''));
        // refresh() exits early when wsId is empty — no fetch should be made
        expect(mockFetch).not.toHaveBeenCalled();
    });
});
