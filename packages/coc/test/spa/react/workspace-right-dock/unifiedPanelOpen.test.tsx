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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import {
    focusUnifiedPanelTab,
    inheritDraftPanelTabs,
    openUnifiedPanelPreviewTab,
    openUnifiedPanelTab,
    openUnifiedPasteTab,
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
    unifiedPanelStorageKey,
    WORKSPACE_SCOPE_KEY,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import {
    useDockOpen,
    workspaceDockOpenStorageKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

import { pasteResourceId, readPasteSnapshot } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPasteTabs';

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

    it('returns the stored id for each concrete remote owner', () => {
        const first = openUnifiedPanelTab(WS, { ...fileInput('src/a.ts'), ownerRoutingRef: 'remote:one:ws-open' });
        const second = openUnifiedPanelTab(WS, { ...fileInput('src/a.ts'), ownerRoutingRef: 'remote:two:ws-open' });
        expect(first).not.toBe(second);
        expect(readUnifiedPanelState(WS).chatTabs[CHAT]?.map(tab => tab.id)).toEqual([first, second]);
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

    it('opens content matches through one owner-routed preview slot at the requested line', () => {
        openUnifiedPanelPreviewTab('group-acme', {
            ownerWorkspaceId: 'member-1',
            ownerRoutingRef: 'remote:hub:member-1',
            chatId: CHAT,
            resourceId: 'src/a.ts',
            label: 'a.ts',
            repoLabel: 'API',
            line: 12,
        });
        openUnifiedPanelPreviewTab('group-acme', {
            ownerWorkspaceId: 'member-2',
            ownerRoutingRef: 'remote:hub:member-2',
            chatId: CHAT,
            resourceId: 'src/a.ts',
            label: 'a.ts',
            repoLabel: 'Web',
            line: 34,
        });

        const tabs = readUnifiedPanelState('group-acme').chatTabs[CHAT] ?? [];
        expect(tabs).toHaveLength(1);
        expect(tabs[0]).toMatchObject({
            ownerWorkspaceId: 'member-2',
            ownerRoutingRef: 'remote:hub:member-2',
            resourceId: 'src/a.ts',
            repoLabel: 'Web',
            line: 34,
            preview: true,
        });
        expect(isDockOpen('group-acme')).toBe(true);
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

    it('persists inherited draft tabs, wakes subscribers once, and does not reveal the dock', () => {
        openUnifiedPanelTab(WS, fileInput('src/a.ts', null), { reveal: false });
        setDockOpen(WS, false);
        let renders = 0;
        function RenderProbe() {
            const { tabs } = useUnifiedPanelTabs(WS, CHAT);
            renders += 1;
            return <span data-testid="inherited-labels">{tabs.map(tab => tab.label).join(',')}</span>;
        }
        render(<RenderProbe />);
        const before = renders;

        act(() => { inheritDraftPanelTabs(WS, CHAT); });

        expect(renders).toBe(before + 1);
        expect(screen.getByTestId('inherited-labels')).toHaveTextContent('a.ts');
        expect(localStorage.getItem(unifiedPanelStorageKey(WS))).toContain(CHAT);
        expect(isDockOpen(WS)).toBe(false);
    });

    it('does not write or re-render when there are no draft tabs to inherit', () => {
        let renders = 0;
        function RenderProbe() {
            useUnifiedPanelTabs(WS, CHAT);
            renders += 1;
            return null;
        }
        render(<RenderProbe />);
        const before = renders;
        const setItem = vi.spyOn(Storage.prototype, 'setItem');

        act(() => { inheritDraftPanelTabs(WS, CHAT); });

        expect(setItem).not.toHaveBeenCalled();
        expect(renders).toBe(before);
    });
});

describe('paste snapshot lifecycle', () => {
    beforeEach(() => {
        clearUnifiedPanelState();
        localStorage.clear();
    });
    afterEach(() => {
        clearUnifiedPanelState();
        localStorage.clear();
    });

    const context = { ownerWorkspaceId: WS, chatId: CHAT };
    const content = '# Snapshot\n\nOriginal pasted text';

    it('captures raw content in memory, reveals the dock, and refocuses matching text', () => {
        const id = openUnifiedPasteTab(WS, content, context);
        const resourceId = pasteResourceId(content);
        expect(readPasteSnapshot(WS, resourceId)).toBe(content);
        expect(isDockOpen(WS)).toBe(true);
        expect(readUnifiedPanelState(WS).chatTabs[CHAT]?.[0]).toMatchObject({
            id, kind: 'paste', label: `Pasted text (${content.length} chars)`, resourceId,
        });
        const second = openUnifiedPasteTab(WS, 'edited text', context);
        expect(second).not.toBe(id);
        expect(openUnifiedPasteTab(WS, content, context)).toBe(id);
        expect(readUnifiedPanelState(WS).chatTabs[CHAT]).toHaveLength(2);
        expect(readUnifiedPanelState(WS).activeByScope[CHAT]).toBe(id);
        expect(readPasteSnapshot(WS, resourceId)).toBe(content);
        const stored = localStorage.getItem(unifiedPanelStorageKey(WS))!;
        expect(stored).not.toContain(content);
        expect(stored).not.toContain(resourceId);
        expect(stored).not.toContain(id);
    });

    it('keeps equal pastes separate by chat and concrete owner in a repo group', () => {
        const group = 'group-acme';
        const first = openUnifiedPasteTab(group, content, {
            ...context, ownerRoutingRef: 'remote:one:ws-open', repoLabel: 'One',
        });
        const second = openUnifiedPasteTab(group, content, {
            ...context, ownerRoutingRef: 'remote:two:ws-open', repoLabel: 'Two',
        });
        const otherChat = openUnifiedPasteTab(group, content, { ...context, chatId: 'chat-b' });
        const state = readUnifiedPanelState(group);
        expect(state.chatTabs[CHAT]?.map(tab => tab.id)).toEqual([first, second]);
        expect(state.chatTabs['chat-b']?.[0].id).toBe(otherChat);
        expect(readPasteSnapshot(WS, pasteResourceId(content))).toBeUndefined();
        updateUnifiedPanelState(group, prev => closeTab(closeTab(prev, first), second));
        expect(readPasteSnapshot(group, pasteResourceId(content))).toBe(content);
        updateUnifiedPanelState(group, prev => closeTab(prev, otherChat));
        expect(readPasteSnapshot(group, pasteResourceId(content))).toBeUndefined();
    });

    it('frees a snapshot on close without affecting another workspace or content', () => {
        const id = openUnifiedPasteTab(WS, content, context);
        openUnifiedPasteTab('ws-b', content, context);
        const other = openUnifiedPasteTab(WS, 'other text', context);
        updateUnifiedPanelState(WS, prev => closeTab(prev, id));
        expect(readPasteSnapshot(WS, pasteResourceId(content))).toBeUndefined();
        expect(readPasteSnapshot('ws-b', pasteResourceId(content))).toBe(content);
        expect(readPasteSnapshot(WS, pasteResourceId('other text'))).toBe('other text');
        updateUnifiedPanelState(WS, prev => closeTab(prev, other));
        expect(readPasteSnapshot(WS, pasteResourceId('other text'))).toBeUndefined();
        expect(openUnifiedPasteTab(WS, content, context)).toBe(id);
        expect(readPasteSnapshot(WS, pasteResourceId(content))).toBe(content);
    });

    it('retains inherited draft content until both draft and chat tabs close', () => {
        const draft = openUnifiedPasteTab(WS, content, { ...context, chatId: null });
        inheritDraftPanelTabs(WS, CHAT);
        const inherited = readUnifiedPanelState(WS).chatTabs[CHAT]![0].id;
        expect(inherited).not.toBe(draft);
        updateUnifiedPanelState(WS, prev => closeTab(prev, draft));
        expect(readPasteSnapshot(WS, pasteResourceId(content))).toBe(content);
        updateUnifiedPanelState(WS, prev => closeTab(prev, inherited));
        expect(readPasteSnapshot(WS, pasteResourceId(content))).toBeUndefined();
    });

    it('clears only the requested panel scope, including empty-string snapshots', () => {
        openUnifiedPasteTab(WS, '', context);
        openUnifiedPasteTab('ws-b', content, context);
        expect(readPasteSnapshot(WS, pasteResourceId(''))).toBe('');
        clearUnifiedPanelState(WS);
        expect(readPasteSnapshot(WS, pasteResourceId(''))).toBeUndefined();
        expect(readPasteSnapshot('ws-b', pasteResourceId(content))).toBe(content);
        clearUnifiedPanelState();
        expect(readPasteSnapshot('ws-b', pasteResourceId(content))).toBeUndefined();
    });

    it('drops paste tabs and content when a reload restores the persisted layout', () => {
        openUnifiedPasteTab(WS, content, context);
        openUnifiedPanelTab(WS, fileInput('src/kept.ts'));
        const saved = localStorage.getItem(unifiedPanelStorageKey(WS))!;
        clearUnifiedPanelState();
        localStorage.setItem(unifiedPanelStorageKey(WS), saved);
        expect(readUnifiedPanelState(WS).chatTabs[CHAT]?.map(tab => tab.kind)).toEqual(['file']);
        expect(readPasteSnapshot(WS, pasteResourceId(content))).toBeUndefined();
    });
});
