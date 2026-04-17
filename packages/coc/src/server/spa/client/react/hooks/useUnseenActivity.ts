/**
 * useUnseenActivity — tracks which tasks have state changes the user hasn't acknowledged.
 *
 * Any state transition (queued→running, running→completed, etc.) marks an item
 * as "unseen" until the user clicks into it.  State is persisted per-workspace
 * in localStorage so it survives page reloads.
 *
 * State is persisted server-side (SQLite `seen_at` column on `processes`).
 * On first load, existing localStorage data is migrated to the server.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { fetchSeenMap, patchSeenState, deleteSeenEntry } from './seenStateApi';

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

/** Combine queued + running + history into a single array, deduplicating by id. */
function mergeAllItems(queued: any[], running: any[], history: any[]): any[] {
    const seen = new Set<string>();
    const result: any[] = [];
    for (const item of [...queued, ...running, ...history]) {
        if (!item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        result.push(item);
    }
    return result;
}

export interface UseUnseenActivityOptions {
    /** When true, apply single-active-chat suppression. */
    isViewingChats?: boolean;
}

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
    queued: any[] = [],
    running: any[] = [],
    options?: UseUnseenActivityOptions,
): UseUnseenActivityResult {
    const [seenMap, setSeenMap] = useState<Record<string, string>>({});
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
    }, [allItems, seenMap]);

    // Chat-specific badge logic: if exactly 1 active chat and the user is
    // currently viewing it, suppress the badge entirely.
    const unseenCount = useMemo(() => {
        if (!options?.isViewingChats || !selectedTaskId) return unseenTaskIds.size;
        const isChat = (t: any) => t.type === 'chat' && !t.payload?.workItemId;
        const activeChats = allItems.filter(t => isChat(t) && (t.status === 'queued' || t.status === 'running'));
        if (activeChats.length === 1 && activeChats[0].id === selectedTaskId) {
            // The user is watching the only active chat — suppress its contribution.
            const adjusted = new Set(unseenTaskIds);
            adjusted.delete(selectedTaskId);
            return adjusted.size;
        }
        return unseenTaskIds.size;
    }, [unseenTaskIds, allItems, selectedTaskId, options?.isViewingChats]);

    // Mark a specific task as seen.
    const markSeen = useCallback((processId: string) => {
        const task = history.find(t => t.id === processId);
        const completedAt = task ? getTaskCompletedAtIso(task) : undefined;
        if (completedAt) {
            setSeenMap(prev => {
                if (prev[processId] === completedAt) return prev;
                schedulePatch([{ processId, seenAt: completedAt }]);
                return { ...prev, [processId]: completedAt };
            });
        }
    }, [history, schedulePatch]);

    // Mark all tasks as seen.
    const markAllSeen = useCallback(() => {
        setSeenMap(prev => {
            const updated = { ...prev };
            const entries: Array<{ processId: string; seenAt: string }> = [];
            let changed = false;
            for (const task of history) {
                const completedAt = getTaskCompletedAtIso(task);
                if (completedAt && updated[task.id] !== completedAt) {
                    updated[task.id] = completedAt;
                    entries.push({ processId: task.id, seenAt: completedAt });
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
                const completedAt = getTaskCompletedAtIso(task);
                if (completedAt && updated[task.id] !== completedAt) {
                    updated[task.id] = completedAt;
                    entries.push({ processId: task.id, seenAt: completedAt });
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
