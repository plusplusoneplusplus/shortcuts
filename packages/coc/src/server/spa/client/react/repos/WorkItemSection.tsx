/**
 * WorkItemSection — collapsible section showing work items grouped by status.
 * Rendered inside the Tasks tab of ActivityListPane.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { useWorkItems } from '../context/WorkItemContext';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
    created: { label: 'Created', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300', icon: '📝' },
    planning: { label: 'Planning', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: '🔍' },
    readyToExecute: { label: 'Ready', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: '✅' },
    executing: { label: 'Executing', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: '⚡' },
    aiDone: { label: 'AI Done', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', icon: '🔄' },
    done: { label: 'Done', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', icon: '🎉' },
    failed: { label: 'Failed', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: '❌' },
};

const PRIORITY_ICON: Record<string, string> = { high: '🔴', normal: '', low: '🔵' };

interface WorkItemSectionProps {
    workspaceId: string;
    onSelectWorkItem: (id: string) => void;
    selectedWorkItemId?: string | null;
}

export function WorkItemSection({ workspaceId, onSelectWorkItem, selectedWorkItemId }: WorkItemSectionProps) {
    const { state, dispatch } = useWorkItems();
    const [showSection, setShowSection] = useState(true);
    const items = state.workItemsByRepo[workspaceId] || [];
    const isLoading = state.loading[workspaceId] ?? false;

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

    const activeItems = items.filter(i => !['done', 'failed'].includes(i.status));
    const completedItems = items.filter(i => ['done', 'failed'].includes(i.status));

    if (items.length === 0 && !isLoading) return null;

    return (
        <div>
            <button
                className="flex items-center gap-1 text-[11px] uppercase text-[#848484] dark:text-[#a0a0a0] font-medium hover:text-[#0078d4] dark:hover:text-[#3794ff] transition-colors mb-1"
                onClick={() => setShowSection(!showSection)}
                data-testid="work-items-section-toggle"
            >
                {showSection ? '▼' : '▶'} Work Items <span className="text-[10px]">({activeItems.length})</span>
            </button>
            {showSection && (
                <div className="flex flex-col gap-1">
                    {isLoading && items.length === 0 && (
                        <div className="text-xs text-[#848484] py-2 text-center">Loading work items…</div>
                    )}
                    {activeItems.map(item => {
                        const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.created;
                        return (
                            <Card
                                key={item.id}
                                className={cn(
                                    'p-2 cursor-pointer',
                                    selectedWorkItemId === item.id && 'ring-2 ring-[#0078d4]'
                                )}
                                onClick={() => onSelectWorkItem(item.id)}
                                data-testid={`work-item-card-${item.id}`}
                            >
                                <div className="flex items-center justify-between gap-1.5 text-xs">
                                    <span className="flex items-center gap-1 min-w-0 truncate">
                                        <span className="shrink-0">{cfg.icon}</span>
                                        {item.priority && PRIORITY_ICON[item.priority] && (
                                            <span className="shrink-0 text-[10px]">{PRIORITY_ICON[item.priority]}</span>
                                        )}
                                        <span className="truncate" title={item.title}>{item.title}</span>
                                    </span>
                                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap', cfg.color)}>
                                        {cfg.label}
                                    </span>
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
                    {completedItems.length > 0 && (
                        <div className="text-[10px] text-[#848484] dark:text-[#999] mt-1">
                            + {completedItems.length} completed/failed
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
