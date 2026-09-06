/**
 * unifiedPanelOpen — the imperative seam AC-04's entry points call from outside
 * the panel's subtree.
 *
 * What these cases pin down is the part a component-local API could not give
 * the entry points: opening a resource with no panel mounted, revealing a
 * collapsed dock without ever collapsing it, filing a tab against the
 * originating chat rather than the selected one, and composing two opens fired
 * in the same tick.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import {
    focusUnifiedPanelTab,
    openUnifiedPanelTab,
    unifiedTabIdFor,
    updateUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import {
    clearUnifiedPanelState,
    readUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { useUnifiedPanelTabs } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useUnifiedPanelTabs';
import {
    closeTab,
    unifiedTabId,
    WORKSPACE_SCOPE_KEY,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import {
    useDockOpen,
    workspaceDockOpenStorageKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

const WS = 'ws-open';
const CHAT = 'chat-a';

function fileInput(path: string, chatId: string | null = CHAT, owner = WS) {
    return {
        kind: 'file' as const,
        ownerWorkspaceId: owner,
        chatId,
        resourceId: path,
        label: path.split('/').pop() ?? path,
    };
}

function setDockOpen(workspaceId: string, open: boolean) {
    localStorage.setItem(workspaceDockOpenStorageKey(workspaceId), open ? '1' : '0');
}

function isDockOpen(workspaceId: string): boolean {
    return localStorage.getItem(workspaceDockOpenStorageKey(workspaceId)) === '1';
}

/** A consumer of the same session, so cross-tree sharing is observable. */
function Probe({ chatId }: { chatId: string | null }) {
    const { tabs, activeId } = useUnifiedPanelTabs(WS, chatId);
    return (
        <div>
            <span data-testid="labels">{tabs.map(tab => tab.label).join(',')}</span>
            <span data-testid="active">{activeId ?? 'none'}</span>
        </div>
    );
}

/** A consumer of the dock's open flag, to watch reveal without a whole panel. */
function DockProbe({ workspaceId }: { workspaceId: string }) {
    const [isOpen] = useDockOpen(workspaceDockOpenStorageKey(workspaceId));
    return <span data-testid="dock-open">{isOpen ? 'open' : 'closed'}</span>;
}

