/**
 * prMergeStatusSummary — pure reducers for the two status indicators shown on the
 * chat PR status card's collapsed top-level header (visible without expanding the
 * card):
 *
 *   1. {@link summarizeLifecycleStatus} — the PR lifecycle state (open / draft /
 *      merged / closed), ALWAYS shown so the user can tell at a glance whether the
 *      PR is, say, already merged.
 *   2. {@link summarizeMergeStatus} — the active auto-merge / auto-complete state
 *      (armed / queued / blocked), shown additionally only when auto-merge is on.
 *
 * Both are single-PR (mirror that one PR) or multi-PR (per-state counts). They are
 * pure (no React / I/O) and reuse the existing status logic — {@link prStatusBadge}
 * for lifecycle, {@link describeAutoMerge} (provider-aware "Auto-merge" vs
 * "Auto-complete") + the auto-merge tone/emoji maps for auto-merge — so no new
 * status logic is introduced.
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

/* -------------------------------------------------------------------------- */
/* Lifecycle status (always shown)                                            */
/* -------------------------------------------------------------------------- */

/** One lifecycle-state count chip for the multi-PR header summary. */
export interface LifecycleStatusSegment {
    /** Raw PR status (e.g. 'open', 'draft', 'merged', 'closed'). */
    status: string;
    emoji: string;
    /** Badge tone class from {@link prStatusBadge}. */
    toneClass: string;
    /** Lowercased word shown after the count (e.g. "open", "merged"). */
    label: string;
    count: number;
}

/** Single-PR lifecycle header shape — mirror that one PR's status badge. */
export interface SingleLifecycleStatus {
    kind: 'single';
    status: string;
    emoji: string;
    toneClass: string;
    /** Badge label (e.g. "Open", "Merged"). */
    label: string;
}

/** Multi-PR lifecycle header shape — per-status counts. */
export interface MultiLifecycleStatus {
    kind: 'multi';
    segments: LifecycleStatusSegment[];
}

export type LifecycleStatusSummary = SingleLifecycleStatus | MultiLifecycleStatus;

/** Natural lifecycle order; unknown statuses sort after these (then alphabetical). */
const LIFECYCLE_ORDER: readonly string[] = ['open', 'draft', 'merged', 'closed'];

function lifecycleRank(status: string): number {
    const idx = LIFECYCLE_ORDER.indexOf(status);
    return idx === -1 ? LIFECYCLE_ORDER.length : idx;
}

/** Statuses of the rows that have loaded (only `ready` rows contribute). */
function readyStatuses(items: readonly PrStatusCardItem[]): string[] {
    const out: string[] = [];
    for (const item of items) {
        if (item.state === 'ready' && item.pr) out.push(item.pr.status);
    }
    return out;
}

/**
 * Reduces the card items to the header lifecycle-status summary, or `null` when no
 * row is `ready` yet. Exactly one ready row → single (one status badge); two or
 * more → multi (per-status counts in lifecycle order).
 */
export function summarizeLifecycleStatus(items: readonly PrStatusCardItem[]): LifecycleStatusSummary | null {
    const statuses = readyStatuses(items);
    if (statuses.length === 0) return null;
    if (statuses.length === 1) {
        const badge = prStatusBadge(statuses[0]);
        return { kind: 'single', status: statuses[0], emoji: badge.emoji, toneClass: badge.className, label: badge.label };
    }
    const counts = new Map<string, number>();
    for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
    const segments = [...counts.keys()]
        .sort((a, b) => lifecycleRank(a) - lifecycleRank(b) || a.localeCompare(b))
        .map(status => {
            const badge = prStatusBadge(status);
            return {
                status,
                emoji: badge.emoji,
                toneClass: badge.className,
                label: badge.label.toLowerCase(),
                count: counts.get(status)!,
            };
        });
    return { kind: 'multi', segments };
}

/* -------------------------------------------------------------------------- */
/* Auto-merge status (shown when active)                                      */
/* -------------------------------------------------------------------------- */

/** An active auto-merge state worth reporting. */
export type MergeStatusKind = 'blocked' | 'queued' | 'armed';

/** Most-attention-worthy first. */
const MERGE_STATUS_ORDER: readonly MergeStatusKind[] = ['blocked', 'queued', 'armed'];

/** One auto-merge-state count chip for the multi-PR header summary. */
export interface MergeStatusSegment {
    state: MergeStatusKind;
    emoji: string;
    toneClass: string;
    /** Word shown after the count (e.g. "blocked", "armed"). */
    label: string;
    count: number;
}

/** Single-PR auto-merge header shape — mirror that one PR's auto-merge (label + reason). */
export interface SingleMergeStatus {
    kind: 'single';
    autoMerge: AutoMergeIndicatorModel;
}

/** Multi-PR auto-merge header shape — per-state counts ordered by attention. */
export interface MultiMergeStatus {
    kind: 'multi';
    segments: MergeStatusSegment[];
}

export type MergeStatusSummary = SingleMergeStatus | MultiMergeStatus;

/** Active auto-merge indicators for the rows that have loaded. */
function readyAutoMerges(items: readonly PrStatusCardItem[]): AutoMergeIndicatorModel[] {
    const out: AutoMergeIndicatorModel[] = [];
    for (const item of items) {
        if (item.state !== 'ready' || !item.pr) continue;
        const model = describeAutoMerge(item.pr.autoMerge, prProviderFromUrl(item.pr.url));
        if (model) out.push(model);
    }
    return out;
}

/**
 * Reduces the card items to the header auto-merge summary, or `null` when no ready
 * row has active auto-merge. Exactly one auto-merge row → single (detail line);
 * two or more → multi (per-state counts ordered blocked → queued → armed).
 */
export function summarizeMergeStatus(items: readonly PrStatusCardItem[]): MergeStatusSummary | null {
    const models = readyAutoMerges(items);
    if (models.length === 0) return null;
    if (models.length === 1) return { kind: 'single', autoMerge: models[0] };
    const counts = new Map<MergeStatusKind, number>();
    for (const model of models) counts.set(model.state, (counts.get(model.state) ?? 0) + 1);
    const segments = MERGE_STATUS_ORDER.filter(kind => counts.has(kind)).map(state => ({
        state,
        emoji: AUTO_MERGE_TONE_EMOJI[state],
        toneClass: AUTO_MERGE_TONE_CLASS[state],
        label: state,
        count: counts.get(state)!,
    }));
    return { kind: 'multi', segments };
}
