/**
 * ProcessList — scrollable list of processes in the left panel.
 * Replaces renderQueuePanel process items from queue.ts / sidebar.ts.
 */

import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Card, Badge, cn } from '../shared';
import { formatDuration, statusIcon, statusLabel } from '../utils/format';

export function ProcessList() {
    const { state, dispatch } = useApp();
    const [now, setNow] = useState(Date.now());

    // Live timer for running processes
    const hasRunning = useMemo(
        () => state.processes.some(p => p.status === 'running'),
        [state.processes]
    );

    useEffect(() => {
        if (!hasRunning) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [hasRunning]);

    const filtered = useMemo(() => {
        return state.processes
            .filter((p: any) => {
                // Skip queue sub-processes and child processes
                if (p.id?.startsWith('queue_')) return false;
                if (p.parentProcessId) return false;
                // Workspace filter
                if (state.workspace !== '__all' && p.workspaceId !== state.workspace) return false;
                // Status filter
                if (state.statusFilter !== '__all' && p.status !== state.statusFilter) return false;
                // Search filter
                if (state.searchQuery) {
                    const q = state.searchQuery.toLowerCase();
                    const title = (p.promptPreview || p.id || '').toLowerCase();
                    if (title.indexOf(q) === -1) return false;
                }
                return true;
            })
            .sort((a: any, b: any) => {
                const order: Record<string, number> = { running: 0, queued: 1, failed: 2, completed: 3, cancelled: 4 };
                const sa = order[a.status] ?? 5;
                const sb = order[b.status] ?? 5;
                if (sa !== sb) return sa - sb;
                return new Date(b.startTime || 0).getTime() - new Date(a.startTime || 0).getTime();
            });
    }, [state.processes, state.workspace, state.statusFilter, state.searchQuery]);

    if (filtered.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-[#848484] text-sm p-4">
                No processes found
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto flex flex-col gap-1 p-2">
            {filtered.map((p: any) => {
                const isActive = state.selectedId === p.id;
                const duration = p.status === 'running' && p.startTime
                    ? formatDuration(now - new Date(p.startTime).getTime())
                    : p.duration != null
                        ? formatDuration(p.duration)
                        : '';
                const preview = p.promptPreview
                    ? (p.promptPreview.length > 80 ? p.promptPreview.slice(0, 80) + '…' : p.promptPreview)
                    : p.id;

                return (
                    <Card
                        key={p.id}
                        onClick={() => dispatch({ type: 'SELECT_PROCESS', id: p.id })}
                        className={cn(
                            'p-2.5',
                            isActive && 'ring-2 ring-[#0078d4] dark:ring-[#3794ff]'
                        )}
                    >
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <Badge status={p.status}>
                                {statusIcon(p.status)} {statusLabel(p.status)}
                            </Badge>
                            {duration && (
                                <span className="text-[11px] text-[#848484] whitespace-nowrap">{duration}</span>
                            )}
                        </div>
                        <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc] line-clamp-2 break-words">
                            {preview}
                        </div>
                    </Card>
                );
            })}
        </div>
    );
}
