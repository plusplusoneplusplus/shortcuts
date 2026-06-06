/**
 * WorkItemHierarchyTree — the hierarchy board left pane.
 * Renders a collapsible hierarchy tree with Epic → Feature → PBI → WI/Bug.
 * Includes create actions, search, and context menu per node.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, cn } from '../../ui';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useWorkItems } from '../../contexts/WorkItemContext';
import { WorkItemHierarchyNode } from './WorkItemHierarchyNode';
import { WorkItemParentPicker } from './WorkItemParentPicker';
import { ContextMenu } from '../../tasks/comments/ContextMenu';
import type { ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { createWorkItemContextDragPayload } from '../chat/sessionContextDrag';
import {
    ALLOWED_CHILD_TYPES,
    type WorkItemSyncProvider,
    type WorkItemSyncProviderStatus,
    type WorkItemSyncStatusResponse,
    type WorkItemTrackerKind,
    type WorkItemTreeNode,
    type WorkItemTreeResponse,
} from '@plusplusoneplusplus/coc-client';
import { isSessionContextAttachmentsEnabled, isWorkItemsSyncEnabled } from '../../utils/config';
import type { WorkItemTypeLabel } from './WorkItemHierarchyNode';
import { TYPE_LABELS } from './WorkItemHierarchyNode';
import {
    buildWorkItemTreeFilters,
    getRemoteProviderFilterOptions,
    getTrackerKindsForRemoteProvider,
    getWorkItemTrackerViewCopy,
    isRemoteTrackerView,
    isGitHubTrackerView as isGitHubTrackerKind,
    shouldShowLocalRootCreationActions,
    type WorkItemRemoteProviderFilter,
    type WorkItemTrackerViewKind,
} from './workItemTrackerViews';

const TYPE_CHILD_LABELS: Record<WorkItemTypeLabel, string> = {
    epic:        'Feature',
    feature:     'PBI / Story',
    pbi:         'Work Item / Bug',
    'work-item': '',
    bug:         '',
};

const COLLAPSE_STORAGE_KEY = (workspaceId: string) => `coc-hierarchy-collapsed-${workspaceId}`;
const REMOTE_PROVIDER_LABELS: Record<WorkItemSyncProvider, string> = {
    github: 'GitHub',
    'azure-boards': 'Azure Boards',
};

interface RemoteSyncStatusState {
    loading: boolean;
    response?: WorkItemSyncStatusResponse;
    error?: string;
}

interface RemoteSyncStatusNotice {
    tone: 'muted' | 'warning' | 'error';
    message: string;
}

function loadCollapsed(workspaceId: string): Set<string> {
    try {
        const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY(workspaceId));
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
}

function saveCollapsed(workspaceId: string, ids: Set<string>): void {
    try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY(workspaceId), JSON.stringify([...ids]));
    } catch { /* quota exceeded */ }
}

function remoteProviderFilterLabel(filter: WorkItemRemoteProviderFilter): string {
    return filter === 'all' ? 'remote providers' : REMOTE_PROVIDER_LABELS[filter];
}

function unavailableStatusMessage(status: WorkItemSyncProviderStatus): string {
    if (status.message) return status.message;
    if (status.provider === 'azure-boards') {
        switch (status.reason) {
            case 'missing-org-url':
                return 'Azure DevOps organization URL is not configured in Provider Tokens.';
            case 'missing-project':
                return 'Azure Boards project is not configured for this workspace.';
            case 'auth-unavailable':
                return status.auth?.message ?? 'Azure CLI authentication is unavailable. Run az login and ensure Azure DevOps access.';
            case 'missing-workspace':
                return 'Workspace metadata is unavailable.';
            default:
                return 'Azure Boards sync is unavailable.';
        }
    }
    switch (status.reason) {
        case 'missing-origin':
        case 'non-github-origin':
        case 'incomplete-preference':
            return 'GitHub repository is not configured for this workspace.';
        case 'auth-unavailable':
            return status.auth?.message ?? 'GitHub authentication is unavailable.';
        default:
            return 'GitHub sync is unavailable.';
    }
}

function providersForFilter(response: WorkItemSyncStatusResponse, filter: WorkItemRemoteProviderFilter): WorkItemSyncProviderStatus[] {
    const providers = response.providers.length > 0
        ? response.providers
        : response.provider ? [response.provider] : [];
    return filter === 'all' ? providers : providers.filter(provider => provider.provider === filter);
}

