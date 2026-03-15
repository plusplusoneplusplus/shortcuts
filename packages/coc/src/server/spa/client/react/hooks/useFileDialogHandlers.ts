/**
 * useFileDialogHandlers — encapsulates all file-level dialog state, context-menu
 * state, and CRUD handlers for the Tasks panel.
 */

import { useCallback, useEffect, useState } from 'react';
import { isTaskDocument } from './useTaskTree';
import type { TaskDocument, TaskDocumentGroup } from './useTaskTree';
import type { FileActionsResult } from './useFileActions';

export interface FileCtxInfo {
    item: TaskDocument | TaskDocumentGroup;
    /** All file paths — multiple for document groups. */
    paths: string[];
    /** Path used for rename (server detects and renames whole group). */
    renamePath: string;
    displayName: string;
    isArchived: boolean;
}

export interface FileCtxMenu { ctxItem: FileCtxInfo; x: number; y: number }

type FileDialogAction = 'rename' | 'delete' | null;
type AiDialogType = 'follow-prompt' | 'update-document' | null;

interface Options {
    fileActions: FileActionsResult;
    refresh: () => void;
    addToast: (msg: string, type: 'error' | 'success') => void;
    onSearchClear: () => void;
}

export function useFileDialogHandlers({ fileActions, refresh, addToast, onSearchClear }: Options) {
    const [fileCtxMenu, setFileCtxMenu] = useState<FileCtxMenu | null>(null);
    const [navigateToFilePath, setNavigateToFilePath] = useState<string | null>(null);

    const [fileDialog, setFileDialog] = useState<{
        action: FileDialogAction;
        ctxItem: FileCtxInfo | null;
        submitting: boolean;
    }>({ action: null, ctxItem: null, submitting: false });

    const [fileMoveDialogOpen, setFileMoveDialogOpen] = useState(false);
    const [fileMoveCtxItem, setFileMoveCtxItem] = useState<FileCtxInfo | null>(null);

    const [aiDialogTarget, setAiDialogTarget] = useState<{ path: string; name: string } | null>(null);
    const [aiDialogType, setAiDialogType] = useState<AiDialogType>(null);

    const closeAiDialog = useCallback(() => { setAiDialogType(null); setAiDialogTarget(null); }, []);

    const closeFileDialog = useCallback(
        () => setFileDialog({ action: null, ctxItem: null, submitting: false }),
        []
    );

    // Listen for external "reveal in panel" requests (e.g. from file preview tooltip goto button).
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.filePath) {
                onSearchClear();
                setNavigateToFilePath(detail.filePath);
            }
        };
        window.addEventListener('coc-reveal-in-panel', handler);
        return () => window.removeEventListener('coc-reveal-in-panel', handler);
    }, [onSearchClear]);

    function buildFileCtxInfo(item: TaskDocument | TaskDocumentGroup): FileCtxInfo {
        if (isTaskDocument(item)) {
            const rel = item.relativePath || '';
            const p = rel ? `${rel}/${item.fileName}` : item.fileName;
            return { item, paths: [p], renamePath: p, displayName: item.baseName, isArchived: item.isArchived };
        }
        // TaskDocumentGroup
        const paths = item.documents.map(doc => {
            const rel = doc.relativePath || '';
            return rel ? `${rel}/${doc.fileName}` : doc.fileName;
        });
        return {
            item,
            paths,
            renamePath: paths[0] ?? '',
            displayName: item.baseName,
            isArchived: item.isArchived,
        };
    }

    const handleFileContextMenu = useCallback(
        (item: TaskDocument | TaskDocumentGroup, x: number, y: number) => {
            setFileCtxMenu({ ctxItem: buildFileCtxInfo(item), x, y });
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        []
    );

    const handleFileRename = useCallback(async (newName: string) => {
        if (!fileDialog.ctxItem) return;
        setFileDialog(s => ({ ...s, submitting: true }));
        try {
            await fileActions.renameFile(fileDialog.ctxItem.renamePath, newName);
            refresh();
            closeFileDialog();
        } catch (err: any) {
            addToast(err.message || 'Rename failed', 'error');
            setFileDialog(s => ({ ...s, submitting: false }));
        }
    }, [fileDialog.ctxItem, fileActions, refresh, closeFileDialog, addToast]);

    const handleFileDelete = useCallback(async () => {
        if (!fileDialog.ctxItem) return;
        setFileDialog(s => ({ ...s, submitting: true }));
        try {
            for (const p of fileDialog.ctxItem.paths) {
                await fileActions.deleteFile(p);
            }
            refresh();
            closeFileDialog();
        } catch (err: any) {
            addToast(err.message || 'Delete failed', 'error');
            setFileDialog(s => ({ ...s, submitting: false }));
        }
    }, [fileDialog.ctxItem, fileActions, refresh, closeFileDialog, addToast]);

    const handleFileMoveConfirm = useCallback(async (destinationRelativePath: string) => {
        if (!fileMoveCtxItem) return;
        for (const p of fileMoveCtxItem.paths) {
            await fileActions.moveFile(p, destinationRelativePath);
        }
        refresh();
        setFileMoveDialogOpen(false);
        setFileMoveCtxItem(null);
    }, [fileMoveCtxItem, fileActions, refresh]);

    return {
        // context-menu state
        fileCtxMenu, setFileCtxMenu,
        // navigation state
        navigateToFilePath, setNavigateToFilePath,
        // file dialog state
        fileDialog, setFileDialog, closeFileDialog,
        // move dialog state
        fileMoveDialogOpen, setFileMoveDialogOpen,
        fileMoveCtxItem, setFileMoveCtxItem,
        // AI dialog state
        aiDialogTarget, setAiDialogTarget,
        aiDialogType, setAiDialogType,
        closeAiDialog,
        // handlers
        handleFileContextMenu,
        handleFileRename,
        handleFileDelete,
        handleFileMoveConfirm,
    };
}
