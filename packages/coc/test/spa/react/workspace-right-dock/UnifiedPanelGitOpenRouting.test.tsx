/**
 * Git tab Open submenu inside the real panel: a repo group's Git tab offers the
 * dock's live members (never the group root or a disabled member), reads
 * recent commits from the group's own server, and opens the member's view in
 * the workspace's `coc://git` page.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const app = vi.hoisted(() => ({ dispatch: vi.fn() }));

const remote = vi.hoisted(() => ({
    listCommits: vi.fn(async (_workspaceId: string, _query?: unknown) => ({
        commits: [{ hash: 'a'.repeat(40), shortHash: 'aaaaaaa', subject: 'Member commit', author: 'x', date: '', parentHashes: [] }],
        unpushedCount: 0,
    })),
    baseUrls: [] as (string | undefined)[],
}));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../../src/server/spa/client/react/api/cocClient')>();
    return {
        ...actual,
        getCocClientFor: (baseUrl?: string) => {
            remote.baseUrls.push(baseUrl);
            return baseUrl ? { git: { listCommits: remote.listCommits } } : actual.getCocClientFor();
        },
    };
});
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <textarea data-testid="mock-terminal-input" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <textarea data-testid="mock-notes-input" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
    getAncestorPaths: () => [],
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState, readUnifiedPanelState, writeUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { EMPTY_UNIFIED_PANEL, openTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { gitPageInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import { setGitPageMember } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useSplitGitPanel';
import { parseCocAddress } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelAddresses';
import { getSpaCocClient } from '../../../../src/server/spa/client/react/api/cocClient';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const GROUP = 'group-g1';
const GROUP_REF = 'remote:srv:group-g1';
const BASE_URL = 'http://127.0.0.1:7201';
const CHAT = 'chat-1';

/** The address the group's single `coc://git` page tab now shows. */
function gitPageAddress() {
    const tab = readUnifiedPanelState(GROUP).workspaceTabs.find(t => t.resourceId === 'coc-git');
    return tab?.browserUrl ? parseCocAddress(tab.browserUrl) : null;
}

function dockStub(target = 'member-a'): WorkspaceDockController {
    return {
        isOpen: true, toggleOpen: vi.fn(), mode: 'explorer', selectMode: vi.fn(), target, setTarget: vi.fn(),
        targets: [], width: 420, maxWidth: 900, isDragging: false, handleMouseDown: vi.fn(), handleTouchStart: vi.fn(),
    };
}

afterEach(() => {
    cleanup();
    clearUnifiedPanelState(GROUP);
    app.dispatch.mockClear();
    remote.listCommits.mockClear();
    remote.baseUrls.length = 0;
});

