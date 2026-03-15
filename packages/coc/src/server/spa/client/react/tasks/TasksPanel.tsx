/**
 * TasksPanel — top-level component for the Tasks sub-tab.
 * Renders a two-zone flex layout: left = TaskTree, right = TaskPreview.
 */

import { useEffect, useRef, useState } from 'react';
import { TaskProvider, useTaskPanel } from '../context/TaskContext';
import { useTaskTree } from '../hooks/useTaskTree';
import { fetchApi } from '../hooks/useApi';
import { useFolderActions } from '../hooks/useFolderActions';
import { useFileActions } from '../hooks/useFileActions';
import { useArchiveUndo } from '../hooks/useArchiveUndo';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useQueue } from '../context/QueueContext';
import { useGlobalToast } from '../context/ToastContext';
import { TaskActions } from './TaskActions';
import { ContextMenu } from './comments/ContextMenu';
import { Spinner } from '../shared';
import { normalizeRemoteUrl } from '../repos/repoGrouping';
import type { TasksPanelNavState } from '../types/dashboard';
import { parseTaskHashParams } from '../utils/taskHashParams';
import { useTaskSearch } from '../hooks/useTaskSearch';
import { useFileDialogHandlers } from '../hooks/useFileDialogHandlers';
import { useFolderDialogHandlers } from '../hooks/useFolderDialogHandlers';
import { useFileContextMenu } from '../hooks/useFileContextMenu';
import { useFolderContextMenu } from '../hooks/useFolderContextMenu';
import { TasksToolbar } from './TasksToolbar';
import { TasksMillerLayout } from './TasksMillerLayout';
import { TasksFileDialogs } from './TasksFileDialogs';
import { TasksFolderDialogs } from './TasksFolderDialogs';
import { TasksAiDialogs } from './TasksAiDialogs';

interface TasksPanelProps {
    wsId: string;
    repos?: import('../repos/repoGrouping').RepoData[];
    onOpenGenerateDialog?: (targetFolder?: string) => void;
    initialNavState?: TasksPanelNavState;
    onNavStateChange?: (navState: TasksPanelNavState) => void;
}

// Re-export so existing imports from this module continue to work.
export { parseTaskHashParams } from '../utils/taskHashParams';

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

