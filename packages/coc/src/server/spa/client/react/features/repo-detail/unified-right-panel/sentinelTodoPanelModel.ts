/**
 * sentinelTodoPanelModel — the pure rules behind a Sentinel chat's To-do tab.
 *
 * The ledger lives on the server that owns the Sentinel chat; this module
 * decides only how a fetched ledger is presented (sections and order), how a
 * job's execution state reads next to an item's fulfillment status, which tab
 * descriptor a chat's To-do opens as, and when the first tracking use may open
 * that tab on its own.
 */

import type {
    SentinelTodoItem,
    SentinelTodoJobLink,
    SentinelTodoStatus,
} from '@plusplusoneplusplus/coc-client';
import {
    activeTabId,
    unifiedTabId,
    type OpenUnifiedTabInput,
    type UnifiedPanelState,
    type UnifiedPanelTab,
} from './unifiedPanelTabsModel';

/** The Sentinel chat a To-do tab reads: its parent workspace and process. */
export interface SentinelTodoOwner {
    /** The chat's parent workspace on its owning server (a repo or repo group). */
    ownerWorkspaceId: string;
    /** Concrete clone route for that owner; `null` pins page origin. */
    ownerRoutingRef?: string | null;
    /** The ledger key: the Sentinel chat's process id. */
    processId: string;
}

export const SENTINEL_TODO_STATUS_LABELS: Readonly<Record<SentinelTodoStatus, string>> = {
    todo: 'To do',
    in_progress: 'In progress',
    needs_attention: 'Needs attention',
    done: 'Done',
};

/** Statuses a user can pick, in the order the select lists them. */
export const SENTINEL_TODO_STATUSES: readonly SentinelTodoStatus[] = ['todo', 'in_progress', 'needs_attention', 'done'];

/** Active items needing a person first, then work in flight, then queued work. */
const ACTIVE_ORDER: Readonly<Record<SentinelTodoStatus, number>> = {
    needs_attention: 0,
    in_progress: 1,
    todo: 2,
    done: 3,
};

export interface SentinelTodoSections {
    active: SentinelTodoItem[];
    done: SentinelTodoItem[];
    archived: SentinelTodoItem[];
}

/**
 * Active items first (needs attention, in progress, to do; oldest first within
 * a status so the list does not reshuffle on every edit), then Done and
 * Archived newest first. Archive is separate from status, so an archived item
 * is listed only under Archived whatever its status.
 */
export function sentinelTodoSections(items: readonly SentinelTodoItem[]): SentinelTodoSections {
    const byCreated = (a: SentinelTodoItem, b: SentinelTodoItem) => a.createdAt.localeCompare(b.createdAt);
    const newestFirst = (a: SentinelTodoItem, b: SentinelTodoItem) => b.updatedAt.localeCompare(a.updatedAt);
    const live = items.filter(item => !item.archived);
    return {
        active: live.filter(item => item.status !== 'done')
            .sort((a, b) => ACTIVE_ORDER[a.status] - ACTIVE_ORDER[b.status] || byCreated(a, b)),
        done: live.filter(item => item.status === 'done').sort(newestFirst),
        archived: items.filter(item => item.archived).sort(newestFirst),
    };
}

/** Done and Needs attention require a short reason, matching Sentinel's rule. */
export function sentinelTodoStatusNeedsReason(status: SentinelTodoStatus): boolean {
    return status === 'done' || status === 'needs_attention';
}

/**
 * A linked job's execution, worded apart from the item's fulfillment status:
 * a completed job is "Job completed", never "Done". Remote jobs never report
 * back, so they read "Status unavailable" until someone records an outcome.
 */
export function sentinelTodoJobStateLabel(job: SentinelTodoJobLink): string {
    const execution = job.execution;
    switch (execution.state) {
        case 'queued': return 'Queued';
        case 'running': return 'Running';
        case 'unavailable': return 'Status unavailable';
        case 'unknown': return 'Status unknown';
        case 'completed': return 'Job completed';
        case 'failed': return 'Job failed';
        case 'cancelled': return 'Job cancelled';
        case 'capped': return 'Job capped';
    }
}

