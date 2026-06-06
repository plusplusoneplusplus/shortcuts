/**
 * WorkItemSection — all work items grouped into collapsible per-status sections.
 * All statuses are shown (including done/failed). Sections with no items are hidden.
 * Done and failed sections start collapsed.
 *
 * Uses server-side grouped endpoint for initial load and search.
 * Per-status infinite scroll auto-loads more items when scrolling to the end of a group.
 *
 * Supports right-click context menu with Pin/Archive/Delete actions on each card.
 * Pinned items sort to the top within each status group.
 * Archived items are hidden by default with a toggle to show them.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, cn } from '../../ui';
import { useWorkItems, type WorkItemSummary } from '../../contexts/WorkItemContext';
import { useWorkItemSearch } from './hooks/useWorkItemSearch';
import { formatRelativeTime } from '../../utils/format';
import { ContextMenu } from '../../tasks/comments/ContextMenu';
import type { ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { getSpaCocClient } from '../../api/cocClient';
import { createWorkItemContextDragPayload, writePointerContextDragData } from '../chat/sessionContextDrag';
import { isSessionContextAttachmentsEnabled } from '../../utils/config';

const PAGE_SIZE = 20;

interface StatusConfig {
    label: string;
    badgeColor: string;
    icon: string;
    /** Start collapsed by default */
    defaultCollapsed?: boolean;
}

