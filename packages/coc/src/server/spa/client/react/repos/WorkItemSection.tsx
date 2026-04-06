/**
 * WorkItemSection — all work items grouped into collapsible per-status sections.
 * All statuses are shown (including done/failed). Sections with no items are hidden.
 * Done and failed sections start collapsed.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { useWorkItems } from '../context/WorkItemContext';
import { formatRelativeTime } from '../utils/format';

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

interface WorkItemSectionProps {
    workspaceId: string;
    onSelectWorkItem: (id: string) => void;
    selectedWorkItemId?: string | null;
}

export function WorkItemSection({ workspaceId, onSelectWorkItem, selectedWorkItemId }: WorkItemSectionProps) {
    const { state, dispatch } = useWorkItems();
    const items = state.workItemsByRepo[workspaceId] || [];
    const isLoading = state.loading[workspaceId] ?? false;

    // Per-status collapse state; done/failed start collapsed
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
        Object.fromEntries(STATUS_ORDER.map(s => [s, STATUS_CONFIG[s].defaultCollapsed ?? false]))
    );

    const fetchWorkItems = useCallback(async () => {
        dispatch({ type: 'SET_LOADING', repoId: workspaceId, loading: true });
        try {
            const data = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/work-items`);
            dispatch({ type: 'SET_WORK_ITEMS', repoId: workspaceId, items: data || [] });
        } catch {
            // silently fail
        } finally {
            dispatch({ type: 'SET_LOADING', repoId: workspaceId, loading: false });
        }
    }, [workspaceId, dispatch]);

    useEffect(() => { fetchWorkItems(); }, [fetchWorkItems]);

    if (items.length === 0 && !isLoading) return null;

    const toggleGroup = (status: string) =>
        setCollapsed(prev => ({ ...prev, [status]: !prev[status] }));

    // Group items by status, sorted by last run time descending within each group
    const grouped = Object.fromEntries(
        STATUS_ORDER.map(s => [
            s,
            items
                .filter(i => i.status === s)
                .sort((a, b) => {
                    const aTime = (a as any).lastRunAt || a.updatedAt;
                    const bTime = (b as any).lastRunAt || b.updatedAt;
                    return bTime.localeCompare(aTime);
                }),
        ])
    );

    const totalCount = items.length;

    return (
        <div data-testid="work-items-section">
            {/* Top-level header */}
            <div className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium mb-2">
                <span>Work Items</span>
                <span className="text-[10px] bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#606060] dark:text-[#aaa] px-1.5 py-0.5 rounded-full">
                    {totalCount}
                </span>
            </div>

            {isLoading && items.length === 0 && (
                <div className="text-xs text-[#848484] py-2 text-center">Loading work items…</div>
            )}

            <div className="flex flex-col gap-2">
                {STATUS_ORDER.map(status => {
                    const group = grouped[status] || [];
                    if (group.length === 0) return null;

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
                                    {group.map(item => (
                                        <Card
                                            key={item.id}
                                            className={cn(
                                                'p-2 cursor-pointer',
                                                selectedWorkItemId === item.id && 'ring-2 ring-[#0078d4]'
                                            )}
                                            onClick={() => onSelectWorkItem(item.id)}
                                            data-testid={`work-item-card-${item.id}`}
                                        >
                                            <div className="flex items-center gap-1 min-w-0 text-xs">
                                                {(item as any).type === 'bug' && (
                                                    <span className="shrink-0 text-[10px]" title="Bug">🐛</span>
                                                )}
                                                {item.priority && PRIORITY_ICON[item.priority] && (
                                                    <span className="shrink-0 text-[10px]">{PRIORITY_ICON[item.priority]}</span>
                                                )}
                                                <span className="truncate" title={item.title}>{item.title}</span>
                                                {(() => {
                                                    const ts = (item as any).lastRunAt || item.updatedAt;
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
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
