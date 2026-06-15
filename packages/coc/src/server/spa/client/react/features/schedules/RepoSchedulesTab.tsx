/**
 * RepoSchedulesTab — workspace-scoped schedule management with CRUD, run history.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '../../ui';
import { useCocClient } from '../../repos/cloneRouting';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { useApp } from '../../contexts/AppContext';
import { useNotesAutoCommit } from '../notes/hooks/useNotesAutoCommit';
import { ScheduleListPanel } from './ScheduleListPanel';
import { ScheduleDetail } from './ScheduleDetail';
import { CreateScheduleForm } from './CreateScheduleForm';
import { PromptScheduleForm } from './PromptScheduleForm';
import { normalizePromptScheduleMode } from './scheduleTypes';
import type { Schedule, RunRecord } from './scheduleTypes';

// Re-export cron utilities that external code may reference
export { parseCronToInterval, describeCron, CRON_EXAMPLES } from '../../utils/cron';
// Re-export for any consumers of these named exports
export { SCHEDULE_TEMPLATES } from './scheduleTemplates';
export { ScheduleDetail } from './ScheduleDetail';
export type { ScheduleDetailProps } from './ScheduleDetail';

interface RepoSchedulesTabProps {
    workspaceId: string;
}

export function RepoSchedulesTab({ workspaceId }: RepoSchedulesTabProps) {
    const { state, dispatch } = useApp();
    // Route schedule CRUD + notes-git status to the workspace's clone (AC-07).
    const client = useCocClient(workspaceId);
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(state.selectedScheduleId);
    const [history, setHistory] = useState<RunRecord[]>([]);
    const [showCreate, setShowCreate] = useState<false | 'prompt' | 'advanced'>(false);
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

    const notesAC = useNotesAutoCommit(workspaceId);

    // Lightweight check: is notes git initialized?
    const [notesGitInitialized, setNotesGitInitialized] = useState(false);
    const notesGitCheckedRef = useRef<string | null>(null);
    useEffect(() => {
        if (notesGitCheckedRef.current === workspaceId) return;
        notesGitCheckedRef.current = workspaceId;
        client.notes.getGitStatus(workspaceId)
            .then((data: any) => {
                if (data?.initialized) setNotesGitInitialized(true);
                else setNotesGitInitialized(false);
            })
            .catch(() => setNotesGitInitialized(false));
    }, [workspaceId, client]);

    const fetchSchedules = useCallback(async () => {
        try {
            const nextSchedules = await client.schedules.list(workspaceId);
            setSchedules(nextSchedules);
        } catch {
            setSchedules([]);
        }
        setLoading(false);
    }, [workspaceId, client]);

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
        client.schedules.history(workspaceId, selectedId)
            .then(nextHistory => {
                if (!cancelled) setHistory(nextHistory);
            })
            .catch(() => {
                if (!cancelled) setHistory([]);
            });
        return () => { cancelled = true; };
    }, [selectedId, workspaceId, client]);

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
        if (schedule.status === 'active') {
            await client.schedules.disable(workspaceId, schedule.id);
        } else {
            await client.schedules.enable(workspaceId, schedule.id);
        }
        fetchSchedules();
    };

    const handleRunNow = async (scheduleId: string) => {
        await client.schedules.run(workspaceId, scheduleId);
        fetchSchedules();
        if (selectedId === scheduleId) {
            const nextHistory = await client.schedules.history(workspaceId, scheduleId);
            setHistory(nextHistory);
        }
    };

    const handleDelete = async (scheduleId: string) => {
        const schedule = schedules.find(s => s.id === scheduleId);
        const slug = scheduleId.replace(/^repo:/, '');
        const message = schedule?.source === 'repo'
            ? `This will permanently delete .github/schedules/${slug}.yaml. This cannot be undone. Continue?`
            : 'Delete this schedule?';
        if (!confirm(message)) return;
        await client.schedules.delete(workspaceId, scheduleId);
        if (selectedId === scheduleId) {
            setSelectedId(null);
            dispatch({ type: 'SET_SELECTED_SCHEDULE', id: null });
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/schedules';
        }
        fetchSchedules();
    };

    const handleMove = async (scheduleId: string, destination: 'user' | 'repo') => {
        await client.schedules.move(workspaceId, scheduleId, destination);
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
            onNew={() => { setShowCreate('prompt'); if (isMobile) setMobileShowDetail(true); }}
            loading={loading}
            onMove={handleMove}
            onRefresh={fetchSchedules}
            notesAutoCommit={{
                available: notesAC.autoCommitEnabled || notesGitInitialized,
                enabled: notesAC.autoCommitEnabled,
                enabling: notesAC.enabling,
                onEnable: () => notesAC.enable(),
            }}
        />
    );

    const detailContent = (
        <>
            {showCreate === 'prompt' ? (
                <div className="px-4 py-3">
                    <PromptScheduleForm
                        workspaceId={workspaceId}
                        onCreated={() => { setShowCreate(false); setDuplicateValues(null); fetchSchedules(); }}
                        onCancel={() => { setShowCreate(false); setDuplicateValues(null); }}
                        onAdvanced={() => setShowCreate('advanced')}
                        initialValues={duplicateValues ? {
                            name: `Copy of ${duplicateValues.name}`,
                            target: duplicateValues.target,
                            cron: duplicateValues.cron,
                            model: duplicateValues.model,
                            chatMode: normalizePromptScheduleMode(duplicateValues.mode, 'ask'),
                            outputFolder: duplicateValues.outputFolder,
                            onFailure: duplicateValues.onFailure,
                        } : undefined}
                    />
                </div>
            ) : showCreate === 'advanced' ? (
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
                            chatMode: normalizePromptScheduleMode(duplicateValues.mode, 'autopilot'),
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
                    onDuplicate={(s) => {
                        setDuplicateValues(s);
                        // Route prompt schedules to the prompt form, others to advanced
                        const isPrompt = (!s.targetType || s.targetType === 'prompt') && !Object.keys(s.params ?? {}).some(k => k === 'pipeline');
                        setShowCreate(isPrompt ? 'prompt' : 'advanced');
                    }}
                    onDelete={handleDelete}
                    onCancelEdit={() => setEditingId(null)}
                    onSaved={() => { setEditingId(null); fetchSchedules(); }}
                />
            ) : (
                <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                    {schedules.length === 0
                        ? 'Create a recurring prompt with "+ New"'
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
                <div className="max-w-3xl">
                    {detailContent}
                </div>
            </div>
        </div>
    );
}
