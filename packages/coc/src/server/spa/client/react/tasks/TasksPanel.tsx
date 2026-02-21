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
import { TaskTree } from './TaskTree';
import { TaskPreview } from './TaskPreview';
import { TaskActions } from './TaskActions';
import { ContextMenu } from './comments/ContextMenu';
import type { ContextMenuItem } from './comments/ContextMenu';
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

    const { state: appState } = useApp();
    const { dispatch: queueDispatch } = useQueue();
    const folderActions = useFolderActions(wsId);

    // ── Folder context-menu state ──────────────────────────────────────
    interface FolderCtxMenu { folder: TaskFolder; x: number; y: number }
    const [folderCtxMenu, setFolderCtxMenu] = useState<FolderCtxMenu | null>(null);

    const handleFolderContextMenu = useCallback(
        (folder: TaskFolder, x: number, y: number) => setFolderCtxMenu({ folder, x, y }),
        []
    );

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
        const folderPath = folderCtxMenu.folder.relativePath || folderCtxMenu.folder.name;
        const isArchived = (folderCtxMenu.folder.relativePath ?? '').startsWith('archive');
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
                disabled: countMarkdownFilesInFolder(folderCtxMenu.folder) === 0,
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
