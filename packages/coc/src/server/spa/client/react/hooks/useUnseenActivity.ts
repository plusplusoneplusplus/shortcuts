/**
 * useUnseenActivity — tracks which completed tasks the user has viewed.
 *
 * Tasks that complete while the user is viewing another task are "unseen"
 * and surfaced via bold styling + dot indicator in the activity list.
 *
 * Chat-specific logic: when exactly one active chat exists and the user is
 * viewing it, the badge is forced to 0.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { fetchSeenMap, patchSeenState, deleteSeenEntry } from './seenStateApi';

const STORAGE_PREFIX = 'coc-unseen-';

/**
 * Derive a comparable snapshot string from a queue item's current state.
 * Format: `status|completedAt` — any change to either field produces a new snapshot.
 */
export function getItemSnapshot(item: any): string {
    const status = item.status || 'unknown';
    const completedAt = item.completedAt || '';
    return `${status}|${completedAt}`;
}

/**
 * Migrate old seen-map values (bare `completedAt` strings) to the new
 * `status|completedAt` snapshot format.  Old values are ISO-ish timestamps
 * that never contain `|`, so the check is unambiguous.
 */
function migrateSeenMap(raw: Record<string, string>): Record<string, string> {
    let migrated = false;
    const result: Record<string, string> = {};
    for (const [id, val] of Object.entries(raw)) {
        if (val && !val.includes('|')) {
            result[id] = `completed|${val}`;
            migrated = true;
        } else {
            result[id] = val;
        }
    }
    return migrated ? result : raw;
}

/** Read the seen map from localStorage, returning null if the key doesn't exist. */
function loadSeenMap(storageKey: string): Record<string, string> | null {
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
            const parsed = JSON.parse(raw);
            return migrateSeenMap(parsed);
        }
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
    /** Set of process IDs that have unseen activity. */
    unseenProcessIds: Set<string>;
    /** Number of tasks with unseen activity. */
    unseenCount: number;
    /** Mark a task as seen (call when user selects a task). */
    markSeen: (taskId: string) => void;
    /** Mark all tasks as seen. */
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
    const storageKey = STORAGE_PREFIX + workspaceId;

    // Whether this workspace had prior seen-state in localStorage.
    const hadPriorStateRef = useRef<boolean>(loadSeenMap(storageKey) !== null);

    const [seenMap, setSeenMap] = useState<Record<string, string>>(() => {
        return loadSeenMap(storageKey) ?? {};
    });

    // Stable merged list of all items (queued + running + history).
    const allItems = useMemo(
        () => mergeAllItems(queued, running, history),
        [queued, running, history],
    );

    // Persist to localStorage whenever seenMap changes.
    useEffect(() => {
        persistSeenMap(storageKey, seenMap);
    }, [seenMap, storageKey]);

    // On first visit (no prior localStorage), seed all existing items as seen
    // so we don't flash everything as "unseen" on initial load.
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
        if (hadPriorStateRef.current || seededRef.current || allItems.length === 0) return;
        seededRef.current = true;
        setSeenMap(prev => {
            const updated = { ...prev };
            let changed = false;
            for (const task of allItems) {
                const snapshot = getItemSnapshot(task);
                if (!updated[task.id]) {
                    updated[task.id] = snapshot;
                    changed = true;
                }
            }
            return changed ? updated : prev;
        });
    }, [allItems]);

    // Auto-mark currently selected task as seen whenever its state changes.
    useEffect(() => {
        if (!selectedTaskId) return;
        const task = allItems.find(t => t.id === selectedTaskId);
        if (!task) return;
        const snapshot = getItemSnapshot(task);
        setSeenMap(prev => {
            if (prev[selectedTaskId] === snapshot) return prev;
            return { ...prev, [selectedTaskId]: snapshot };
        });
    }, [selectedTaskId, allItems]);

    // Compute the unseen set.
    const unseenProcessIds = useMemo(() => {
        const unseen = new Set<string>();
        for (const task of allItems) {
            const snapshot = getItemSnapshot(task);
            const seen = seenMap[task.id];
            if (!seen || seen !== snapshot) {
                unseen.add(task.id);
            }
        }
        return unseen;
    }, [history, seenMap]);

    // Mark a specific task as seen.
    const markSeen = useCallback((taskId: string) => {
        const task = allItems.find(t => t.id === taskId);
        if (!task) return;
        const snapshot = getItemSnapshot(task);
        setSeenMap(prev => {
            if (prev[taskId] === snapshot) return prev;
            return { ...prev, [taskId]: snapshot };
        });
    }, [allItems]);

    // Mark all history tasks as seen.
    const markAllSeen = useCallback(() => {
        setSeenMap(prev => {
            const updated = { ...prev };
            const entries: Array<{ processId: string; seenAt: string }> = [];
            let changed = false;
            for (const task of allItems) {
                const snapshot = getItemSnapshot(task);
                if (updated[task.id] !== snapshot) {
                    updated[task.id] = snapshot;
                    changed = true;
                }
            }
            if (entries.length > 0) schedulePatch(entries);
            return changed ? updated : prev;
        });
    }, [allItems]);

    // Mark a specific subset of tasks as seen (e.g. the currently filtered list).
    const markTasksSeen = useCallback((tasks: any[]) => {
        setSeenMap(prev => {
            const updated = { ...prev };
            const entries: Array<{ processId: string; seenAt: string }> = [];
            let changed = false;
            for (const task of tasks) {
                const snapshot = getItemSnapshot(task);
                if (snapshot === 'unknown|' && !task.status) continue;
                if (updated[task.id] !== snapshot) {
                    updated[task.id] = snapshot;
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

    // Periodically clean up entries for tasks no longer in any list (limit map growth).
    const lastCleanupRef = useRef(0);
    useEffect(() => {
        if (allItems.length === 0) return; // don't wipe seenMap before items load
        const now = Date.now();
        if (now - lastCleanupRef.current < 60_000) return; // at most once per minute
        lastCleanupRef.current = now;
        const allIds = new Set(allItems.map(t => t.id));
        setSeenMap(prev => {
            const keys = Object.keys(prev);
            const stale = keys.filter(id => !allIds.has(id));
            if (stale.length === 0) return prev;
            const cleaned = { ...prev };
            for (const id of stale) delete cleaned[id];
            return cleaned;
        });
    }, [allItems]);

    return { unseenTaskIds, unseenCount, markSeen, markAllSeen, markTasksSeen, markUnseen };
}

/**
 * Pure helper: compute the unseen count for a workspace from localStorage + items.
 * Safe to call outside of React (no hooks).
 * Accepts all item arrays (queued, running, history) to detect any state change.
 */
export function computeUnseenCount(
    workspaceId: string,
    history: any[],
    queued: any[] = [],
    running: any[] = [],
): number {
    const storageKey = STORAGE_PREFIX + workspaceId;
    const seenMap = loadSeenMap(storageKey) ?? {};
    const allItems = mergeAllItems(queued, running, history);
    let count = 0;
    for (const task of allItems) {
        const snapshot = getItemSnapshot(task);
        const seen = seenMap[task.id];
        if (!seen || seen !== snapshot) count++;
    }
    return count;
}
