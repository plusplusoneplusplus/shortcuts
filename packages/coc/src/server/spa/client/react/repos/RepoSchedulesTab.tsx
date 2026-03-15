/**
 * RepoSchedulesTab — workspace-scoped schedule management with CRUD, run history.
 */

import { useState, useEffect, useCallback } from 'react';
import { cn } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { useApp } from '../context/AppContext';
import { ScheduleListPanel } from './ScheduleListPanel';
import { ScheduleDetail } from './ScheduleDetail';
import { CreateScheduleForm } from './CreateScheduleForm';
import type { Schedule, RunRecord } from './scheduleTypes';

// Re-export cron utilities that external code may reference
export { parseCronToInterval, describeCron, CRON_EXAMPLES } from '../utils/cron';
// Re-export for any consumers of these named exports
export { SCHEDULE_TEMPLATES } from './scheduleTemplates';
export { ScheduleDetail } from './ScheduleDetail';
export type { ScheduleDetailProps } from './ScheduleDetail';

interface RepoSchedulesTabProps {
    workspaceId: string;
}

export function RepoSchedulesTab({ workspaceId }: RepoSchedulesTabProps) {
    const { state, dispatch } = useApp();
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(state.selectedScheduleId);
    const [history, setHistory] = useState<RunRecord[]>([]);
    const [showCreate, setShowCreate] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [duplicateValues, setDuplicateValues] = useState<Partial<Schedule> | null>(null);
    const { isMobile, isTablet } = useBreakpoint();
    const { width: leftPanelWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: isTablet ? 256 : 288,
        minWidth: 160,
        maxWidth: 600,
        storageKey: 'schedules-left-panel-width',
    });
    const [mobileShowDetail, setMobileShowDetail] = useState(false);

    const fetchSchedules = useCallback(async () => {
        try {
            const data = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/schedules`);
            setSchedules(data?.schedules || []);
        } catch {
            setSchedules([]);
        }
        setLoading(false);
    }, [workspaceId]);

    useEffect(() => {
        setLoading(true);
        fetchSchedules();
    }, [workspaceId, fetchSchedules]);

    // Listen for schedule WebSocket events
    useEffect(() => {
        const wsHandler = () => fetchSchedules();
        window.addEventListener('schedule-changed', wsHandler);
        return () => window.removeEventListener('schedule-changed', wsHandler);
    }, [workspaceId, fetchSchedules]);

    const handleSelect = (scheduleId: string) => {
        if (selectedId !== scheduleId) {
            setEditingId(null);
        }
        setSelectedId(scheduleId);
        dispatch({ type: 'SET_SELECTED_SCHEDULE', id: scheduleId });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/schedules/' + encodeURIComponent(scheduleId);
        if (isMobile) setMobileShowDetail(true);
    };

    // Fetch history whenever selectedId changes
    useEffect(() => {
        if (!selectedId) return;
        let cancelled = false;
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(selectedId)}/history`)
            .then(data => {
                if (!cancelled) setHistory(data?.history || []);
            })
            .catch(() => {
                if (!cancelled) setHistory([]);
            });
        return () => { cancelled = true; };
    }, [selectedId, workspaceId]);

    // Auto-select first schedule when schedules load and nothing is selected
    useEffect(() => {
        if (selectedId === null && schedules.length > 0) {
            const id = schedules[0].id;
            setSelectedId(id);
            dispatch({ type: 'SET_SELECTED_SCHEDULE', id });
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/schedules/' + encodeURIComponent(id);
        }
    }, [schedules, selectedId, workspaceId, dispatch]);

    const handlePauseResume = async (schedule: Schedule) => {
        const newStatus = schedule.status === 'active' ? 'paused' : 'active';
        await fetch(getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(schedule.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
        });
        fetchSchedules();
    };

    const handleRunNow = async (scheduleId: string) => {
        await fetch(getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}/run`, {
            method: 'POST',
        });
        fetchSchedules();
        if (selectedId === scheduleId) {
            const data = await fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}/history`);
            setHistory(data?.history || []);
        }
    };

    const handleDelete = async (scheduleId: string) => {
        if (!confirm('Delete this schedule?')) return;
        await fetch(getApiBase() + `/workspaces/${encodeURIComponent(workspaceId)}/schedules/${encodeURIComponent(scheduleId)}`, {
            method: 'DELETE',
        });
        if (selectedId === scheduleId) {
            setSelectedId(null);
            dispatch({ type: 'SET_SELECTED_SCHEDULE', id: null });
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/schedules';
        }
        fetchSchedules();
    };

    if (loading) {
        return <div className="p-4 text-sm text-[#848484]">Loading schedules...</div>;
    }

    const selectedSchedule = schedules.find(s => s.id === selectedId) ?? null;

    const listPanel = (
        <ScheduleListPanel
            schedules={schedules}
            selectedId={selectedId}
            onSelect={handleSelect}
            onNew={() => { setShowCreate(true); if (isMobile) setMobileShowDetail(true); }}
            loading={loading}
        />
    );

    const detailContent = (
        <>
            {showCreate ? (
                <div className="px-4 py-3">
                    <CreateScheduleForm
                        workspaceId={workspaceId}
                        onCreated={() => { setShowCreate(false); setDuplicateValues(null); fetchSchedules(); }}
                        onCancel={() => { setShowCreate(false); setDuplicateValues(null); }}
                        initialValues={duplicateValues ? {
                            name: `Copy of ${duplicateValues.name}`,
                            target: duplicateValues.target,
                            targetType: duplicateValues.targetType,
                            cron: duplicateValues.cron,
                            params: duplicateValues.params ? { ...duplicateValues.params } : undefined,
                            onFailure: duplicateValues.onFailure,
                            outputFolder: duplicateValues.outputFolder,
                            model: duplicateValues.model,
                            chatMode: duplicateValues.mode ?? 'autopilot',
                        } : undefined}
                    />
                </div>
            ) : selectedSchedule ? (
                <ScheduleDetail
                    schedule={selectedSchedule}
                    workspaceId={workspaceId}
                    history={history}
                    editingId={editingId}
                    onRunNow={handleRunNow}
                    onPauseResume={handlePauseResume}
                    onEdit={(id) => setEditingId(id)}
                    onDuplicate={(s) => { setDuplicateValues(s); setShowCreate(true); }}
                    onDelete={handleDelete}
                    onCancelEdit={() => setEditingId(null)}
                    onSaved={() => { setEditingId(null); fetchSchedules(); }}
                />
            ) : (
                <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                    {schedules.length === 0
                        ? 'Create your first schedule with "+ New"'
                        : 'Select a schedule to view details'}
                </div>
            )}
        </>
    );

    if (isMobile) {
        return (
            <div className="flex flex-col h-full overflow-hidden" data-testid="schedules-split-panel">
                {mobileShowDetail ? (
                    <div className="flex-1 flex flex-col overflow-hidden" data-testid="schedules-detail-panel">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                            <button
                                className="text-xs text-[#0078d4] flex items-center gap-1 hover:underline"
                                onClick={() => setMobileShowDetail(false)}
                                data-testid="schedules-back-btn"
                            >
                                ← Schedules
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            {detailContent}
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col overflow-hidden" data-testid="schedules-mobile-list">
                        {listPanel}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className={cn('flex h-full overflow-hidden', isDragging && 'select-none')} data-testid="schedules-split-panel">
            {/* Left panel */}
            <div
                className="flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden"
                style={{ width: leftPanelWidth }}
                data-testid="schedules-list-panel"
            >
                {listPanel}
            </div>

            {/* Resize handle */}
            <div
                className="flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 transition-colors flex-shrink-0"
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                data-testid="schedules-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize schedules panel"
                tabIndex={0}
            />

            {/* Right panel */}
            <div className="flex-1 min-w-0 overflow-y-auto" data-testid="schedules-detail-panel">
                {detailContent}
            </div>
        </div>
    );
}