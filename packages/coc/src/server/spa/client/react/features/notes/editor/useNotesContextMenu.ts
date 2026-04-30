import { useState, useCallback } from 'react';
import type { NoteTreeNode } from '../notesApi';

export type NoteDialogAction = 'create-page' | 'create-section' | 'create-notebook' | 'create-page-ai' | 'rename' | 'delete';

export interface NoteCtxMenu {
    node: NoteTreeNode;
    x: number;
    y: number;
}

export interface NoteDialog {
    action: NoteDialogAction;
    node: NoteTreeNode;
    submitting: boolean;
}

export interface UseNotesContextMenuResult {
    ctxMenu: NoteCtxMenu | null;
    dialog: NoteDialog | null;
    openContextMenu: (node: NoteTreeNode, x: number, y: number) => void;
    closeContextMenu: () => void;
    openDialog: (action: NoteDialogAction, node: NoteTreeNode) => void;
    closeDialog: () => void;
    setSubmitting: (submitting: boolean) => void;
}

export function useNotesContextMenu(): UseNotesContextMenuResult {
    const [ctxMenu, setCtxMenu] = useState<NoteCtxMenu | null>(null);
    const [dialog, setDialog] = useState<NoteDialog | null>(null);

    const openContextMenu = useCallback((node: NoteTreeNode, x: number, y: number) => {
        setCtxMenu({ node, x, y });
    }, []);

    const closeContextMenu = useCallback(() => {
        setCtxMenu(null);
    }, []);

    const openDialog = useCallback((action: NoteDialogAction, node: NoteTreeNode) => {
        setCtxMenu(null);
        setDialog({ action, node, submitting: false });
    }, []);

    const closeDialog = useCallback(() => {
        setDialog(null);
    }, []);

    const setSubmitting = useCallback((submitting: boolean) => {
        setDialog(prev => prev ? { ...prev, submitting } : null);
    }, []);

    return { ctxMenu, dialog, openContextMenu, closeContextMenu, openDialog, closeDialog, setSubmitting };
}
