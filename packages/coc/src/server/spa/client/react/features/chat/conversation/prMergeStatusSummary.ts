/**
 * prMergeStatusSummary — pure reducer for the aggregate merge-status indicator
 * shown on the chat PR status card's collapsed top-level header.
 *
 * No React, no I/O — given the card items it reduces the ready rows to either a
 * single-PR detail shape (mirror that one PR's auto-merge / lifecycle) or a
 * multi-PR per-state count shape (ordered by attention), so the header indicator
 * can render the merge/auto-merge state without expanding the card.
 *
 * Reuses the existing status logic — {@link describeAutoMerge} (provider-aware
 * "Auto-merge" vs "Auto-complete"), {@link prProviderFromUrl}, the auto-merge
 * tone/emoji maps, and {@link prStatusBadge} for terminal lifecycle — so no new
 * merge-status logic is introduced.
 */
import { prStatusBadge } from '../../pull-requests/pr-utils';
import {
    describeAutoMerge,
    prProviderFromUrl,
    AUTO_MERGE_TONE_CLASS,
    AUTO_MERGE_TONE_EMOJI,
    type AutoMergeIndicatorModel,
    type PrStatusCardItem,
} from './PrStatusCard';

/** A single attention-worthy merge state. */
export type MergeStatusKind = 'blocked' | 'queued' | 'armed' | 'merged' | 'closed';

/** Most-attention-worthy first — active auto-merge before terminal lifecycle. */
const MERGE_STATUS_ORDER: readonly MergeStatusKind[] = ['blocked', 'queued', 'armed', 'merged', 'closed'];

/** One render-ready count chip for the multi-PR header summary. */
export interface MergeStatusSegment {
    state: MergeStatusKind;
    emoji: string;
    toneClass: string;
    /** Word shown after the count (e.g. "blocked", "armed", "merged"). */
    label: string;
    count: number;
}

/** Single-PR header shape — mirror that one PR's status (label + reason). */
export interface SingleMergeStatus {
    kind: 'single';
    /** Active auto-merge indicator, when armed/queued/blocked. */
    autoMerge?: AutoMergeIndicatorModel;
    /** Terminal lifecycle, shown when there is no active auto-merge. */
    lifecycle?: 'merged' | 'closed';
}

/** Multi-PR header shape — per-state counts ordered by attention. */
export interface MultiMergeStatus {
    kind: 'multi';
    segments: MergeStatusSegment[];
}

export type MergeStatusSummary = SingleMergeStatus | MultiMergeStatus;

const LIFECYCLE_TONE_CLASS: Record<'merged' | 'closed', string> = {
    merged: prStatusBadge('merged').className,
    closed: prStatusBadge('closed').className,
};

const LIFECYCLE_EMOJI: Record<'merged' | 'closed', string> = {
    merged: prStatusBadge('merged').emoji,
    closed: prStatusBadge('closed').emoji,
};

interface ItemMergeState {
    autoMerge?: AutoMergeIndicatorModel;
    lifecycle?: 'merged' | 'closed';
}

/**
 * The merge state worth reporting for one row, or null. Priority (per spec):
 * active auto-merge (blocked/queued/armed) wins over terminal lifecycle; a plain
 * open PR with no auto-merge reports nothing. Only `ready` rows contribute.
 */
function itemMergeState(item: PrStatusCardItem): ItemMergeState | null {
    if (item.state !== 'ready' || !item.pr) return null;
    const autoMerge = describeAutoMerge(item.pr.autoMerge, prProviderFromUrl(item.pr.url));
    if (autoMerge) return { autoMerge };
    if (item.pr.status === 'merged') return { lifecycle: 'merged' };
    if (item.pr.status === 'closed') return { lifecycle: 'closed' };
    return null;
}

function stateKind(state: ItemMergeState): MergeStatusKind {
    return state.autoMerge ? state.autoMerge.state : (state.lifecycle as 'merged' | 'closed');
}

function segmentFor(state: MergeStatusKind, count: number): MergeStatusSegment {
    if (state === 'merged' || state === 'closed') {
        return { state, emoji: LIFECYCLE_EMOJI[state], toneClass: LIFECYCLE_TONE_CLASS[state], label: state, count };
    }
    return { state, emoji: AUTO_MERGE_TONE_EMOJI[state], toneClass: AUTO_MERGE_TONE_CLASS[state], label: state, count };
}

/**
 * Reduces the card items to the header merge-status summary, or `null` when
 * nothing is worth showing (no ready row, or every ready row is a plain open PR
 * with no auto-merge). Exactly one reportable row → single (detail line); two or
 * more → multi (per-state counts ordered by attention).
 */
export function summarizeMergeStatus(items: readonly PrStatusCardItem[]): MergeStatusSummary | null {
    const states: ItemMergeState[] = [];
    for (const item of items) {
        const state = itemMergeState(item);
        if (state) states.push(state);
    }
    if (states.length === 0) return null;
    if (states.length === 1) {
        const only = states[0];
        return { kind: 'single', autoMerge: only.autoMerge, lifecycle: only.lifecycle };
    }
    const counts = new Map<MergeStatusKind, number>();
    for (const state of states) {
        const kind = stateKind(state);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const segments = MERGE_STATUS_ORDER.filter(kind => counts.has(kind)).map(kind =>
        segmentFor(kind, counts.get(kind)!),
    );
    return { kind: 'multi', segments };
}
