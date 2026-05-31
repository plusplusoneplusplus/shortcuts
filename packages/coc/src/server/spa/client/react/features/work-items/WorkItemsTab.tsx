/**
 * WorkItemsTab — sub-tab for managing work items within a repository.
 * Replaces the Plans tab with a list + detail split view.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button, cn } from '../../ui';
import { Spinner } from '../../ui';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { WorkItemSection } from './WorkItemSection';
import { WorkItemDetail } from './WorkItemDetail';
import { WorkItemExecutionSession } from './WorkItemExecutionSession';
import { WorkItemHierarchyTree } from './WorkItemHierarchyTree';
import { CommitDetail } from '../git/commits/CommitDetail';
import { FileDiffPanel } from '../git/diff/FileDiffPanel';
import { createCommitDiffSource } from '../git/diff/diffSource';
import { CreateWorkItemDialog } from './CreateWorkItemDialog';
import { useWorkItems } from '../../contexts/WorkItemContext';
import { useApp } from '../../contexts/AppContext';
import { fetchApi } from '../../hooks/useApi';
import { buildFileTree, compactFolders, FileTreeView } from '../git/diff/FileTree';
import { useFileCommentCounts } from '../git/hooks/useFileCommentCounts';
import { computeDiffCommentKey } from '../../../comments/diff-comment-utils';
import { buildWorkItemHash, buildWorkItemSessionHash, buildWorkItemCommitHash } from '../../layout/Router';
import { isWorkItemsHierarchyEnabled, isWorkItemsAiAuthoringEnabled } from '../../utils/config';
import type { WorkItemTypeLabel } from './WorkItemHierarchyNode';
import { WorkItemAiComposer } from './WorkItemAiComposer';

export interface WorkItemsTabProps {
    workspaceId: string;
    /** Called when the user wants to view a completed task in the Tasks tab. */
    onNavigateToTasksTab?: (taskId: string) => void;
}

