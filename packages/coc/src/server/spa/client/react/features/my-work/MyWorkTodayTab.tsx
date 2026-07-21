/**
 * MyWorkTodayTab — actionable "Today" view for a virtual workspace (My Work,
 * and later My Life via the `workspaceId` prop).
 *
 * Reads the task model exposed by the My Work task routes
 * (`getSpaCocClient().myWork`), which parse `Action Items.md` and
 * `Follow Ups.md` as the single source of truth. Renders the current action
 * items and "waiting on" follow-ups (grouped by person) with checkbox toggling
 * and a quick-add bar.
 *
 * Toggles are optimistic: flip locally, PATCH, then refetch so the id/line map
 * stays in sync (ids are within-snapshot addressing tokens, so any mutation that
 * reflows lines must be followed by a refetch). A failed PATCH rolls the toggle
 * back and surfaces an inline error.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MyWorkTask, MyWorkTasks } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';

export interface MyWorkTodayTabProps {
    /** Virtual workspace whose notes back the Today view (e.g. `my_work`). */
    workspaceId: string;
    /** True while this tab is the visible sub-tab; drives the initial fetch. */
    active?: boolean;
}

/** Group follow-ups by their `person` heading, preserving first-seen order. */
function groupByPerson(followUps: MyWorkTask[]): { person: string; items: MyWorkTask[] }[] {
    const order: string[] = [];
    const byPerson = new Map<string, MyWorkTask[]>();
    for (const item of followUps) {
        const person = item.person ?? '';
        if (!byPerson.has(person)) {
            byPerson.set(person, []);
            order.push(person);
        }
        byPerson.get(person)!.push(item);
    }
    return order.map(person => ({ person, items: byPerson.get(person)! }));
}

