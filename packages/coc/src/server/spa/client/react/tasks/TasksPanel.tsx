/**
 * TasksPanel — top-level component for the Tasks sub-tab.
 * Renders a two-zone flex layout: left = TaskTree, right = TaskPreview.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { TaskProvider, useTaskPanel } from '../context/TaskContext';
import { useTaskTree, countMarkdownFilesInFolder, isTaskDocument, isTaskDocumentGroup } from '../hooks/useTaskTree';
import type { TaskFolder, TaskDocument, TaskDocumentGroup } from '../hooks/useTaskTree';
import { useFolderActions } from '../hooks/useFolderActions';
import { useFileActions } from '../hooks/useFileActions';
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
import { FileMoveDialog } from './FileMoveDialog';
import { Dialog } from '../shared/Dialog';
import { Button } from '../shared/Button';
import { FollowPromptDialog } from '../shared/FollowPromptDialog';
import { BulkFollowPromptDialog } from '../shared/BulkFollowPromptDialog';
import { GenerateTaskDialog } from './GenerateTaskDialog';
import { Spinner } from '../shared';

interface TasksPanelProps {
    wsId: string;
}

export function parseTaskHashParams(hash: string, wsId: string) {
    const [hashPath, queryStr] = hash.replace(/^#/, '').split('?');
    const parts = hashPath.split('/');
    if (parts[0] !== 'repos' || decodeURIComponent(parts[1] || '') !== wsId || parts[2] !== 'tasks')
        return { initialFolderPath: null, initialFilePath: null, initialViewMode: null as 'review' | 'source' | null };
    const taskParts = parts.slice(3).map(p => decodeURIComponent(p)).filter(Boolean);

    const params = new URLSearchParams(queryStr || '');
    const modeParam = params.get('mode');
    const initialViewMode: 'review' | 'source' | null = modeParam === 'source' ? 'source' : modeParam === 'review' ? 'review' : null;

    if (!taskParts.length) return { initialFolderPath: null, initialFilePath: null, initialViewMode };
    const last = taskParts[taskParts.length - 1];
    if (last.endsWith('.md')) {
        return {
            initialFolderPath: taskParts.slice(0, -1).join('/') || null,
            initialFilePath: taskParts.join('/'),
            initialViewMode,
        };
    }
    return { initialFolderPath: taskParts.join('/'), initialFilePath: null, initialViewMode };
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
    const [generateDialog, setGenerateDialog] = useState<{
        open: boolean;
        targetFolder: string | undefined;
    }>({ open: false, targetFolder: undefined });

    const { state: appState } = useApp();
    const { dispatch: queueDispatch } = useQueue();
    const { addToast } = useGlobalToast();
    const folderActions = useFolderActions(wsId);
    const fileActions = useFileActions(wsId);

    // ── File context-menu state ────────────────────────────────────────
    interface FileCtxInfo {
        item: TaskDocument | TaskDocumentGroup;
        /** All file paths — multiple for document groups. */
        paths: string[];
        /** Path used for rename (server detects and renames whole group). */
        renamePath: string;
        displayName: string;
        isArchived: boolean;
    }
    interface FileCtxMenu { ctxItem: FileCtxInfo; x: number; y: number }
    const [fileCtxMenu, setFileCtxMenu] = useState<FileCtxMenu | null>(null);

    type FileDialogAction = 'rename' | 'delete' | null;
    const [fileDialog, setFileDialog] = useState<{
        action: FileDialogAction;
        ctxItem: FileCtxInfo | null;
        submitting: boolean;
    }>({ action: null, ctxItem: null, submitting: false });

    const [fileMoveDialogOpen, setFileMoveDialogOpen] = useState(false);
    const [fileMoveCtxItem, setFileMoveCtxItem] = useState<FileCtxInfo | null>(null);

    const closeFileDialog = useCallback(
        () => setFileDialog({ action: null, ctxItem: null, submitting: false }),
        []
    );

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

    // ── Folder context-menu state ──────────────────────────────────────
    interface FolderCtxMenu {
        folder: TaskFolder;
        x: number;
        y: number;
        source: 'folder-row' | 'empty-space';
    }
    const [folderCtxMenu, setFolderCtxMenu] = useState<FolderCtxMenu | null>(null);

    const handleFolderContextMenu = useCallback(
        (folder: TaskFolder, x: number, y: number) => setFolderCtxMenu({ folder, x, y, source: 'folder-row' }),
        []
    );

    const handleFolderEmptySpaceContextMenu = useCallback(
        (folder: TaskFolder, x: number, y: number) => setFolderCtxMenu({ folder, x, y, source: 'empty-space' }),
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
            if (actionKey === 'generate-task-ai') {
                setGenerateDialog({
                    open: true,
                    targetFolder: folder.relativePath || folder.name,
                });
            }
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

    // ── Build file context-menu items ──────────────────────────────────
    const noop = () => {};
    const ws = appState.workspaces.find((w: any) => w.id === wsId);
    const fileMenuItems: ContextMenuItem[] = fileCtxMenu ? (() => {
        const { ctxItem } = fileCtxMenu;
        const tasksFolder = '.vscode/tasks';
        return [
            // ── Clipboard ──
            {
                label: 'Copy Path',
                icon: '📋',
                onClick: () => {
                    navigator.clipboard.writeText(ctxItem.renamePath);
                },
            },
            {
                label: 'Copy Absolute Path',
                icon: '📂',
                onClick: () => {
                    const rootPath = ws?.rootPath ?? '';
                    const abs = [rootPath, tasksFolder, ctxItem.renamePath].filter(Boolean).join('/');
                    navigator.clipboard.writeText(abs);
                },
            },
            { separator: true, label: '', onClick: noop },
            // ── Archive ──
            {
                label: ctxItem.isArchived ? 'Unarchive' : 'Archive',
                icon: ctxItem.isArchived ? '📤' : '🗄️',
                onClick: async () => {
                    setFileCtxMenu(null);
                    try {
                        for (const p of ctxItem.paths) {
                            if (ctxItem.isArchived) {
                                await fileActions.unarchiveFile(p);
                            } else {
                                await fileActions.archiveFile(p);
                            }
                        }
                        refresh();
                    } catch (err: any) {
                        addToast(err.message || 'Archive failed', 'error');
                    }
                },
            },
            { separator: true, label: '', onClick: noop },
            // ── Rename / Move ──
            {
                label: 'Rename',
                icon: '✏️',
                onClick: () => {
                    setFileCtxMenu(null);
                    setFileDialog({ action: 'rename', ctxItem, submitting: false });
                },
            },
            {
                label: 'Move File',
                icon: '📦',
                onClick: () => {
                    setFileCtxMenu(null);
                    setFileMoveCtxItem(ctxItem);
                    setFileMoveDialogOpen(true);
                },
            },
            { separator: true, label: '', onClick: noop },
            // ── Change Status (submenu) ──
            ...(isTaskDocument(ctxItem.item) || isTaskDocumentGroup(ctxItem.item)
                ? [
                    {
                        label: 'Change Status',
                        icon: '📌',
                        onClick: noop,
                        children: [
                            { label: 'Pending', icon: '⏳', onClick: () => { setFileCtxMenu(null); (async () => { try { for (const p of ctxItem.paths) await fileActions.updateStatus(p, 'pending'); refresh(); } catch (err: any) { addToast(err.message || 'Status update failed', 'error'); } })(); } },
                            { label: 'In Progress', icon: '🔄', onClick: () => { setFileCtxMenu(null); (async () => { try { for (const p of ctxItem.paths) await fileActions.updateStatus(p, 'in-progress'); refresh(); } catch (err: any) { addToast(err.message || 'Status update failed', 'error'); } })(); } },
                            { label: 'Done', icon: '✅', onClick: () => { setFileCtxMenu(null); (async () => { try { for (const p of ctxItem.paths) await fileActions.updateStatus(p, 'done'); refresh(); } catch (err: any) { addToast(err.message || 'Status update failed', 'error'); } })(); } },
                            { label: 'Future', icon: '📋', onClick: () => { setFileCtxMenu(null); (async () => { try { for (const p of ctxItem.paths) await fileActions.updateStatus(p, 'future'); refresh(); } catch (err: any) { addToast(err.message || 'Status update failed', 'error'); } })(); } },
                        ],
                    },
                ]
                : []),
            { separator: true, label: '', onClick: noop },
            // ── Danger ──
            {
                label: 'Delete',
                icon: '🗑️',
                onClick: () => {
                    setFileCtxMenu(null);
                    setFileDialog({ action: 'delete', ctxItem, submitting: false });
                },
            },
        ];
    })() : [];

    // ── Build folder context-menu items ────────────────────────────────
    const folderMenuItems: ContextMenuItem[] = folderCtxMenu ? (() => {
        const folder = folderCtxMenu.folder;
        if (folderCtxMenu.source === 'empty-space') {
            return [
                {
                    label: 'Create Folder',
                    icon: '📁',
                    onClick: () => handleFolderContextMenuAction('create-subfolder', folder),
                },
            ];
        }

        const folderPath = folder.relativePath || folder.name;
        const isArchived = (folder.relativePath ?? '').startsWith('archive');
        return [
            // ── Clipboard ──
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
            { separator: true, label: '', onClick: noop },
            // ── Queue & Archive ──
            {
                label: 'Queue All Tasks',
                icon: '▶',
                disabled: countMarkdownFilesInFolder(folder) === 0,
                onClick: () => {
                    queueDispatch({ type: 'OPEN_DIALOG', folderPath });
                },
                children: [
                    {
                        label: 'Queue All Tasks',
                        icon: '▶',
                        disabled: countMarkdownFilesInFolder(folder) === 0,
                        onClick: () => {
                            queueDispatch({ type: 'OPEN_DIALOG', folderPath });
                        },
                    },
                    {
                        label: 'Follow Prompt',
                        icon: '📝',
                        onClick: () => handleFolderContextMenuAction('follow-prompt', folder),
                    },
                ],
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
            { separator: true, label: '', onClick: noop },
            // ── Create / Rename / Move ──
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
                label: 'Move Folder',
                icon: '📦',
                onClick: () => handleFolderContextMenuAction('move', folder),
            },
            { separator: true, label: '', onClick: noop },
            // ── AI Actions ──
            {
                label: 'Generate Task with AI…',
                icon: '✨',
                onClick: () => handleFolderContextMenuAction('generate-task-ai', folder),
            },
            {
                label: 'Bulk Follow Prompt',
                icon: '🤖',
                onClick: () => handleFolderContextMenuAction('follow-prompt', folder),
            },
            { separator: true, label: '', onClick: noop },
            // ── Danger ──
            {
                label: 'Delete Folder',
                icon: '🗑️',
                onClick: () => handleFolderContextMenuAction('delete', folder),
            },
        ];
    })() : [];

    return (
        <div className="flex flex-col h-full">
            <div className="repo-tasks-toolbar flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <Button
                    variant="primary"
                    size="sm"
                    id="repo-tasks-new-btn"
                    data-testid="repo-tasks-new-btn"
                    onClick={() => setFolderDialog({ action: 'create-task', folder: tree!, submitting: false })}
                >
                    + New Task
                </Button>
                <Button
                    variant="secondary"
                    size="sm"
                    id="repo-tasks-folder-btn"
                    data-testid="repo-tasks-folder-btn"
                    onClick={() => setFolderDialog({ action: 'create-subfolder', folder: tree!, submitting: false })}
                >
                    + New Folder
                </Button>
                <div className="flex-1 min-w-0">
                    <TaskActions
                        wsId={wsId}
                        openFilePath={openFilePath}
                        selectedFilePaths={Array.from(selectedFilePaths)}
                        tasksFolderPath=".vscode/tasks"
                        selectedFolderPath={selectedFolderPath}
                        onClearSelection={clearSelection}
                        onGenerateWithAI={() => setGenerateDialog({ open: true, targetFolder: undefined })}
                        noBorder
                    />
                </div>
            </div>
            <div
                ref={scrollRef}
                className="miller-columns flex-1 overflow-x-auto overflow-y-hidden min-h-0 min-w-0"
                data-testid="tasks-miller-scroll-container"
            >
                <div className="flex h-full min-h-0 min-w-full">
                    <div className="flex-shrink-0 h-full min-h-0">
                        <TaskTree
                            tree={tree}
                            commentCounts={commentCounts}
                            wsId={wsId}
                            initialFolderPath={initialParams.initialFolderPath}
                            initialFilePath={initialParams.initialFilePath}
                            onColumnsChange={handleColumnsChange}
                            onFolderContextMenu={handleFolderContextMenu}
                            onFolderEmptySpaceContextMenu={handleFolderEmptySpaceContextMenu}
                            onFileContextMenu={handleFileContextMenu}
                        />
                    </div>

                    {openFilePath && (
                        <div className="h-full min-h-0 flex-1 min-w-[48rem] border-r border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <TaskPreview wsId={wsId} filePath={openFilePath} initialViewMode={initialParams.initialViewMode} />
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

            {/* File context menu */}
            {fileCtxMenu && (
                <ContextMenu
                    position={{ x: fileCtxMenu.x, y: fileCtxMenu.y }}
                    items={fileMenuItems}
                    onClose={() => setFileCtxMenu(null)}
                />
            )}

            {/* Rename File dialog */}
            {fileDialog.action === 'rename' && fileDialog.ctxItem && (
                <FolderActionDialog
                    open
                    title="Rename File"
                    label="New name"
                    initialValue={fileDialog.ctxItem.displayName}
                    placeholder="Enter new file name"
                    confirmLabel="Rename"
                    submitting={fileDialog.submitting}
                    onClose={closeFileDialog}
                    onConfirm={handleFileRename}
                />
            )}

            {/* Delete File confirmation dialog */}
            {fileDialog.action === 'delete' && fileDialog.ctxItem && (
                <Dialog
                    open
                    onClose={closeFileDialog}
                    title="Delete File"
                    footer={
                        <>
                            <Button variant="secondary" onClick={closeFileDialog}>Cancel</Button>
                            <Button
                                variant="danger"
                                loading={fileDialog.submitting}
                                onClick={handleFileDelete}
                            >
                                Delete
                            </Button>
                        </>
                    }
                >
                    Are you sure you want to delete{' '}
                    <strong>{fileDialog.ctxItem.displayName}</strong>?
                    This cannot be undone.
                </Dialog>
            )}

            {/* Move File dialog */}
            {tree && (
                <FileMoveDialog
                    open={fileMoveDialogOpen}
                    onClose={() => { setFileMoveDialogOpen(false); setFileMoveCtxItem(null); }}
                    sourceName={fileMoveCtxItem?.displayName ?? null}
                    tree={tree}
                    onConfirm={handleFileMoveConfirm}
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

            {/* Create Task in Folder dialog (or at root when folder is tree) */}
            {folderDialog.action === 'create-task' && folderDialog.folder && (
                <FolderActionDialog
                    open
                    title={folderDialog.folder.relativePath ? 'Create Task in Folder' : 'Create Task'}
                    label="Task name"
                    initialValue=""
                    placeholder="Enter task name"
                    confirmLabel="Create"
                    showDocType
                    submitting={folderDialog.submitting}
                    onClose={closeFolderDialog}
                    onConfirm={(name, docType) => handleCreateTask(name, docType)}
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
                <BulkFollowPromptDialog
                    wsId={wsId}
                    folder={folderDialog.folder}
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
            {generateDialog.open && (
                <GenerateTaskDialog
                    wsId={wsId}
                    initialFolder={generateDialog.targetFolder ?? selectedFolderPath ?? undefined}
                    onClose={() => setGenerateDialog({ open: false, targetFolder: undefined })}
                    onSuccess={() => {
                        setGenerateDialog({ open: false, targetFolder: undefined });
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
