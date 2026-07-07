/**
 * ScheduleMainPane — the schedule create / view-edit surface rendered in the
 * chat-list "main pane" (RepoChatTab's detail region) when the
 * `schedulesInScheduledSlide` flag is ON.
 *
 * This is the host that AC-02 (create) and AC-03 (view/edit) mount into. It
 * reuses the existing schedule components — `PromptScheduleForm` for the create
 * / edit form and `ScheduleDetail` for the read view + action bar — and drives
 * them through the existing `client.schedules.*` API, so no schedule backend or
 * UI is rebuilt. The chat-list "Scheduled" slide is the list surface (the
 * sidebar); this component owns only the right/main pane for one active
 * schedule at a time.
 *
 * Routing: the pane is driven purely by the `#repos/{ws}/schedules/...` hash
 * (parsed by `parseScheduleMainPaneRoute`), so it is deep-linkable and survives
 * reloads. Closing / cancelling / deleting navigates back to the bare
 * `#repos/{ws}/schedules` hash, which resolves to the chat surface with the
 * Scheduled slide active.
 */

import { useCallback, useEffect, useState } from 'react';
import { useCocClient } from '../../repos/cloneRouting';
import { useApp } from '../../contexts/AppContext';
import { ScheduleDetail } from './ScheduleDetail';
import { PromptScheduleForm } from './PromptScheduleForm';
import type { Schedule, RunRecord } from './scheduleTypes';

/** Confirm text shown when navigating away from a form with unsaved edits. */
const DISCARD_CONFIRM = 'Discard changes? Your unsaved edits will be lost.';

/**
 * Parsed schedule main-pane route:
 *  - `new`    → `#repos/{ws}/schedules/new`   (create form)
 *  - `detail` → `#repos/{ws}/schedules/{id}`  (read view / inline edit)
 * A bare `#repos/{ws}/schedules` (no id) yields `null` — there is no active
 * schedule in the main pane (the Scheduled slide is the landing surface).
 */
export type ScheduleMainPaneRoute =
    | { kind: 'new' }
    | { kind: 'detail'; scheduleId: string };