const STATUS_CONFIG: Record<string, StatusConfig> = {
    created:        { label: 'Created',           icon: '📝', badgeColor: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
    planning:       { label: 'Planning',          icon: '🔍', badgeColor: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
    readyToExecute: { label: 'Ready to Execute',  icon: '✅', badgeColor: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
    executing:      { label: 'Executing',         icon: '⚡', badgeColor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
    aiDone:         { label: 'AI Done',           icon: '🔄', badgeColor: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
    aiFailed:       { label: 'AI Failed',         icon: '⚠️', badgeColor: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', defaultCollapsed: true },
    failed:         { label: 'Failed',            icon: '❌', badgeColor: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', defaultCollapsed: true },
    done:           { label: 'Done',              icon: '🎉', badgeColor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', defaultCollapsed: true },
};

/** Display order for status groups — lifecycle progression: new → active → terminal */
const STATUS_ORDER = ['created', 'planning', 'readyToExecute', 'executing', 'aiDone', 'aiFailed', 'failed', 'done'] as const;

const PRIORITY_ICON: Record<string, string> = { high: '🔴', normal: '', low: '🔵' };

/** Per-status infinite scroll sentinel — triggers auto-load when visible. */
function StatusGroupSentinel({
    status,
    hasMore,
    onLoadMore,
}: {
    status: string;
    hasMore: boolean;
    onLoadMore: (status: string) => void;
}) {
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || !hasMore) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    onLoadMore(status);
                }
            },
            { rootMargin: '200px' },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [status, hasMore, onLoadMore]);

    if (!hasMore) return null;
    return (
        <div ref={sentinelRef} className="flex justify-center py-1" data-testid={`work-items-sentinel-${status}`}>
            <span className="text-[10px] text-[#848484] dark:text-[#999]">Loading…</span>
        </div>
    );
}

interface WorkItemSectionProps {
    workspaceId: string;
    onSelectWorkItem: (id: string) => void;
    selectedWorkItemId?: string | null;
    highlightedWorkItemId?: string | null;
}

export function WorkItemSection({ workspaceId, onSelectWorkItem, selectedWorkItemId, highlightedWorkItemId }: WorkItemSectionProps) {
    const { state, dispatch } = useWorkItems();
    const items = state.workItemsByRepo[workspaceId] || [];
    const pagination = state.paginationByRepo[workspaceId];
    const isLoading = state.loading[workspaceId] ?? false;
    const { searchInput, searchQuery, searchInputRef, onSearchChange, onSearchClear } = useWorkItemSearch();
    const prevSearchRef = useRef(searchQuery);
    const loadingStatusesRef = useRef(new Set<string>());
    const sessionContextDragEnabled = isSessionContextAttachmentsEnabled();

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: WorkItemSummary } | null>(null);

    // Show/hide archived items toggle
    const [showArchived, setShowArchived] = useState(false);

    // Per-status collapse state; persisted in localStorage (workspace-scoped)
    const storageKey = `coc-wi-categories-${workspaceId}`;
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
        const defaults = Object.fromEntries(STATUS_ORDER.map(s => [s, STATUS_CONFIG[s].defaultCollapsed ?? false]));
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                    return { ...defaults, ...parsed };
                }
            }
        } catch { /* ignore corrupt storage */ }
        return defaults;
    });

    // Fetch grouped work items (initial load and search)
    const fetchGroupedWorkItems = useCallback(async (query?: string) => {
        dispatch({ type: 'SET_LOADING', repoId: workspaceId, loading: true });
        try {
            const data = await getSpaCocClient().workItems.grouped(workspaceId, {
                limit: PAGE_SIZE,
                q: query,
            });
            dispatch({ type: 'SET_GROUPED_WORK_ITEMS', repoId: workspaceId, groups: data?.groups || {} });
        } catch {
            // silently fail
        } finally {
            dispatch({ type: 'SET_LOADING', repoId: workspaceId, loading: false });
        }
    }, [workspaceId, dispatch]);

    // Load more items for a specific status group (per-category infinite scroll)
    const loadMoreForStatus = useCallback(async (status: string) => {
        if (loadingStatusesRef.current.has(status)) return;
        const statusPagination = pagination?.[status];
        if (!statusPagination?.hasMore) return;

        loadingStatusesRef.current.add(status);
        try {
            const data = await getSpaCocClient().workItems.list(workspaceId, {
                status,
                limit: PAGE_SIZE,
                offset: statusPagination.offset,
                q: searchQuery || undefined,
            });
            dispatch({
                type: 'APPEND_STATUS_ITEMS',
                repoId: workspaceId,
                status,
                items: data?.items || [],
                total: data?.total ?? statusPagination.total,
                hasMore: data?.hasMore ?? false,
                offset: statusPagination.offset,
            });
        } catch {
            // silently fail
        } finally {
            loadingStatusesRef.current.delete(status);
        }
    }, [workspaceId, dispatch, searchQuery, pagination]);

    // Initial fetch
    useEffect(() => { fetchGroupedWorkItems(); }, [fetchGroupedWorkItems]);

    // Re-fetch when search query changes
    useEffect(() => {
        if (prevSearchRef.current !== searchQuery) {
            prevSearchRef.current = searchQuery;
            fetchGroupedWorkItems(searchQuery || undefined);
        }
    }, [searchQuery, fetchGroupedWorkItems]);

    // ── Context menu actions ──

    const handlePin = useCallback(async (item: WorkItemSummary) => {
        const pinned = !item.pinnedAt;
        // Optimistic update
        dispatch({ type: 'WORK_ITEM_UPDATED', repoId: workspaceId, item: { ...item, pinnedAt: pinned ? new Date().toISOString() : undefined } });
        try {
            await getSpaCocClient().workItems.pin(workspaceId, item.id, pinned);
        } catch {
            // Revert on failure
            dispatch({ type: 'WORK_ITEM_UPDATED', repoId: workspaceId, item });
        }
    }, [workspaceId, dispatch]);

    const handleArchive = useCallback(async (item: WorkItemSummary) => {
        const archived = !item.archivedAt;
        dispatch({ type: 'WORK_ITEM_UPDATED', repoId: workspaceId, item: { ...item, archivedAt: archived ? new Date().toISOString() : undefined } });
        try {
            await getSpaCocClient().workItems.archive(workspaceId, item.id, archived);
        } catch {
            dispatch({ type: 'WORK_ITEM_UPDATED', repoId: workspaceId, item });
        }
    }, [workspaceId, dispatch]);

    const handleDelete = useCallback(async (item: WorkItemSummary) => {
        if (!confirm('Delete this work item?')) return;
        dispatch({ type: 'WORK_ITEM_REMOVED', repoId: workspaceId, id: item.id });
        try {
            await getSpaCocClient().workItems.delete(workspaceId, item.id);
        } catch {
            // Re-add on failure
            dispatch({ type: 'WORK_ITEM_ADDED', repoId: workspaceId, item });
        }
    }, [workspaceId, dispatch]);

    const handleContextMenu = useCallback((e: React.MouseEvent, item: WorkItemSummary) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, item });
    }, []);

    const contextMenuItems = useMemo((): ContextMenuItem[] => {
        if (!contextMenu) return [];
        const item = contextMenu.item;
        return [
            {
                label: item.pinnedAt ? 'Unpin' : 'Pin',
                icon: '📌',
                onClick: () => handlePin(item),
            },
            {
                label: item.archivedAt ? 'Unarchive' : 'Archive',
                icon: item.archivedAt ? '📂' : '🗄️',
                onClick: () => handleArchive(item),
            },
            { label: '', separator: true, onClick: () => {} },
            {
                label: 'Delete',
                icon: '🗑️',
                onClick: () => handleDelete(item),
            },
        ];
    }, [contextMenu, handlePin, handleArchive, handleDelete]);

    const shouldHideEmptySection = items.length === 0 && !isLoading && !searchInput;

    const toggleGroup = (status: string) =>
        setCollapsed(prev => {
            const next = { ...prev, [status]: !prev[status] };
            try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore storage errors */ }
            return next;
        });

    // Count archived items for the toggle label
    const archivedCount = items.filter(i => !!i.archivedAt).length;

    // Filter out archived items unless showArchived is enabled
    const visibleItems = showArchived ? items : items.filter(i => !i.archivedAt);

    // Group items by status, pinned items first, then sorted by last run time descending
    const grouped = Object.fromEntries(
        STATUS_ORDER.map(s => [
            s,
            visibleItems
                .filter(i => i.status === s)
                .sort((a, b) => {
                    // Pinned items sort to top
                    if (a.pinnedAt && !b.pinnedAt) return -1;
                    if (!a.pinnedAt && b.pinnedAt) return 1;
                    const aTime = a.lastRunAt || a.updatedAt;
                    const bTime = b.lastRunAt || b.updatedAt;
                    return bTime.localeCompare(aTime);
                }),
        ])
    );

    const totalCount = pagination
        ? Object.values(pagination).reduce((sum, p) => sum + (p?.total ?? 0), 0)
        : items.length;
    // Subtract archived from displayed count when hidden
    const displayCount = showArchived ? totalCount : totalCount - archivedCount;

    useEffect(() => {
        if (!highlightedWorkItemId) return;
        const element = Array.from(document.querySelectorAll<HTMLElement>('[data-work-item-id]'))
            .find(candidate => candidate.dataset.workItemId === highlightedWorkItemId);
        element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [highlightedWorkItemId, visibleItems]);

    if (shouldHideEmptySection) return null;

    return (
        <div data-testid="work-items-section">
            {/* Top-level header */}
            <div className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium mb-2">
                <span>Work Items</span>
                <span className="text-[10px] bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#606060] dark:text-[#aaa] px-1.5 py-0.5 rounded-full">
                    {displayCount}
                </span>
                {archivedCount > 0 && (
                    <button
                        className={cn(
                            'ml-auto text-[10px] px-1.5 py-0.5 rounded transition-colors',
                            showArchived
                                ? 'bg-[#0078d4]/10 text-[#0078d4] dark:text-[#3794ff]'
                                : 'text-[#848484] hover:text-[#333] dark:hover:text-[#eee]',
                        )}
                        onClick={() => setShowArchived(v => !v)}
                        title={showArchived ? 'Hide archived items' : `Show ${archivedCount} archived item(s)`}
                        data-testid="work-items-archive-toggle"
                    >
                        🗄️ {archivedCount}
                    </button>
                )}
            </div>

            {/* Search input */}
            <div className="relative mb-2">
                <input
                    ref={searchInputRef}
                    type="text"
                    value={searchInput}
                    onChange={e => onSearchChange(e.target.value)}
                    placeholder="Search work items… (Ctrl+F)"
                    className="w-full text-xs px-2 py-1.5 rounded border border-[#d0d0d0] dark:border-[#555] bg-white dark:bg-[#2d2d2d] text-[#333] dark:text-[#ddd] placeholder-[#999] dark:placeholder-[#777] focus:outline-none focus:ring-1 focus:ring-[#0078d4]"
                    data-testid="work-item-search-input"
                />
                {searchInput && (
                    <button
                        onClick={onSearchClear}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-[#999] hover:text-[#333] dark:hover:text-[#eee]"
                        data-testid="work-item-search-clear"
                    >
                        ✕
                    </button>
                )}
            </div>

            {isLoading && items.length === 0 && (
                <div className="text-xs text-[#848484] py-2 text-center">Loading work items…</div>
            )}

            {!isLoading && items.length === 0 && searchInput && (
                <div className="text-xs text-[#848484] py-2 text-center">No work items match your search.</div>
            )}

            <div className="flex flex-col gap-2">
                {STATUS_ORDER.map(status => {
                    const group = grouped[status] || [];
                    const statusPag = pagination?.[status];
                    const statusTotal = Math.max(statusPag?.total ?? 0, group.length);
                    const statusHasMore = statusPag?.hasMore ?? false;

                    if (statusTotal === 0 && group.length === 0) return null;

                    const cfg = STATUS_CONFIG[status];
                    const isCollapsed = collapsed[status] ?? false;

                    return (
                        <div key={status} data-testid={`work-items-group-${status}`}>
                            {/* Group header */}
                            <button
                                className="flex items-center gap-1.5 w-full text-left text-[11px] text-[#606060] dark:text-[#aaa] hover:text-[#333] dark:hover:text-[#eee] transition-colors mb-1"
                                onClick={() => toggleGroup(status)}
                                data-testid={`work-items-group-toggle-${status}`}
                            >
                                <span className="text-[10px]">{isCollapsed ? '▶' : '▼'}</span>
                                <span>{cfg.icon}</span>
                                <span className="font-medium">{cfg.label}</span>
                                <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full', cfg.badgeColor)}>
                                    {group.length}
                                </span>
                            </button>

                            {/* Group items */}
                            {!isCollapsed && (
                                <div className="flex flex-col gap-1 pl-3">
                                    {group.map(item => {
                                        const sessionContextPayload = sessionContextDragEnabled
                                            ? createWorkItemContextDragPayload(item, { activeWorkspaceId: workspaceId })
                                            : null;
                                        return (
                                            <Card
                                                key={item.id}
                                                className={cn(
                                                    'p-2 cursor-pointer',
                                                    sessionContextPayload && 'cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-sky-300 dark:hover:ring-sky-700',
                                                    selectedWorkItemId === item.id && 'ring-2 ring-[#0078d4]',
                                                    item.archivedAt && 'opacity-50',
                                                    highlightedWorkItemId === item.id && 'animate-pulse ring-2 ring-[#0078d4]/50',
                                                )}
                                                onClick={() => onSelectWorkItem(item.id)}
                                                onContextMenu={(e) => handleContextMenu(e, item)}
                                                draggable={!!sessionContextPayload}
                                                onDragStart={sessionContextPayload ? (e) => writePointerContextDragData(e.dataTransfer, sessionContextPayload) : undefined}
                                                title={sessionContextPayload ? `${sessionContextPayload.label} - drag to attach as work item context` : item.title}
                                                data-testid={`work-item-card-${item.id}`}
                                                data-work-item-id={item.id}
                                                data-session-context-source={sessionContextPayload ? 'true' : undefined}
                                                data-session-context-kind={sessionContextPayload ? 'work-item' : undefined}
                                            >
                                                <div className="flex items-center gap-1 min-w-0 text-xs">
                                                    {item.pinnedAt && (
                                                        <span className="shrink-0 text-[10px]" title="Pinned" data-testid={`work-item-pin-${item.id}`}>📌</span>
                                                    )}
                                                    {item.workItemNumber != null && (
                                                        <span className="shrink-0 text-[10px] text-[#848484] dark:text-[#999] font-mono" data-testid={`work-item-number-${item.id}`}>WI-{item.workItemNumber}</span>
                                                    )}
                                                    {item.type === 'bug' && (
                                                        <span className="shrink-0 text-[10px]" title="Bug">🐛</span>
                                                    )}
                                                    {item.priority && PRIORITY_ICON[item.priority] && (
                                                        <span className="shrink-0 text-[10px]">{PRIORITY_ICON[item.priority]}</span>
                                                    )}
                                                    <span className={cn('truncate', item.archivedAt && 'line-through')} title={item.title}>{item.title}</span>
                                                    {(() => {
                                                        const ts = item.lastRunAt || item.updatedAt;
                                                        const label = formatRelativeTime(ts);
                                                        return label ? (
                                                            <span className="ml-auto shrink-0 text-[10px] text-[#848484] dark:text-[#999]" title={ts}>
                                                                {label}
                                                            </span>
                                                        ) : null;
                                                    })()}
                                                </div>
                                                {item.plan && (
                                                    <div className="text-[10px] text-[#848484] dark:text-[#999] mt-0.5">
                                                        Plan v{item.plan.version}
                                                    </div>
                                                )}
                                                {item.tags && item.tags.length > 0 && (
                                                    <div className="flex gap-1 mt-1 flex-wrap">
                                                        {item.tags.slice(0, 3).map(tag => (
                                                            <span key={tag} className="text-[9px] px-1 py-0.5 rounded bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#606060] dark:text-[#aaa]">{tag}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </Card>
                                        );
                                    })}
                                    {/* Per-status infinite scroll sentinel */}
                                    <StatusGroupSentinel
                                        status={status}
                                        hasMore={statusHasMore}
                                        onLoadMore={loadMoreForStatus}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Context menu */}
            {contextMenu && (
                <ContextMenu
                    position={{ x: contextMenu.x, y: contextMenu.y }}
                    items={contextMenuItems}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}
