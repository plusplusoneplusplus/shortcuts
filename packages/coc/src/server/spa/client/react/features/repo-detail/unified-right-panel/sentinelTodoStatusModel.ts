/**
 * sentinelTodoStatusModel — how a Sentinel to-do item's status reads: the
 * display status (with derived In review), labels, tracking type, priority and
 * section order. Pure and dependency-free so the server's messaging replies
 * share it with the To-do tab.
 */

import type {
    SentinelTodoItem,
    SentinelTodoPriority,
    SentinelTodoStatus,
    SentinelTodoType,
} from '@plusplusoneplusplus/coc-client';
import { SENTINEL_TODO_RECENT_LIMIT } from '@plusplusoneplusplus/coc-client';

/** Saved fulfillment, not an intermediate job result, determines the recent-list budget. */
export function sentinelTodoRecentPage<T extends SentinelTodoItem>(items: readonly T[], limit = SENTINEL_TODO_RECENT_LIMIT, offset = 0) {
    const active = items.filter(item => !item.archived && item.status !== 'done');
    const done = items.filter(item => !item.archived && item.status === 'done');
    const archived = items.filter(item => item.archived);
    const newestFirst = (a: T, b: T) => b.updatedAt.localeCompare(a.updatedAt);
    // Reverse before the stable sort so equally recent records prefer newer insertion order.
    const ordered = [...active, ...done.reverse().sort(newestFirst), ...archived.reverse().sort(newestFirst)];
    const end = Math.min(ordered.length, offset + (offset === 0 ? Math.max(limit, active.length) : limit));
    return {
        items: ordered.slice(offset, end),
        total: ordered.length,
        hasMore: end < ordered.length,
        nextOffset: end < ordered.length ? end : null,
    };
}

export type SentinelTodoDisplayStatus = SentinelTodoStatus | 'in_review';

export const SENTINEL_TODO_STATUS_LABELS: Readonly<Record<SentinelTodoDisplayStatus, string>> = {
    todo: 'To do',
    in_progress: 'In progress',
    deferred: 'Deferred',
    in_review: 'In review',
    needs_attention: 'Needs attention',
    done: 'Done',
};

/**
 * An item's priority. An older owning server omits the field, which reads as
 * Regular like any item stored before priorities existed.
 */
export function sentinelTodoPriority(item: Pick<SentinelTodoItem, 'priority'>): SentinelTodoPriority {
    return item.priority === 'high' ? 'high' : 'regular';
}

/**
 * An item's tracking type. An older owning server omits the field, and every
 * item stored before manual tracking existed is normal.
 */
export function sentinelTodoType(item: Pick<SentinelTodoItem, 'type'>): SentinelTodoType {
    return item.type === 'manual' ? 'manual' : 'normal';
}

/** Active items needing a person first, then work in flight, then queued work. */
const ACTIVE_ORDER: Readonly<Record<SentinelTodoDisplayStatus, number>> = {
    needs_attention: 0,
    in_review: 1,
    in_progress: 2,
    todo: 3,
    deferred: 4,
    done: 5,
};

/** Presentation only: durable assessment evidence never changes fulfillment or authorizes execution. */
export function sentinelTodoDisplayStatus(item: SentinelTodoItem): SentinelTodoDisplayStatus {
    if (item.archived || item.status === 'done' || item.status === 'deferred' || sentinelTodoType(item) === 'manual') return item.status;
    const pending = item.jobs.filter(job => ((!job.serverId && job.kind !== 'remote') || job.remote) && 'review' in job.execution
        && job.execution.review?.assessment === 'pending');
    if (!pending.length) return item.status;
    // New/parallel work stays visible; its older pending assessments remain on their job rows.
    if (item.jobs.some(job => job.execution.state === 'running' || job.execution.state === 'queued')) return 'in_progress';
    const latest = item.jobs[item.jobs.length - 1];
    if (latest && (latest.execution.state === 'unknown' || latest.execution.state === 'unavailable')) return item.status;
    return pending.some(job => 'review' in job.execution && job.execution.review?.state === 'failed')
        ? 'needs_attention' : 'in_review';
}

export interface SentinelTodoSections {
    active: SentinelTodoItem[];
    done: SentinelTodoItem[];
    archived: SentinelTodoItem[];
}

/**
 * One tracking type's sections: active items first (needs attention, in
 * progress, to do; oldest first within a status so the list does not reshuffle
 * on every edit), then Done and Archived newest first. Archive is separate from
 * status, so an archived item is listed only under Archived whatever its
 * status. Normal and Manual tracking each get their own sections.
 */
export function sentinelTodoSections(items: readonly SentinelTodoItem[], type: SentinelTodoType): SentinelTodoSections {
    const byCreated = (a: SentinelTodoItem, b: SentinelTodoItem) => a.createdAt.localeCompare(b.createdAt);
    const newestFirst = (a: SentinelTodoItem, b: SentinelTodoItem) => b.updatedAt.localeCompare(a.updatedAt);
    const ofType = items.filter(item => sentinelTodoType(item) === type);
    const live = ofType.filter(item => !item.archived);
    return {
        active: live.filter(item => item.status !== 'done')
            .sort((a, b) => ACTIVE_ORDER[sentinelTodoDisplayStatus(a)] - ACTIVE_ORDER[sentinelTodoDisplayStatus(b)] || byCreated(a, b)),
        done: live.filter(item => item.status === 'done').sort(newestFirst),
        archived: ofType.filter(item => item.archived).sort(newestFirst),
    };
}