export function WorkItemsTab({ workspaceId, onNavigateToTasksTab }: WorkItemsTabProps) {
    const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
    const [selectedSessionTaskId, setSelectedSessionTaskId] = useState<string | null>(null);
    const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
    const [selectedCommitFile, setSelectedCommitFile] = useState<string | null>(null);
    const [commitFiles, setCommitFiles] = useState<{ status: string; path: string }[]>([]);
    const [commitFilesLoading, setCommitFilesLoading] = useState(false);
    const [hunkTarget, setHunkTarget] = useState<'first' | 'last' | undefined>(undefined);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [createDialogType, setCreateDialogType] = useState<WorkItemTypeLabel>('work-item');
    const [createDialogParentId, setCreateDialogParentId] = useState<string | undefined>(undefined);
    const [mobileShowDetail, setMobileShowDetail] = useState(false);
    const { isMobile, isTablet } = useBreakpoint();
    const { dispatch } = useWorkItems();
    const { state: appState } = useApp();
    const deepLinkConsumedRef = useRef(false);
    const hierarchyEnabled = isWorkItemsHierarchyEnabled();
    const { width: leftPanelWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: isTablet ? 280 : 340,
        minWidth: 200,
        maxWidth: 600,
        storageKey: 'work-items-left-panel-width',
    });

    // Initialise from URL deep-link on first mount only.
    useEffect(() => {
        if (deepLinkConsumedRef.current) return;
        deepLinkConsumedRef.current = true;
        if (appState.selectedWorkItemId) {
            setSelectedWorkItemId(appState.selectedWorkItemId);
            if (appState.selectedWorkItemSessionTaskId) {
                setSelectedSessionTaskId(appState.selectedWorkItemSessionTaskId);
            }
            if (appState.selectedWorkItemCommitHash) {
                setSelectedCommitHash(appState.selectedWorkItemCommitHash);
                if (appState.selectedWorkItemCommitFilePath) {
                    setSelectedCommitFile(appState.selectedWorkItemCommitFilePath);
                }
            }
            if (isMobile) setMobileShowDetail(true);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch changed files when a commit is selected, auto-select the first file
    useEffect(() => {
        if (!selectedCommitHash) {
            setCommitFiles([]);
            return;
        }
        setCommitFilesLoading(true);
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${selectedCommitHash}/files`)
            .then((data: { files?: { status: string; path: string }[] }) => {
                const files = data.files ?? [];
                setCommitFiles(files);
                if (files.length > 0) {
                    setSelectedCommitFile(files[0].path);
                }
            })
            .catch(() => setCommitFiles([]))
            .finally(() => setCommitFilesLoading(false));
    }, [workspaceId, selectedCommitHash]);

    // Fetch comment counts for the selected commit's files
    const commentCounts = useFileCommentCounts(
        workspaceId,
        selectedCommitHash ? `${selectedCommitHash}^` : null,
        selectedCommitHash,
    );

    const [fileCommentMap, setFileCommentMap] = useState<Map<string, number>>(new Map());

    useEffect(() => {
        if (commentCounts.size === 0 || !selectedCommitHash || commitFiles.length === 0) {
            setFileCommentMap(new Map());
            return;
        }
        let cancelled = false;
        const oldRef = `${selectedCommitHash}^`;
        const computeMap = async () => {
            const map = new Map<string, number>();
            for (const file of commitFiles) {
                const key = await computeDiffCommentKey(workspaceId, oldRef, selectedCommitHash, file.path);
                const count = commentCounts.get(key) ?? 0;
                if (count > 0) map.set(file.path, count);
            }
            if (!cancelled) setFileCommentMap(map);
        };
        void computeMap();
        return () => { cancelled = true; };
    }, [commitFiles, selectedCommitHash, commentCounts, workspaceId]);

    const commitFilePaths = useMemo(
        () => commitFiles.map(f => f.path).sort(),
        [commitFiles],
    );

    const handleSelectWorkItem = useCallback((id: string) => {
        setSelectedWorkItemId(id);
        setSelectedSessionTaskId(null);
        setSelectedCommitHash(null);
        setSelectedCommitFile(null);
        if (isMobile) setMobileShowDetail(true);
        location.hash = buildWorkItemHash(workspaceId, id);
    }, [isMobile, workspaceId]);

    const handleBack = useCallback(() => {
        setSelectedWorkItemId(null);
        setSelectedSessionTaskId(null);
        setSelectedCommitHash(null);
        setSelectedCommitFile(null);
        setMobileShowDetail(false);
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/work-items';
    }, [workspaceId]);

    const handleBackFromSession = useCallback(() => {
        setSelectedSessionTaskId(null);
        if (selectedWorkItemId) {
            location.hash = buildWorkItemHash(workspaceId, selectedWorkItemId);
        }
    }, [workspaceId, selectedWorkItemId]);

    const handleViewCommit = useCallback((sha: string) => {
        setSelectedCommitHash(sha);
        setSelectedCommitFile(null);
        setHunkTarget(undefined);
        if (selectedWorkItemId) {
            location.hash = buildWorkItemCommitHash(workspaceId, selectedWorkItemId, sha);
        }
    }, [workspaceId, selectedWorkItemId]);

    const handleBackFromCommit = useCallback(() => {
        if (selectedCommitFile) {
            setSelectedCommitFile(null);
            setHunkTarget(undefined);
            if (selectedWorkItemId && selectedCommitHash) {
                location.hash = buildWorkItemCommitHash(workspaceId, selectedWorkItemId, selectedCommitHash);
            }
        } else {
            setSelectedCommitHash(null);
            if (selectedWorkItemId) {
                location.hash = buildWorkItemHash(workspaceId, selectedWorkItemId);
            }
        }
    }, [selectedCommitFile, selectedWorkItemId, selectedCommitHash, workspaceId]);

    const handleCommitFileSelect = useCallback((filePath: string) => {
        setSelectedCommitFile(filePath);
        setHunkTarget(undefined);
        if (selectedWorkItemId && selectedCommitHash) {
            location.hash = buildWorkItemCommitHash(workspaceId, selectedWorkItemId, selectedCommitHash, filePath);
        }
    }, [workspaceId, selectedWorkItemId, selectedCommitHash]);

    const handleNavigateToFile = useCallback((filePath: string, target: 'first' | 'last') => {
        setSelectedCommitFile(filePath);
        setHunkTarget(target);
    }, []);

    const handleViewTask = useCallback((taskId: string) => {
        setSelectedSessionTaskId(taskId);
        if (selectedWorkItemId) {
            location.hash = buildWorkItemSessionHash(workspaceId, selectedWorkItemId, taskId);
        }
    }, [workspaceId, selectedWorkItemId]);

    const handleCreated = useCallback((item: any) => {
        dispatch({ type: 'WORK_ITEM_ADDED', repoId: workspaceId, item });
        setSelectedWorkItemId(item.id);
        setSelectedSessionTaskId(null);
        setSelectedCommitHash(null);
        setSelectedCommitFile(null);
        if (isMobile) setMobileShowDetail(true);
        location.hash = buildWorkItemHash(workspaceId, item.id);
    }, [dispatch, workspaceId, isMobile]);

    const handleExecuted = useCallback(() => {
        // Refresh work items after execution
        dispatch({ type: 'SET_LOADING', repoId: workspaceId, loading: true });
    }, [dispatch, workspaceId]);

    const openCreateDialog = useCallback((type: WorkItemTypeLabel, parentId?: string) => {
        setCreateDialogType(type);
        setCreateDialogParentId(parentId);
        setShowCreateDialog(true);
    }, []);

    const [showAiComposer, setShowAiComposer] = useState(false);
    const aiAuthoringEnabled = isWorkItemsAiAuthoringEnabled();

    const listPane = hierarchyEnabled ? (
        <WorkItemHierarchyTree
            workspaceId={workspaceId}
            selectedWorkItemId={selectedWorkItemId}
            onSelectWorkItem={handleSelectWorkItem}
            onCreated={handleCreated}
            onCreateItem={openCreateDialog}
            onCreateWithAi={aiAuthoringEnabled ? () => setShowAiComposer(true) : undefined}
            isMobile={isMobile}
        />
    ) : (
        <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Work Items</h2>
                <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openCreateDialog('work-item')} data-testid="create-work-item-btn">
                        + New
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openCreateDialog('bug')} data-testid="create-bug-btn">
                        🐛 Bug
                    </Button>
                    {aiAuthoringEnabled && (
                        <Button variant="ghost" size="sm" onClick={() => setShowAiComposer(true)} data-testid="create-with-ai-btn">
                            ✨ AI
                        </Button>
                    )}
                </div>
            </div>
            <WorkItemSection
                workspaceId={workspaceId}
                onSelectWorkItem={handleSelectWorkItem}
                selectedWorkItemId={selectedWorkItemId}
            />
        </div>
    );

    const detailPane = selectedWorkItemId ? (
        selectedCommitHash ? (
            <div className="flex flex-col h-full overflow-hidden" data-testid="work-item-commit-review">
                <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#474749] flex items-center gap-2">
                    <button
                        onClick={handleBackFromCommit}
                        className="text-sm text-[#848484] hover:text-[#333] dark:hover:text-[#ccc] shrink-0"
                        data-testid="commit-review-back-btn"
                        aria-label={selectedCommitFile ? 'Back to file list' : 'Back to work item'}
                    >
                        ←
                    </button>
                    <span className="text-xs font-medium text-[#3c3c3c] dark:text-[#cccccc]">
                        {selectedCommitFile ? 'File Diff' : 'Commit Review'}
                    </span>
                    <code className="text-xs text-[#848484] font-mono">{selectedCommitHash.slice(0, 7)}</code>
                    {selectedCommitFile && (
                        <span className="text-[11px] text-[#616161] dark:text-[#999] truncate" title={selectedCommitFile}>
                            — {selectedCommitFile.split('/').pop()}
                        </span>
                    )}
                </div>
                <div className="flex flex-1 min-h-0 overflow-hidden">
                    {/* File list sidebar */}
                    <div
                        className="w-56 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] overflow-y-auto bg-[#f8f8f8] dark:bg-[#1e1e1e]"
                        data-testid="commit-file-sidebar"
                    >
                        <div className="px-2 py-2">
                            <div className="text-[11px] font-medium text-[#616161] dark:text-[#999] mb-1.5 px-1">
                                Changed Files {!commitFilesLoading && commitFiles.length > 0 && `(${commitFiles.length})`}
                            </div>
                            {commitFilesLoading ? (
                                <div className="flex items-center gap-2 text-[11px] text-[#848484] px-1" data-testid="commit-files-loading">
                                    <Spinner size="sm" /> Loading...
                                </div>
                            ) : commitFiles.length > 0 ? (
                                <FileTreeView
                                    nodes={compactFolders(buildFileTree(commitFiles))}
                                    commitHash={selectedCommitHash}
                                    selectedFile={selectedCommitFile ? { hash: selectedCommitHash, filePath: selectedCommitFile } : null}
                                    onFileSelect={(_hash, filePath) => handleCommitFileSelect(filePath)}
                                    fileCommentMap={fileCommentMap}
                                    commentBadgeTestIdPrefix="wi-commit-file-comment-badge"
                                    fileTestIdPrefix="wi-commit-file"
                                />
                            ) : (
                                <div className="text-[11px] text-[#848484] px-1">No files changed</div>
                            )}
                        </div>
                    </div>
                    {/* CommitDetail for overview; FileDiffPanel for file-level diffs */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                        {selectedCommitFile ? (
                            <FileDiffPanel
                                key={`${selectedCommitHash}-${selectedCommitFile}`}
                                source={createCommitDiffSource(workspaceId, selectedCommitHash, {
                                    files: commitFilePaths,
                                })}
                                workspaceId={workspaceId}
                                filePath={selectedCommitFile}
                                onNavigateToFile={handleNavigateToFile}
                                initialHunkTarget={hunkTarget}
                            />
                        ) : (
                            <CommitDetail
                                key={selectedCommitHash}
                                workspaceId={workspaceId}
                                hash={selectedCommitHash}
                            />
                        )}
                    </div>
                </div>
            </div>
        ) : selectedSessionTaskId ? (
            <WorkItemExecutionSession
                taskId={selectedSessionTaskId}
                workspaceId={workspaceId}
                onBack={handleBackFromSession}
            />
        ) : (
            <WorkItemDetail
                workItemId={selectedWorkItemId}
                workspaceId={workspaceId}
                onBack={handleBack}
                onExecuted={handleExecuted}
                onViewTask={handleViewTask}
                onViewCommit={handleViewCommit}
                onNavigateToTasksTab={onNavigateToTasksTab}
                isMobile={isMobile}
                onCreateChild={openCreateDialog}
            />
        )
    ) : (
        <div className="flex items-center justify-center h-full text-sm text-[#848484]">
            <div className="text-center space-y-2">
                <div className="text-3xl">📋</div>
                <div>Select a work item or bug, or create a new one</div>
                <div className="flex gap-2 justify-center flex-wrap">
                    <Button variant="ghost" size="sm" onClick={() => openCreateDialog('work-item')}>
                        + Create Work Item
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openCreateDialog('bug')}>
                        🐛 Create Bug
                    </Button>
                    {aiAuthoringEnabled && (
                        <Button variant="ghost" size="sm" onClick={() => setShowAiComposer(true)} data-testid="create-with-ai-empty-btn">
                            ✨ Create with AI
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );

    if (isMobile) {
        return (
            <>
                <div className="flex flex-col h-full overflow-hidden" data-testid="work-items-panel">
                    {mobileShowDetail && selectedWorkItemId ? (
                        <div className="flex-1 flex flex-col overflow-hidden">{detailPane}</div>
                    ) : (
                        <div className="flex-1 flex flex-col overflow-hidden">{listPane}</div>
                    )}
                </div>
                <CreateWorkItemDialog
                    open={showCreateDialog}
                    onClose={() => setShowCreateDialog(false)}
                    workspaceId={workspaceId}
                    onCreated={handleCreated}
                    itemType={createDialogType}
                    parentId={createDialogParentId}
                />
                <WorkItemAiComposer
                    open={showAiComposer}
                    onClose={() => setShowAiComposer(false)}
                    workspaceId={workspaceId}
                    mode="create"
                    onCreated={handleCreated}
                />
            </>
        );
    }

    return (
        <>
            <div className={cn('flex h-full overflow-hidden', isDragging && 'select-none')} data-testid="work-items-panel">
                <div
                    className="flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden"
                    style={{ width: leftPanelWidth }}
                >
                    {listPane}
                </div>
                <div
                    className="flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 transition-colors flex-shrink-0"
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleTouchStart}
                    role="separator"
                    aria-orientation="vertical"
                />
                <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                    {detailPane}
                </div>
            </div>
            <CreateWorkItemDialog
                open={showCreateDialog}
                onClose={() => setShowCreateDialog(false)}
                workspaceId={workspaceId}
                onCreated={handleCreated}
                itemType={createDialogType}
                parentId={createDialogParentId}
            />
            <WorkItemAiComposer
                open={showAiComposer}
                onClose={() => setShowAiComposer(false)}
                workspaceId={workspaceId}
                mode="create"
                onCreated={handleCreated}
            />
        </>
    );
}