describe('unifiedPanelOpen', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
    });
    afterEach(() => {
        cleanup();
        localStorage.clear();
        clearUnifiedPanelState();
    });

    it('opens a tab with no panel mounted and returns its stable id', () => {
        const id = openUnifiedPanelTab(WS, fileInput('src/app.ts'));

        expect(id).toBe(unifiedTabId({ kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'src/app.ts' }));
        const state = readUnifiedPanelState(WS);
        expect(state.chatTabs[CHAT]?.map(tab => tab.resourceId)).toEqual(['src/app.ts']);
        expect(state.activeByScope[CHAT]).toBe(id);
        // Same descriptor, same id — that is what lets an entry point ask
        // "is my tab still there?" without holding a handle.
        expect(unifiedTabIdFor(fileInput('src/app.ts'))).toBe(id);
    });

    it('reveals a collapsed dock, and never collapses an open one', () => {
        setDockOpen(WS, false);
        render(<DockProbe workspaceId={WS} />);
        expect(screen.getByTestId('dock-open')).toHaveTextContent('closed');

        act(() => { openUnifiedPanelTab(WS, fileInput('src/app.ts')); });
        expect(screen.getByTestId('dock-open')).toHaveTextContent('open');

        // A second open leaves it open — reveal is one-way, so a stream of
        // events can never toggle the panel shut under the user.
        act(() => { openUnifiedPanelTab(WS, fileInput('src/other.ts')); });
        expect(screen.getByTestId('dock-open')).toHaveTextContent('open');
    });

    it('leaves the dock collapsed for a background open', () => {
        setDockOpen(WS, false);

        openUnifiedPanelTab(WS, fileInput('src/app.ts'), { reveal: false });

        expect(isDockOpen(WS)).toBe(false);
        expect(readUnifiedPanelState(WS).chatTabs[CHAT]).toHaveLength(1);
    });

    it('reaches a mounted consumer of the same workspace', () => {
        render(<Probe chatId={CHAT} />);
        expect(screen.getByTestId('labels')).toHaveTextContent('');

        act(() => { openUnifiedPanelTab(WS, fileInput('src/app.ts')); });

        expect(screen.getByTestId('labels')).toHaveTextContent('app.ts');
        expect(screen.getByTestId('active')).toHaveTextContent('app.ts');
    });

    it('files a late response under the originating chat, not the selected one', () => {
        // The user has moved on to chat B while an async open for chat A lands.
        render(<Probe chatId="chat-b" />);

        act(() => { openUnifiedPanelTab(WS, fileInput('src/app.ts', CHAT)); });

        // Chat B's strip is untouched...
        expect(screen.getByTestId('labels')).toHaveTextContent('');
        // ...and the tab is waiting in chat A, where it was asked for.
        expect(readUnifiedPanelState(WS).chatTabs[CHAT]?.map(tab => tab.resourceId)).toEqual(['src/app.ts']);
    });

    it('keeps a repo-group member tab owned by its member repo', () => {
        const id = openUnifiedPanelTab('group-acme', fileInput('src/app.ts', CHAT, 'member-1'));

        const tab = readUnifiedPanelState('group-acme').chatTabs[CHAT]?.[0];
        expect(tab?.id).toBe(id);
        // Scope is the group, owner is the member — requests route by the owner.
        expect(tab?.ownerWorkspaceId).toBe('member-1');
        expect(readUnifiedPanelState(WS).chatTabs[CHAT]).toBeUndefined();
    });

    it('composes two opens fired in the same tick', () => {
        render(<Probe chatId={CHAT} />);

        act(() => {
            openUnifiedPanelTab(WS, fileInput('src/a.ts'));
            openUnifiedPanelTab(WS, fileInput('src/b.ts'));
        });

        expect(screen.getByTestId('labels')).toHaveTextContent('a.ts,b.ts');
    });

    it('focuses an existing tab without resurrecting a closed one', () => {
        const first = openUnifiedPanelTab(WS, fileInput('src/a.ts'));
        const second = openUnifiedPanelTab(WS, fileInput('src/b.ts'));
        render(<Probe chatId={CHAT} />);
        expect(screen.getByTestId('active')).toHaveTextContent(second);

        act(() => { expect(focusUnifiedPanelTab(WS, CHAT, first)).toBe(true); });
        expect(screen.getByTestId('active')).toHaveTextContent(first);

        act(() => { updateUnifiedPanelState(WS, prev => closeTab(prev, first)); });
        // Focusing a tab the user closed does nothing — only an explicit open
        // may bring a resource back.
        act(() => { expect(focusUnifiedPanelTab(WS, CHAT, first)).toBe(false); });
        expect(readUnifiedPanelState(WS).chatTabs[CHAT]?.map(tab => tab.id)).toEqual([second]);
    });

    it('does not let a background chat repoint the visible scope, or reveal the dock', () => {
        const hidden = openUnifiedPanelTab(WS, fileInput('src/hidden.ts', 'chat-bg'), { reveal: false });
        const shown = openUnifiedPanelTab(WS, fileInput('src/shown.ts', CHAT), { reveal: false });
        setDockOpen(WS, false);

        // Chat A cannot see chat BG's tab, so the activation is refused.
        expect(focusUnifiedPanelTab(WS, CHAT, hidden)).toBe(false);
        expect(readUnifiedPanelState(WS).activeByScope[CHAT]).toBe(shown);
        // ...and a refused focus must not pop the panel open either.
        expect(isDockOpen(WS)).toBe(false);
    });

    it('skips the write when the model reports a no-op', () => {
        openUnifiedPanelTab(WS, fileInput('src/a.ts'));
        const before = readUnifiedPanelState(WS);

        updateUnifiedPanelState(WS, prev => closeTab(prev, 'no-such-tab'));

        // Same reference: a no-op never notifies subscribers.
        expect(readUnifiedPanelState(WS)).toBe(before);
    });

    it('files a chat-owned resource under the workspace when no chat is selected', () => {
        const id = openUnifiedPanelTab(WS, fileInput('src/a.ts', null));

        const state = readUnifiedPanelState(WS);
        expect(state.chatTabs[WORKSPACE_SCOPE_KEY]?.map(tab => tab.id)).toEqual([id]);
        expect(state.activeByScope[WORKSPACE_SCOPE_KEY]).toBe(id);
    });
});
