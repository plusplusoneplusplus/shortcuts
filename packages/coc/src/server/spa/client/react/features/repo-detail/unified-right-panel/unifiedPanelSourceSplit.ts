/**
 * The unified panel's two-pane source split: pure rules plus a session-only
 * store.
 *
 * A split shows two `file` tabs side by side. It holds tab ids only, never
 * descriptors or buffers, so ownership, persistence and the edit buffer stay
 * with the tab model and the reused `PreviewPane`. The focused pane always
 * shows the panel's active tab; activating another file tab replaces the
 * focused pane's file, and a non-file tab takes the whole panel without
 * forgetting the split.
 *
 * The store is in memory and keyed by the owner-qualified panel storage scope
 * plus the selected chat, so workspace and chat switches restore only their
 * own split and a reload starts without one.
 */

import { useSyncExternalStore } from 'react';
import { unifiedPanelStorageKey, type UnifiedPanelTab } from './unifiedPanelTabsModel';

export type SourceSplitPane = 'left' | 'right';

export interface SourceSplitState {
    left: string;
    right: string;
    focus: SourceSplitPane;
    /** Left pane share of the pane area, 0..1. */
    ratio: number;
}

/** Minimum content width for each pane, in CSS pixels. */
export const SOURCE_SPLIT_MIN_PANE_WIDTH = 280;
/** Divider width between the panes, in CSS pixels. */
export const SOURCE_SPLIT_DIVIDER_WIDTH = 4;
/** Keyboard resize step for the divider. */
export const SOURCE_SPLIT_RATIO_STEP = 0.05;

export function sourceSplitScopeKey(workspaceId: string, chatId: string | null): string {
    return JSON.stringify([unifiedPanelStorageKey(workspaceId), chatId]);
}

/** Only source files can enter a pane. */
export function canSplitTab(tab: UnifiedPanelTab | null | undefined): tab is UnifiedPanelTab {
    return tab?.kind === 'file';
}

/** Both panes fit at their minimum width beside the divider. */
export function isSourceSplitWide(availableWidth: number): boolean {
    return availableWidth >= SOURCE_SPLIT_MIN_PANE_WIDTH * 2 + SOURCE_SPLIT_DIVIDER_WIDTH;
}

export function clampSourceSplitRatio(ratio: number, availableWidth: number): number {
    const paneArea = availableWidth - SOURCE_SPLIT_DIVIDER_WIDTH;
    if (!Number.isFinite(ratio) || paneArea <= 0) return 0.5;
    const min = Math.min(0.5, SOURCE_SPLIT_MIN_PANE_WIDTH / paneArea);
    return Math.min(1 - min, Math.max(min, ratio));
}

/**
 * The split after a file tab lands on the right edge (drag or "Open to the
 * Right"). An existing split keeps its left pane and replaces the right pane;
 * otherwise the active file stays on the left, or — with no other active file —
 * the dropped file shows in both panes over its one shared buffer.
 */
export function sourceSplitForDrop(
    split: SourceSplitState | null,
    active: UnifiedPanelTab | null,
    dropped: UnifiedPanelTab,
): SourceSplitState | null {
    if (!canSplitTab(dropped)) return split;
    if (split !== null) return { ...split, right: dropped.id, focus: 'right' };
    const left = canSplitTab(active) && active.id !== dropped.id ? active.id : dropped.id;
    return { left, right: dropped.id, focus: 'right', ratio: 0.5 };
}

/**
 * Keeps a split consistent with the visible tabs: an active file tab belongs to
 * the focused pane, and a pane whose file is no longer visible ends the split.
 * Returns the same reference when nothing changed.
 */
export function reconcileSourceSplit(
    split: SourceSplitState | null,
    tabs: readonly UnifiedPanelTab[],
    active: UnifiedPanelTab | null,
): SourceSplitState | null {
    if (split === null) return null;
    let next = split;
    if (canSplitTab(active) && next[next.focus] !== active.id) next = { ...next, [next.focus]: active.id };
    const fileIds = new Set(tabs.filter(canSplitTab).map(tab => tab.id));
    if (!fileIds.has(next.left) || !fileIds.has(next.right)) return null;
    return next;
}

export function otherSourceSplitPane(pane: SourceSplitPane): SourceSplitPane {
    return pane === 'left' ? 'right' : 'left';
}

// ---------------------------------------------------------------------------
// Session-only store
// ---------------------------------------------------------------------------

const splits = new Map<string, SourceSplitState>();
const listeners = new Map<string, Set<() => void>>();

export function readSourceSplit(key: string): SourceSplitState | null {
    return splits.get(key) ?? null;
}

export function writeSourceSplit(key: string, split: SourceSplitState | null): void {
    if (readSourceSplit(key) === split) return;
    if (split === null) splits.delete(key);
    else splits.set(key, split);
    listeners.get(key)?.forEach(listener => listener());
}

/** Test seam: drop every in-memory split, as a reload does. */
export function clearSourceSplits(): void {
    const keys = [...splits.keys()];
    splits.clear();
    for (const key of keys) listeners.get(key)?.forEach(listener => listener());
}

function subscribe(key: string, listener: () => void): () => void {
    let set = listeners.get(key);
    if (!set) {
        set = new Set();
        listeners.set(key, set);
    }
    set.add(listener);
    return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(key);
    };
}

export function useSourceSplit(key: string): SourceSplitState | null {
    return useSyncExternalStore(
        listener => subscribe(key, listener),
        () => readSourceSplit(key),
        () => readSourceSplit(key),
    );
}
