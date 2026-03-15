/**
 * useFolderDialogHandlers — encapsulates all folder-level dialog state, context-menu
 * state, and CRUD handlers for the Tasks panel.
 */

import { useCallback, useState } from 'react';
import type { TaskFolder } from './useTaskTree';
import type { FolderActionsResult } from './useFolderActions';
import type { FileActionsResult } from './useFileActions';
import type { DragItem } from './useTaskDragDrop';

export interface FolderCtxMenu {
    folder: TaskFolder;
    x: number;
    y: number;
    source: 'folder-row' | 'empty-space';
}

export type FolderDialogAction = 'rename' | 'create-subfolder' | 'create-task' | 'delete' | 'follow-prompt' | null;

interface Options {
    folderActions: FolderActionsResult;
    fileActions: FileActionsResult;
    refresh: () => void;
    addToast: (msg: string, type: 'error' | 'success') => void;
    onOpenGenerateDialog?: (targetFolder?: string) => void;
}

export function useFolderDialogHandlers({ folderActions, fileActions, refresh, addToast, onOpenGenerateDialog }: Options) {
    const [folderCtxMenu, setFolderCtxMenu] = useState<FolderCtxMenu | null>(null);

    const [folderDialog, setFolderDialog] = useState<{
        action: FolderDialogAction;
        folder: TaskFolder | null;
        submitting: boolean;
    }>({ action: null, folder: null, submitting: false });

    const [moveDialogOpen, setMoveDialogOpen] = useState(false);
    const [moveSourceFolder, setMoveSourceFolder] = useState<TaskFolder | null>(null);

    const closeFolderDialog = useCallback(
        () => setFolderDialog({ action: null, folder: null, submitting: false }),
        []
    );

    const handleFolderContextMenu = useCallback(
        (folder: TaskFolder, x: number, y: number) => setFolderCtxMenu({ folder, x, y, source: 'folder-row' }),
        []
    );

    const handleFolderEmptySpaceContextMenu = useCallback(
        (folder: TaskFolder, x: number, y: number) => setFolderCtxMenu({ folder, x, y, source: 'empty-space' }),
        []
    );

    const handleFolderContextMenuAction = useCallback(
        (actionKey: string, folder: TaskFolder) => {
            setFolderCtxMenu(null);
            if (actionKey === 'rename') setFolderDialog({ action: 'rename', folder, submitting: false });
            if (actionKey === 'create-subfolder') setFolderDialog({ action: 'create-subfolder', folder, submitting: false });
            if (actionKey === 'create-task') setFolderDialog({ action: 'create-task', folder, submitting: false });
            if (actionKey === 'delete') setFolderDialog({ action: 'delete', folder, submitting: false });
            if (actionKey === 'follow-prompt') setFolderDialog({ action: 'follow-prompt', folder, submitting: false });
            if (actionKey === 'generate-task-ai') {
                onOpenGenerateDialog?.(folder.relativePath || folder.name);
            }
            if (actionKey === 'move') {
                setMoveSourceFolder(folder);
                setMoveDialogOpen(true);
            }
        },
        [onOpenGenerateDialog]
    );

    const handleRename = useCallback(async (newName: string) => {
        if (!folderDialog.folder) return;
        setFolderDialog(s => ({ ...s, submitting: true }));
        try {
            await folderActions.renameFolder(folderDialog.folder.relativePath, newName);
            refresh();
            closeFolderDialog();
        } catch (err: any) {
            addToast(err.message || 'Rename failed', 'error');
            setFolderDialog(s => ({ ...s, submitting: false }));
        }
    }, [folderDialog.folder, folderActions, refresh, closeFolderDialog, addToast]);

    const handleCreateSubfolder = useCallback(async (name: string) => {
        if (!folderDialog.folder) return;
        setFolderDialog(s => ({ ...s, submitting: true }));
        try {
            await folderActions.createSubfolder(folderDialog.folder.relativePath, name);
            refresh();
            closeFolderDialog();
        } catch (err: any) {
            addToast(err.message || 'Create subfolder failed', 'error');
            setFolderDialog(s => ({ ...s, submitting: false }));
        }
    }, [folderDialog.folder, folderActions, refresh, closeFolderDialog, addToast]);

    const handleCreateTask = useCallback(async (taskName: string, docType?: string) => {
        if (!folderDialog.folder) return;
        setFolderDialog(s => ({ ...s, submitting: true }));
        try {
            await folderActions.createTask(folderDialog.folder.relativePath ?? '', taskName, docType);
            refresh();
            closeFolderDialog();
        } catch (err: any) {
            addToast(err.message || 'Create task failed', 'error');
            setFolderDialog(s => ({ ...s, submitting: false }));
        }
    }, [folderDialog.folder, folderActions, refresh, closeFolderDialog, addToast]);

    const handleDelete = useCallback(async () => {
        if (!folderDialog.folder) return;
        setFolderDialog(s => ({ ...s, submitting: true }));
        try {
            await folderActions.deleteFolder(folderDialog.folder.relativePath);
            refresh();
            closeFolderDialog();
        } catch (err: any) {
            addToast(err.message || 'Delete failed', 'error');
            setFolderDialog(s => ({ ...s, submitting: false }));
        }
    }, [folderDialog.folder, folderActions, refresh, closeFolderDialog, addToast]);

    const handleMoveConfirm = useCallback(async (destinationRelativePath: string) => {
        if (!moveSourceFolder) return;
        await folderActions.moveFolder(moveSourceFolder.relativePath, destinationRelativePath);
        refresh();
        setMoveDialogOpen(false);
        setMoveSourceFolder(null);
    }, [moveSourceFolder, folderActions, refresh]);

    const handleDragDrop = useCallback(async (items: DragItem[], targetFolderPath: string) => {
        try {
            for (const item of items) {
                if (item.type === 'folder') {
                    await folderActions.moveFolder(item.path, targetFolderPath);
                } else {
                    await fileActions.moveFile(item.path, targetFolderPath);
                }
            }
            refresh();
        } catch (err: any) {
            addToast(err.message || 'Move failed', 'error');
        }
    }, [folderActions, fileActions, refresh, addToast]);

    return {
        // context-menu state
        folderCtxMenu, setFolderCtxMenu,
        // dialog state
        folderDialog, setFolderDialog, closeFolderDialog,
        // move dialog state
        moveDialogOpen, setMoveDialogOpen,
        moveSourceFolder, setMoveSourceFolder,
        // handlers
        handleFolderContextMenu,
        handleFolderEmptySpaceContextMenu,
        handleFolderContextMenuAction,
        handleRename,
        handleCreateSubfolder,
        handleCreateTask,
        handleDelete,
        handleMoveConfirm,
        handleDragDrop,
    };
}
