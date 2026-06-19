/**
 * TasksPanel — top-level component for the Tasks sub-tab.
 * Renders a two-zone flex layout: left = TaskTree, right = TaskPreview.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { TaskProvider, useTaskPanel } from '../contexts/TaskContext';
import { useTaskTree, filterFolderTree, isDocumentMatchingFilter, type TaskStatusValue, type TaskFolder, STATUS_PILLS } from './hooks/useTaskTree';
import { getSpaCocClient } from '../api/cocClient';
import { useFolderActions } from './hooks/useFolderActions';
import { useFileActions } from './hooks/useFileActions';
import { useArchiveUndo } from './hooks/useArchiveUndo';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { useQueue } from '../contexts/QueueContext';
import { useApp } from '../contexts/AppContext';
import { useGlobalToast } from '../contexts/ToastContext';
import { TaskActions } from './TaskActions';
import { ContextMenu } from './comments/ContextMenu';
import { Spinner } from '../ui';
import { normalizeRemoteUrl } from '../repos/repoGrouping';
import type { TasksPanelNavState } from '../types/dashboard';
import { parseTaskHashParams } from '../utils/taskHashParams';
import { useTaskSearch } from './hooks/useTaskSearch';
import { useFileDialogHandlers } from './hooks/useFileDialogHandlers';
import { useFolderDialogHandlers } from './hooks/useFolderDialogHandlers';
import { useFileContextMenu } from './hooks/useFileContextMenu';
import { useFolderContextMenu } from './hooks/useFolderContextMenu';
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

function getParentFolderPath(filePath: string | null | undefined): string | null {
    if (!filePath || !filePath.match(/[\\/]/)) return null;
    return filePath.split(/[\\/]/).slice(0, -1).join('/');
}

function TasksPanelInner({ wsId, repos, onOpenGenerateDialog, initialNavState, onNavStateChange }: TasksPanelProps) {
    const { tree, commentCounts, loading, error, refresh } = useTaskTree(wsId);
    const { openFilePath, openFileTaskRootPath, setOpenFilePath, selectedFilePaths, clearSelection, selectedFolderPath } = useTaskPanel();
    const [initialParams] = useState(() => parseTaskHashParams(location.hash, wsId));
    const scrollRef = useRef<HTMLDivElement>(null);
    const { isMobile } = useBreakpoint();
    const [toolbarOverflowOpen, setToolbarOverflowOpen] = useState(false);
    const [statusFilter, setStatusFilter] = useState<TaskStatusValue[]>([]);
    const [tasksFolder, setTasksFolder] = useState('.vscode/tasks');
    const [folderPaths, setFolderPaths] = useState<string[]>([]);
    useEffect(() => {
        getSpaCocClient().tasks.getSettings(wsId)
            .then((data: any) => {
                if (data?.folderPath) setTasksFolder(data.folderPath);
                setFolderPaths(data?.folderPaths ?? []);
            })
            .catch(() => {});
    }, [wsId]);
    const primaryFolderPath = tasksFolder;

    const { dispatch: queueDispatch } = useQueue();
    const { state: appState } = useApp();
    const { addToast } = useGlobalToast();
    const workspaceRootPath = useMemo(() => {
        const ws = appState.workspaces.find((w: any) => w.id === wsId);
        return ws?.rootPath ?? '';
    }, [appState.workspaces, wsId]);
    const { undoAvailable, undoInFlight, setUndoAvailable, undoLastArchive } = useArchiveUndo(wsId, refresh);
    const [activeFolder, setActiveFolder] = useState<TaskFolder | null>(null);
    const [activeFolderPath, setActiveFolderPath] = useState<string | null>(
        initialNavState?.activeFolderPath
            ?? initialNavState?.selectedFolderPath
            ?? getParentFolderPath(initialNavState?.openFilePath)
    );
    const handleActiveFolderChange = useCallback((folder: TaskFolder) => {
        setActiveFolder(folder);
        setActiveFolderPath(folder.relativePath ? folder.relativePath.replace(/\\/g, '/') : null);
    }, []);
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

    const { searchInput, searchQuery, searchResults, searchInputRef, onSearchChange, onSearchClear } = useTaskSearch(tree ?? null, { isPreviewOpen: !!openFilePath });

    const filteredTree = useMemo(() => {
        if (!tree || statusFilter.length === 0) return tree;
        return filterFolderTree(tree, statusFilter);
    }, [tree, statusFilter]);

    const filteredSearchResults = useMemo(() => {
        if (statusFilter.length === 0) return searchResults;
        return searchResults.filter(item => {
            if ('documents' in item && !('children' in item)) {
                return item.documents.some(doc => isDocumentMatchingFilter(doc, statusFilter));
            }
            return isDocumentMatchingFilter(item as { status?: string }, statusFilter);
        });
    }, [searchResults, statusFilter]);

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
        queueDispatch,
        wsId,
        workspaceRootPath,
    });

    const { folderMenuItems } = useFolderContextMenu({
        folderCtxMenu: folderDlg.folderCtxMenu,
        setFolderCtxMenu: folderDlg.setFolderCtxMenu,
        tasksFolder,
        folderActions,
        refresh,
        addToast,
        siblingRepos,
        onQueueFolder: (fp) => queueDispatch({ type: 'OPEN_DIALOG', folderPath: fp, workspaceId: wsId }),
        handleFolderContextMenuAction: folderDlg.handleFolderContextMenuAction,
        queueDispatch,
        wsId,
        workspaceRootPath,
    });

    useEffect(() => {
        scrollToEnd(scrollRef.current);
    }, [openFilePath]);

    useEffect(() => {
        onNavStateChange?.({
            openFilePath,
            selectedFilePaths: Array.from(selectedFilePaths),
            selectedFolderPath,
            activeFolderPath,
        });
    }, [openFilePath, selectedFilePaths, selectedFolderPath, activeFolderPath, onNavStateChange]);

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

    const resolvedActiveFolder = activeFolder ?? tree;

    return (
        <div className="flex flex-col h-full">
            <TasksToolbar
                isMobile={isMobile}
                onNewTask={() => folderDlg.setFolderDialog({ action: 'create-task', folder: resolvedActiveFolder, submitting: false })}
                onNewFolder={() => folderDlg.setFolderDialog({ action: 'create-subfolder', folder: resolvedActiveFolder, submitting: false })}
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
                        openFileTaskRootPath={openFileTaskRootPath}
                        selectedFolderPath={selectedFolderPath}
                        onClearSelection={clearSelection}
                        noBorder
                    />
                }
                selectedFolderPath={selectedFolderPath}
                onQueueFolder={(fp) => queueDispatch({ type: 'OPEN_DIALOG', folderPath: fp })}
                toolbarOverflowOpen={toolbarOverflowOpen}
                setToolbarOverflowOpen={setToolbarOverflowOpen}
                statusFilter={statusFilter}
                onStatusFilterChange={setStatusFilter}
            />

            {statusFilter.length > 0 && (
                <div
                    className="bg-[#0078d4]/5 dark:bg-[#3794ff]/5 border-b border-[#0078d4]/20 dark:border-[#3794ff]/20 px-3 py-1 text-xs text-[#616161] dark:text-[#9d9d9d] flex items-center gap-2"
                    data-testid="task-status-filter-banner"
                >
                    <span>Filtered by:</span>
                    {statusFilter.map(s => {
                        const pill = STATUS_PILLS.find(p => p.status === s);
                        return pill ? <span key={s}>{pill.icon} {pill.label}</span> : null;
                    })}
                    <button
                        className="ml-auto text-[#0078d4] dark:text-[#3794ff] hover:underline text-xs"
                        onClick={() => setStatusFilter([])}
                        data-testid="task-filter-clear"
                    >
                        ✕ Clear filter
                    </button>
                </div>
            )}

            <TasksMillerLayout
                scrollRef={scrollRef}
                isSearching={!!searchQuery}
                searchResults={filteredSearchResults}
                searchQuery={searchQuery}
                tree={filteredTree ?? tree!}
                commentCounts={commentCounts}
                wsId={wsId}
                tasksFolder={tasksFolder}
                primaryFolderPath={primaryFolderPath}
                initialFolderPath={initialParams.initialFolderPath}
                initialFilePath={initialParams.initialFilePath}
                initialActiveFolderPath={initialParams.initialFolderPath ?? initialNavState?.activeFolderPath ?? getParentFolderPath(initialNavState?.openFilePath)}
                initialViewMode={initialParams.initialViewMode}
                navigateToFilePath={fileDlg.navigateToFilePath}
                onNavigated={() => fileDlg.setNavigateToFilePath(null)}
                onColumnsChange={handleColumnsChange}
                onNavigateBack={handleNavigateBack}
                onFolderContextMenu={folderDlg.handleFolderContextMenu}
                onFolderEmptySpaceContextMenu={folderDlg.handleFolderEmptySpaceContextMenu}
                onFileContextMenu={fileDlg.handleFileContextMenu}
                onDrop={folderDlg.handleDragDrop}
                onActiveFolderChange={handleActiveFolderChange}
                openFilePath={openFilePath}
                openFileTaskRootPath={openFileTaskRootPath}
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
        <TaskProvider initialNavState={initialNavState}>
            <TasksPanelInner wsId={wsId} repos={repos} onOpenGenerateDialog={onOpenGenerateDialog} initialNavState={initialNavState} onNavStateChange={onNavStateChange} />
        </TaskProvider>
    );
}
