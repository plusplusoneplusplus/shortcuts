// @vitest-environment jsdom
/**
 * Tests for useNotesTrees — the per-root lazy tree fetch + session cache that
 * backs the stacked root sections (AC-01/AC-03). A root's tree must only be
 * requested when its section is first expanded, and must survive a
 * collapse/re-expand without a second request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useNotesTrees, notesRootParam } from '../../../../../../src/server/spa/client/react/features/notes/editor/useNotesTrees';

const getTreeMock = vi.fn();

vi.mock('../../../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getTree: (...args: any[]) => getTreeMock(...args),
    },
}));

function treeResponse(rootId: string) {
    return {
        tree: [{ name: rootId, path: rootId, type: 'page' as const }],
        notesRoot: `/notes/${rootId}`,
        systemFolders: ['.system'],
    };
}

beforeEach(() => {
    getTreeMock.mockReset();
    getTreeMock.mockImplementation((_ws: string, root?: string) =>
        Promise.resolve(treeResponse(root ?? 'default')));
});

afterEach(() => {
    cleanup();
});

describe('notesRootParam', () => {
    it('maps the managed root to no root param and passes others through', () => {
        expect(notesRootParam('default')).toBeUndefined();
        expect(notesRootParam('')).toBeUndefined();
        expect(notesRootParam('docs/api')).toBe('docs/api');
    });
});

describe('useNotesTrees', () => {
    it('only fetches roots that are active', async () => {
        const { result } = renderHook(() => useNotesTrees('ws1', ['default']));

        await waitFor(() => expect(result.current.getTree('default').tree).not.toBeNull());

        expect(getTreeMock).toHaveBeenCalledTimes(1);
        expect(getTreeMock).toHaveBeenCalledWith('ws1', undefined);
        expect(result.current.isFetched('docs')).toBe(false);
        expect(result.current.getTree('docs')).toMatchObject({ tree: null, loading: false });
    });

    it('reports a loading placeholder for an active root before its fetch lands', () => {
        getTreeMock.mockImplementation(() => new Promise(() => {}));
        const { result } = renderHook(() => useNotesTrees('ws1', ['default']));

        expect(result.current.getTree('default').loading).toBe(true);
    });

    it('fetches a root the first time it becomes active and caches it after', async () => {
        const { result, rerender } = renderHook(
            ({ active }: { active: string[] }) => useNotesTrees('ws1', active),
            { initialProps: { active: ['default'] } },
        );

        await waitFor(() => expect(result.current.isFetched('default')).toBe(true));
        expect(getTreeMock).toHaveBeenCalledTimes(1);

        // Second section expands — only the new root is requested.
        rerender({ active: ['default', 'docs'] });
        await waitFor(() => expect(result.current.isFetched('docs')).toBe(true));
        expect(getTreeMock).toHaveBeenCalledTimes(2);
        expect(getTreeMock).toHaveBeenLastCalledWith('ws1', 'docs');
        expect(result.current.getTree('docs').tree).toEqual(treeResponse('docs').tree);

        // Collapse then re-expand: the cached tree is reused, no new request.
        rerender({ active: ['default'] });
        expect(result.current.getTree('docs').tree).toEqual(treeResponse('docs').tree);
        rerender({ active: ['default', 'docs'] });
        await Promise.resolve();
        expect(getTreeMock).toHaveBeenCalledTimes(2);
    });

    it('exposes each root tree independently', async () => {
        const { result } = renderHook(() => useNotesTrees('ws1', ['default', 'docs']));

        await waitFor(() => {
            expect(result.current.isFetched('default')).toBe(true);
            expect(result.current.isFetched('docs')).toBe(true);
        });

        expect(result.current.getTree('default').notesRoot).toBe('/notes/default');
        expect(result.current.getTree('docs').notesRoot).toBe('/notes/docs');
        expect(Object.keys(result.current.trees).sort()).toEqual(['default', 'docs']);
    });

    it('records a per-root error without disturbing sibling roots', async () => {
        getTreeMock.mockImplementation((_ws: string, root?: string) =>
            root === 'docs'
                ? Promise.reject(new Error('boom'))
                : Promise.resolve(treeResponse(root ?? 'default')));

        const { result } = renderHook(() => useNotesTrees('ws1', ['default', 'docs']));

        await waitFor(() => expect(result.current.getTree('docs').error).toBe('boom'));
        expect(result.current.getTree('docs').loading).toBe(false);
        expect(result.current.getTree('default').tree).not.toBeNull();
        expect(result.current.getTree('default').error).toBeNull();
    });

    it('refreshes only roots already fetched', async () => {
        const { result } = renderHook(() => useNotesTrees('ws1', ['default']));
        await waitFor(() => expect(result.current.isFetched('default')).toBe(true));

        await act(async () => { await result.current.refresh('docs'); });
        expect(getTreeMock).toHaveBeenCalledTimes(1);

        await act(async () => { await result.current.refresh('default'); });
        expect(getTreeMock).toHaveBeenCalledTimes(2);
    });

    it('refreshes every fetched root on a notes-changed event for this workspace', async () => {
        const { result } = renderHook(() => useNotesTrees('ws1', ['default', 'docs']));
        await waitFor(() => expect(getTreeMock).toHaveBeenCalledTimes(2));

        await act(async () => {
            window.dispatchEvent(new CustomEvent('notes-changed', { detail: { wsId: 'other' } }));
        });
        expect(getTreeMock).toHaveBeenCalledTimes(2);

        await act(async () => {
            window.dispatchEvent(new CustomEvent('notes-changed', { detail: { wsId: 'ws1' } }));
        });
        await waitFor(() => expect(getTreeMock).toHaveBeenCalledTimes(4));
        expect(result.current.getTree('docs').tree).not.toBeNull();
    });

    it('drops the cache when the workspace changes', async () => {
        const { result, rerender } = renderHook(
            ({ ws }: { ws: string }) => useNotesTrees(ws, ['default']),
            { initialProps: { ws: 'ws1' } },
        );
        await waitFor(() => expect(result.current.isFetched('default')).toBe(true));

        rerender({ ws: 'ws2' });
        expect(result.current.getTree('default').tree).toBeNull();
        await waitFor(() => expect(getTreeMock).toHaveBeenLastCalledWith('ws2', undefined));
        await waitFor(() => expect(result.current.isFetched('default')).toBe(true));
    });

    it('ignores a stale response that lands after a newer request', async () => {
        const resolvers: Array<(value: any) => void> = [];
        getTreeMock.mockImplementation(() => new Promise(resolve => { resolvers.push(resolve); }));

        const { result } = renderHook(() => useNotesTrees('ws1', ['default']));
        await waitFor(() => expect(resolvers.length).toBe(1));

        await act(async () => { void result.current.refresh('default'); });
        await waitFor(() => expect(resolvers.length).toBe(2));

        await act(async () => {
            resolvers[1]({ tree: [{ name: 'fresh', path: 'fresh', type: 'page' }], notesRoot: '/fresh', systemFolders: [] });
            resolvers[0]({ tree: [{ name: 'stale', path: 'stale', type: 'page' }], notesRoot: '/stale', systemFolders: [] });
        });

        expect(result.current.getTree('default').notesRoot).toBe('/fresh');
    });
});
