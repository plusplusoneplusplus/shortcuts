/**
 * unifiedCanvasEvents — AC-06's routing and live-event relay.
 *
 * The cases here pin the two halves separately, because they answer different
 * questions: the descriptor decides WHICH tab an AI canvas update lands in (and
 * that it is the same tab the "+" menu and an inline embed would open), while
 * the registry decides what a mounted `CanvasPanel` is told about it.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import {
    canvasEventTabInput,
    clearUnifiedCanvasEvents,
    publishUnifiedCanvasEvent,
    routeUnifiedCanvasUpdate,
    useUnifiedCanvasEvent,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedCanvasEvents';
import { canvasEmbedTabInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedCanvasEmbeds';
import {
    clearUnifiedPanelState,
    readUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import {
    closeTab,
    visibleTabs,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { updateUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { workspaceDockOpenStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

const WS = 'ws-canvas-events';
const CHAT = 'chat-a';

/** A stand-in for the mounted canvas view, reporting what it was told. */
function Probe({ workspaceId, canvasId }: { workspaceId: string; canvasId: string }) {
    const live = useUnifiedCanvasEvent(workspaceId, canvasId);
    return <div data-testid="probe" data-revision={live ? String(live.revision) : 'none'} />;
}

function event(overrides: Partial<{ canvasId: string; title: string; revision: number; editor: 'ai' | 'user' }> = {}) {
    return {
        canvasId: 'canvas-1',
        title: 'Plan',
        revision: 1,
        editor: 'ai' as const,
        ...overrides,
    };
}

function args(overrides: Record<string, unknown> = {}) {
    return {
        event: event(),
        ownerWorkspaceId: WS,
        scopeWorkspaceId: WS,
        chatId: CHAT,
        ...overrides,
    } as Parameters<typeof routeUnifiedCanvasUpdate>[0];
}

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
    clearUnifiedCanvasEvents();
});

afterEach(() => {
    cleanup();
    clearUnifiedPanelState();
    clearUnifiedCanvasEvents();
});

describe('canvasEventTabInput', () => {
    it('files the canvas against the chat that received the event', () => {
        const input = canvasEventTabInput(args())!;
        expect(input).toMatchObject({
            kind: 'canvas',
            ownerWorkspaceId: WS,
            chatId: CHAT,
            resourceId: 'canvas-1',
            label: 'Plan',
        });
        // A canvas has a write path of its own; a live event is not a reason to
        // mark it as a read-only reference.
        expect(input.readOnly).toBeUndefined();
    });

    it('routes to the owning clone and labels it when it is not the panel scope', () => {
        const input = canvasEventTabInput(args({
            ownerWorkspaceId: 'member-b',
            scopeWorkspaceId: 'group-acme',
            workspaces: [{ id: 'member-b', name: 'Member B' }],
        }))!;
        // The event named a canvas served by a member clone; content requests
        // and later events both have to follow it, not the group.
        expect(input.ownerWorkspaceId).toBe('member-b');
        expect(input.repoLabel).toBe('Member B');
    });

    it('falls back to the shared untitled label for a blank title', () => {
        expect(canvasEventTabInput(args({ event: event({ title: '' }) }))!.label).toBe('Untitled canvas');
    });

    it('declines a blank canvas id, a blank owner, and an unowned event', () => {
        expect(canvasEventTabInput(args({ event: event({ canvasId: '  ' }) }))).toBeNull();
        expect(canvasEventTabInput(args({ ownerWorkspaceId: '  ' }))).toBeNull();
        // A canvas is chat-owned: with no chat there is nothing to scope it to.
        expect(canvasEventTabInput(args({ chatId: null }))).toBeNull();
    });

    it('reaches the same descriptor an inline embed opens', () => {
        // One canvas must be one tab however it was reached — an AI update on a
        // canvas the user already opened from its embed must focus that tab.
        expect(canvasEventTabInput(args())).toEqual(canvasEmbedTabInput({
            canvasId: 'canvas-1',
            title: 'Plan',
            ownerWorkspaceId: WS,
            scopeWorkspaceId: WS,
            chatId: CHAT,
        }));
    });
});

