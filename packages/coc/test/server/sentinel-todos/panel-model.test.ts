/**
 * Pure rules of the Sentinel To-do tab: ledger sections and order, job vs.
 * fulfillment wording, tab identity per owner and chat, persistence of the
 * descriptor only, flag-off hiding, the open-menu entry, and when the first
 * tracking use may open the tab without stealing focus.
 */
import { describe, expect, it } from 'vitest';
import type { SentinelTodoItem, SentinelTodoJobLink } from '@plusplusoneplusplus/coc-client';
import {
    isSentinelTodoChangeFor,
    SENTINEL_TODO_PRIORITIES,
    SENTINEL_TODO_PRIORITY_LABELS,
    sentinelTodoJobStateLabel,
    sentinelTodoPriority,
    sentinelTodoReviewLabel,
    sentinelTodoSaveError,
    sentinelTodoSections,
    sentinelTodoStatusReason,
    sentinelTodoTabInput,
    shouldAutoOpenSentinelTodoTab,
    withoutSentinelTodoTabs,
} from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoPanelModel';
import {
    EMPTY_UNIFIED_PANEL,
    activateTab,
    closeTab,
    displayGroupForKind,
    openTab,
    parseUnifiedPanelState,
    scopeForKind,
    serializeUnifiedPanelState,
    visibleTabs,
} from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { openMenuActions } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpenMenuModel';

let seq = 0;
function item(overrides: Partial<SentinelTodoItem> = {}): SentinelTodoItem {
    seq += 1;
    const stamp = `2026-10-09T00:00:${String(seq).padStart(2, '0')}.000Z`;
    return {
        id: `item-${seq}`, title: `Item ${seq}`, completionCondition: '', notes: '', status: 'todo', archived: false,
        revision: 1, createdAt: stamp, updatedAt: stamp, createdBy: 'user', updatedBy: 'user', jobs: [],
        priority: 'regular', ...overrides,
    };
}

function job(execution: SentinelTodoJobLink['execution'], overrides: Partial<SentinelTodoJobLink> = {}): SentinelTodoJobLink {
    return {
        processId: 'queue_child', workspaceId: 'ws-b', kind: 'local', openLink: '#repos/ws-b/chats/child',
        linkedAt: '2026-10-09T00:00:00.000Z', execution, ...overrides,
    };
}

const OWNER = { ownerWorkspaceId: 'ws-1', processId: 'queue_sentinel' };

describe('sentinelTodoSections', () => {
    it('orders active items by attention, then in progress, then to do, and splits Done and Archived', () => {
        const todo = item({ status: 'todo' });
        const attention = item({ status: 'needs_attention' });
        const progress = item({ status: 'in_progress' });
        const olderDone = item({ status: 'done', updatedAt: '2026-10-09T01:00:00.000Z' });
        const newerDone = item({ status: 'done', updatedAt: '2026-10-09T02:00:00.000Z' });
        const archivedDone = item({ status: 'done', archived: true });
        const archivedTodo = item({ status: 'todo', archived: true });

        const sections = sentinelTodoSections([todo, olderDone, attention, archivedDone, progress, newerDone, archivedTodo]);

        expect(sections.active.map(i => i.id)).toEqual([attention.id, progress.id, todo.id]);
        expect(sections.done.map(i => i.id)).toEqual([newerDone.id, olderDone.id]);
        expect(sections.archived.map(i => i.id).sort()).toEqual([archivedDone.id, archivedTodo.id].sort());
    });

    it('keeps creation order within one status so edits do not reshuffle the list', () => {
        const first = item({ updatedAt: '2026-10-09T09:00:00.000Z' });
        const second = item();
        expect(sentinelTodoSections([second, first]).active.map(i => i.id)).toEqual([first.id, second.id]);
    });
});

