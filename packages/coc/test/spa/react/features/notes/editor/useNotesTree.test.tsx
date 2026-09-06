// @vitest-environment jsdom
/**
 * Tests for useNotesTree — the single-root tree fetch behind the classic notes
 * sidebar. The regression these guard is the sidebar blanking on every
 * refresh: a refetch must keep the previously loaded tree for its whole
 * in-flight window, and a failed refetch must not wipe it.
 *
 * `notesApi.getTree` is injected as a deferred promise so the in-flight window
 * is held open deterministically rather than raced against a real fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useNotesTree } from '../../../../../../src/server/spa/client/react/features/notes/editor/useNotesTree';

const getTreeMock = vi.fn();

vi.mock('../../../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getTree: (...args: any[]) => getTreeMock(...args),
        createNode: vi.fn(),
        renameNode: vi.fn(),
        deleteNode: vi.fn(),
        reorder: vi.fn(),
    },
}));

function treeResponse(name: string) {
    return {
        tree: [{ name, path: name, type: 'page' as const }],
        notesRoot: `/notes/${name}`,
        systemFolders: ['.system'],
    };
}

/** A `getTree` mock whose every call is settled by the test on demand. */
function deferredGetTree() {
    const calls: Array<{ resolve: (v: any) => void; reject: (e: any) => void }> = [];
    getTreeMock.mockImplementation(() => new Promise((resolve, reject) => {
        calls.push({ resolve, reject });
    }));
    return calls;
}

beforeEach(() => {
    getTreeMock.mockReset();
});

afterEach(() => {
    cleanup();
});

describe('useNotesTree', () => {
    it('reports loading with no tree on the very first load', async () => {
        const calls = deferredGetTree();
        const { result } = renderHook(() => useNotesTree('ws1'));

        await waitFor(() => expect(calls.length).toBe(1));
        expect(result.current.loading).toBe(true);
        expect(result.current.tree).toBeNull();

        await act(async () => { calls[0].resolve(treeResponse('Alpha')); });
        expect(result.current.loading).toBe(false);
        expect(result.current.tree).toEqual(treeResponse('Alpha').tree);
    });

    it('keeps the old tree for the whole refresh window, then swaps in the new one', async () => {
        const calls = deferredGetTree();
        const { result } = renderHook(() => useNotesTree('ws1'));

        await waitFor(() => expect(calls.length).toBe(1));
        await act(async () => { calls[0].resolve(treeResponse('Alpha')); });

        await act(async () => { void result.current.refresh(); });
        await waitFor(() => expect(calls.length).toBe(2));

        expect(result.current.loading).toBe(true);
        expect(result.current.tree).toEqual(treeResponse('Alpha').tree);
        expect(result.current.notesRoot).toBe('/notes/Alpha');

        await act(async () => { calls[1].resolve(treeResponse('Beta')); });
        expect(result.current.tree).toEqual(treeResponse('Beta').tree);
        expect(result.current.loading).toBe(false);
    });

    it('keeps the previous tree when a refresh rejects and only records the error', async () => {
        const calls = deferredGetTree();
        const { result } = renderHook(() => useNotesTree('ws1'));

        await waitFor(() => expect(calls.length).toBe(1));
        await act(async () => { calls[0].resolve(treeResponse('Alpha')); });

        await act(async () => { void result.current.refresh(); });
        await waitFor(() => expect(calls.length).toBe(2));
        await act(async () => { calls[1].reject(new Error('offline')); });

        expect(result.current.error).toBe('offline');
        expect(result.current.loading).toBe(false);
        expect(result.current.tree).toEqual(treeResponse('Alpha').tree);
        expect(result.current.systemFolders).toEqual(['.system']);
    });

    it('leaves a first-load failure with no tree so the error state still shows', async () => {
        const calls = deferredGetTree();
        const { result } = renderHook(() => useNotesTree('ws1'));

        await waitFor(() => expect(calls.length).toBe(1));
        await act(async () => { calls[0].reject(new Error('boom')); });

        expect(result.current.error).toBe('boom');
        expect(result.current.loading).toBe(false);
        expect(result.current.tree).toBeNull();
    });

    it('refreshes on a notes-changed event for this workspace without dropping the tree', async () => {
        const calls = deferredGetTree();
        const { result } = renderHook(() => useNotesTree('ws1'));

        await waitFor(() => expect(calls.length).toBe(1));
        await act(async () => { calls[0].resolve(treeResponse('Alpha')); });

        await act(async () => {
            window.dispatchEvent(new CustomEvent('notes-changed', { detail: { wsId: 'other' } }));
        });
        expect(calls.length).toBe(1);

        await act(async () => {
            window.dispatchEvent(new CustomEvent('notes-changed', { detail: { wsId: 'ws1' } }));
        });
        await waitFor(() => expect(calls.length).toBe(2));
        expect(result.current.tree).toEqual(treeResponse('Alpha').tree);

        await act(async () => { calls[1].resolve(treeResponse('Beta')); });
        expect(result.current.tree).toEqual(treeResponse('Beta').tree);
    });

    it('drops the tree when the workspace changes so no foreign tree flashes', async () => {
        const calls = deferredGetTree();
        const { result, rerender } = renderHook(
            ({ ws }: { ws: string }) => useNotesTree(ws),
            { initialProps: { ws: 'ws1' } },
        );

        await waitFor(() => expect(calls.length).toBe(1));
        await act(async () => { calls[0].resolve(treeResponse('Alpha')); });

        rerender({ ws: 'ws2' });
        expect(result.current.tree).toBeNull();
        expect(result.current.loading).toBe(true);

        await waitFor(() => expect(calls.length).toBe(2));
        await act(async () => { calls[1].resolve(treeResponse('Gamma')); });
        expect(result.current.tree).toEqual(treeResponse('Gamma').tree);
    });
});
