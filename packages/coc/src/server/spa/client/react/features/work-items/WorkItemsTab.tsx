/**
 * WorkItemsTab — sub-tab for managing work items within a repository.
 * Replaces the Plans tab with a list + detail split view.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button, cn } from '../../ui';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { WorkItemSection } from './WorkItemSection';
import { WorkItemDetail } from './WorkItemDetail';
import { WorkItemExecutionSession } from './WorkItemExecutionSession';
import { WorkItemHierarchyTree } from './WorkItemHierarchyTree';
import { WorkItemCommitReviewPane } from './WorkItemCommitReviewPane';
import { CreateWorkItemDialog } from './CreateWorkItemDialog';
import { ImportFromGitHubDialog } from './ImportFromGitHubDialog';
import { useWorkItems } from '../../contexts/WorkItemContext';
import { useApp } from '../../contexts/AppContext';
import { fetchApi } from '../../hooks/useApi';
import { useFileCommentCounts } from '../git/hooks/useFileCommentCounts';
import { computeDiffCommentKey } from '../../../comments/diff-comment-utils';
import { buildWorkItemHash, buildWorkItemSessionHash, buildWorkItemCommitHash } from '../../layout/Router';
import { isWorkItemsHierarchyEnabled, isWorkItemsAiAuthoringEnabled } from '../../utils/config';
import type { WorkItemTypeLabel } from './WorkItemHierarchyNode';
import { WorkItemAiComposer } from './WorkItemAiComposer';
import type { WorkItemSyncProvider, WorkItemTrackerKind } from '@plusplusoneplusplus/coc-client';
import {
    WORK_ITEM_TRACKER_TABS,
    getTrackerKindsForView,
    readStoredWorkItemTrackerView,
    type WorkItemRemoteProviderFilter,
    type WorkItemTrackerViewKind,
    writeStoredWorkItemTrackerView,
} from './workItemTrackerViews';

function GitHubIcon({ className, testId }: { className?: string; testId?: string }) {
    return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true" data-testid={testId}>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
    );
}

function AzureDevOpsIcon({ className, testId }: { className?: string; testId?: string }) {
    return (
        <svg className={className} viewBox="0 0 16 16" fill="currentColor" width="14" height="14" aria-hidden="true" data-testid={testId}>
            <path d="M15 3.622v8.512L11.5 15l-5.425-1.975v1.958L3.004 10.97l8.951.7V4.005L15 3.622zm-2.984.428L6.994 1v2.001L2.382 4.356 1 6.13v4.029l1.978.873V5.869l9.038-1.819z" />
        </svg>
    );
}

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
    const [activeTracker, setActiveTracker] = useState<WorkItemTrackerViewKind>(() => readStoredWorkItemTrackerView(workspaceId));
    const [remoteProviderFilter, setRemoteProviderFilter] = useState<WorkItemRemoteProviderFilter>('all');
    const [detectedRemoteProvider, setDetectedRemoteProvider] = useState<WorkItemSyncProvider | undefined>(undefined);
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
    const [showImportDialog, setShowImportDialog] = useState(false);
    const [importDialogProvider, setImportDialogProvider] = useState<WorkItemSyncProvider>('github');
    const [highlightedWorkItemId, setHighlightedWorkItemId] = useState<string | null>(null);

    const openImportDialog = useCallback((provider?: WorkItemSyncProvider) => {
        const nextProvider = provider ?? (remoteProviderFilter === 'azure-boards' ? 'azure-boards' : 'github');
        setImportDialogProvider(nextProvider);
        setShowImportDialog(true);
    }, [remoteProviderFilter]);
    const remoteImportProviderOptions = useMemo<readonly WorkItemSyncProvider[]>(
        () => [importDialogProvider],
        [importDialogProvider],
    );
    const selectTracker = useCallback((viewKind: WorkItemTrackerViewKind) => {
        setActiveTracker(viewKind);
        writeStoredWorkItemTrackerView(workspaceId, viewKind);
    }, [workspaceId]);

    const handleImported = useCallback((item: any, provider?: WorkItemSyncProvider) => {
        const importedProvider: WorkItemRemoteProviderFilter =
            provider
            ?? (item?.tracker?.kind === 'azure-boards-backed' ? 'azure-boards' : item?.tracker?.kind === 'github-backed' ? 'github' : 'all');
        selectTracker('remote');
        setRemoteProviderFilter(importedProvider);
        dispatch({ type: 'WORK_ITEM_ADDED', repoId: workspaceId, item });
        setSelectedWorkItemId(item.id);
        setSelectedSessionTaskId(null);
        setSelectedCommitHash(null);
        setSelectedCommitFile(null);
        setHighlightedWorkItemId(item.id);
        if (isMobile) setMobileShowDetail(true);
        location.hash = buildWorkItemHash(workspaceId, item.id);
        setTimeout(() => setHighlightedWorkItemId(null), 2000);
    }, [dispatch, workspaceId, isMobile, selectTracker]);

    const remoteTrackerKinds = useMemo<WorkItemTrackerKind[]>(
        () => getTrackerKindsForView(activeTracker, remoteProviderFilter),
        [activeTracker, remoteProviderFilter],
    );
    const remoteTabProvider = detectedRemoteProvider ?? (remoteProviderFilter === 'all' ? undefined : remoteProviderFilter);

    const listPane = hierarchyEnabled ? (
        <div className="flex flex-col h-full" data-testid="work-item-tracker-tabs-panel">
            <div
                className="border-b border-[#d0d7de] dark:border-[#474749] bg-white dark:bg-[#1e1e1e] px-2 py-2 shrink-0"
                role="tablist"
                aria-label="Work item tracker"
            >
                <div className="grid grid-cols-2 gap-1 rounded-[7px] border border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] p-[3px]">
                    {WORK_ITEM_TRACKER_TABS.map(tab => {
                        const active = activeTracker === tab.kind;
                        return (
                            <button
                                key={tab.kind}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                className={cn(
                                    'rounded-[5px] px-[7px] py-[5px] text-left transition-colors min-h-[30px] flex items-center',
                                    active
                                        ? 'bg-white text-[#1f2328] shadow-[0_1px_2px_rgba(31,35,40,0.08)] dark:bg-[#333] dark:text-[#f0f0f0]'
                                        : 'text-[#656d76] hover:text-[#1f2328] dark:text-[#999] dark:hover:text-[#f0f0f0]',
                                )}
                                onClick={() => {
                                    selectTracker(tab.kind);
                                    setSelectedWorkItemId(null);
                                    setSelectedSessionTaskId(null);
                                    setSelectedCommitHash(null);
                                    setSelectedCommitFile(null);
                                    if (isMobile) setMobileShowDetail(false);
                                    location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/work-items';
                                }}
                                data-testid={`work-item-tracker-tab-${tab.kind}`}
                            >
                                <span className="flex items-center w-full gap-1.5 min-w-0">
                                    {tab.kind === 'remote' && remoteTabProvider === 'github' && (
                                        <GitHubIcon className="shrink-0 opacity-70" testId="work-item-tracker-tab-remote-github-icon" />
                                    )}
                                    {tab.kind === 'remote' && remoteTabProvider === 'azure-boards' && (
                                        <AzureDevOpsIcon className="shrink-0 opacity-70" testId="work-item-tracker-tab-remote-azure-boards-icon" />
                                    )}
                                    <strong className="text-[12px] leading-[1.2] font-semibold">{tab.label}</strong>
                                    <span className="ml-auto text-[11px] font-semibold font-mono leading-[1.2]" />
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>
            <WorkItemHierarchyTree
                key={`${activeTracker}-${remoteProviderFilter}`}
                workspaceId={workspaceId}
                trackerViewKind={activeTracker}
                trackerKinds={remoteTrackerKinds}
                remoteProviderFilter={remoteProviderFilter}
                onRemoteProviderFilterChange={setRemoteProviderFilter}
                onDetectedRemoteProviderChange={setDetectedRemoteProvider}
                selectedWorkItemId={selectedWorkItemId}
                onSelectWorkItem={handleSelectWorkItem}
                onCreated={handleCreated}
                onCreateItem={openCreateDialog}
                onCreateWithAi={activeTracker === 'local' && aiAuthoringEnabled ? () => setShowAiComposer(true) : undefined}
                onImportFromRemote={activeTracker === 'remote' ? openImportDialog : undefined}
                highlightedWorkItemId={highlightedWorkItemId}
                isMobile={isMobile}
            />
        </div>
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
                    <Button variant="ghost" size="sm" onClick={() => openImportDialog('github')} data-testid="import-from-github-btn">
                        Import from GitHub
                    </Button>
                </div>
            </div>
            <WorkItemSection
                workspaceId={workspaceId}
                onSelectWorkItem={handleSelectWorkItem}
                selectedWorkItemId={selectedWorkItemId}
                highlightedWorkItemId={highlightedWorkItemId}
            />
        </div>
    );

    const detailPane = selectedWorkItemId ? (
        selectedCommitHash ? (
            <WorkItemCommitReviewPane
                workspaceId={workspaceId}
                selectedCommitHash={selectedCommitHash}
                selectedCommitFile={selectedCommitFile}
                commitFiles={commitFiles}
                commitFilesLoading={commitFilesLoading}
                commitFilePaths={commitFilePaths}
                fileCommentMap={fileCommentMap}
                hunkTarget={hunkTarget}
                onBackFromCommit={handleBackFromCommit}
                onCommitFileSelect={handleCommitFileSelect}
                onNavigateToFile={handleNavigateToFile}
            />
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
                <ImportFromGitHubDialog
                    open={showImportDialog}
                    onClose={() => setShowImportDialog(false)}
                    workspaceId={workspaceId}
                    initialProvider={importDialogProvider}
                    providerOptions={activeTracker === 'remote' ? remoteImportProviderOptions : undefined}
                    onImported={handleImported}
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
                    className="w-[6px] cursor-col-resize flex-shrink-0 transition-colors"
                    style={{
                        background: 'linear-gradient(to right, #eaeef2, #f6f8fa 1px, #f6f8fa calc(100% - 1px), #eaeef2)',
                    }}
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
            <ImportFromGitHubDialog
                open={showImportDialog}
                onClose={() => setShowImportDialog(false)}
                workspaceId={workspaceId}
                initialProvider={importDialogProvider}
                providerOptions={activeTracker === 'remote' ? remoteImportProviderOptions : undefined}
                onImported={handleImported}
            />
        </>
    );
}