describe('priority', () => {
    it('lists Regular then High and reads a missing or unknown priority as Regular', () => {
        expect(SENTINEL_TODO_PRIORITIES.map(p => SENTINEL_TODO_PRIORITY_LABELS[p])).toEqual(['Regular', 'High']);
        expect(sentinelTodoPriority(item({ priority: 'high' }))).toBe('high');
        expect(sentinelTodoPriority(item())).toBe('regular');
        // An older owning server omits the field.
        expect(sentinelTodoPriority({ ...item(), priority: undefined } as never)).toBe('regular');
        expect(sentinelTodoPriority({ ...item(), priority: 'urgent' } as never)).toBe('regular');
    });

    it('does not reorder sections by priority', () => {
        const regular = item();
        const high = item({ priority: 'high' });
        expect(sentinelTodoSections([regular, high]).active.map(i => i.id)).toEqual([regular.id, high.id]);
    });
});

describe('job and review labels', () => {
    it('words job execution apart from fulfillment and marks remote jobs unavailable', () => {
        expect(sentinelTodoJobStateLabel(job({ state: 'completed' }))).toBe('Job completed');
        expect(sentinelTodoJobStateLabel(job({ state: 'failed', reason: 'boom' }))).toBe('Job failed');
        expect(sentinelTodoJobStateLabel(job({ state: 'running' }))).toBe('Running');
        expect(sentinelTodoJobStateLabel(job({ state: 'unavailable' }, { kind: 'remote', serverId: 'srv-2' }))).toBe('Status unavailable');
    });

    it('reports review delivery, including a visible failure, but never a verdict', () => {
        expect(sentinelTodoReviewLabel(job({ state: 'running' }))).toBeNull();
        expect(sentinelTodoReviewLabel(job({ state: 'completed', review: { state: 'queued' } }))).toBe('Review pending');
        expect(sentinelTodoReviewLabel(job({ state: 'completed', review: { state: 'delivered' } }))).toBe('Review delivered');
        expect(sentinelTodoReviewLabel(job({ state: 'failed', review: { state: 'failed', reason: 'chat gone' } })))
            .toBe('Review failed: chat gone');
    });
});

describe('To-do tab descriptor', () => {
    it('is chat-scoped, grouped with tools, and keyed by owner + chat with the ledger process as resource', () => {
        const input = sentinelTodoTabInput(OWNER, 'chat-1');
        expect(input).toMatchObject({ kind: 'todo', ownerWorkspaceId: 'ws-1', chatId: 'chat-1', resourceId: 'queue_sentinel', label: 'To-do' });
        expect(scopeForKind('todo')).toBe('chat');
        expect(displayGroupForKind('todo')).toBe('tools');

        let state = openTab(EMPTY_UNIFIED_PANEL, input);
        state = openTab(state, input);
        expect(visibleTabs(state, 'chat-1')).toHaveLength(1);
        expect(visibleTabs(state, 'chat-2')).toHaveLength(0);
    });

    it('keeps same-id owners on different hosts apart through the concrete route', () => {
        const local = sentinelTodoTabInput({ ...OWNER, ownerRoutingRef: null }, 'chat-1');
        const remote = sentinelTodoTabInput({ ...OWNER, ownerRoutingRef: 'remote:srv-2:ws-1' }, 'chat-1');
        const state = openTab(openTab(EMPTY_UNIFIED_PANEL, local), remote);
        expect(visibleTabs(state, 'chat-1').map(tab => tab.ownerRoutingRef)).toEqual([null, 'remote:srv-2:ws-1']);
    });

    it('persists only the descriptor and restores it after a reload', () => {
        const state = openTab(EMPTY_UNIFIED_PANEL, sentinelTodoTabInput(OWNER, 'chat-1'));
        const raw = serializeUnifiedPanelState(state);
        expect(raw).not.toContain('completionCondition');
        const restored = parseUnifiedPanelState(raw);
        expect(visibleTabs(restored, 'chat-1')).toEqual([expect.objectContaining({ kind: 'todo', resourceId: 'queue_sentinel' })]);
    });

    it('flag-off hides To-do tabs without dropping them from the stored state', () => {
        const input = sentinelTodoTabInput(OWNER, 'chat-1');
        const state = openTab(openTab(EMPTY_UNIFIED_PANEL, { kind: 'canvas', ownerWorkspaceId: 'ws-1', chatId: 'chat-1', resourceId: 'c1', label: 'C' }), input);
        const hidden = withoutSentinelTodoTabs(state);
        expect(visibleTabs(hidden, 'chat-1').map(tab => tab.kind)).toEqual(['canvas']);
        expect(visibleTabs(state, 'chat-1').map(tab => tab.kind)).toEqual(['canvas', 'todo']);
        expect(withoutSentinelTodoTabs(hidden)).toBe(hidden);
    });
});

