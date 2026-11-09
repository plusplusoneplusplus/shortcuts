/**
 * Git tab right-click → Open → Workspace / recent commits.
 *
 * Owner resolution and routing are unit-tested in `panelGitCommit.test.ts`;
 * these cases prove the menu shape, load states, member choice, and the
 * shared submenu's keyboard, touch, Escape and focus behaviour.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { GitCommit } from '@plusplusoneplusplus/coc-client';
import { UnifiedPanelTabStrip } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedPanelTabStrip';
import {
    EMPTY_UNIFIED_PANEL, openTab, visibleTabs, type UnifiedPanelTab,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import type {
    GitTabOpenOwner, UnifiedPanelGitOpenSource,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/panelGitCommit';

import { gitPageInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import { cocPageKindOf } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelAddresses';

const WS = 'ws-1';
const CHAT = 'chat-1';

afterEach(() => cleanup());

function gitTabs(): readonly UnifiedPanelTab[] {
    let state = EMPTY_UNIFIED_PANEL;
    state = openTab(state, gitPageInput({ ownerWorkspaceId: WS, ownerRoutingRef: null, chatId: CHAT }));
    state = openTab(state, { kind: 'file', ownerWorkspaceId: WS, chatId: CHAT, resourceId: 'src/a.ts', label: 'a.ts' });
    return visibleTabs(state, CHAT);
}

const isGitPage = (tab: UnifiedPanelTab) => cocPageKindOf(tab.browserUrl) === 'git';

function owner(workspaceId: string, label = workspaceId): GitTabOpenOwner {
    return { workspaceId, label, target: { routeWorkspaceId: WS, workspaceId, sourceSelectionId: workspaceId } };
}

function commit(index: number, subject = `Commit subject ${index}`): GitCommit {
    const hash = `${index}`.repeat(40).slice(0, 40);
    return { hash, shortHash: hash.slice(0, 7), subject, author: 'a', date: '2026-11-01T00:00:00Z', parentHashes: [] };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

function source(overrides: Partial<UnifiedPanelGitOpenSource> = {}): UnifiedPanelGitOpenSource {
    return {
        owner: owner(WS),
        choices: [],
        loadRecent: vi.fn(async () => [1, 2, 3, 4, 5, 6].map(index => commit(index))),
        open: vi.fn(),
        ...overrides,
    };
}

function renderStrip(gitOpen: UnifiedPanelGitOpenSource | null) {
    const tabs = gitTabs();
    const gitOpenSource = vi.fn((tab: UnifiedPanelTab) => (isGitPage(tab) ? gitOpen : null));
    const props = {
        tabs, activeId: tabs[0].id, onActivate: vi.fn(), onClose: vi.fn(), onCloseMany: vi.fn(),
        onMove: vi.fn(), onMenuAction: vi.fn(), gitOpenSource,
    };
    render(<UnifiedPanelTabStrip {...props} />);
    const git = tabs.find(isGitPage)!;
    const file = tabs.find(tab => tab.kind === 'file')!;
    return { props, gitNode: screen.getByTestId(`unified-panel-tab-${git.id}`), fileNode: screen.getByTestId(`unified-panel-tab-${file.id}`) };
}

const openRow = () => screen.getByRole('menuitem', { name: 'Open' });
const submenu = () => screen.queryByRole('menu', { name: 'Open' });
const flush = () => act(async () => { await Promise.resolve(); });

describe('Git tab Open submenu', () => {
    it('is offered only on Git tabs with a source, before Close, with a chevron', () => {
        const { fileNode, gitNode } = renderStrip(source());
        fireEvent.contextMenu(fileNode, { clientX: 20, clientY: 30 });
        expect(screen.queryByRole('menuitem', { name: 'Open' })).toBeNull();
        fireEvent.mouseDown(document.body);

        fireEvent.contextMenu(gitNode, { clientX: 20, clientY: 30 });
        const menu = screen.getByRole('menu', { name: 'Tab actions' });
        expect(within(menu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Open▶', 'Duplicate', 'Close', 'Close Other▶']);
        expect(openRow().getAttribute('aria-haspopup')).toBe('menu');
        expect(screen.getByTestId('unified-panel-tab-menu-open-git-chevron')).toBeTruthy();
        cleanup();

        const { gitNode: noSource } = renderStrip(null);
        fireEvent.contextMenu(noSource, { clientX: 20, clientY: 30 });
        expect(screen.queryByRole('menuitem', { name: 'Open' })).toBeNull();
    });

    it('lists Workspace first, then five recent commits with short SHA and a full accessible subject', async () => {
        const pending = deferred<readonly GitCommit[]>();
        const longSubject = 'Refactor the unified right panel tab context menu into nested submenus for clarity';
        const gitOpen = source({ loadRecent: vi.fn(() => pending.promise) });
        const { gitNode } = renderStrip(gitOpen);
        fireEvent.contextMenu(gitNode, { clientX: 20, clientY: 30 });
        expect(gitOpen.loadRecent).not.toHaveBeenCalled();

        fireEvent.click(openRow());
        expect(within(submenu()!).getByRole('status').textContent).toBe('Loading recent commits…');
        expect(within(submenu()!).getAllByRole('menuitem')[0].textContent).toBe('Workspace');
        expect(gitOpen.loadRecent).toHaveBeenCalledTimes(1);
        expect(gitOpen.loadRecent).toHaveBeenCalledWith(gitOpen.owner);

        await act(async () => { pending.resolve([commit(1, longSubject), ...[2, 3, 4, 5, 6].map(index => commit(index))]); });
        const items = within(submenu()!).getAllByRole('menuitem');
        expect(items[0].textContent).toBe('Workspace');
        expect(items.slice(1).map(item => item.textContent?.slice(0, 7)))
            .toEqual(['1111111', '2222222', '3333333', '4444444', '5555555']);
        const first = items[1];
        expect(first.getAttribute('aria-label')).toBe(`Open commit 1111111: ${longSubject}`);
        expect(first.getAttribute('title')).toBe(longSubject);
        expect(first.textContent).toBe(`1111111${longSubject.slice(0, 47)}…`);
        expect(submenu()!.style.visibility).toBe('');
    });

    it('opens a commit or the working tree through the source, then closes and refocuses the tab', async () => {
        const gitOpen = source();
        const { gitNode, props } = renderStrip(gitOpen);
        gitNode.focus();
        fireEvent.contextMenu(gitNode, { clientX: 20, clientY: 30 });
        fireEvent.click(openRow());
        await flush();
        fireEvent.click(screen.getByRole('menuitem', { name: /^Open commit 3333333/ }));
        expect(gitOpen.open).toHaveBeenCalledWith(gitOpen.owner, expect.objectContaining({ hash: commit(3).hash }));
        expect(screen.queryByTestId('unified-panel-tab-menu')).toBeNull();
        await flush();
        expect(document.activeElement).toBe(gitNode);

        fireEvent.contextMenu(gitNode, { clientX: 20, clientY: 30 });
        fireEvent.click(openRow());
        fireEvent.click(screen.getByRole('menuitem', { name: 'Workspace' }));
        expect(gitOpen.open).toHaveBeenLastCalledWith(gitOpen.owner, null);
        expect(props.onMenuAction).not.toHaveBeenCalled();
    });

    it('shows empty, error with Retry, and unavailable states', async () => {
        const empty = source({ loadRecent: vi.fn(async () => []) });
        const first = renderStrip(empty);
        fireEvent.contextMenu(first.gitNode, { clientX: 20, clientY: 30 });
        fireEvent.click(openRow());
        await flush();
        expect(within(submenu()!).getByRole('status').textContent).toBe('No commits yet.');
        cleanup();

        const loadRecent = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce([commit(7)]);
        const failing = source({ loadRecent });
        const second = renderStrip(failing);
        fireEvent.contextMenu(second.gitNode, { clientX: 20, clientY: 30 });
        fireEvent.click(openRow());
        await flush();
        expect(within(submenu()!).getByRole('status').textContent).toBe('Could not load recent commits.');
        fireEvent.click(screen.getByRole('menuitem', { name: 'Retry' }));
        await flush();
        expect(loadRecent).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('menuitem', { name: /^Open commit 7777777/ })).toBeTruthy();
        // Retry unmounts itself; focus moves into the submenu instead of the body.
        expect(submenu()!.contains(document.activeElement)).toBe(true);
        cleanup();

        const offline = source({ unavailable: 'Recent commits unavailable: the owning server is not connected.' });
        const third = renderStrip(offline);
        fireEvent.contextMenu(third.gitNode, { clientX: 20, clientY: 30 });
        fireEvent.click(openRow());
        await flush();
        expect(offline.loadRecent).not.toHaveBeenCalled();
        expect(within(submenu()!).getByRole('status').textContent).toMatch(/owning server is not connected/);
        expect(screen.getByRole('menuitem', { name: 'Workspace' })).toBeEnabled();
    });

    it('requires an explicit member choice for a group tab and reads nothing before it', async () => {
        const memberA = owner('member-a', 'Member A');
        const memberB = owner('member-b', 'Member B');
        const gitOpen = source({ owner: null, choices: [memberA, memberB] });
        const { gitNode } = renderStrip(gitOpen);
        fireEvent.contextMenu(gitNode, { clientX: 20, clientY: 30 });
        fireEvent.keyDown(openRow(), { key: 'ArrowRight' });

        expect(within(submenu()!).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Member A', 'Member B']);
        expect(screen.queryByRole('menuitem', { name: 'Workspace' })).toBeNull();
        expect(gitOpen.loadRecent).not.toHaveBeenCalled();
        expect(document.activeElement?.textContent).toBe('Member A');

        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
        await flush();
        expect(gitOpen.loadRecent).toHaveBeenCalledWith(memberB);
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Workspace: Member B' }));
        fireEvent.click(screen.getByRole('menuitem', { name: /^Open commit 1111111/ }));
        expect(gitOpen.open).toHaveBeenCalledWith(memberB, expect.objectContaining({ hash: commit(1).hash }));

        fireEvent.contextMenu(gitNode, { clientX: 20, clientY: 30 });
        fireEvent.click(openRow());
        fireEvent.click(screen.getByRole('menuitem', { name: 'Member A' }));
        await flush();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Choose another repository' }));
        expect(within(submenu()!).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Member A', 'Member B']);
    });

    it('keeps keyboard, Escape and focus scoped to the submenu', async () => {
        const gitOpen = source();
        const { gitNode, props } = renderStrip(gitOpen);
        gitNode.focus();
        fireEvent.keyDown(gitNode, { key: 'F10', shiftKey: true });
        expect(document.activeElement).toBe(openRow());

        fireEvent.keyDown(openRow(), { key: 'Enter' });
        await flush();
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Workspace' }));
        fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^Open commit 1111111/ }));
        fireEvent.keyDown(document.activeElement!, { key: 'End' });
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /^Open commit 5555555/ }));

        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        expect(submenu()).toBeNull();
        expect(document.activeElement).toBe(openRow());

        fireEvent.keyDown(screen.getByTestId('unified-panel-tab-menu'), { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Close' }));
        fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
        await flush();
        expect(screen.queryByTestId('unified-panel-tab-menu')).toBeNull();
        expect(document.activeElement).toBe(gitNode);
        expect(gitOpen.open).not.toHaveBeenCalled();
        expect(props.onMenuAction).not.toHaveBeenCalled();
    });

    it('opens on mouse hover but not touch hover, toggles on tap, and switches with Close Other', () => {
        const { gitNode } = renderStrip(source());
        fireEvent.contextMenu(gitNode, { clientX: 20, clientY: 30 });

        fireEvent.pointerEnter(openRow(), { pointerType: 'touch' });
        expect(submenu()).toBeNull();
        fireEvent.click(openRow());
        expect(submenu()).not.toBeNull();
        fireEvent.click(openRow());
        expect(submenu()).toBeNull();

        fireEvent.pointerEnter(openRow(), { pointerType: 'mouse' });
        expect(submenu()).not.toBeNull();
        fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Close Other' }), { pointerType: 'mouse' });
        expect(submenu()).toBeNull();
        expect(screen.getByRole('menu', { name: 'Close Other' })).toBeTruthy();
    });
});
