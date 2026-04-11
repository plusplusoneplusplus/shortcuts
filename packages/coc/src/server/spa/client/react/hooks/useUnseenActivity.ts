/**
 * useUnseenActivity — tracks which completed tasks the user has viewed.
 *
 * Tasks that complete while the user is viewing another task are "unseen"
 * and surfaced via bold styling + dot indicator in the activity list.
 *
 * State is persisted server-side (SQLite `seen_at` column on `processes`).
 * On first load, existing localStorage data is migrated to the server.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { fetchSeenMap, patchSeenState, deleteSeenEntry } from './seenStateApi';

const STORAGE_PREFIX = 'coc-unseen-';

export interface UseUnseenActivityResult {
    /** Set of process IDs that have unseen activity. */
    unseenProcessIds: Set<string>;
    /** Number of tasks with unseen activity. */
    unseenCount: number;
    /** Mark a process as seen (call when user selects a task). */
    markSeen: (processId: string) => void;
    /** Mark all history tasks as seen. */
    markAllSeen: () => void;
    /** Mark a specific subset of tasks as seen (e.g. the currently filtered list). */
    markTasksSeen: (tasks: any[]) => void;
    /** Mark a process as unseen/unread (removes it from the seen map). */
    markUnseen: (processId: string) => void;
}

export function useUnseenActivity(
    workspaceId: string,
    history: any[],
    selectedTaskId: string | null,
): UseUnseenActivityResult {
    const [seenMap, setSeenMap] = useState<Record<string, string>>({});
    const initializedRef = useRef(false);
    const seededRef = useRef(false);

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
            if (task.completedAt) {
                updated[task.id] = task.completedAt;
                entries.push({ processId: task.id, seenAt: task.completedAt });
            }
        }
        if (entries.length > 0) {
            setSeenMap(updated);
            patchSeenState(workspaceId, entries).catch(() => {});
        }
    }, [history, seenMap, workspaceId]);

    // Auto-mark currently selected task as seen when it appears in history.
    useEffect(() => {
        if (!selectedTaskId || !initializedRef.current) return;
        const task = history.find(t => t.id === selectedTaskId);
        if (task?.completedAt) {
            setSeenMap(prev => {
                if (prev[selectedTaskId] === task.completedAt) return prev;
                const updated = { ...prev, [selectedTaskId]: task.completedAt };
                schedulePatch([{ processId: selectedTaskId, seenAt: task.completedAt }]);
                return updated;
            });
        }
    }, [selectedTaskId, history, schedulePatch]);

    // Compute the unseen set.
    const unseenProcessIds = useMemo(() => {
        const unseen = new Set<string>();
        for (const task of history) {
            if (!task.completedAt) continue;
            const seen = seenMap[task.id];
            if (!seen || seen !== task.completedAt) {
                unseen.add(task.id);
            }
        }
        return unseen;
    }, [history, seenMap]);

    // Mark a specific task as seen.
    const markSeen = useCallback((processId: string) => {
        const task = history.find(t => t.id === processId);
        if (task?.completedAt) {
            setSeenMap(prev => {
                if (prev[processId] === task.completedAt) return prev;
                schedulePatch([{ processId, seenAt: task.completedAt }]);
                return { ...prev, [processId]: task.completedAt };
            });
        }
    }, [history, schedulePatch]);

    // Mark all history tasks as seen.
    const markAllSeen = useCallback(() => {
        setSeenMap(prev => {
            const updated = { ...prev };
            const entries: Array<{ processId: string; seenAt: string }> = [];
            let changed = false;
            for (const task of history) {
                if (task.completedAt && updated[task.id] !== task.completedAt) {
                    updated[task.id] = task.completedAt;
                    entries.push({ processId: task.id, seenAt: task.completedAt });
                    changed = true;
                }
            }
            if (entries.length > 0) schedulePatch(entries);
            return changed ? updated : prev;
        });
    }, [history, schedulePatch]);

    // Mark a specific subset of tasks as seen (e.g. the currently filtered list).
    const markTasksSeen = useCallback((tasks: any[]) => {
        setSeenMap(prev => {
            const updated = { ...prev };
            const entries: Array<{ processId: string; seenAt: string }> = [];
            let changed = false;
            for (const task of tasks) {
                if (task.completedAt && updated[task.id] !== task.completedAt) {
                    updated[task.id] = task.completedAt;
                    entries.push({ processId: task.id, seenAt: task.completedAt });
                    changed = true;
                }
            }
            if (entries.length > 0) schedulePatch(entries);
            return changed ? updated : prev;
        });
    }, [schedulePatch]);

    // Mark a specific task as unseen/unread.
    const markUnseen = useCallback((processId: string) => {
        setSeenMap(prev => {
            if (!(processId in prev)) return prev;
            const updated = { ...prev };
            delete updated[processId];
            deleteSeenEntry(workspaceId, processId).catch(() => {});
            return updated;
        });
    }, [workspaceId]);

    return { unseenProcessIds, unseenCount: unseenProcessIds.size, markSeen, markAllSeen, markTasksSeen, markUnseen };
}