describe('open menu entry', () => {
    it('lists To-do only for an enabled Sentinel chat', () => {
        const ids = (todoAvailable?: boolean, chatId: string | null = 'chat-1') =>
            openMenuActions({ targetWorkspaceId: 'ws-1', chatId, todoAvailable }).map(action => action.id);
        expect(ids(true)).toContain('todo');
        expect(ids(false)).not.toContain('todo');
        expect(ids(undefined)).not.toContain('todo');
        expect(ids(true, null)).not.toContain('todo');
    });
});

describe('shouldAutoOpenSentinelTodoTab', () => {
    const input = sentinelTodoTabInput(OWNER, 'chat-1');
    const first = { workspaceId: 'ws-1', processId: 'queue_sentinel', ledgerRevision: 1 };

    it('opens on the first ledger write when the chat shows no tab', () => {
        expect(shouldAutoOpenSentinelTodoTab(EMPTY_UNIFIED_PANEL, 'chat-1', input, first)).toBe(true);
    });

    it('never steals focus from another selected tab, including a workspace tab', () => {
        const withCanvas = openTab(EMPTY_UNIFIED_PANEL, { kind: 'canvas', ownerWorkspaceId: 'ws-1', chatId: 'chat-1', resourceId: 'c1', label: 'C' });
        expect(shouldAutoOpenSentinelTodoTab(withCanvas, 'chat-1', input, first)).toBe(false);
        const withTerminal = openTab(EMPTY_UNIFIED_PANEL, { kind: 'terminal', ownerWorkspaceId: 'ws-1', chatId: null, resourceId: 't', label: 'Terminal' });
        expect(shouldAutoOpenSentinelTodoTab(withTerminal, 'chat-1', input, first)).toBe(false);
    });

    it('does not reopen a closed tab on later updates', () => {
        const opened = openTab(EMPTY_UNIFIED_PANEL, input);
        const closed = closeTab(opened, visibleTabs(opened, 'chat-1')[0].id);
        expect(shouldAutoOpenSentinelTodoTab(closed, 'chat-1', input, { ...first, ledgerRevision: 2 })).toBe(false);
        expect(shouldAutoOpenSentinelTodoTab(activateTab(opened, 'chat-1', visibleTabs(opened, 'chat-1')[0].id), 'chat-1', input, first)).toBe(false);
    });
});

describe('isSentinelTodoChangeFor', () => {
    it('matches only this owner and chat', () => {
        const base = { type: 'sentinel-todos-changed', workspaceId: 'ws-1', processId: 'queue_sentinel', ledgerRevision: 3, itemId: 'i' };
        expect(isSentinelTodoChangeFor(base, OWNER)).toBe(true);
        expect(isSentinelTodoChangeFor({ ...base, workspaceId: 'ws-2' }, OWNER)).toBe(false);
        expect(isSentinelTodoChangeFor({ ...base, processId: 'queue_other' }, OWNER)).toBe(false);
        expect(isSentinelTodoChangeFor({ ...base, type: 'git-changed' }, OWNER)).toBe(false);
        expect(isSentinelTodoChangeFor(null, OWNER)).toBe(false);
    });
});

describe('sentinelTodoStatusReason', () => {
    it('makes a person\'s Done reason optional and keeps Needs attention required', () => {
        expect(sentinelTodoStatusReason('done')).toBe('optional');
        expect(sentinelTodoStatusReason('needs_attention')).toBe('required');
        expect(sentinelTodoStatusReason('todo')).toBeNull();
        expect(sentinelTodoStatusReason('in_progress')).toBeNull();
    });
});

describe('sentinelTodoSaveError', () => {
    it('distinguishes conflicts, a missing ledger, and other failures', () => {
        expect(sentinelTodoSaveError({ code: 'conflict', status: 409 })).toMatchObject({ conflict: true });
        expect(sentinelTodoSaveError({ status: 404 }).message).toMatch(/unavailable/);
        expect(sentinelTodoSaveError(new Error('disk full'))).toEqual({ message: 'Could not save: disk full', conflict: false });
    });
});
