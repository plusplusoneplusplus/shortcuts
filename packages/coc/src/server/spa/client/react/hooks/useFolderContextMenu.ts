/**
 * useFolderContextMenu — builds the context-menu items array for folder right-clicks
 * in the Tasks panel.
 */

import { useMemo } from 'react';
import type { ContextMenuItem } from '../tasks/comments/ContextMenu';
import type { FolderCtxMenu } from './useFolderDialogHandlers';
import type { FolderActionsResult } from './useFolderActions';
import { countMarkdownFilesInFolder } from './useTaskTree';
import type { RepoData } from '../repos/repoGrouping';

interface Options {
    folderCtxMenu: FolderCtxMenu | null;
    setFolderCtxMenu: (v: FolderCtxMenu | null) => void;
    tasksFolder: string;
    folderActions: FolderActionsResult;
    refresh: () => void;
    addToast: (msg: string, type: 'error' | 'success') => void;
    siblingRepos: RepoData[];
    onQueueFolder: (folderPath: string) => void;
    handleFolderContextMenuAction: (actionKey: string, folder: import('./useTaskTree').TaskFolder) => void;
}

export function useFolderContextMenu({
    folderCtxMenu,
    setFolderCtxMenu,
    tasksFolder,
    folderActions,
    refresh,
    addToast,
    siblingRepos,
    onQueueFolder,
    handleFolderContextMenuAction,
}: Options): { folderMenuItems: ContextMenuItem[] } {
    const folderMenuItems: ContextMenuItem[] = useMemo(() => {
        if (!folderCtxMenu) return [];
        const noop = () => {};
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
                    navigator.clipboard.writeText(`${tasksFolder}/${folderPath}`);
                },
            },
            {
                label: 'Copy Absolute Path',
                icon: '📂',
                onClick: () => {
                    const abs = [tasksFolder.replace(/\\/g, '/'), folderPath].filter(Boolean).join('/');
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
                    onQueueFolder(folderPath);
                },
                children: [
                    {
                        label: 'Queue All Tasks',
                        icon: '▶',
                        disabled: countMarkdownFilesInFolder(folder) === 0,
                        onClick: () => {
                            onQueueFolder(folderPath);
                        },
                    },
                    {
                        label: 'Run Skill',
                        icon: '⚡',
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
            ...(siblingRepos.length > 0
                ? [
                    {
                        label: 'Move To Other Repo',
                        icon: '🔀',
                        onClick: noop,
                        children: siblingRepos.map(r => ({
                            label: r.workspace.name,
                            icon: '📂',
                            onClick: () => {
                                setFolderCtxMenu(null);
                                (async () => {
                                    try {
                                        await folderActions.moveFolderToWorkspace(folderPath, r.workspace.id, '');
                                        refresh();
                                        addToast(`Moved to ${r.workspace.name}`, 'success');
                                    } catch (err: any) {
                                        addToast(err.message || 'Move failed', 'error');
                                    }
                                })();
                            },
                        })),
                    },
                ]
                : []),
            { separator: true, label: '', onClick: noop },
            // ── AI Actions ──
            {
                label: 'Generate Task with AI…',
                icon: '✨',
                onClick: () => handleFolderContextMenuAction('generate-task-ai', folder),
            },
            {
                label: 'Bulk Run Skill',
                icon: '⚡',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [folderCtxMenu, tasksFolder, siblingRepos]);

    return { folderMenuItems };
}