describe('Git tab Open in a repo group panel', () => {
    it('chooses a live member explicitly, reads it on the group server and opens its commit route', async () => {
        const localList = vi.spyOn(getSpaCocClient().git, 'listCommits');
        writeUnifiedPanelState(GROUP, openTab(EMPTY_UNIFIED_PANEL,
            gitPageInput({ ownerWorkspaceId: GROUP, ownerRoutingRef: GROUP_REF, chatId: CHAT })));
        render(<UnifiedRightPanel workspaceId={GROUP} routingRef={GROUP_REF} chatId={CHAT} dock={dockStub()}
            targets={[
                { workspaceId: GROUP, label: 'Group root', deprioritized: true },
                { workspaceId: 'member-a', label: 'Alpha' },
                { workspaceId: 'member-b', label: 'Beta' },
                { workspaceId: 'member-c', label: 'Gone', disabled: true },
            ]}
            repoGroup={{ id: GROUP, name: 'G', liveRepoCount: 2, baseUrl: BASE_URL }}
            appDispatch={app.dispatch} />);

        fireEvent.contextMenu(screen.getByRole('tab', { name: /Git/ }), { clientX: 20, clientY: 30 });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
        const submenu = screen.getByRole('menu', { name: 'Open' });
        expect(within(submenu).getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Alpha', 'Beta']);
        expect(remote.listCommits).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Beta' }));
        await act(async () => { await Promise.resolve(); });
        expect(remote.listCommits).toHaveBeenCalledWith('member-b', { limit: 5, refresh: true });
        expect(remote.baseUrls).toContain(BASE_URL);
        expect(localList).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Open commit aaaaaaa: Member commit' }));
        expect(gitPageAddress()).toEqual({ kind: 'git', gitMemberId: 'member-b', view: { type: 'commit', hash: 'a'.repeat(40) } });
        expect(app.dispatch).not.toHaveBeenCalled();
        expect(screen.queryByRole('menu', { name: 'Tab actions' })).toBeNull();
        localList.mockRestore();
    });

    it('shows the right-clicked Git tab when opening its working tree from another tab', () => {
        let state = openTab(EMPTY_UNIFIED_PANEL,
            gitPageInput({ ownerWorkspaceId: GROUP, ownerRoutingRef: GROUP_REF, chatId: CHAT }, { gitMemberId: 'member-a' }));
        state = openTab(state, { kind: 'terminal', ownerWorkspaceId: GROUP, chatId: CHAT, resourceId: 's1', label: 'bash' });
        writeUnifiedPanelState(GROUP, state);
        render(<UnifiedRightPanel workspaceId={GROUP} routingRef={GROUP_REF} chatId={CHAT} dock={dockStub()}
            repoGroup={{ id: GROUP, name: 'G', liveRepoCount: 1, baseUrl: BASE_URL }} appDispatch={app.dispatch} />);
        const gitTab = screen.getByRole('tab', { name: /Git/ });
        expect(gitTab.getAttribute('aria-selected')).toBe('false');

        fireEvent.contextMenu(gitTab, { clientX: 20, clientY: 30 });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
        // The tab names its member, so no choice is asked.
        fireEvent.click(screen.getByRole('menuitem', { name: 'Workspace' }));
        expect(gitPageAddress()).toEqual({ kind: 'git', gitMemberId: 'member-a', view: { type: 'working-tree-all' } });
        expect(screen.getByRole('tab', { name: /Git/ }).getAttribute('aria-selected')).toBe('true');
    });

    it('opens the group root\'s Git page from the "+" menu and focuses it on a second open', () => {
        const targets = [
            { workspaceId: GROUP, label: 'Group root' },
            { workspaceId: 'member-a', label: 'Alpha' },
        ];
        render(<UnifiedRightPanel workspaceId={GROUP} routingRef={GROUP_REF} chatId={CHAT} dock={dockStub(GROUP)}
            targets={targets} repoGroup={{ id: GROUP, name: 'G', liveRepoCount: 1, baseUrl: BASE_URL }}
            appDispatch={app.dispatch} />);

        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        fireEvent.click(screen.getByTestId('unified-panel-open-git'));
        const tabs = readUnifiedPanelState(GROUP).workspaceTabs.filter(tab => tab.resourceId === 'coc-git');
        expect(tabs).toEqual([expect.objectContaining({ ownerWorkspaceId: GROUP, ownerRoutingRef: GROUP_REF, browserUrl: 'coc://git' })]);
        expect(screen.getByRole('tab', { name: /Git/ }).getAttribute('aria-selected')).toBe('true');
        // The page body is the Git detail host, not a page error.
        expect(screen.getByTestId('unified-git-tab')).toBeTruthy();
        expect(screen.queryByTestId('browser-address-error')).toBeNull();

        // A second open focuses the same page and keeps the member/view it already names.
        act(() => { writeUnifiedPanelState(GROUP, openTab(readUnifiedPanelState(GROUP),
            { kind: 'terminal', ownerWorkspaceId: GROUP, chatId: CHAT, resourceId: 's1', label: 'bash' })); });
        // The group's own Git list names its member on the page.
        act(() => { setGitPageMember(GROUP, GROUP_REF, 'member-a'); });
        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        fireEvent.click(screen.getByTestId('unified-panel-open-git'));
        expect(readUnifiedPanelState(GROUP).workspaceTabs.filter(tab => tab.resourceId === 'coc-git'))
            .toEqual([expect.objectContaining({ browserUrl: 'coc://git/member/member-a' })]);
        expect(screen.getByRole('tab', { name: /Git/ }).getAttribute('aria-selected')).toBe('true');
        expect(app.dispatch).not.toHaveBeenCalled();
    });
});