/** Review delivery for a finished job — not a verdict on the item. */
export function sentinelTodoReviewLabel(job: SentinelTodoJobLink): string | null {
    const execution = job.execution;
    if (!('review' in execution) || !execution.review) return null;
    switch (execution.review.state) {
        case 'pending':
        case 'queued': return 'Review pending';
        case 'delivered': return 'Review delivered';
        case 'failed': return `Review failed${execution.review.reason ? `: ${execution.review.reason}` : ''}`;
    }
}

/** The tab a Sentinel chat's ledger opens as: one per concrete owner and chat. */
export function sentinelTodoTabInput(owner: SentinelTodoOwner, chatId: string): OpenUnifiedTabInput {
    return {
        kind: 'todo',
        ownerWorkspaceId: owner.ownerWorkspaceId,
        ...(owner.ownerRoutingRef === undefined ? {} : { ownerRoutingRef: owner.ownerRoutingRef }),
        chatId,
        resourceId: owner.processId,
        label: 'To-do',
    };
}

/**
 * The panel state with every To-do tab hidden, for a flag-off session. The
 * descriptors stay in storage — the flag loads asynchronously, so deleting
 * them on a not-yet-enabled first render would lose tabs on every reload.
 * Returns the same reference when there is nothing to hide.
 */
export function withoutSentinelTodoTabs(state: UnifiedPanelState): UnifiedPanelState {
    let changed = false;
    const chatTabs: Record<string, readonly UnifiedPanelTab[]> = {};
    for (const [key, tabs] of Object.entries(state.chatTabs)) {
        const kept = tabs.filter(tab => tab.kind !== 'todo');
        if (kept.length !== tabs.length) changed = true;
        chatTabs[key] = kept;
    }
    return changed ? { ...state, chatTabs } : state;
}

export interface SentinelTodoChangeEvent {
    workspaceId: string;
    processId: string;
    ledgerRevision: number;
}

/** Whether a WebSocket message is a change to this owner's ledger. */
export function isSentinelTodoChangeFor(message: unknown, owner: SentinelTodoOwner): message is SentinelTodoChangeEvent {
    const event = message as Partial<SentinelTodoChangeEvent> & { type?: unknown } | null;
    return event?.type === 'sentinel-todos-changed'
        && event.workspaceId === owner.ownerWorkspaceId
        && event.processId === owner.processId
        && typeof event.ledgerRevision === 'number';
}

/**
 * The first tracking use opens the To-do tab only when it steals nothing: the
 * change is the ledger's first write (revision 1), the tab is not already
 * open, and the chat has no selected tab at all. A later update never
 * reopens a tab the user closed.
 */
export function shouldAutoOpenSentinelTodoTab(
    state: UnifiedPanelState,
    chatId: string,
    input: OpenUnifiedTabInput,
    event: SentinelTodoChangeEvent,
): boolean {
    if (event.ledgerRevision !== 1) return false;
    const id = unifiedTabId(input);
    if ((state.chatTabs[chatId] ?? []).some(tab => tab.id === id)) return false;
    return activeTabId(state, chatId) === null;
}

/** A save failure's message, with a conflict's current item when the server sent one. */
export function sentinelTodoSaveError(error: unknown): { message: string; conflict: boolean } {
    const record = error as { code?: unknown; status?: unknown; message?: unknown } | null;
    if (record?.code === 'conflict' || record?.status === 409) {
        return {
            message: 'This item changed since you opened it. The latest version is shown; your unsaved text is kept.',
            conflict: true,
        };
    }
    if (record?.status === 404) {
        return { message: 'The to-do ledger is unavailable for this chat.', conflict: false };
    }
    const detail = typeof record?.message === 'string' && record.message ? record.message : 'Unknown error';
    return { message: `Could not save: ${detail}`, conflict: false };
}