function remoteSyncStatusNotice(state: RemoteSyncStatusState, filter: WorkItemRemoteProviderFilter): RemoteSyncStatusNotice | null {
    const providerLabel = remoteProviderFilterLabel(filter);
    if (state.loading) {
        return {
            tone: 'muted',
            message: `Checking ${providerLabel} sync status...`,
        };
    }
    if (state.error) {
        return {
            tone: 'error',
            message: `Unable to check ${providerLabel} sync status: ${state.error}`,
        };
    }
    const response = state.response;
    if (!response) return null;
    if (response.disabled) {
        return {
            tone: 'warning',
            message: response.disabledReason === 'hierarchy-disabled'
                ? 'Remote sync is unavailable because Work Items hierarchy is disabled.'
                : 'Remote sync is disabled by configuration. Enable Work Items sync to import or refresh remote Epic trees.',
        };
    }
    if (!response.remoteProvider && response.providers.length === 0 && !response.provider) {
        return {
            tone: 'warning',
            message: 'No supported remote provider was detected for this workspace repo. Configure a GitHub or Azure DevOps remote to use remote work-item sync.',
        };
    }
    const providers = providersForFilter(response, filter);
    if (providers.length === 0) {
        return {
            tone: 'warning',
            message: `${providerLabel} sync status is unavailable.`,
        };
    }
    const unavailable = providers.filter(provider => !provider.available);
    if (unavailable.length > 0) {
        const status = unavailable[0];
        return {
            tone: 'warning',
            message: `${REMOTE_PROVIDER_LABELS[status.provider]} unavailable: ${unavailableStatusMessage(status)}`,
        };
    }
    return null;
}

export interface WorkItemHierarchyTreeProps {
    workspaceId: string;
    /** Filters the tree to one Epic-rooted tracker partition. */
    trackerKind?: WorkItemTrackerKind;
    /** Filters the tree to multiple Epic-rooted tracker partitions, merged in order. */
    trackerKinds?: readonly WorkItemTrackerKind[];
    /** UI-level tracker view used for copy and Remote provider controls. */
    trackerViewKind?: WorkItemTrackerViewKind;
    remoteProviderFilter?: WorkItemRemoteProviderFilter;
    onRemoteProviderFilterChange?: (provider: WorkItemRemoteProviderFilter) => void;
    onDetectedRemoteProviderChange?: (provider: WorkItemSyncProvider | undefined) => void;
    selectedWorkItemId: string | null;
    onSelectWorkItem: (id: string) => void;
    /** Called when a new work item is created from within the tree. */
    onCreated: (item: any) => void;
    /** Open the create dialog for a given type with an optional parent. */
    onCreateItem: (type: WorkItemTypeLabel, parentId?: string) => void;
    /** When provided, renders the "✨ Create with AI" entry point in the tree header and empty state. */
    onCreateWithAi?: () => void;
    /** When provided in Remote view, opens import for the detected remote provider. */
    onImportFromRemote?: (provider: WorkItemSyncProvider) => void;
    /** Legacy GitHub-only import entry point used outside the Remote/Synced tracker view. */
    onImportFromGitHub?: () => void;
    /** Newly imported item id to scroll to and highlight once the tree renders it. */
    highlightedWorkItemId?: string | null;
    /** When true, renders the always-visible mobile add-child buttons. */
    isMobile?: boolean;
}

