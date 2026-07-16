import { useState, useEffect, useCallback, useRef } from 'react';
import {
    notesApi,
    type CreateNoteNodeResponse,
    type NoteTreeNode,
    type RenameNoteNodeResponse,
} from '../notesApi';

export interface UseNotesTreeResult {
    tree: NoteTreeNode[] | null;
    notesRoot: string | null;
    systemFolders: string[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    createNode: (parentPath: string, name: string, type: 'notebook' | 'section' | 'page') => Promise<CreateNoteNodeResponse>;
    renameNode: (oldPath: string, newPath: string) => Promise<RenameNoteNodeResponse>;
    deleteNode: (path: string) => Promise<void>;
    reorderNodes: (parentPath: string, order: string[]) => Promise<void>;
}

interface NotesTreeState {
    scopeKey: string;
    tree: NoteTreeNode[] | null;
    notesRoot: string | null;
    systemFolders: string[];
    loading: boolean;
    error: string | null;
}

function emptyTreeState(scopeKey: string): NotesTreeState {
    return {
        scopeKey,
        tree: null,
        notesRoot: null,
        systemFolders: [],
        loading: true,
        error: null,
    };
}

export function useNotesTree(workspaceId: string, root?: string): UseNotesTreeResult {
    const scopeKey = `${workspaceId}\0${root ?? ''}`;
    const [state, setState] = useState<NotesTreeState>(() => emptyTreeState(scopeKey));
    const requestGenerationRef = useRef(0);
    const activeScopeRef = useRef(scopeKey);
    activeScopeRef.current = scopeKey;
    const visibleState = state.scopeKey === scopeKey ? state : emptyTreeState(scopeKey);

    const fetchTree = useCallback(async () => {
        if (activeScopeRef.current !== scopeKey) {
            return;
        }
        const requestGeneration = ++requestGenerationRef.current;
        setState(prev => prev.scopeKey === scopeKey
            ? { ...prev, loading: true, error: null }
            : emptyTreeState(scopeKey));
        try {
            const data = await notesApi.getTree(workspaceId, root);
            if (requestGeneration !== requestGenerationRef.current || activeScopeRef.current !== scopeKey) {
                return;
            }
            setState({
                scopeKey,
                tree: data.tree,
                notesRoot: data.notesRoot,
                systemFolders: data.systemFolders ?? [],
                loading: false,
                error: null,
            });
        } catch (err: any) {
            if (requestGeneration !== requestGenerationRef.current || activeScopeRef.current !== scopeKey) {
                return;
            }
            setState({
                ...emptyTreeState(scopeKey),
                loading: false,
                error: err.message ?? 'Failed to load notes tree',
            });
        }
    }, [scopeKey, workspaceId, root]);

    useEffect(() => {
        void fetchTree();
        return () => {
            requestGenerationRef.current += 1;
        };
    }, [fetchTree]);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { wsId?: string } | undefined;
            if (detail?.wsId !== workspaceId) {
                return;
            }
            void fetchTree();
        };
        window.addEventListener('notes-changed', handler);
        return () => window.removeEventListener('notes-changed', handler);
    }, [workspaceId, fetchTree]);

    const createNode = useCallback(async (parentPath: string, name: string, type: 'notebook' | 'section' | 'page') => {
        const nodePath = parentPath ? `${parentPath}/${name}` : name;
        const created = await notesApi.createNode(workspaceId, nodePath, type, root);
        await fetchTree();
        return created;
    }, [workspaceId, root, fetchTree]);

    const renameNode = useCallback(async (oldPath: string, newPath: string) => {
        const renamed = await notesApi.renameNode(workspaceId, oldPath, newPath, root);
        await fetchTree();
        return renamed;
    }, [workspaceId, root, fetchTree]);

    const deleteNode = useCallback(async (path: string) => {
        await notesApi.deleteNode(workspaceId, path, root);
        await fetchTree();
    }, [workspaceId, root, fetchTree]);

    const reorderNodes = useCallback(async (parentPath: string, order: string[]) => {
        await notesApi.reorder(workspaceId, parentPath, order, root);
        await fetchTree();
    }, [workspaceId, root, fetchTree]);

    return {
        tree: visibleState.tree,
        notesRoot: visibleState.notesRoot,
        systemFolders: visibleState.systemFolders,
        loading: visibleState.loading,
        error: visibleState.error,
        refresh: fetchTree,
        createNode,
        renameNode,
        deleteNode,
        reorderNodes,
    };
}