/** Parse the schedule main-pane route out of a location hash, scoped to `workspaceId`. */
export function parseScheduleMainPaneRoute(hash: string, workspaceId: string): ScheduleMainPaneRoute | null {
    const clean = hash.replace(/^#/, '').split('?')[0];
    const parts = clean.split('/');
    if (parts[0] !== 'repos' || !parts[1]) return null;
    if (decodeURIComponent(parts[1]) !== workspaceId) return null;
    if (parts[2] !== 'schedules') return null;
    if (!parts[3]) return null;
    if (parts[3] === 'new') return { kind: 'new' };
    return { kind: 'detail', scheduleId: decodeURIComponent(parts[3]) };
}

/**
 * True when `hash` addresses the schedules family for `workspaceId` — the bare
 * `#repos/{ws}/schedules` landing hash OR any `#repos/{ws}/schedules/...` deep
 * link (new / detail). Unlike `parseScheduleMainPaneRoute` (which returns null
 * for the bare hash, meaning "no active schedule in the main pane"), this covers
 * the whole family so the chat-list "Scheduled" slide can be forced active
 * whenever the schedules surface is the active route (AC-03 deep-link / AC-04
 * redirect target).
 */
export function isSchedulesRoute(hash: string, workspaceId: string): boolean {
    const clean = hash.replace(/^#/, '').split('?')[0];
    const parts = clean.split('/');
    if (parts[0] !== 'repos' || !parts[1]) return false;
    if (decodeURIComponent(parts[1]) !== workspaceId) return false;
    return parts[2] === 'schedules';
}

interface ScheduleMainPaneProps {
    workspaceId: string;
    route: ScheduleMainPaneRoute;
}

export function ScheduleMainPane({ workspaceId, route }: ScheduleMainPaneProps) {
    const client = useCocClient(workspaceId);
    const { dispatch } = useApp();
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [history, setHistory] = useState<RunRecord[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    // Id of a schedule just created into the repo store — drives the
    // "commit to share" reminder shown once on its fresh detail view.
    const [commitReminderId, setCommitReminderId] = useState<string | null>(null);
    // True while the open create/edit form has unsaved edits — gates the
    // "Discard changes?" prompt on navigate-away (Close / Cancel / Esc).
    const [formDirty, setFormDirty] = useState(false);

    const selectedId = route.kind === 'detail' ? route.scheduleId : null;
    const scheduleBase = '#repos/' + encodeURIComponent(workspaceId) + '/schedules';

    const fetchSchedules = useCallback(async () => {
        try {
            setSchedules(await client.schedules.list(workspaceId));
        } catch {
            setSchedules([]);
        }
        setLoaded(true);
    }, [workspaceId, client]);

    useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

    // Live-refresh the underlying list on schedule mutations (create/run/pause).
    useEffect(() => {
        const handler = () => fetchSchedules();
        window.addEventListener('schedule-changed', handler);
        return () => window.removeEventListener('schedule-changed', handler);
    }, [fetchSchedules]);

    // Reset any inline-edit state when the route target changes.
    useEffect(() => { setEditingId(null); }, [route.kind, selectedId]);

    // Fetch run history for the selected schedule.
    useEffect(() => {
        if (!selectedId) { setHistory([]); return; }
        let cancelled = false;
        client.schedules.history(workspaceId, selectedId)
            .then(next => { if (!cancelled) setHistory(next); })
            .catch(() => { if (!cancelled) setHistory([]); });
        return () => { cancelled = true; };
    }, [selectedId, workspaceId, client]);

    const navigate = useCallback((hash: string) => { location.hash = hash; }, []);

    // Navigate back to the Scheduled slide, discarding any form state. The
    // unguarded variant used after a successful create/delete (no prompt).
    const doCloseToSlide = useCallback(() => {
        setFormDirty(false);
        setCommitReminderId(null);
        dispatch({ type: 'SET_SELECTED_SCHEDULE', id: null });
        navigate(scheduleBase);
    }, [dispatch, navigate, scheduleBase]);

    // Close control (header "← Schedules" / create Cancel): prompt before
    // leaving a dirty form; silent when clean.
    const closeToSlide = useCallback(() => {
        if (formDirty && !confirm(DISCARD_CONFIRM)) return;
        doCloseToSlide();
    }, [formDirty, doCloseToSlide]);

    // Leave inline edit back to the read view, guarding a dirty editor.
    const cancelEdit = useCallback(() => {
        if (formDirty && !confirm(DISCARD_CONFIRM)) return;
        setFormDirty(false);
        setEditingId(null);
    }, [formDirty]);

    const handleRunNow = useCallback(async (scheduleId: string) => {
        await client.schedules.run(workspaceId, scheduleId);
        fetchSchedules();
        if (selectedId === scheduleId) {
            try { setHistory(await client.schedules.history(workspaceId, scheduleId)); } catch { /* keep prior */ }
        }
    }, [client, workspaceId, fetchSchedules, selectedId]);

    const handlePauseResume = useCallback(async (schedule: Schedule) => {
        if (schedule.status === 'active') {
            await client.schedules.disable(workspaceId, schedule.id);
        } else {
            await client.schedules.enable(workspaceId, schedule.id);
        }
        fetchSchedules();
    }, [client, workspaceId, fetchSchedules]);

    const handleDelete = useCallback(async (scheduleId: string) => {
        const schedule = schedules.find(s => s.id === scheduleId);
        const slug = scheduleId.replace(/^repo:/, '');
        const message = schedule?.source === 'repo'
            ? `This will permanently delete .github/schedules/${slug}.yaml. This cannot be undone. Continue?`
            : 'Delete this schedule?';
        if (!confirm(message)) return;
        await client.schedules.delete(workspaceId, scheduleId);
        fetchSchedules();
        doCloseToSlide();
    }, [schedules, client, workspaceId, fetchSchedules, doCloseToSlide]);

    // Esc closes an open form (create → back to slide; edit → back to read
    // view), routed through the same dirty guard.
    const formOpen = route.kind === 'new' || (route.kind === 'detail' && editingId != null && editingId === selectedId);
    useEffect(() => {
        if (!formOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (route.kind === 'new') closeToSlide();
            else cancelEdit();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [formOpen, route.kind, closeToSlide, cancelEdit]);

    // ── Create ────────────────────────────────────────────────────────────
    if (route.kind === 'new') {
        return (
            <div
                className="flex flex-col h-full min-h-0 overflow-y-auto bg-white dark:bg-[#1e1e1e]"
                data-testid="schedule-main-pane"
                data-schedule-pane-mode="new"
            >
                <ScheduleMainPaneHeader title="New schedule" onClose={closeToSlide} />
                <div className="px-4 py-3 max-w-3xl w-full">
                    <PromptScheduleForm
                        workspaceId={workspaceId}
                        mode="create"
                        storePicker
                        onDirtyChange={setFormDirty}
                        onCreated={(created) => {
                            setFormDirty(false);
                            fetchSchedules();
                            if (created?.id) {
                                if (created.source === 'repo') setCommitReminderId(created.id);
                                dispatch({ type: 'SET_SELECTED_SCHEDULE', id: created.id });
                                navigate(scheduleBase + '/' + encodeURIComponent(created.id));
                            } else {
                                doCloseToSlide();
                            }
                        }}
                        onCancel={closeToSlide}
                    />
                </div>
            </div>
        );
    }

    // ── View / edit ───────────────────────────────────────────────────────
    const selectedSchedule = selectedId ? schedules.find(s => s.id === selectedId) ?? null : null;

    return (
        <div
            className="flex flex-col h-full min-h-0 overflow-y-auto bg-white dark:bg-[#1e1e1e]"
            data-testid="schedule-main-pane"
            data-schedule-pane-mode="detail"
        >
            <ScheduleMainPaneHeader title="Schedule" onClose={closeToSlide} />
            <div className="max-w-3xl w-full">
                {commitReminderId != null && commitReminderId === selectedId && (
                    <div
                        className="mx-5 mt-3 px-3 py-2 rounded text-xs bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 flex items-start gap-2"
                        data-testid="schedule-main-pane-commit-reminder"
                    >
                        <span className="flex-1">
                            Schedule saved to <code className="font-mono">.github/schedules/</code> — commit to share with your team.
                        </span>
                        <button
                            type="button"
                            className="text-teal-500 hover:text-teal-700 dark:hover:text-teal-200 font-bold leading-none flex-shrink-0"
                            onClick={() => setCommitReminderId(null)}
                            aria-label="Dismiss reminder"
                            data-testid="schedule-main-pane-commit-reminder-dismiss"
                        >
                            ×
                        </button>
                    </div>
                )}
                {selectedSchedule ? (
                    <ScheduleDetail
                        schedule={selectedSchedule}
                        workspaceId={workspaceId}
                        history={history}
                        editingId={editingId}
                        showDuplicate={false}
                        disableNonPromptEdit={true}
                        onEditDirtyChange={setFormDirty}
                        onRunNow={handleRunNow}
                        onPauseResume={handlePauseResume}
                        onEdit={(id) => setEditingId(id)}
                        onDuplicate={() => { /* out of scope for the Scheduled-slide main pane */ }}
                        onDelete={handleDelete}
                        onCancelEdit={cancelEdit}
                        onSaved={() => { setFormDirty(false); setEditingId(null); fetchSchedules(); }}
                    />
                ) : !loaded ? (
                    <div className="p-6 text-sm text-[#656d76] dark:text-[#848484]" data-testid="schedule-main-pane-loading">
                        Loading schedule…
                    </div>
                ) : (
                    <div className="p-6 text-sm text-[#656d76] dark:text-[#848484]" data-testid="schedule-main-pane-not-found">
                        Schedule not found.{' '}
                        <button
                            type="button"
                            className="text-[#0969da] dark:text-[#4fc3f7] hover:underline"
                            onClick={closeToSlide}
                            data-testid="schedule-main-pane-back"
                        >
                            Back to schedules
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function ScheduleMainPaneHeader({ title, onClose }: { title: string; onClose: () => void }) {
    return (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[#eaeef2] dark:border-[#3c3c3c] flex-shrink-0 bg-white dark:bg-[#1e1e1e]">
            <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-[#0969da] dark:text-[#4fc3f7] hover:underline"
                onClick={onClose}
                data-testid="schedule-main-pane-close"
            >
                ← Schedules
            </button>
            <span className="text-xs font-semibold text-[#1f2328] dark:text-[#cccccc] truncate">{title}</span>
        </div>
    );
}