export function MyWorkTodayTab({ workspaceId, active = true }: MyWorkTodayTabProps) {
    const [tasks, setTasks] = useState<MyWorkTasks | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [quickAdd, setQuickAdd] = useState('');
    const [busy, setBusy] = useState(false);
    // Guard against a fetch resolving after the component unmounts.
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await getSpaCocClient().myWork.getTasks();
            if (mounted.current) setTasks(result);
        } catch (err) {
            if (mounted.current) setError(getSpaCocClientErrorMessage(err, 'Failed to load tasks'));
        } finally {
            if (mounted.current) setLoading(false);
        }
    }, []);

    // Fetch once the tab becomes active. `active` defaults true so the tab also
    // works when rendered standalone (tests, future embeddings).
    const hasLoaded = useRef(false);
    useEffect(() => {
        if (active && !hasLoaded.current) {
            hasLoaded.current = true;
            void load();
        }
    }, [active, load]);

    const toggle = useCallback(async (task: MyWorkTask) => {
        const nextChecked = !task.checked;
        // Optimistic flip on whichever list the task lives in.
        setTasks(prev => prev && {
            actionItems: prev.actionItems.map(t => t.id === task.id ? { ...t, checked: nextChecked } : t),
            followUps: prev.followUps.map(t => t.id === task.id ? { ...t, checked: nextChecked } : t),
        });
        try {
            await getSpaCocClient().myWork.patchTask(task.id, { checked: nextChecked });
            // Refetch: toggling can change ids and (for follow-ups) grouping.
            await load();
        } catch (err) {
            // Roll the optimistic flip back and surface the failure inline.
            setTasks(prev => prev && {
                actionItems: prev.actionItems.map(t => t.id === task.id ? { ...t, checked: task.checked } : t),
                followUps: prev.followUps.map(t => t.id === task.id ? { ...t, checked: task.checked } : t),
            });
            if (mounted.current) setError(getSpaCocClientErrorMessage(err, 'Failed to update task'));
        }
    }, [load]);

    const submitQuickAdd = useCallback(async () => {
        const text = quickAdd.trim();
        if (!text || busy) return; // empty quick-add is a no-op
        setBusy(true);
        setError(null);
        try {
            await getSpaCocClient().myWork.addTask({ list: 'action', text });
            if (mounted.current) setQuickAdd('');
            await load();
        } catch (err) {
            if (mounted.current) setError(getSpaCocClientErrorMessage(err, 'Failed to add task'));
        } finally {
            if (mounted.current) setBusy(false);
        }
    }, [quickAdd, busy, load]);

    const actionItems = tasks?.actionItems ?? [];
    const followUps = tasks?.followUps ?? [];
    const followUpGroups = useMemo(() => groupByPerson(followUps), [followUps]);
    const doneCount = actionItems.filter(t => t.checked).length;
    const totalCount = actionItems.length;

    // Archive every checked action item under `## Archive`, then refetch. Shares
    // the `busy` guard with quick-add so only one mutation runs at a time, and it
    // never optimistically mutates the list (ids reflow after the write). Mirrors
    // `submitQuickAdd()`: set busy → clear error → mutate → refetch → finally.
    const clearCompleted = useCallback(async () => {
        if (busy || doneCount === 0) return; // nothing checked, or a mutation already in flight
        setBusy(true);
        setError(null);
        try {
            await getSpaCocClient().myWork.archiveTasks();
            await load();
        } catch (err) {
            if (mounted.current) setError(getSpaCocClientErrorMessage(err, 'Failed to archive completed items'));
        } finally {
            if (mounted.current) setBusy(false);
        }
    }, [busy, doneCount, load]);
    // Once tasks have loaded we keep the lists mounted — a mutation error shows
    // as an inline banner above them, not by blanking the view (so an optimistic
    // rollback stays visible). The full loading state is only the first fetch.
    const firstLoad = loading && !tasks;
    const isEmpty = !!tasks && actionItems.length === 0 && followUps.length === 0;

    const openNote = (path: string) => {
        location.hash = `#repos/${workspaceId}/notes/${encodeURIComponent(path)}`;
    };

    return (
        <div className="flex flex-col h-full min-h-0 overflow-auto p-4 gap-4" data-testid="my-work-today-tab">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Today</h2>
                {totalCount > 0 && (
                    <span
                        className="text-xs text-gray-500 dark:text-gray-400"
                        data-testid="my-work-today-stat"
                    >
                        {doneCount}/{totalCount} done
                    </span>
                )}
            </div>

            {firstLoad && (
                <div className="text-sm text-gray-500 dark:text-gray-400" data-testid="my-work-today-loading">
                    Loading tasks…
                </div>
            )}

            {error && (
                <div
                    className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400"
                    data-testid="my-work-today-error"
                >
                    <span>{error}</span>
                    <button
                        type="button"
                        className="underline"
                        onClick={() => void load()}
                        data-testid="my-work-today-retry"
                    >
                        Retry
                    </button>
                </div>
            )}

            {isEmpty && (
                <div className="text-sm text-gray-500 dark:text-gray-400" data-testid="my-work-today-empty">
                    Nothing for today. Add an action item below to get started.
                </div>
            )}

            {tasks && (
                <>
                    <section data-testid="my-work-today-actions">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Action Items
                            </h3>
                            <div className="flex items-center gap-3">
                                {doneCount >= 1 && (
                                    <button
                                        type="button"
                                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                                        onClick={() => void clearCompleted()}
                                        disabled={busy}
                                        aria-busy={busy}
                                        data-testid="my-work-today-clear-completed"
                                    >
                                        {busy ? 'Clearing…' : 'Clear completed'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                    onClick={() => openNote('Action Items.md')}
                                    data-testid="my-work-today-open-actions"
                                >
                                    Open note
                                </button>
                            </div>
                        </div>
                        <ul className="flex flex-col gap-1">
                            {actionItems.map(task => (
                                <li key={task.id} data-testid={`my-work-today-action-${task.id}`}>
                                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={task.checked}
                                            onChange={() => void toggle(task)}
                                            data-testid={`my-work-today-check-${task.id}`}
                                        />
                                        <span className={task.checked ? 'line-through text-gray-400' : ''}>
                                            {task.text}
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    </section>

                    <section data-testid="my-work-today-followups">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Waiting On
                            </h3>
                            <button
                                type="button"
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                onClick={() => openNote('Follow Ups.md')}
                                data-testid="my-work-today-open-followups"
                            >
                                Open note
                            </button>
                        </div>
                        {followUpGroups.map(group => (
                            <div key={group.person || '__none__'} className="mb-2" data-testid={`my-work-today-person-${group.person || 'unassigned'}`}>
                                {group.person && (
                                    <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{group.person}</div>
                                )}
                                <ul className="flex flex-col gap-1">
                                    {group.items.map(task => (
                                        <li key={task.id} data-testid={`my-work-today-followup-${task.id}`}>
                                            <label className="flex items-start gap-2 text-sm cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={task.checked}
                                                    onChange={() => void toggle(task)}
                                                    data-testid={`my-work-today-check-${task.id}`}
                                                />
                                                <span className={task.checked ? 'line-through text-gray-400' : ''}>
                                                    {task.text}
                                                </span>
                                            </label>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </section>
                </>
            )}

            <form
                className="flex items-center gap-2 mt-auto"
                onSubmit={e => { e.preventDefault(); void submitQuickAdd(); }}
                data-testid="my-work-today-quickadd"
            >
                <input
                    type="text"
                    className="flex-1 text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-transparent"
                    placeholder="Add an action item…"
                    value={quickAdd}
                    onChange={e => setQuickAdd(e.target.value)}
                    data-testid="my-work-today-quickadd-input"
                />
                <button
                    type="submit"
                    className="text-sm px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                    disabled={busy || quickAdd.trim().length === 0}
                    data-testid="my-work-today-quickadd-btn"
                >
                    Add
                </button>
            </form>
        </div>
    );
}