describe('the live event registry', () => {
    it('hands the newest event to the view mounted for that canvas', () => {
        render(<Probe workspaceId={WS} canvasId="canvas-1" />);
        expect(screen.getByTestId('probe').getAttribute('data-revision')).toBe('none');

        act(() => { publishUnifiedCanvasEvent(WS, event({ revision: 3 })); });
        expect(screen.getByTestId('probe').getAttribute('data-revision')).toBe('3');
    });

    it('drops an event that does not advance the revision', () => {
        expect(publishUnifiedCanvasEvent(WS, event({ revision: 4 }))).toBe(true);
        // `CanvasPanel` reloads from the event's identity, so re-delivering an
        // equivalent event would make it refetch for nothing.
        expect(publishUnifiedCanvasEvent(WS, event({ revision: 4 }))).toBe(false);
        expect(publishUnifiedCanvasEvent(WS, event({ revision: 3 }))).toBe(false);
        expect(publishUnifiedCanvasEvent(WS, event({ revision: 5 }))).toBe(true);
    });

    it('keeps canvases of the same id in different clones apart', () => {
        render(
            <>
                <div data-testid="a"><Probe workspaceId="ws-a" canvasId="canvas-1" /></div>
                <div data-testid="b"><Probe workspaceId="ws-b" canvasId="canvas-1" /></div>
            </>,
        );
        act(() => { publishUnifiedCanvasEvent('ws-a', event({ revision: 2 })); });

        const revisions = screen.getAllByTestId('probe').map(n => n.getAttribute('data-revision'));
        // A similarly identified canvas in another workspace is another
        // resource — it must not reload from this event.
        expect(revisions).toEqual(['2', 'none']);
    });
});

describe('routeUnifiedCanvasUpdate', () => {
    function isDockOpen(workspaceId: string): boolean {
        return localStorage.getItem(workspaceDockOpenStorageKey(workspaceId)) === '1';
    }

    it('opens the canvas tab, activates it, and reveals a collapsed panel', () => {
        localStorage.setItem(workspaceDockOpenStorageKey(WS), '0');
        const tabId = routeUnifiedCanvasUpdate(args());

        const state = readUnifiedPanelState(WS);
        expect(visibleTabs(state, CHAT).map(t => t.resourceId)).toEqual(['canvas-1']);
        expect(state.activeByScope[CHAT]).toBe(tabId);
        expect(isDockOpen(WS)).toBe(true);
    });

    it('recreates a tab the user closed and keeps one tab per canvas', () => {
        const tabId = routeUnifiedCanvasUpdate(args())!;
        act(() => { updateUnifiedPanelState(WS, prev => closeTab(prev, tabId)); });
        expect(visibleTabs(readUnifiedPanelState(WS), CHAT)).toEqual([]);

        // A later update is as much a reason to show the canvas as its creation.
        expect(routeUnifiedCanvasUpdate(args({ event: event({ revision: 2 }) }))).toBe(tabId);
        expect(visibleTabs(readUnifiedPanelState(WS), CHAT).map(t => t.id)).toEqual([tabId]);

        routeUnifiedCanvasUpdate(args({ event: event({ revision: 3 }) }));
        expect(visibleTabs(readUnifiedPanelState(WS), CHAT)).toHaveLength(1);
    });

    it('publishes the event so an already-mounted view reconciles as it is focused', () => {
        render(<Probe workspaceId={WS} canvasId="canvas-1" />);
        act(() => { routeUnifiedCanvasUpdate(args({ event: event({ revision: 7 }) })); });
        expect(screen.getByTestId('probe').getAttribute('data-revision')).toBe('7');
    });

    it('files nothing at all when the event names no chat to own it', () => {
        localStorage.setItem(workspaceDockOpenStorageKey(WS), '0');
        expect(routeUnifiedCanvasUpdate(args({ chatId: null }))).toBeNull();
        expect(visibleTabs(readUnifiedPanelState(WS), null)).toEqual([]);
        // A declined route must not pop an empty panel open either.
        expect(isDockOpen(WS)).toBe(false);
    });
});
