import { useState, useEffect, useCallback } from 'react';
import { notesApi, type NoteTreeNode } from '../notesApi';

export interface UseNotesTreeResult {
    tree: NoteTreeNode[] | null;
    notesRoot: string | null;
    systemFolders: string[];
    loading: boolean;
    error: string | null;
    refresh: () => void;
    createNode: (parentPath: string, name: string, type: 'notebook' | 'section' | 'page') => Promise<void>;
    renameNode: (oldPath: string, newPath: string) => Promise<void>;
    deleteNode: (path: string) => Promise<void>;
    reorderNodes: (parentPath: string, order: string[]) => Promise<void>;
}

export function useNotesTree(workspaceId: string, root?: string): UseNotesTreeResult {
    const [tree, setTree] = useState<NoteTreeNode[] | null>(null);
    const [notesRoot, setNotesRoot] = useState<string | null>(null);
    const [systemFolders, setSystemFolders] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchTree = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await notesApi.getTree(workspaceId, root);
            setTree(data.tree);
            setNotesRoot(data.notesRoot);
            setSystemFolders(data.systemFolders ?? []);
        } catch (err: any) {
            setError(err.message ?? 'Failed to load notes tree');
        } finally {
            setLoading(false);
        }
    }, [workspaceId, root]);

    useEffect(() => {
        fetchTree();
    }, [fetchTree]);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { wsId?: string } | undefined;
            if (detail?.wsId !== workspaceId) return;
            void fetchTree();
        };
        window.addEventListener('notes-changed', handler);
        return () => window.removeEventListener('notes-changed', handler);
    }, [workspaceId, fetchTree]);

    const createNode = useCallback(async (parentPath: string, name: string, type: 'notebook' | 'section' | 'page') => {
        const nodePath = parentPath ? `${parentPath}/${name}` : name;
        await notesApi.createNode(workspaceId, nodePath, type, root);
        await fetchTree();
    }, [workspaceId, root, fetchTree]);

    const renameNode = useCallback(async (oldPath: string, newPath: string) => {
        await notesApi.renameNode(workspaceId, oldPath, newPath, root);
        await fetchTree();
    }, [workspaceId, root, fetchTree]);

    const deleteNode = useCallback(async (path: string) => {
        await notesApi.deleteNode(workspaceId, path, root);
        await fetchTree();
    }, [workspaceId, root, fetchTree]);

    const reorderNodes = useCallback(async (parentPath: string, order: string[]) => {
        await notesApi.reorder(workspaceId, parentPath, order, root);
        await fetchTree();
    }, [workspaceId, root, fetchTree]);

    return { tree, notesRoot, systemFolders, loading, error, refresh: fetchTree, createNode, renameNode, deleteNode, reorderNodes };
}
