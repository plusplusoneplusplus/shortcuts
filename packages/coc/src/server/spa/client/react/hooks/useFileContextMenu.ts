/**
 * useFileContextMenu — builds the context-menu items array for file right-clicks
 * in the Tasks panel.
 */

import { useMemo } from 'react';
import type { ContextMenuItem } from '../tasks/comments/ContextMenu';
import type { FileCtxMenu, FileCtxInfo } from './useFileDialogHandlers';
import type { FileActionsResult } from './useFileActions';
import { isTaskDocument, isTaskDocumentGroup } from './useTaskTree';
import type { RepoData } from '../repos/repoGrouping';

interface Options {
    fileCtxMenu: FileCtxMenu | null;
    setFileCtxMenu: (v: FileCtxMenu | null) => void;
    tasksFolder: string;
    fileActions: FileActionsResult;
    refresh: () => void;
    addToast: (msg: string, type: 'error' | 'success') => void;
    siblingRepos: RepoData[];
    onSearchClear: () => void;
    setNavigateToFilePath: (path: string | null) => void;
    setFileDialog: (v: { action: 'rename' | 'delete' | null; ctxItem: FileCtxInfo | null; submitting: boolean }) => void;
    setFileMoveCtxItem: (v: FileCtxInfo | null) => void;
    setFileMoveDialogOpen: (v: boolean) => void;
    setAiDialogTarget: (v: { path: string; name: string } | null) => void;
    setAiDialogType: (v: 'follow-prompt' | 'update-document' | null) => void;
}

export function useFileContextMenu({
    fileCtxMenu,
    setFileCtxMenu,
    tasksFolder,
    fileActions,
    refresh,
    addToast,
    siblingRepos,
    onSearchClear,
    setNavigateToFilePath,
    setFileDialog,
    setFileMoveCtxItem,
    setFileMoveDialogOpen,
    setAiDialogTarget,
    setAiDialogType,
}: Options): { fileMenuItems: ContextMenuItem[] } {
    const fileMenuItems: ContextMenuItem[] = useMemo(() => {
        if (!fileCtxMenu) return [];
        const noop = () => {};
        const { ctxItem } = fileCtxMenu;
        return [
            // ── Reveal in Panel ──
            {
                label: 'Reveal in Panel',
                icon: '🔍',
                onClick: () => {
                    setFileCtxMenu(null);
                    onSearchClear();
                    if (ctxItem.paths[0]) {
                        setNavigateToFilePath(ctxItem.paths[0]);
                    }
                },
            },
            { separator: true, label: '', onClick: noop },
            // ── Clipboard ──
            {
                label: 'Copy Path',
                icon: '📋',
                onClick: () => {
                    navigator.clipboard.writeText(`${tasksFolder}/${ctxItem.renamePath}`);
                },
            },
            {
                label: 'Copy Absolute Path',
                icon: '📂',
                onClick: () => {
                    const abs = [tasksFolder.replace(/\\/g, '/'), ctxItem.renamePath].filter(Boolean).join('/');
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
                                setFileCtxMenu(null);
                                (async () => {
                                    try {
                                        for (const p of ctxItem.paths) {
                                            await fileActions.moveFileToWorkspace(p, r.workspace.id, '');
                                        }
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
            // ── AI Actions ──
            {
                label: '✨ Run Skill',
                icon: '⚡',
                onClick: () => {
                    setFileCtxMenu(null);
                    setAiDialogTarget({ path: ctxItem.renamePath, name: ctxItem.displayName });
                    setAiDialogType('follow-prompt');
                },
            },
            {
                label: '✨ Update Document',
                icon: '✏️',
                onClick: () => {
                    setFileCtxMenu(null);
                    setAiDialogTarget({ path: ctxItem.renamePath, name: ctxItem.displayName });
                    setAiDialogType('update-document');
                },
            },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fileCtxMenu, tasksFolder, siblingRepos]);

    return { fileMenuItems };
}
