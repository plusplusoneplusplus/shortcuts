/**
 * useUnseenActivity — tracks which completed tasks the user has viewed.
 *
 * Tasks that complete while the user is viewing another task are "unseen"
 * and surfaced via bold styling + dot indicator in the activity list.
 *
 * State is persisted per-workspace in localStorage so it survives page reloads.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

const STORAGE_PREFIX = 'coc-unseen-';

/** Read the seen map from localStorage, returning null if the key doesn't exist. */
function loadSeenMap(storageKey: string): Record<string, string> | null {
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw) return JSON.parse(raw);
    } catch { /* corrupt or unavailable */ }
    return null;
}

function persistSeenMap(storageKey: string, map: Record<string, string>): void {
    try {
        localStorage.setItem(storageKey, JSON.stringify(map));
        // Notify same-tab listeners (e.g. sidebar badge) that seen state changed.
        window.dispatchEvent(new CustomEvent('coc-seen-updated', { detail: { storageKey } }));
    }
    catch { /* quota or unavailable */ }
}

export interface UseUnseenActivityResult {
    /** Set of task IDs that have unseen activity. */
    unseenTaskIds: Set<string>;
    /** Number of tasks with unseen activity. */
    unseenCount: number;
    /** Mark a task as seen (call when user selects a task). */
    markSeen: (taskId: string) => void;
    /** Mark all history tasks as seen. */
    markAllSeen: () => void;
    /** Mark a specific subset of tasks as seen (e.g. the currently filtered list). */
    markTasksSeen: (tasks: any[]) => void;
    /** Mark a task as unseen/unread (removes it from the seen map). */
    markUnseen: (taskId: string) => void;
}

export function useUnseenActivity(
    workspaceId: string,
    history: any[],
    selectedTaskId: string | null,
): UseUnseenActivityResult {
    const storageKey = STORAGE_PREFIX + workspaceId;

    // Whether this workspace had prior seen-state in localStorage.
    const hadPriorStateRef = useRef<boolean>(loadSeenMap(storageKey) !== null);

    const [seenMap, setSeenMap] = useState<Record<string, string>>(() => {
        return loadSeenMap(storageKey) ?? {};
    });

    // Persist to localStorage whenever seenMap changes.
    useEffect(() => {
        persistSeenMap(storageKey, seenMap);
    }, [seenMap, storageKey]);

    // On first visit (no prior localStorage), seed all existing history as seen
    // so we don't flash everything as "unseen" on initial load.
    const seededRef = useRef(false);
    useEffect(() => {
        if (hadPriorStateRef.current || seededRef.current || history.length === 0) return;
        seededRef.current = true;
        setSeenMap(prev => {
            const updated = { ...prev };
            let changed = false;
            for (const task of history) {
                if (task.completedAt && !updated[task.id]) {
                    updated[task.id] = task.completedAt;
                    changed = true;
                }
            }
            return changed ? updated : prev;
        });
    }, [history]);

    // Auto-mark currently selected task as seen when it appears in history.
    useEffect(() => {
        if (!selectedTaskId) return;
        const task = history.find(t => t.id === selectedTaskId);
        if (task?.completedAt) {
            setSeenMap(prev => {
                if (prev[selectedTaskId] === task.completedAt) return prev;
                return { ...prev, [selectedTaskId]: task.completedAt };
            });
        }
    }, [selectedTaskId, history]);

    // Compute the unseen set.
    const unseenTaskIds = useMemo(() => {
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
    const markSeen = useCallback((taskId: string) => {
        const task = history.find(t => t.id === taskId);
        if (task?.completedAt) {
            setSeenMap(prev => {
                if (prev[taskId] === task.completedAt) return prev;
                return { ...prev, [taskId]: task.completedAt };
            });
        }
    }, [history]);

    // Mark all history tasks as seen.
    const markAllSeen = useCallback(() => {
        setSeenMap(prev => {
            const updated = { ...prev };
            let changed = false;
            for (const task of history) {
                if (task.completedAt && updated[task.id] !== task.completedAt) {
                    updated[task.id] = task.completedAt;
                    changed = true;
                }
            }
            return changed ? updated : prev;
        });
    }, [history]);

    // Mark a specific subset of tasks as seen (e.g. the currently filtered list).
    const markTasksSeen = useCallback((tasks: any[]) => {
        setSeenMap(prev => {
            const updated = { ...prev };
            let changed = false;
            for (const task of tasks) {
                if (task.completedAt && updated[task.id] !== task.completedAt) {
                    updated[task.id] = task.completedAt;
                    changed = true;
                }
            }
            return changed ? updated : prev;
        });
    }, []);

    // Mark a specific task as unseen/unread.
    const markUnseen = useCallback((taskId: string) => {
        setSeenMap(prev => {
            if (!(taskId in prev)) return prev;
            const updated = { ...prev };
            delete updated[taskId];
            return updated;
        });
    }, []);

    // Periodically clean up entries for tasks no longer in history (limit map growth).
    const lastCleanupRef = useRef(0);
    useEffect(() => {
        if (history.length === 0) return; // don't wipe seenMap before history loads
        const now = Date.now();
        if (now - lastCleanupRef.current < 60_000) return; // at most once per minute
        lastCleanupRef.current = now;
        const historyIds = new Set(history.map(t => t.id));
        setSeenMap(prev => {
            const keys = Object.keys(prev);
            const stale = keys.filter(id => !historyIds.has(id));
            if (stale.length === 0) return prev;
            const cleaned = { ...prev };
            for (const id of stale) delete cleaned[id];
            return cleaned;
        });
    }, [history]);

    return { unseenTaskIds, unseenCount: unseenTaskIds.size, markSeen, markAllSeen, markTasksSeen, markUnseen };
}

/**
 * Pure helper: compute the unseen count for a workspace from localStorage + history.
 * Safe to call outside of React (no hooks).
 */
export function computeUnseenCount(workspaceId: string, history: any[]): number {
    const storageKey = STORAGE_PREFIX + workspaceId;
    const seenMap = loadSeenMap(storageKey) ?? {};
    let count = 0;
    for (const task of history) {
        if (!task.completedAt) continue;
        const seen = seenMap[task.id];
        if (!seen || seen !== task.completedAt) count++;
    }
    return count;
}
