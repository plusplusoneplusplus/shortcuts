import { useCallback, useMemo } from 'react';
import {
    notesApi,
    type CreateNoteNodeResponse,
    type RenameNoteNodeResponse,
} from '../notesApi';
import { notesRootParam } from './useNotesTrees';

/**
 * The same create/rename/delete/reorder operations `useNotesTree` exposes, but
 * with the root passed per call instead of baked into the hook. Stacked
 * sections each act on their own root, so a single-root-bound mutation set no
 * longer works.
 */
export interface NotesRootMutations {
    createNode: (rootId: string, parentPath: string, name: string, type: 'notebook' | 'section' | 'page') => Promise<CreateNoteNodeResponse>;
    renameNode: (rootId: string, oldPath: string, newPath: string) => Promise<RenameNoteNodeResponse>;
    deleteNode: (rootId: string, path: string) => Promise<void>;
    reorderNodes: (rootId: string, parentPath: string, order: string[]) => Promise<void>;
}

/**
 * Root-parameterized notes mutations.
 *
 * Each call targets one root and re-fetches only that root afterwards via
 * `refresh` (normally `useNotesTrees().refresh`), matching `useNotesTree`'s
 * mutate-then-refetch semantics. A failed request rejects without refreshing,
 * exactly as before.
 */
export function useNotesRootMutations(
    workspaceId: string,
    refresh: (rootId: string) => Promise<void>,
): NotesRootMutations {
    const createNode = useCallback(async (
        rootId: string,
        parentPath: string,
        name: string,
        type: 'notebook' | 'section' | 'page',
    ) => {
        const nodePath = parentPath ? `${parentPath}/${name}` : name;
        const created = await notesApi.createNode(workspaceId, nodePath, type, notesRootParam(rootId));
        await refresh(rootId);
        return created;
    }, [workspaceId, refresh]);

    const renameNode = useCallback(async (rootId: string, oldPath: string, newPath: string) => {
        const renamed = await notesApi.renameNode(workspaceId, oldPath, newPath, notesRootParam(rootId));
        await refresh(rootId);
        return renamed;
    }, [workspaceId, refresh]);

    const deleteNode = useCallback(async (rootId: string, path: string) => {
        await notesApi.deleteNode(workspaceId, path, notesRootParam(rootId));
        await refresh(rootId);
    }, [workspaceId, refresh]);

    const reorderNodes = useCallback(async (rootId: string, parentPath: string, order: string[]) => {
        await notesApi.reorder(workspaceId, parentPath, order, notesRootParam(rootId));
        await refresh(rootId);
    }, [workspaceId, refresh]);

    return useMemo(
        () => ({ createNode, renameNode, deleteNode, reorderNodes }),
        [createNode, renameNode, deleteNode, reorderNodes],
    );
}
