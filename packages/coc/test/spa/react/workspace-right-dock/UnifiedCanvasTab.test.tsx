/**
 * UnifiedCanvasTab — the chat-directed actions a canvas keeps now that its only
 * host is the shared right panel.
 *
 * `CanvasPanel` is stubbed: what matters here is the wiring around it — which
 * conversation "Ask AI" and "Send comments" reach, that an unmounted chat
 * leaves those actions off rather than silently dropping them, that pop-out
 * targets the canvas's OWNING workspace, and that a created Kusto query becomes
 * its own tab under the same conversation.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

// Stub the editor: it reports which callbacks it was handed and lets a test
// fire them.
vi.mock('../../../../src/server/spa/client/react/features/canvas/CanvasPanel', () => ({
    CanvasPanel: (props: any) => React.createElement('div', {
        'data-testid': 'canvas-panel-mock',
        'data-canvas-id': props.canvasId,
        'data-workspace-id': props.workspaceId,
        'data-has-ask-ai': props.onAskAi ? 'yes' : 'no',
        'data-has-send': props.onSendToAi ? 'yes' : 'no',
        'data-available-count': String(props.availableCanvases?.length ?? 0),
    },
        React.createElement('button', { 'data-testid': 'fire-ask-ai', onClick: () => props.onAskAi?.('Rewrite this') }, 'Ask AI'),
        React.createElement('button', { 'data-testid': 'fire-send', onClick: () => { void props.onSendToAi?.('2 comments'); } }, 'Send'),
        React.createElement('button', { 'data-testid': 'fire-popout', onClick: () => props.onPopOut?.() }, 'Pop out'),
        React.createElement('button', { 'data-testid': 'fire-created', onClick: () => props.onCanvasCreated?.('canvas-new') }, 'Create'),
    ),
}));

import { UnifiedCanvasTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedCanvasTab';
import {
    clearUnifiedChatCanvasActions,
    publishUnifiedChatCanvasActions,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedChatCanvasActions';
import { clearUnifiedPanelState, readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { visibleTabs } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { clearCanvasPopOutHandles } from '../../../../src/server/spa/client/react/features/canvas/canvasPopOut';

const SCOPE = 'group-1';
const OWNER = 'member-repo';
const CHAT = 'chat-a';

function renderTab(overrides: Partial<React.ComponentProps<typeof UnifiedCanvasTab>> = {}) {
    return render(
        <UnifiedCanvasTab
            workspaceId={OWNER}
            scopeWorkspaceId={SCOPE}
            canvasId="canvas-1"
            chatId={CHAT}
            onClose={vi.fn()}
            {...overrides}
        />,
    );
}

function chatActions() {
    return { askAi: vi.fn(), sendToAi: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(() => {
    clearUnifiedChatCanvasActions();
    clearUnifiedPanelState();
    clearCanvasPopOutHandles();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearUnifiedChatCanvasActions();
    clearUnifiedPanelState();
    clearCanvasPopOutHandles();
});

describe('chat-directed actions', () => {
    it('routes Ask AI and Send to the conversation that owns the canvas', async () => {
        const a = chatActions();
        const other = chatActions();
        publishUnifiedChatCanvasActions(CHAT, a);
        publishUnifiedChatCanvasActions('chat-b', other);
        renderTab();

        expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-has-ask-ai')).toBe('yes');
        fireEvent.click(screen.getByTestId('fire-ask-ai'));
        await act(async () => { fireEvent.click(screen.getByTestId('fire-send')); });

        expect(a.askAi).toHaveBeenCalledWith('Rewrite this');
        expect(a.sendToAi).toHaveBeenCalledExactlyOnceWith('2 comments');
        // A second chat mounted in the same workspace is never reached.
        expect(other.askAi).not.toHaveBeenCalled();
        expect(other.sendToAi).not.toHaveBeenCalled();
    });

    it('keeps pointing at its own chat after the user selects another one', async () => {
        const a = chatActions();
        publishUnifiedChatCanvasActions(CHAT, a);
        renderTab();

        // The panel switches to chat-b's tabs; this canvas tab still belongs to
        // chat-a, so its pending action must not follow the selection.
        publishUnifiedChatCanvasActions('chat-b', chatActions());
        await act(async () => { fireEvent.click(screen.getByTestId('fire-send')); });

        expect(a.sendToAi).toHaveBeenCalledExactlyOnceWith('2 comments');
    });

    it('hides both actions when the owning chat is not mounted', () => {
        renderTab();
        const panel = screen.getByTestId('canvas-panel-mock');
        expect(panel.getAttribute('data-has-ask-ai')).toBe('no');
        expect(panel.getAttribute('data-has-send')).toBe('no');
    });

    it('hides both actions for a tab with no owning chat at all', () => {
        publishUnifiedChatCanvasActions(CHAT, chatActions());
        renderTab({ chatId: null });
        expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-has-ask-ai')).toBe('no');
    });

    it('picks the actions up when the chat mounts after the tab', () => {
        renderTab();
        expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-has-send')).toBe('no');

        act(() => { publishUnifiedChatCanvasActions(CHAT, chatActions()); });
        expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-has-send')).toBe('yes');
    });
});

describe('routing and chrome', () => {
    it('renders the canvas at its owning workspace, not the panel’s scope', () => {
        renderTab();
        const panel = screen.getByTestId('canvas-panel-mock');
        expect(panel.getAttribute('data-workspace-id')).toBe(OWNER);
        expect(panel.getAttribute('data-canvas-id')).toBe('canvas-1');
    });

    it('offers no in-tab canvas switcher — the tab strip is the one control', () => {
        renderTab();
        expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-available-count')).toBe('0');
    });

    it('pops out at the owning workspace and focuses the same window on a repeat', () => {
        const handle = { closed: false, focus: vi.fn() };
        const openSpy = vi.spyOn(window, 'open').mockReturnValue(handle as unknown as Window);
        renderTab();

        fireEvent.click(screen.getByTestId('fire-popout'));
        fireEvent.click(screen.getByTestId('fire-popout'));

        expect(openSpy).toHaveBeenCalledOnce();
        const [url, name] = openSpy.mock.calls[0];
        expect(url).toContain(`workspace=${OWNER}`);
        expect(url).toContain('canvasId=canvas-1');
        expect(name).toBe('coc-canvas-canvas-1');
        expect(handle.focus).toHaveBeenCalledOnce();
        // Popping out leaves the canvas in its tab; no rail replaces it.
        expect(screen.getByTestId('canvas-panel-mock')).toBeTruthy();
    });

    it('opens a created Kusto query as its own tab, linked to the same chat', () => {
        renderTab();
        act(() => { fireEvent.click(screen.getByTestId('fire-created')); });

        const tabs = visibleTabs(readUnifiedPanelState(SCOPE), CHAT);
        expect(tabs.map(t => t.resourceId)).toEqual(['canvas-new']);
        const tab = tabs[0]!;
        expect(tab.kind).toBe('canvas');
        expect(tab.chatId).toBe(CHAT);
        // The query belongs to the clone that served the canvas it came from.
        expect(tab.ownerWorkspaceId).toBe(OWNER);
        // The originating tab is untouched — its draft survives.
        expect(screen.getByTestId('canvas-panel-mock').getAttribute('data-canvas-id')).toBe('canvas-1');
    });

    it('labels a created query with its owning repo when that is not the scope', () => {
        renderTab({ repoLabel: 'member-repo' });
        act(() => { fireEvent.click(screen.getByTestId('fire-created')); });

        const tab = visibleTabs(readUnifiedPanelState(SCOPE), CHAT)[0]!;
        expect(tab.repoLabel).toBe('member-repo');
    });
});
