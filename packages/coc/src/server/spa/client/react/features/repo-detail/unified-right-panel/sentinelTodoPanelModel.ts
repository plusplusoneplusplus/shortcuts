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
    SentinelTodoJobLink,
    SentinelTodoPriority,
    SentinelTodoStatus,
    SentinelTodoItem,
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

/** One string per concrete ledger owner, so same-id workspaces on other hosts stay apart. */
export function sentinelTodoOwnerKey(owner: SentinelTodoOwner): string {
    return `${owner.ownerRoutingRef ?? ''}\n${owner.ownerWorkspaceId}\n${owner.processId}`;
}

/** Parent-ledger-only, prerequisite-first chain; visited IDs also bound malformed cycles. */
export function sentinelTodoDependencyChain(itemId: string, items: readonly SentinelTodoItem[]): string[] {
    const byId = new Map(items.map(item => [item.id, item]));
    const visited = new Set<string>();
    const chain: string[] = [];
    const visit = (id: string) => {
        if (visited.has(id)) return;
        visited.add(id);
        for (const edge of byId.get(id)?.dependsOn ?? []) visit(edge.itemId);
        chain.push(id);
    };
    visit(itemId);
    return chain;
}

export * from './sentinelTodoStatusModel';

/** Statuses a user can pick, in the order the select lists them. */
export const SENTINEL_TODO_STATUSES: readonly SentinelTodoStatus[] = ['todo', 'in_progress', 'needs_attention', 'done'];

export const SENTINEL_TODO_PRIORITY_LABELS: Readonly<Record<SentinelTodoPriority, string>> = {
    high: 'High',
    regular: 'Regular',
};

/** Priorities a user can pick, in the order the select lists them. */
export const SENTINEL_TODO_PRIORITIES: readonly SentinelTodoPriority[] = ['regular', 'high'];

/** Lines in a free-text field, ignoring trailing blank lines. */
export function sentinelTodoLineCount(text: string): number {
    return text.replace(/\s+$/, '').split(/\r?\n/).length;
}

/** Long notes start folded in an expanded row so Done when and actions stay in view. */
export function sentinelTodoFoldNotes(notes: string): boolean {
    return sentinelTodoLineCount(notes) > 2 || notes.length > 160;
}

/**
 * Whether choosing a status asks for a reason first. Needs attention requires
 * one; a person marking Done may give one or leave it blank (Sentinel's own
 * Done reviews still require a reason server-side).
 */
export function sentinelTodoStatusReason(status: SentinelTodoStatus): 'required' | 'optional' | null {
    if (status === 'needs_attention') return 'required';
    return status === 'done' ? 'optional' : null;
}

/**
 * A linked job's execution, worded apart from the item's fulfillment status:
 * a completed job is "Completed", never "Done". Remote jobs never report
 * back, so they read "Status unavailable" until someone records an outcome.
 */
export function sentinelTodoJobStateLabel(job: SentinelTodoJobLink): string {
    const execution = job.execution;
    switch (execution.state) {
        case 'queued': return 'Queued';
        case 'running': return 'Running';
        case 'unavailable': return 'Status unavailable';
        case 'unknown': return 'Status unknown';
        case 'completed': return 'Completed';
        case 'failed': return 'Job failed';
        case 'cancelled': return 'Job cancelled';
        case 'capped': return 'Job capped';
    }
}

/** Review delivery for a finished job — not a verdict on the item. */
export function sentinelTodoReviewLabel(job: SentinelTodoJobLink): string | null {
    const execution = job.execution;
    if (!('review' in execution) || !execution.review) return null;
    if (execution.review.assessment === 'reviewed') return 'Reviewed';
    if (execution.review.assessment === 'superseded') return 'User verdict retained';
    if (execution.review.assessment === 'not_required') {
        if (execution.review.state === 'failed') return `Notice failed${execution.review.reason ? `: ${execution.review.reason}` : ''}`;
        return execution.review.state === 'delivered' ? 'Notice delivered' : 'Notice pending';
    }
    switch (execution.review.state) {
        case 'pending':
        case 'queued': return 'Review pending';
        case 'delivered': return execution.review.assessment === 'pending' ? 'Review pending (result delivered)' : 'Review delivered';
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

export interface SentinelTodoChangeEvent {
    workspaceId: string;
    processId: string;
    ledgerRevision: number;
    tagOnly?: boolean;
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
    if (event.tagOnly || event.ledgerRevision !== 1) return false;
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
