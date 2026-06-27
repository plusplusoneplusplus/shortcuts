/**
 * useUnseenChat — tracks which completed tasks the user has viewed.
 *
 * Tasks that complete while the user is viewing another task are "unseen"
 * and surfaced via bold styling + dot indicator in the activity list.
 *
 * State is persisted server-side (SQLite `seen_at` column on `processes`).
 * On first load, existing localStorage data is migrated to the server.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { fetchSeenMap, patchSeenState, deleteSeenEntry } from '../../../hooks/preferences/seenStateApi';

const STORAGE_PREFIX = 'coc-unseen-';

/**
 * Resolve a completion timestamp from either legacy `completedAt` (string)
 * or `endTime` (ms epoch, used by ProcessHistoryItem).
 */
export function getTaskCompletedAtIso(task: any): string | undefined {
    if (task.completedAt) return String(task.completedAt);
    if (task.endTime) return new Date(task.endTime).toISOString();
    return undefined;
}

export interface useUnseenChatResult {
    /** Set of process IDs that have unseen activity. */
    unseenProcessIds: Set<string>;
    /** Number of tasks with unseen activity. */
    unseenCount: number;
    /**
     * Mark a process as seen (call when user selects a task).
     * Returns `true` when the seen-state actually changed (a real transition),
     * `false` when it was already seen — callers gate workspace-scoped side
     * effects (e.g. the unseen-count refetch) on this so a warm reopen of an
     * already-seen conversation does not re-fire the count request.
     */
    markSeen: (processId: string) => boolean;
    /** Mark all history tasks as seen. Returns `true` if anything changed. */
    markAllSeen: () => boolean;
    /**
     * Mark a specific subset of tasks as seen (e.g. the currently filtered list).
     * Returns `true` if anything changed.
     */
    markTasksSeen: (tasks: any[]) => boolean;
    /**
     * Mark a process as unseen/unread (removes it from the seen map).
     * Returns `true` if an entry was actually removed.
     */
    markUnseen: (processId: string) => boolean;
}

