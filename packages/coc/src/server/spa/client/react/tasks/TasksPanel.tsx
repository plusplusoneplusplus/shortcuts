/**
 * TasksPanel — top-level component for the Tasks sub-tab.
 * Renders a two-zone flex layout: left = TaskTree, right = TaskPreview.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { TaskProvider, useTaskPanel } from '../context/TaskContext';
import { useTaskTree, countMarkdownFilesInFolder } from '../hooks/useTaskTree';
import type { TaskFolder } from '../hooks/useTaskTree';
import { useFolderActions } from '../hooks/useFolderActions';
import { useApp } from '../context/AppContext';
import { useQueue } from '../context/QueueContext';
import { useGlobalToast } from '../context/ToastContext';
import { TaskTree } from './TaskTree';
import { TaskPreview } from './TaskPreview';
import { TaskActions } from './TaskActions';
import { ContextMenu } from './comments/ContextMenu';
import type { ContextMenuItem } from './comments/ContextMenu';
import { FolderActionDialog } from './FolderActionDialog';
import { FolderMoveDialog } from './FolderMoveDialog';
import { Dialog } from '../shared/Dialog';
import { Button } from '../shared/Button';
import { FollowPromptDialog } from '../shared/FollowPromptDialog';
import { GenerateTaskDialog } from './GenerateTaskDialog';
import { Spinner } from '../shared';

interface TasksPanelProps {
    wsId: string;
}

export function parseTaskHashParams(hash: string, wsId: string) {
    const parts = hash.replace(/^#/, '').split('/');
    if (parts[0] !== 'repos' || decodeURIComponent(parts[1] || '') !== wsId || parts[2] !== 'tasks')
        return { initialFolderPath: null, initialFilePath: null };
    const taskParts = parts.slice(3).map(p => decodeURIComponent(p)).filter(Boolean);
    if (!taskParts.length) return { initialFolderPath: null, initialFilePath: null };
    const last = taskParts[taskParts.length - 1];
    if (last.endsWith('.md')) {
        return {
            initialFolderPath: taskParts.slice(0, -1).join('/') || null,
            initialFilePath: taskParts.join('/'),
        };
    }
    return { initialFolderPath: taskParts.join('/'), initialFilePath: null };
}

function scrollToEnd(el: HTMLElement | null) {
    if (!el) return;
    requestAnimationFrame(() => {
        const target = el.scrollWidth - el.clientWidth;
        if (typeof el.scrollTo === 'function') {
            el.scrollTo({ left: target, behavior: 'smooth' });
        } else {
            el.scrollLeft = target;
        }
    });
}

function TasksPanelInner({ wsId }: TasksPanelProps) {
    const { tree, commentCounts, loading, error, refresh } = useTaskTree(wsId);
    const { openFilePath, selectedFilePaths, clearSelection, selectedFolderPath } = useTaskPanel();
    const [initialParams] = useState(() => parseTaskHashParams(location.hash, wsId));
    const scrollRef = useRef<HTMLDivElement>(null);
    const [generateDialogOpen, setGenerateDialogOpen] = useState(false);

    const { state: appState } = useApp();
    const { dispatch: queueDispatch } = useQueue();
    const { addToast } = useGlobalToast();
    const folderActions = useFolderActions(wsId);

    // ── Folder context-menu state ──────────────────────────────────────
    interface FolderCtxMenu { folder: TaskFolder; x: number; y: number }
    const [folderCtxMenu, setFolderCtxMenu] = useState<FolderCtxMenu | null>(null);

    const handleFolderContextMenu = useCallback(
        (folder: TaskFolder, x: number, y: number) => setFolderCtxMenu({ folder, x, y }),
        []
    );

    // ── Folder dialog state ────────────────────────────────────────────
    type FolderDialogAction = 'rename' | 'create-subfolder' | 'create-task' | 'delete' | 'follow-prompt' | null;

    const [folderDialog, setFolderDialog] = useState<{
        action: FolderDialogAction;
        folder: TaskFolder | null;
        submitting: boolean;
    }>({ action: null, folder: null, submitting: false });

    // ── Move dialog state ──────────────────────────────────────────────
    const [moveDialogOpen, setMoveDialogOpen] = useState(false);
    const [moveSourceFolder, setMoveSourceFolder] = useState<TaskFolder | null>(null);

    const closeFolderDialog = useCallback(
        () => setFolderDialog({ action: null, folder: null, submitting: false }),
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
            if (actionKey === 'move') {
                setMoveSourceFolder(folder);
                setMoveDialogOpen(true);
            }
        },
        []
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

    const handleCreateTask = useCallback(async (taskName: string) => {
        if (!folderDialog.folder) return;
        setFolderDialog(s => ({ ...s, submitting: true }));
        try {
            await folderActions.createTask(folderDialog.folder.relativePath, taskName);
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

    useEffect(() => {
        scrollToEnd(scrollRef.current);
    }, [openFilePath]);

    const handleColumnsChange = () => {
        scrollToEnd(scrollRef.current);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full gap-2 text-sm text-[#848484]">
                <Spinner /> Loading tasks…
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 text-sm text-[#f14c4c]" data-testid="tasks-error">
                {error}
            </div>
        );
    }

    if (!tree) {
        return (
            <div className="p-4 text-sm text-[#848484]">
                No tasks folder found. Create a <code>.vscode/tasks/</code> directory to get started.
            </div>
        );
    }

    // ── Build folder context-menu items ────────────────────────────────
    const ws = appState.workspaces.find((w: any) => w.id === wsId);
    const folderMenuItems: ContextMenuItem[] = folderCtxMenu ? (() => {
        const folder = folderCtxMenu.folder;
        const folderPath = folder.relativePath || folder.name;
        const isArchived = (folder.relativePath ?? '').startsWith('archive');
        return [
            {
                label: 'Copy Path',
                icon: '📋',
                onClick: () => {
                    navigator.clipboard.writeText(folderPath);
                },
            },
            {
                label: 'Copy Absolute Path',
                icon: '📂',
                onClick: () => {
                    const rootPath = ws?.rootPath ?? '';
                    const tasksFolder = '.vscode/tasks';
                    const abs = [rootPath, tasksFolder, folderPath].filter(Boolean).join('/');
                    navigator.clipboard.writeText(abs);
                },
            },
            {
                label: 'Queue All Tasks',
                icon: '▶',
                disabled: countMarkdownFilesInFolder(folder) === 0,
                onClick: () => {
                    queueDispatch({ type: 'OPEN_DIALOG', folderPath });
                },
            },
            {
                label: isArchived ? 'Unarchive Folder' : 'Archive Folder',
                icon: isArchived ? '📤' : '🗄️',
                onClick: async () => {
                    if (isArchived) {
                        await folderActions.unarchiveFolder(folderPath);
                    } else {
                        await folderActions.archiveFolder(folderPath);
                    }
                    refresh();
                },
            },
            {
                label: 'Rename Folder',
                icon: '✏️',
                onClick: () => handleFolderContextMenuAction('rename', folder),
            },
            {
                label: 'Create Subfolder',
                icon: '📁',
                onClick: () => handleFolderContextMenuAction('create-subfolder', folder),
            },
            {
                label: 'Create Task in Folder',
                icon: '📄',
                onClick: () => handleFolderContextMenuAction('create-task', folder),
            },
            {
                label: 'Delete Folder',
                icon: '🗑️',
                onClick: () => handleFolderContextMenuAction('delete', folder),
            },
            {
                label: 'Move Folder',
                icon: '📦',
                onClick: () => handleFolderContextMenuAction('move', folder),
            },
            {
                label: 'Bulk Follow Prompt',
                icon: '🤖',
                onClick: () => handleFolderContextMenuAction('follow-prompt', folder),
            },
        ];
    })() : [];

    return (
        <div className="flex flex-col h-full">
            <TaskActions
                wsId={wsId}
                openFilePath={openFilePath}
                selectedFilePaths={Array.from(selectedFilePaths)}
                tasksFolderPath=".vscode/tasks"
                selectedFolderPath={selectedFolderPath}
                onClearSelection={clearSelection}
                onGenerateWithAI={() => setGenerateDialogOpen(true)}
            />
            <div
                ref={scrollRef}
                className="flex-1 overflow-x-auto overflow-y-hidden min-h-0 min-w-0"
                data-testid="tasks-miller-scroll-container"
            >
                <div className="flex h-full min-h-0 w-max min-w-full">
                    <div className="flex-shrink-0 h-full min-h-0">
                        <TaskTree
                            tree={tree}
                            commentCounts={commentCounts}
                            wsId={wsId}
                            initialFolderPath={initialParams.initialFolderPath}
                            initialFilePath={initialParams.initialFilePath}
                            onColumnsChange={handleColumnsChange}
                            onFolderContextMenu={handleFolderContextMenu}
                        />
                    </div>

                    {openFilePath && (
                        <div className="h-full min-h-0 min-w-[72rem] w-[72rem] max-w-[72rem] border-r border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <TaskPreview wsId={wsId} filePath={openFilePath} />
                        </div>
                    )}
                </div>
            </div>
            {folderCtxMenu && (
                <ContextMenu
                    position={{ x: folderCtxMenu.x, y: folderCtxMenu.y }}
                    items={folderMenuItems}
                    onClose={() => setFolderCtxMenu(null)}
                />
            )}

            {/* Rename Folder dialog */}
            {folderDialog.action === 'rename' && folderDialog.folder && (
                <FolderActionDialog
                    open
                    title="Rename Folder"
                    label="New name"
                    initialValue={folderDialog.folder.name}
                    placeholder="Enter new folder name"
                    confirmLabel="Rename"
                    submitting={folderDialog.submitting}
                    onClose={closeFolderDialog}
                    onConfirm={handleRename}
                />
            )}

            {/* Create Subfolder dialog */}
            {folderDialog.action === 'create-subfolder' && folderDialog.folder && (
                <FolderActionDialog
                    open
                    title="Create Subfolder"
                    label="Subfolder name"
                    initialValue=""
                    placeholder="Enter subfolder name"
                    confirmLabel="Create"
                    submitting={folderDialog.submitting}
                    onClose={closeFolderDialog}
                    onConfirm={handleCreateSubfolder}
                />
            )}

            {/* Create Task in Folder dialog */}
            {folderDialog.action === 'create-task' && folderDialog.folder && (
                <FolderActionDialog
                    open
                    title="Create Task in Folder"
                    label="Task name"
                    initialValue=""
                    placeholder="Enter task name"
                    confirmLabel="Create"
                    submitting={folderDialog.submitting}
                    onClose={closeFolderDialog}
                    onConfirm={handleCreateTask}
                />
            )}

            {/* Delete Folder confirmation dialog */}
            {folderDialog.action === 'delete' && folderDialog.folder && (
                <Dialog
                    open
                    onClose={closeFolderDialog}
                    title="Delete Folder"
                    footer={
                        <>
                            <Button variant="secondary" onClick={closeFolderDialog}>Cancel</Button>
                            <Button
                                variant="danger"
                                loading={folderDialog.submitting}
                                onClick={handleDelete}
                            >
                                Delete
                            </Button>
                        </>
                    }
                >
                    Are you sure you want to delete{' '}
                    <strong>{folderDialog.folder.name}</strong> and all its contents?
                    This cannot be undone.
                </Dialog>
            )}

            {/* Bulk Follow Prompt dialog */}
            {folderDialog.action === 'follow-prompt' && folderDialog.folder && (
                <FollowPromptDialog
                    wsId={wsId}
                    taskPath={folderDialog.folder.relativePath}
                    taskName={folderDialog.folder.name}
                    onClose={closeFolderDialog}
                />
            )}

            {/* Move Folder dialog */}
            {tree && (
                <FolderMoveDialog
                    open={moveDialogOpen}
                    onClose={() => { setMoveDialogOpen(false); setMoveSourceFolder(null); }}
                    sourceFolder={moveSourceFolder}
                    tree={tree}
                    onConfirm={handleMoveConfirm}
                />
            )}

            {/* Generate Task with AI dialog */}
            {generateDialogOpen && (
                <GenerateTaskDialog
                    wsId={wsId}
                    initialFolder={selectedFolderPath ?? undefined}
                    onClose={() => setGenerateDialogOpen(false)}
                    onSuccess={() => {
                        setGenerateDialogOpen(false);
                        refresh();
                    }}
                />
            )}
        </div>
    );
}

export function TasksPanel({ wsId }: TasksPanelProps) {
    return (
        <TaskProvider>
            <TasksPanelInner wsId={wsId} />
        </TaskProvider>
    );
}
