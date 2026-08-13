// @vitest-environment jsdom
/**
 * Tests for useNotesRootMutations — create/rename/delete/reorder with the root
 * passed per call, so each stacked section mutates its own root and refreshes
 * only that root's tree.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useNotesRootMutations } from '../../../../../../src/server/spa/client/react/features/notes/editor/useNotesRootMutations';

const createNodeMock = vi.fn();
const renameNodeMock = vi.fn();
const deleteNodeMock = vi.fn();
const reorderMock = vi.fn();

vi.mock('../../../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        createNode: (...args: any[]) => createNodeMock(...args),
        renameNode: (...args: any[]) => renameNodeMock(...args),
        deleteNode: (...args: any[]) => deleteNodeMock(...args),
        reorder: (...args: any[]) => reorderMock(...args),
    },
}));

let refresh: ReturnType<typeof vi.fn>;

function setup(workspaceId = 'ws1') {
    refresh = vi.fn().mockResolvedValue(undefined);
    return renderHook(() => useNotesRootMutations(workspaceId, refresh));
}

beforeEach(() => {
    createNodeMock.mockReset().mockResolvedValue({ path: 'Inbox/new.md' });
    renameNodeMock.mockReset().mockResolvedValue({ oldPath: 'a.md', newPath: 'b.md' });
    deleteNodeMock.mockReset().mockResolvedValue(undefined);
    reorderMock.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
    cleanup();
});

describe('useNotesRootMutations', () => {
    it('creates a node under the given root and refreshes only that root', async () => {
        const { result } = setup();

        const created = await result.current.createNode('docs', 'Guides', 'intro.md', 'page');

        expect(createNodeMock).toHaveBeenCalledWith('ws1', 'Guides/intro.md', 'page', 'docs');
        expect(created).toEqual({ path: 'Inbox/new.md' });
        expect(refresh.mock.calls).toEqual([['docs']]);
    });

    it('creates at the tree root when parentPath is empty', async () => {
        const { result } = setup();

        await result.current.createNode('docs', '', 'Notebook', 'notebook');

        expect(createNodeMock).toHaveBeenCalledWith('ws1', 'Notebook', 'notebook', 'docs');
    });

    it('maps the managed root to no root param', async () => {
        const { result } = setup();

        await result.current.createNode('default', '', 'Notebook', 'notebook');
        await result.current.renameNode('default', 'a.md', 'b.md');
        await result.current.deleteNode('default', 'a.md');
        await result.current.reorderNodes('default', '', ['b', 'a']);

        expect(createNodeMock).toHaveBeenCalledWith('ws1', 'Notebook', 'notebook', undefined);
        expect(renameNodeMock).toHaveBeenCalledWith('ws1', 'a.md', 'b.md', undefined);
        expect(deleteNodeMock).toHaveBeenCalledWith('ws1', 'a.md', undefined);
        expect(reorderMock).toHaveBeenCalledWith('ws1', '', ['b', 'a'], undefined);
        expect(refresh.mock.calls).toEqual([['default'], ['default'], ['default'], ['default']]);
    });

    it('renames within a root and returns the server paths', async () => {
        const { result } = setup();

        const renamed = await result.current.renameNode('docs', 'a.md', 'b.md');

        expect(renameNodeMock).toHaveBeenCalledWith('ws1', 'a.md', 'b.md', 'docs');
        expect(renamed).toEqual({ oldPath: 'a.md', newPath: 'b.md' });
        expect(refresh.mock.calls).toEqual([['docs']]);
    });

    it('deletes and reorders within the given root', async () => {
        const { result } = setup();

        await result.current.deleteNode('docs', 'Guides/intro.md');
        await result.current.reorderNodes('other', 'Guides', ['b.md', 'a.md']);

        expect(deleteNodeMock).toHaveBeenCalledWith('ws1', 'Guides/intro.md', 'docs');
        expect(reorderMock).toHaveBeenCalledWith('ws1', 'Guides', ['b.md', 'a.md'], 'other');
        expect(refresh.mock.calls).toEqual([['docs'], ['other']]);
    });

    it('does not refresh when the request fails', async () => {
        const { result } = setup();
        renameNodeMock.mockRejectedValue(new Error('nope'));

        await expect(result.current.renameNode('docs', 'a.md', 'b.md')).rejects.toThrow('nope');
        expect(refresh).not.toHaveBeenCalled();
    });

    it('keeps a stable handle set across renders', () => {
        const { result, rerender } = setup();
        const first = result.current;

        rerender();

        expect(result.current).toBe(first);
    });
});