function TasksPanelInner({ wsId, repos, onOpenGenerateDialog }: TasksPanelProps) {
    const { tree, commentCounts, loading, error, refresh } = useTaskTree(wsId);
    const { openFilePath, setOpenFilePath, selectedFilePaths, clearSelection, selectedFolderPath } = useTaskPanel();
    const [initialParams] = useState(() => parseTaskHashParams(location.hash, wsId));
    const scrollRef = useRef<HTMLDivElement>(null);
    const { isMobile } = useBreakpoint();
    const [toolbarOverflowOpen, setToolbarOverflowOpen] = useState(false);
    const [tasksFolder, setTasksFolder] = useState('.vscode/tasks');
    useEffect(() => {
        fetchApi(`/workspaces/${encodeURIComponent(wsId)}/tasks/settings`)
            .then((data: any) => { if (data?.folderPath) setTasksFolder(data.folderPath); })
            .catch(() => {});
    }, [wsId]);

    const { dispatch: queueDispatch } = useQueue();
    const { addToast } = useGlobalToast();
    const { undoAvailable, undoInFlight, setUndoAvailable, undoLastArchive } = useArchiveUndo(wsId, refresh);
    const folderActions = useFolderActions(wsId, { onArchived: () => setUndoAvailable(true) });
    const fileActions = useFileActions(wsId, { onArchived: () => setUndoAvailable(true) });

    // ── Close toolbar overflow when clicking outside ──────────────────
    useEffect(() => {
        if (!toolbarOverflowOpen) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            const btn = document.querySelector('[data-testid="tasks-toolbar-overflow-btn"]');
            const menu = document.querySelector('[data-testid="tasks-toolbar-overflow-menu"]');
            if (btn && !btn.contains(target) && menu && !menu.contains(target)) {
                setToolbarOverflowOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [toolbarOverflowOpen]);

    // ── Sibling repos (same remote URL, different workspace) ──────────
    const siblingRepos = (repos ?? []).filter(r => {
        if (r.workspace.id === wsId) return false;
        const currentRepo = (repos ?? []).find(rr => rr.workspace.id === wsId);
        if (!currentRepo) return false;
        const currentUrl = currentRepo.workspace.remoteUrl || currentRepo.gitInfo?.remoteUrl;
        const candidateUrl = r.workspace.remoteUrl || r.gitInfo?.remoteUrl;
        if (!currentUrl || !candidateUrl) return false;
        return normalizeRemoteUrl(currentUrl) === normalizeRemoteUrl(candidateUrl);
    });

    const { searchInput, searchQuery, searchResults, searchInputRef, onSearchChange, onSearchClear } = useTaskSearch(tree ?? null);

    const fileDlg = useFileDialogHandlers({ fileActions, refresh, addToast, onSearchClear });
    const folderDlg = useFolderDialogHandlers({ folderActions, fileActions, refresh, addToast, onOpenGenerateDialog });

    const { fileMenuItems } = useFileContextMenu({
        fileCtxMenu: fileDlg.fileCtxMenu,
        setFileCtxMenu: fileDlg.setFileCtxMenu,
        tasksFolder,
        fileActions,
        refresh,
        addToast,
        siblingRepos,
        onSearchClear,
        setNavigateToFilePath: fileDlg.setNavigateToFilePath,
        setFileDialog: fileDlg.setFileDialog,
        setFileMoveCtxItem: fileDlg.setFileMoveCtxItem,
        setFileMoveDialogOpen: fileDlg.setFileMoveDialogOpen,
        setAiDialogTarget: fileDlg.setAiDialogTarget,
        setAiDialogType: fileDlg.setAiDialogType,
    });

    const { folderMenuItems } = useFolderContextMenu({
        folderCtxMenu: folderDlg.folderCtxMenu,
        setFolderCtxMenu: folderDlg.setFolderCtxMenu,
        tasksFolder,
        folderActions,
        refresh,
        addToast,
        siblingRepos,
        onQueueFolder: (fp) => queueDispatch({ type: 'OPEN_DIALOG', folderPath: fp }),
        handleFolderContextMenuAction: folderDlg.handleFolderContextMenuAction,
    });

    useEffect(() => {
        scrollToEnd(scrollRef.current);
    }, [openFilePath]);

    const handleColumnsChange = () => { scrollToEnd(scrollRef.current); };
    const handleNavigateBack = () => { if (scrollRef.current) scrollRef.current.scrollLeft = 0; };

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

    return (
        <div className="flex flex-col h-full">
            <TasksToolbar
                isMobile={isMobile}
                onNewTask={() => folderDlg.setFolderDialog({ action: 'create-task', folder: tree, submitting: false })}
                onNewFolder={() => folderDlg.setFolderDialog({ action: 'create-subfolder', folder: tree, submitting: false })}
                undoAvailable={undoAvailable}
                undoInFlight={undoInFlight}
                onUndoArchive={undoLastArchive}
                onUndoError={(msg) => addToast(msg, 'error')}
                searchInput={searchInput}
                searchInputRef={searchInputRef}
                onSearchChange={onSearchChange}
                onSearchClear={onSearchClear}
                taskActions={
                    <TaskActions
                        wsId={wsId}
                        openFilePath={openFilePath}
                        selectedFilePaths={Array.from(selectedFilePaths)}
                        tasksFolderPath={tasksFolder}
                        selectedFolderPath={selectedFolderPath}
                        onClearSelection={clearSelection}
                        noBorder
                    />
                }
                selectedFolderPath={selectedFolderPath}
                onQueueFolder={(fp) => queueDispatch({ type: 'OPEN_DIALOG', folderPath: fp })}
                toolbarOverflowOpen={toolbarOverflowOpen}
                setToolbarOverflowOpen={setToolbarOverflowOpen}
            />

            <TasksMillerLayout
                scrollRef={scrollRef}
                isSearching={!!searchQuery}
                searchResults={searchResults}
                searchQuery={searchQuery}
                tree={tree}
                commentCounts={commentCounts}
                wsId={wsId}
                tasksFolder={tasksFolder}
                initialFolderPath={initialParams.initialFolderPath}
                initialFilePath={initialParams.initialFilePath}
                initialViewMode={initialParams.initialViewMode}
                navigateToFilePath={fileDlg.navigateToFilePath}
                onNavigated={() => fileDlg.setNavigateToFilePath(null)}
                onColumnsChange={handleColumnsChange}
                onNavigateBack={handleNavigateBack}
                onFolderContextMenu={folderDlg.handleFolderContextMenu}
                onFolderEmptySpaceContextMenu={folderDlg.handleFolderEmptySpaceContextMenu}
                onFileContextMenu={fileDlg.handleFileContextMenu}
                onDrop={folderDlg.handleDragDrop}
                openFilePath={openFilePath}
                setOpenFilePath={setOpenFilePath}
                isMobile={isMobile}
                wsIdEncoded={encodeURIComponent(wsId)}
            />

            {folderDlg.folderCtxMenu && (
                <ContextMenu
                    position={{ x: folderDlg.folderCtxMenu.x, y: folderDlg.folderCtxMenu.y }}
                    items={folderMenuItems}
                    onClose={() => folderDlg.setFolderCtxMenu(null)}
                />
            )}
            {fileDlg.fileCtxMenu && (
                <ContextMenu
                    position={{ x: fileDlg.fileCtxMenu.x, y: fileDlg.fileCtxMenu.y }}
                    items={fileMenuItems}
                    onClose={() => fileDlg.setFileCtxMenu(null)}
                />
            )}

            <TasksFileDialogs
                tree={tree}
                fileDialog={fileDlg.fileDialog}
                closeFileDialog={fileDlg.closeFileDialog}
                handleFileRename={fileDlg.handleFileRename}
                handleFileDelete={fileDlg.handleFileDelete}
                fileMoveDialogOpen={fileDlg.fileMoveDialogOpen}
                fileMoveCtxItem={fileDlg.fileMoveCtxItem}
                onCloseMoveDialog={() => { fileDlg.setFileMoveDialogOpen(false); fileDlg.setFileMoveCtxItem(null); }}
                handleFileMoveConfirm={fileDlg.handleFileMoveConfirm}
            />

            <TasksFolderDialogs
                tree={tree}
                folderDialog={folderDlg.folderDialog}
                closeFolderDialog={folderDlg.closeFolderDialog}
                handleRename={folderDlg.handleRename}
                handleCreateSubfolder={folderDlg.handleCreateSubfolder}
                handleCreateTask={folderDlg.handleCreateTask}
                handleDelete={folderDlg.handleDelete}
                moveDialogOpen={folderDlg.moveDialogOpen}
                moveSourceFolder={folderDlg.moveSourceFolder}
                onCloseMoveDialog={() => { folderDlg.setMoveDialogOpen(false); folderDlg.setMoveSourceFolder(null); }}
                handleMoveConfirm={folderDlg.handleMoveConfirm}
            />

            <TasksAiDialogs
                wsId={wsId}
                aiDialogType={fileDlg.aiDialogType}
                aiDialogTarget={fileDlg.aiDialogTarget}
                closeAiDialog={fileDlg.closeAiDialog}
                folderDialogAction={folderDlg.folderDialog.action}
                folderDialogFolder={folderDlg.folderDialog.folder}
                closeFolderDialog={folderDlg.closeFolderDialog}
            />
        </div>
    );
}

export function TasksPanel({ wsId, repos, onOpenGenerateDialog, initialNavState, onNavStateChange }: TasksPanelProps) {
    return (
        <TaskProvider initialNavState={initialNavState} onNavStateChange={onNavStateChange}>
            <TasksPanelInner wsId={wsId} repos={repos} onOpenGenerateDialog={onOpenGenerateDialog} />
        </TaskProvider>
    );
}
