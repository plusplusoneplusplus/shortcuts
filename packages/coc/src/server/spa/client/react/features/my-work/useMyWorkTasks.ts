/**
 * useMyWorkTasks — the data layer behind the My Work Today tab.
 *
 * Owns the fetch, the three mutations (toggle, quick-add, archive) and the
 * shared error/busy state, so the tab itself is left with rendering only.
 *
 * Toggles are optimistic: flip locally, PATCH, then refetch so the id/line map
 * stays in sync (ids are within-snapshot addressing tokens, so any mutation
 * that reflows lines must be followed by a refetch). A failed PATCH rolls the
 * toggle back and surfaces an inline error.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MyWorkTask, MyWorkTasks } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';

export interface UseMyWorkTasksResult {
    tasks: MyWorkTasks | null;
    actionItems: MyWorkTask[];
    followUps: MyWorkTask[];
    /** True only during the very first fetch, before any snapshot exists. */
    firstLoad: boolean;
    /** True once loaded and both lists are empty. */
    isEmpty: boolean;
    error: string | null;
    /** True while a mutation (quick-add or archive) is in flight. */
    busy: boolean;
    doneCount: number;
    totalCount: number;
    load: () => Promise<void>;
    toggle: (task: MyWorkTask) => Promise<void>;
    /** Adds an action item; resolves true when the write succeeded. */
    addActionItem: (text: string) => Promise<boolean>;
    clearCompleted: () => Promise<void>;
}

/**
 * @param active True while the owning tab is visible; drives the initial fetch.
 */
export function useMyWorkTasks(active: boolean): UseMyWorkTasksResult {
    const [tasks, setTasks] = useState<MyWorkTasks | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
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

    // Fetch once the tab becomes active. `active` defaults true at the call
    // site so the tab also works when rendered standalone (tests, future
    // embeddings).
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

    const addActionItem = useCallback(async (text: string): Promise<boolean> => {
        if (!text || busy) return false; // empty quick-add is a no-op
        setBusy(true);
        setError(null);
        try {
            await getSpaCocClient().myWork.addTask({ list: 'action', text });
            await load();
            return true;
        } catch (err) {
            if (mounted.current) setError(getSpaCocClientErrorMessage(err, 'Failed to add task'));
            return false;
        } finally {
            if (mounted.current) setBusy(false);
        }
    }, [busy, load]);

    const actionItems = tasks?.actionItems ?? [];
    const followUps = tasks?.followUps ?? [];
    const doneCount = actionItems.filter(t => t.checked).length;
    const totalCount = actionItems.length;

    // Archive every checked action item under `## Archive`, then refetch. Shares
    // the `busy` guard with quick-add so only one mutation runs at a time, and it
    // never optimistically mutates the list (ids reflow after the write). Mirrors
    // `addActionItem()`: set busy → clear error → mutate → refetch → finally.
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

    return {
        tasks,
        actionItems,
        followUps,
        // Once tasks have loaded we keep the lists mounted — a mutation error
        // shows as an inline banner above them, not by blanking the view (so an
        // optimistic rollback stays visible). The full loading state is only the
        // first fetch.
        firstLoad: loading && !tasks,
        isEmpty: !!tasks && actionItems.length === 0 && followUps.length === 0,
        error,
        busy,
        doneCount,
        totalCount,
        load,
        toggle,
        addActionItem,
        clearCompleted,
    };
}