export function WorkItemHierarchyTree({
    workspaceId,
    trackerKind,
    trackerKinds,
    trackerViewKind,
    remoteProviderFilter = 'all',
    onRemoteProviderFilterChange,
    onDetectedRemoteProviderChange,
    selectedWorkItemId,
    onSelectWorkItem,
    onCreated,
    onCreateItem,
    onCreateWithAi,
    onImportFromRemote,
    onImportFromGitHub,
    highlightedWorkItemId,
    isMobile = false,
}: WorkItemHierarchyTreeProps) {
    const [treeData, setTreeData] = useState<WorkItemTreeNode[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => loadCollapsed(workspaceId));
    const [showArchived, setShowArchived] = useState(false);
    const [showDone, setShowDone] = useState(false);
    const [remoteStatus, setRemoteStatus] = useState<RemoteSyncStatusState>({ loading: false });
    const requestedTrackerKinds = useMemo(
        () => trackerKinds ? [...trackerKinds] : (trackerKind ? [trackerKind] : []),
        [trackerKind, trackerKinds],
    );
    const showLocalRootCreationActions = shouldShowLocalRootCreationActions(trackerViewKind ?? trackerKind);
    const isGitHubTrackerView = isGitHubTrackerKind(trackerKind);
    const isRemoteView = isRemoteTrackerView(trackerViewKind);
    const workItemsSyncEnabled = isWorkItemsSyncEnabled();
    const sessionContextDragEnabled = isSessionContextAttachmentsEnabled();
    const detectedRemoteProvider = isRemoteView ? remoteStatus.response?.remoteProvider : undefined;
    const visibleRemoteProviderFilter: WorkItemRemoteProviderFilter = detectedRemoteProvider ?? remoteProviderFilter;
    const remoteProviderFilterOptions = isRemoteView && remoteStatus.response && !remoteStatus.response.disabled
        ? detectedRemoteProvider ? getRemoteProviderFilterOptions(detectedRemoteProvider) : []
        : [];
    const remoteProviderAffordancesVisible = isRemoteView && !!detectedRemoteProvider;
    const effectiveTrackerKinds = useMemo(() => {
        if (!isRemoteView) return requestedTrackerKinds;
        if (!workItemsSyncEnabled) return [];
        if (detectedRemoteProvider) return getTrackerKindsForRemoteProvider(detectedRemoteProvider);
        if (remoteStatus.error) return requestedTrackerKinds;
        return [];
    }, [detectedRemoteProvider, isRemoteView, remoteStatus.error, requestedTrackerKinds, workItemsSyncEnabled]);
    const trackerCopy = getWorkItemTrackerViewCopy(trackerViewKind, visibleRemoteProviderFilter);
    const remoteStatusNotice = remoteSyncStatusNotice(remoteStatus, visibleRemoteProviderFilter);

    const [contextMenu, setContextMenu] = useState<{
        node: WorkItemTreeNode;
        position: { x: number; y: number };
    } | null>(null);

    const [parentPicker, setParentPicker] = useState<{
        itemId: string;
        itemType: WorkItemTypeLabel;
        currentParentId?: string;
    } | null>(null);

    const [typePicker, setTypePicker] = useState<{ node: WorkItemTreeNode } | null>(null);

    const handleAddChild = useCallback((node: WorkItemTreeNode) => {
        const effectiveType = (node.item.type ?? 'work-item') as WorkItemTypeLabel;
        const childTypes = ALLOWED_CHILD_TYPES[effectiveType] ?? [];
        if (childTypes.length === 0) return;
        if (childTypes.length === 1) {
            onCreateItem(childTypes[0] as WorkItemTypeLabel, node.item.id);
        } else {
            setTypePicker({ node });
        }
    }, [onCreateItem]);

    const { state: workItemState } = useWorkItems();
    const lastFetchedAt = useRef<string>('');

    const fetchTree = useCallback(async () => {
        setLoading(true);
        setError(null);
        if (isRemoteView && effectiveTrackerKinds.length === 0) {
            setTreeData([]);
            setTotal(0);
            setLoading(false);
            return;
        }
        try {
            const filters = buildWorkItemTreeFilters({
                searchQuery,
                trackerKinds: effectiveTrackerKinds,
                showArchived,
                showDone,
            });
            const responses: WorkItemTreeResponse[] = await Promise.all(
                filters.map(filter => getSpaCocClient().workItems.tree(workspaceId, filter)),
            );
            if (responses.some(resp => resp.disabled)) {
                setError('Hierarchy feature is disabled.');
                return;
            }
            setTreeData(responses.flatMap(resp => resp.roots));
            setTotal(responses.reduce((sum, resp) => sum + resp.total, 0));
            lastFetchedAt.current = new Date().toISOString();
        } catch (err: any) {
            setError(err.message ?? 'Failed to load hierarchy');
        } finally {
            setLoading(false);
        }
    }, [workspaceId, effectiveTrackerKinds, isRemoteView, searchQuery, showArchived, showDone]);

    // Initial load
    useEffect(() => { fetchTree(); }, [fetchTree]);

    useEffect(() => {
        if (!isRemoteView) {
            setRemoteStatus({ loading: false });
            onDetectedRemoteProviderChange?.(undefined);
            return;
        }
        if (!workItemsSyncEnabled) {
            setRemoteStatus({
                loading: false,
                response: {
                    enabled: false,
                    disabled: true,
                    disabledReason: 'sync-disabled',
                    maxItems: 0,
                    providers: [],
                },
            });
            return;
        }
        let cancelled = false;
        setRemoteStatus({ loading: true });
        getSpaCocClient().workItems.syncStatus(workspaceId)
            .then(response => {
                if (!cancelled) setRemoteStatus({ loading: false, response });
            })
            .catch(error => {
                if (!cancelled) {
                    setRemoteStatus({
                        loading: false,
                        error: getSpaCocClientErrorMessage(error, 'Failed to load remote sync status'),
                    });
                }
            });
        return () => { cancelled = true; };
    }, [isRemoteView, onDetectedRemoteProviderChange, workItemsSyncEnabled, workspaceId]);

    useEffect(() => {
        if (!isRemoteView) return;
        onDetectedRemoteProviderChange?.(detectedRemoteProvider);
        if (detectedRemoteProvider && remoteProviderFilter !== detectedRemoteProvider) {
            onRemoteProviderFilterChange?.(detectedRemoteProvider);
        }
    }, [
        detectedRemoteProvider,
        isRemoteView,
        onDetectedRemoteProviderChange,
        onRemoteProviderFilterChange,
        remoteProviderFilter,
    ]);

    // Refresh when WebSocket events arrive (work item context changes)
    const repoItems = workItemState.workItemsByRepo[workspaceId];
    const prevRepoItemsRef = useRef(repoItems);
    useEffect(() => {
        if (prevRepoItemsRef.current === repoItems) return;
        prevRepoItemsRef.current = repoItems;
        // Debounce to avoid multiple rapid refreshes
        const timer = setTimeout(() => fetchTree(), 300);
        return () => clearTimeout(timer);
    }, [repoItems, fetchTree]);

    // Persist collapse state
    useEffect(() => {
        saveCollapsed(workspaceId, collapsedIds);
    }, [workspaceId, collapsedIds]);

    useEffect(() => {
        if (!highlightedWorkItemId) return;
        const element = Array.from(document.querySelectorAll<HTMLElement>('[data-work-item-id]'))
            .find(candidate => candidate.dataset.workItemId === highlightedWorkItemId);
        element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [highlightedWorkItemId, treeData]);

    const handleToggleCollapse = useCallback((id: string) => {
        setCollapsedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent, node: WorkItemTreeNode) => {
        e.preventDefault();
        setContextMenu({ node, position: { x: e.clientX, y: e.clientY } });
    }, []);

    const handleDelete = useCallback(async (id: string) => {
        if (!confirm('Delete this work item? Children must be moved or deleted first.')) return;
        try {
            await getSpaCocClient().workItems.delete(workspaceId, id);
            fetchTree();
        } catch (err: any) {
            alert(err.message ?? 'Failed to delete');
        }
    }, [workspaceId, fetchTree]);

    const buildContextMenuItems = useCallback((node: WorkItemTreeNode): ContextMenuItem[] => {
        const effectiveType = (node.item.type ?? 'work-item') as WorkItemTypeLabel;
        const childTypes = ALLOWED_CHILD_TYPES[effectiveType] ?? [];
        const items: ContextMenuItem[] = [];

        // Create child actions
        if (childTypes.length > 0) {
            const childLabel = TYPE_CHILD_LABELS[effectiveType];
            items.push({
                label: `Add ${childLabel}`,
                icon: '➕',
                onClick: () => {
                    if (childTypes.length === 1) {
                        onCreateItem(childTypes[0], node.item.id);
                    } else {
                        // pbi → work-item or bug; open dialog for work-item first
                        onCreateItem('work-item', node.item.id);
                    }
                },
            });
            if (childTypes.length > 1) {
                items.push({
                    label: 'Add Bug',
                    icon: '🐛',
                    onClick: () => onCreateItem('bug', node.item.id),
                });
            }
        }

        // Change parent
        if (effectiveType !== 'epic') {
            items.push({
                label: 'Change Parent…',
                icon: '🔗',
                onClick: () => setParentPicker({
                    itemId: node.item.id,
                    itemType: effectiveType,
                    currentParentId: node.item.parentId ?? undefined,
                }),
                separator: childTypes.length > 0,
            });
            if (node.item.parentId) {
                items.push({
                    label: 'Unlink Parent',
                    icon: '🔓',
                    onClick: async () => {
                        try {
                            await getSpaCocClient().workItems.update(workspaceId, node.item.id, { parentId: null });
                            fetchTree();
                        } catch (err: any) {
                            alert(err.message ?? 'Failed to unlink');
                        }
                    },
                });
            }
        }

        // Pin/archive/delete
        items.push({
            label: node.item.pinnedAt ? 'Unpin' : 'Pin',
            icon: '📌',
            separator: true,
            onClick: async () => {
                try {
                    await getSpaCocClient().workItems.pin(workspaceId, node.item.id, !node.item.pinnedAt);
                    fetchTree();
                } catch (err: any) {
                    alert(err.message ?? 'Failed to pin');
                }
            },
        });
        items.push({
            label: node.item.archivedAt ? 'Unarchive' : 'Archive',
            icon: '🗄️',
            onClick: async () => {
                try {
                    await getSpaCocClient().workItems.archive(workspaceId, node.item.id, !node.item.archivedAt);
                    fetchTree();
                } catch (err: any) {
                    alert(err.message ?? 'Failed to archive');
                }
            },
        });
        items.push({
            label: 'Delete',
            icon: '🗑',
            onClick: () => handleDelete(node.item.id),
        });

        return items;
    }, [workspaceId, onCreateItem, fetchTree, handleDelete]);

    /** Recursively render a tree node and its children. */
    const renderNode = useCallback((node: WorkItemTreeNode, depth: number): React.ReactNode => {
        const id = node.item.id;
        const hasChildren = node.children.length > 0;
        const collapsed = collapsedIds.has(id);
        const sessionContextPayload = sessionContextDragEnabled
            ? createWorkItemContextDragPayload(node.item, { activeWorkspaceId: workspaceId })
            : null;

        return (
            <WorkItemHierarchyNode
                key={id}
                node={node}
                depth={depth}
                collapsed={collapsed}
                selected={selectedWorkItemId === id}
                hasChildren={hasChildren}
                onSelect={onSelectWorkItem}
                onToggleCollapse={handleToggleCollapse}
                onContextMenu={handleContextMenu}
                isMobile={isMobile}
                onAddChild={handleAddChild}
                highlighted={highlightedWorkItemId === id}
                sessionContextPayload={sessionContextPayload}
            >
                {!collapsed && node.children.map(child => renderNode(child, depth + 1))}
            </WorkItemHierarchyNode>
        );
    }, [collapsedIds, selectedWorkItemId, onSelectWorkItem, handleToggleCollapse, handleContextMenu, isMobile, handleAddChild, highlightedWorkItemId, sessionContextDragEnabled, workspaceId]);

    const readyCount = useMemo(() => {
        const countReady = (nodes: WorkItemTreeNode[]): number =>
            nodes.reduce((sum, n) => sum + (n.item.status === 'readyToExecute' ? 1 : 0) + countReady(n.children), 0);
        return countReady(treeData);
    }, [treeData]);
    const runCount = useMemo(() => {
        const countRunning = (nodes: WorkItemTreeNode[]): number =>
            nodes.reduce((sum, n) => sum + (n.item.status === 'executing' || n.item.status === 'aiDone' ? 1 : 0) + countRunning(n.children), 0);
        return countRunning(treeData);
    }, [treeData]);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="flex flex-col flex-1 min-h-0" data-testid="work-item-hierarchy-tree">
            {/* ── Rail top: search + actions + filters ── */}
            <div className="border-b border-[#d0d7de] dark:border-[#474749] bg-white dark:bg-[#1e1e1e] px-2 py-2 shrink-0 grid gap-1.5">
                {/* Command line: search + New + Import + more */}
                <div className="grid gap-1 items-center" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto auto' }}>
                    <label className="flex items-center gap-1.5 border border-[#d0d7de] dark:border-[#555] bg-white dark:bg-[#1e1e1e] rounded-md px-2 h-7">
                        <span className="text-[#656d76] dark:text-[#999] text-[12px] font-mono shrink-0">s</span>
                        <input
                            type="search"
                            className="flex-1 min-w-0 border-0 outline-none bg-transparent text-[12px] text-[#1f2328] dark:text-[#cccccc] placeholder-[#656d76] dark:placeholder-[#999]"
                            placeholder="Search work items"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            data-testid="hierarchy-search-input"
                        />
                    </label>
                    {showLocalRootCreationActions && (
                        <button
                            className="inline-flex items-center justify-center gap-[5px] min-h-7 border border-[rgba(31,35,40,0.15)] rounded-md bg-[#1f883d] text-white px-2 text-[12px] font-semibold tracking-[0.02em] whitespace-nowrap hover:bg-[#1a7f37] dark:bg-[#238636] dark:hover:bg-[#2ea043]"
                            onClick={() => onCreateItem('epic')}
                            data-testid="create-epic-btn"
                            title="Create new work item"
                            type="button"
                        >
                            New
                        </button>
                    )}
                    {remoteProviderAffordancesVisible && detectedRemoteProvider && onImportFromRemote && (
                        <button
                            className="inline-flex items-center justify-center gap-[5px] min-h-7 border border-[#d0d7de] dark:border-[#555] rounded-md bg-[#f6f8fa] dark:bg-[#333] text-[#1f2328] dark:text-[#f0f0f0] px-2 text-[12px] font-semibold tracking-[0.02em] whitespace-nowrap hover:bg-[#f3f4f6] dark:hover:bg-[#3c3c3c]"
                            onClick={() => onImportFromRemote(detectedRemoteProvider)}
                            data-testid="import-from-remote-btn"
                            title={`Import a ${REMOTE_PROVIDER_LABELS[detectedRemoteProvider]} Epic tree`}
                            type="button"
                        >
                            Import remote
                        </button>
                    )}
                    {onImportFromGitHub && (
                        <button
                            className="inline-flex items-center justify-center gap-[5px] min-h-7 border border-[#d0d7de] dark:border-[#555] rounded-md bg-[#f6f8fa] dark:bg-[#333] text-[#1f2328] dark:text-[#f0f0f0] px-2 text-[12px] font-semibold tracking-[0.02em] whitespace-nowrap hover:bg-[#f3f4f6] dark:hover:bg-[#3c3c3c]"
                            onClick={onImportFromGitHub}
                            data-testid="import-from-github-btn"
                            title="Import from GitHub"
                            type="button"
                        >
                            Import
                        </button>
                    )}
                    {onCreateWithAi && (
                        <button
                            className="inline-flex items-center justify-center w-7 h-7 border border-[#d0d7de] dark:border-[#555] rounded-md bg-[#f6f8fa] dark:bg-[#333] text-[#1f2328] dark:text-[#f0f0f0] text-[12px] font-semibold hover:bg-[#f3f4f6] dark:hover:bg-[#3c3c3c]"
                            type="button"
                            data-testid="hierarchy-create-with-ai-btn"
                            title="Create with AI"
                            aria-label="Create with AI"
                            onClick={onCreateWithAi}
                        >
                            ✨
                        </button>
                    )}
                    <button
                        className="inline-flex items-center justify-center w-7 h-7 border border-[#d0d7de] dark:border-[#555] rounded-md bg-[#f6f8fa] dark:bg-[#333] text-[#1f2328] dark:text-[#f0f0f0] text-[12px] font-semibold hover:bg-[#f3f4f6] dark:hover:bg-[#3c3c3c]"
                        type="button"
                        aria-label="More actions"
                        title="More actions"
                    >
                        ...
                    </button>
                </div>
                {/* Filter chips */}
                <div className="flex items-center gap-1 min-w-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }} aria-label="Tree filters">
                    <button
                        className={cn(
                            'border rounded-full bg-white dark:bg-transparent h-6 px-2 text-[11px] inline-flex items-center gap-1 whitespace-nowrap transition-colors',
                            !showDone && !showArchived
                                ? 'border-[#0969da] text-[#0969da] bg-[#ddf4ff] dark:border-[#0969da] dark:text-[#58a6ff] dark:bg-[#0969da]/15 font-semibold'
                                : 'border-[#d0d7de] dark:border-[#555] text-[#656d76] dark:text-[#999]',
                        )}
                        onClick={() => { setShowDone(false); setShowArchived(false); }}
                        type="button"
                        aria-pressed={!showDone && !showArchived}
                    >
                        Open <span className="font-mono">{total}</span>
                    </button>
                    <button
                        className={cn(
                            'border rounded-full bg-white dark:bg-transparent h-6 px-2 text-[11px] inline-flex items-center gap-1 whitespace-nowrap transition-colors',
                            showDone
                                ? 'border-[color-mix(in_srgb,#1a7f37_35%,#d0d7de)] text-[#1a7f37] bg-[#dafbe1] dark:border-[#1a7f37]/40 dark:text-[#3fb950] dark:bg-[#1a7f37]/15 font-semibold'
                                : 'border-[#d0d7de] dark:border-[#555] text-[#656d76] dark:text-[#999]',
                        )}
                        onClick={() => setShowDone(p => !p)}
                        title="Toggle done items"
                        data-testid="hierarchy-done-toggle"
                        type="button"
                    >
                        Done
                    </button>
                    <button
                        className={cn(
                            'border rounded-full bg-white dark:bg-transparent h-6 px-2 text-[11px] inline-flex items-center gap-1 whitespace-nowrap transition-colors',
                            showArchived
                                ? 'border-[color-mix(in_srgb,#9a6700_30%,#d0d7de)] text-[#9a6700] bg-[#fff8c5] dark:border-[#9a6700]/40 dark:text-[#d29922] dark:bg-[#9a6700]/15 font-semibold'
                                : 'border-[#d0d7de] dark:border-[#555] text-[#656d76] dark:text-[#999]',
                        )}
                        onClick={() => setShowArchived(p => !p)}
                        title="Toggle archived items"
                        data-testid="hierarchy-archived-toggle"
                        type="button"
                    >
                        Archived
                    </button>
                    {isRemoteView && remoteProviderFilterOptions.length > 0 && remoteProviderFilterOptions.map(option => {
                        const active = visibleRemoteProviderFilter === option.kind;
                        return (
                            <button
                                key={option.kind}
                                type="button"
                                className={cn(
                                    'border rounded-full bg-white dark:bg-transparent h-6 px-2 text-[11px] inline-flex items-center gap-1 whitespace-nowrap transition-colors',
                                    active
                                        ? 'border-[#0969da] text-[#0969da] bg-[#ddf4ff] dark:border-[#0969da] dark:text-[#58a6ff] dark:bg-[#0969da]/15 font-semibold'
                                        : 'border-[#d0d7de] dark:border-[#555] text-[#656d76] dark:text-[#999]',
                                )}
                                onClick={() => onRemoteProviderFilterChange?.(option.kind)}
                                data-testid={`remote-provider-filter-${option.kind}`}
                                aria-pressed={active}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ── Rail summary metrics ── */}
            <div className="grid grid-cols-4 border-b border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] shrink-0" aria-label="Work item summary">
                <div className="px-1.5 py-[5px] border-r border-[#eaeef2] dark:border-[#3c3c3c]">
                    <strong className="block text-[12px] leading-[1.2] font-semibold font-mono text-[#1f2328] dark:text-[#cccccc]">{total}</strong>
                    <span className="block text-[10px] leading-[1.2] text-[#656d76] dark:text-[#999]">items</span>
                </div>
                <div className="px-1.5 py-[5px] border-r border-[#eaeef2] dark:border-[#3c3c3c]">
                    <strong className="block text-[12px] leading-[1.2] font-semibold font-mono text-[#1f2328] dark:text-[#cccccc]">{readyCount}</strong>
                    <span className="block text-[10px] leading-[1.2] text-[#656d76] dark:text-[#999]">ready</span>
                </div>
                <div className="px-1.5 py-[5px] border-r border-[#eaeef2] dark:border-[#3c3c3c]">
                    <strong className="block text-[12px] leading-[1.2] font-semibold font-mono text-[#1f2328] dark:text-[#cccccc]">{runCount}</strong>
                    <span className="block text-[10px] leading-[1.2] text-[#656d76] dark:text-[#999]">runs</span>
                </div>
                <div className="px-1.5 py-[5px]">
                    <strong className="block text-[12px] leading-[1.2] font-semibold font-mono text-[#1f2328] dark:text-[#cccccc]">0</strong>
                    <span className="block text-[10px] leading-[1.2] text-[#656d76] dark:text-[#999]">review</span>
                </div>
            </div>

            {isRemoteView && remoteStatusNotice && (
                <div
                    className={cn(
                        'mx-2 mt-2 rounded-md border px-2.5 py-1.5 text-[12px] leading-[1.4]',
                        remoteStatusNotice.tone === 'warning'
                            ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                            : remoteStatusNotice.tone === 'error'
                                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300'
                                : 'border-[#d0d7de] bg-[#f6f8fa] text-[#656d76] dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#999]',
                    )}
                    role={remoteStatusNotice.tone === 'error' ? 'alert' : 'status'}
                    data-testid="remote-sync-status-message"
                    data-status-tone={remoteStatusNotice.tone}
                >
                    {remoteStatusNotice.message}
                </div>
            )}

            {/* ── Tree body ── */}
            <div className="flex-1 overflow-y-auto min-h-0 p-1">
                {loading ? (
                    <div className="flex items-center justify-center h-16 text-sm text-[#848484]" data-testid="hierarchy-loading">
                        Loading…
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-16 gap-2 px-3" data-testid="hierarchy-error">
                        <p className="text-xs text-red-500 text-center">{error}</p>
                        <Button variant="ghost" size="sm" onClick={fetchTree}>Retry</Button>
                    </div>
                ) : treeData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center min-h-24 gap-3 px-4 py-4 text-center" data-testid="hierarchy-empty">
                        <div className="text-3xl">🗂️</div>
                        <p className="text-xs text-[#848484]">
                            {searchQuery ? 'No results found.' : trackerCopy.empty}
                        </p>
                        {!searchQuery && showLocalRootCreationActions && (
                            <div className="flex gap-2">
                                <Button variant="primary" size="sm" onClick={() => onCreateItem('epic')} data-testid="empty-create-epic-btn">
                                    + Create Epic
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => onCreateItem('work-item')}>
                                    + Work Item
                                </Button>
                                {onCreateWithAi && (
                                    <Button variant="ghost" size="sm" onClick={onCreateWithAi} data-testid="hierarchy-empty-create-with-ai-btn">
                                        ✨ Create with AI
                                    </Button>
                                )}
                            </div>
                        )}
                        {!searchQuery && isGitHubTrackerView && onImportFromGitHub && (
                            <Button variant="primary" size="sm" onClick={onImportFromGitHub} data-testid="empty-import-from-github-btn">
                                Import from GitHub
                            </Button>
                        )}
                        {!searchQuery && remoteProviderAffordancesVisible && detectedRemoteProvider && onImportFromRemote && (
                            <Button variant="primary" size="sm" onClick={() => onImportFromRemote(detectedRemoteProvider)} data-testid="empty-import-from-remote-btn">
                                Import remote work item
                            </Button>
                        )}
                    </div>
                ) : (
                    <div data-testid="hierarchy-tree-list">
                        {/* Section header */}
                        <div className="sticky top-0 z-[1] flex items-center gap-[5px] h-[26px] px-[5px] text-[#656d76] dark:text-[#999] text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ background: 'color-mix(in srgb, var(--tw-bg-opacity, white) 94%, transparent)', backdropFilter: 'blur(6px)' }}>
                            <span>{trackerViewKind === 'remote' ? 'Remote tree' : 'Local tree'}</span>
                            <span className="inline-flex items-center justify-center h-[17px] min-w-[18px] px-[5px] rounded-full border border-[#d0d7de] dark:border-[#555] bg-[#f6f8fa] dark:bg-[#333] text-[#656d76] dark:text-[#999] text-[10px] font-semibold font-mono leading-none">
                                {total}
                            </span>
                        </div>

                        {/* Rooted nodes */}
                        {treeData
                            .filter(n => n.item.type === 'epic' || (n.item.type && ['feature', 'pbi'].includes(n.item.type) && n.item.parentId == null))
                            .map(n => renderNode(n, 0))}

                        {/* Unparented group */}
                        {(() => {
                            const unparented = treeData.filter(n => {
                                const t = n.item.type ?? 'work-item';
                                return t !== 'epic' && !n.item.parentId;
                            });
                            if (unparented.length === 0) return null;
                            return (
                                <div data-testid="hierarchy-unparented-group">
                                    <div className="mx-1.5 mt-3.5 mb-1 pt-2 border-t border-[#eaeef2] dark:border-[#3c3c3c] text-[11px] font-semibold text-[#656d76] dark:text-[#999] uppercase tracking-[0.08em]">
                                        Unparented
                                    </div>
                                    {unparented.map(n => renderNode(n, 0))}
                                </div>
                            );
                        })()}
                    </div>
                )}
            </div>

            {/* ── Rail footer ── */}
            <div className="border-t border-[#d0d7de] dark:border-[#474749] bg-[#f6f8fa] dark:bg-[#252526] px-2 py-[5px] text-[#656d76] dark:text-[#999] text-[11px] flex items-center justify-between gap-2 shrink-0">
                <span className="truncate">
                    {isRemoteView ? (remoteStatus.loading ? 'Checking sync...' : 'Last sync') : 'Local changes saved'}
                </span>
                <span className="font-mono text-[11px]">{total} item{total !== 1 ? 's' : ''}</span>
            </div>

            {/* ── Context menu ── */}
            {contextMenu && (
                <ContextMenu
                    position={contextMenu.position}
                    items={buildContextMenuItems(contextMenu.node)}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* ── Parent picker ── */}
            {parentPicker && (
                <WorkItemParentPicker
                    open={true}
                    onClose={() => setParentPicker(null)}
                    workspaceId={workspaceId}
                    itemId={parentPicker.itemId}
                    itemType={parentPicker.itemType}
                    currentParentId={parentPicker.currentParentId}
                    onParentChanged={() => {
                        setParentPicker(null);
                        fetchTree();
                    }}
                />
            )}

            {/* ── Type picker (mobile add-child) ── */}
            {typePicker && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
                    onClick={() => setTypePicker(null)}
                    data-testid="type-picker-overlay"
                >
                    <div
                        className="w-full max-w-sm bg-white dark:bg-[#1e1e1e] rounded-t-xl p-4 pb-8 shadow-2xl"
                        onClick={e => e.stopPropagation()}
                        data-testid="type-picker-modal"
                    >
                        <p className="text-xs font-medium text-[#848484] dark:text-[#999] mb-3 uppercase tracking-wide">
                            Add child to "{typePicker.node.item.title}"
                        </p>
                        <div className="flex flex-col gap-2">
                            {(ALLOWED_CHILD_TYPES[(typePicker.node.item.type ?? 'work-item') as WorkItemTypeLabel] ?? []).map(childType => (
                                <button
                                    key={childType}
                                    className="w-full text-left px-3 py-2.5 rounded-lg border border-[#e0e0e0] dark:border-[#444] text-sm text-[#3c3c3c] dark:text-[#cccccc] hover:bg-[#f5f5f5] dark:hover:bg-[#2a2d2e] active:bg-[#e8e8e8] dark:active:bg-[#333]"
                                    onClick={() => { onCreateItem(childType as WorkItemTypeLabel, typePicker.node.item.id); setTypePicker(null); }}
                                    data-testid={`type-picker-option-${childType}`}
                                >
                                    {TYPE_LABELS[childType as WorkItemTypeLabel] ?? childType}
                                </button>
                            ))}
                        </div>
                        <button
                            className="mt-3 w-full text-center text-xs text-[#848484] py-2"
                            onClick={() => setTypePicker(null)}
                            data-testid="type-picker-cancel"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

        </div>
    );
}