export function useUnseenChat(
    workspaceId: string,
    history: any[],
    selectedTaskId: string | null,
): useUnseenChatResult {
    const [seenMap, setSeenMap] = useState<Record<string, string>>({});
    // Synchronous mirror of seenMap. The mutators below run inside event
    // handlers and must report whether they actually changed state *before* the
    // next render commits, so they read/update this ref instead of relying on
    // the async `setSeenMap` updater closure. Kept in sync with `seenMap` after
    // every commit (incl. async effects) and eagerly updated inside each mutator
    // so back-to-back synchronous calls in one tick stay correct.
    const seenMapRef = useRef<Record<string, string>>({});
    useEffect(() => { seenMapRef.current = seenMap; }, [seenMap]);
    const initializedRef = useRef(false);
    const seededRef = useRef(false);
    const prevSelectedRef = useRef<string | null>(null);

    // Debounce batch for patchSeenState calls
    const pendingEntriesRef = useRef<Array<{ processId: string; seenAt: string }>>([]);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const flushPending = useCallback(() => {
        if (pendingEntriesRef.current.length === 0) return;
        const entries = pendingEntriesRef.current;
        pendingEntriesRef.current = [];
        patchSeenState(workspaceId, entries).catch(() => { /* fire-and-forget */ });
    }, [workspaceId]);

    const schedulePatch = useCallback((entries: Array<{ processId: string; seenAt: string }>) => {
        pendingEntriesRef.current.push(...entries);
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(flushPending, 100);
    }, [flushPending]);

    // Load initial seen map from server + handle localStorage migration
    useEffect(() => {
        let cancelled = false;
        initializedRef.current = false;
        seededRef.current = false;

        (async () => {
            try {
                const serverMap = await fetchSeenMap(workspaceId);
                if (cancelled) return;

                // One-time localStorage migration
                const storageKey = STORAGE_PREFIX + workspaceId;
                let localMap: Record<string, string> | null = null;
                try {
                    const raw = localStorage.getItem(storageKey);
                    if (raw) localMap = JSON.parse(raw);
                } catch { /* corrupt or unavailable */ }

                if (localMap && Object.keys(localMap).length > 0) {
                    // Merge localStorage entries into server state
                    const merged = { ...serverMap };
                    const migrationEntries: Array<{ processId: string; seenAt: string }> = [];
                    for (const [processId, seenAt] of Object.entries(localMap)) {
                        if (!merged[processId]) {
                            merged[processId] = seenAt;
                            migrationEntries.push({ processId, seenAt });
                        }
                    }
                    if (migrationEntries.length > 0) {
                        patchSeenState(workspaceId, migrationEntries).catch(() => {});
                    }
                    // Remove localStorage key after migration
                    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
                    if (!cancelled) setSeenMap(merged);
                } else {
                    if (!cancelled) setSeenMap(serverMap);
                }

                if (!cancelled) initializedRef.current = true;
            } catch {
                // Server unavailable — start with empty map
                if (!cancelled) {
                    setSeenMap({});
                    initializedRef.current = true;
                }
            }
        })();

        return () => {
            cancelled = true;
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
    }, [workspaceId]);

    // First-visit seeding: when server map is empty and no localStorage key exists,
    // seed all completed tasks as seen so we don't flash everything as "unseen".
    useEffect(() => {
        if (!initializedRef.current || seededRef.current || history.length === 0) return;
        if (Object.keys(seenMap).length > 0) return; // already has data
        seededRef.current = true;

        const entries: Array<{ processId: string; seenAt: string }> = [];
        const updated: Record<string, string> = {};
        for (const task of history) {
            const completedAt = getTaskCompletedAtIso(task);
            if (completedAt) {
                updated[task.id] = completedAt;
                entries.push({ processId: task.id, seenAt: completedAt });
            }
        }
        if (entries.length > 0) {
            setSeenMap(updated);
            patchSeenState(workspaceId, entries).catch(() => {});
        }
    }, [history, seenMap, workspaceId]);

    // Auto-mark currently selected task as seen when user navigates to it.
    // Guard: skip when only history changed (e.g. running → completed transition).
    useEffect(() => {
        if (!selectedTaskId || !initializedRef.current) {
            prevSelectedRef.current = selectedTaskId;
            return;
        }
        if (prevSelectedRef.current === selectedTaskId) return;
        prevSelectedRef.current = selectedTaskId;

        const task = history.find(t => t.id === selectedTaskId);
        const completedAt = task ? getTaskCompletedAtIso(task) : undefined;
        if (completedAt) {
            setSeenMap(prev => {
                if (prev[selectedTaskId] === completedAt) return prev;
                const updated = { ...prev, [selectedTaskId]: completedAt };
                schedulePatch([{ processId: selectedTaskId, seenAt: completedAt }]);
                return updated;
            });
        }
    }, [selectedTaskId, history, schedulePatch]);

    // Compute the unseen set.
    const unseenProcessIds = useMemo(() => {
        const unseen = new Set<string>();
        for (const task of history) {
            const completedAt = getTaskCompletedAtIso(task);
            if (!completedAt) continue;
            const seen = seenMap[task.id];
            if (!seen || seen !== completedAt) {
                unseen.add(task.id);
            }
        }
        return unseen;
    }, [history, seenMap]);

    // Mark a specific task as seen. Returns whether the state actually changed.
    const markSeen = useCallback((processId: string): boolean => {
        const task = history.find(t => t.id === processId);
        const completedAt = task ? getTaskCompletedAtIso(task) : undefined;
        if (!completedAt) return false;
        if (seenMapRef.current[processId] === completedAt) return false;
        const updated = { ...seenMapRef.current, [processId]: completedAt };
        seenMapRef.current = updated;
        schedulePatch([{ processId, seenAt: completedAt }]);
        setSeenMap(updated);
        return true;
    }, [history, schedulePatch]);

    // Mark all history tasks as seen. Returns whether anything changed.
    const markAllSeen = useCallback((): boolean => {
        const updated = { ...seenMapRef.current };
        const entries: Array<{ processId: string; seenAt: string }> = [];
        for (const task of history) {
            const completedAt = getTaskCompletedAtIso(task);
            if (completedAt && updated[task.id] !== completedAt) {
                updated[task.id] = completedAt;
                entries.push({ processId: task.id, seenAt: completedAt });
            }
        }
        if (entries.length === 0) return false;
        seenMapRef.current = updated;
        schedulePatch(entries);
        setSeenMap(updated);
        return true;
    }, [history, schedulePatch]);

    // Mark a specific subset of tasks as seen (e.g. the currently filtered list).
    // Returns whether anything changed.
    const markTasksSeen = useCallback((tasks: any[]): boolean => {
        const updated = { ...seenMapRef.current };
        const entries: Array<{ processId: string; seenAt: string }> = [];
        for (const task of tasks) {
            const completedAt = getTaskCompletedAtIso(task);
            if (completedAt && updated[task.id] !== completedAt) {
                updated[task.id] = completedAt;
                entries.push({ processId: task.id, seenAt: completedAt });
            }
        }
        if (entries.length === 0) return false;
        seenMapRef.current = updated;
        schedulePatch(entries);
        setSeenMap(updated);
        return true;
    }, [schedulePatch]);

    // Mark a specific task as unseen/unread. Returns whether an entry was removed.
    const markUnseen = useCallback((processId: string): boolean => {
        if (!(processId in seenMapRef.current)) return false;
        const updated = { ...seenMapRef.current };
        delete updated[processId];
        seenMapRef.current = updated;
        deleteSeenEntry(workspaceId, processId).catch(() => {});
        setSeenMap(updated);
        return true;
    }, [workspaceId]);

    return { unseenProcessIds, unseenCount: unseenProcessIds.size, markSeen, markAllSeen, markTasksSeen, markUnseen };
}
