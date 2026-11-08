// @vitest-environment jsdom
/**
 * useSplitGitPanel owns the seam between the split workspace's git list and
 * the panel's one `coc://git` page tab per scope: the tab's identity
 * (workspace-scoped, not chat-scoped, since the page is shared like Notes),
 * its address (member + view), and — the highest-risk part of the migration
 * off the old chat-scoped tab / AppContext git route — telling "an external
 * open changed what the page shows" apart from "the page's own detail just
 * echoed back the view we ourselves wrote", so `RepoGitTab` never loops or
 * fails to notice a real external open.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
    useGitPageTabAddress,
    useSplitGitPanel,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useSplitGitPanel';
import { openPanelGitCommit, openPanelGitMember } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/panelGitCommit';
import { clearUnifiedPanelState, readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';

function commitItem(hash: string) {
    return { hash, shortHash: hash.slice(0, 7), subject: hash, author: 'a', date: '', parentHashes: [] };
}

function Probe({ scopeWorkspaceId, memberId }: { scopeWorkspaceId: string; memberId?: string }) {
    const panel = useSplitGitPanel({ scopeWorkspaceId, memberId, enabled: true });
    return (
        <>
            <button data-testid="select-commit" onClick={() => panel.onViewChange?.({ type: 'commit', commit: commitItem('internal-y') })}>
                select
            </button>
            <button data-testid="reveal-working-tree" onClick={() => panel.revealView?.({ type: 'working-tree-all' })}>
                reveal
            </button>
            <span
                data-testid="status"
                data-open={String(panel.detailOpen)}
                data-restored={panel.restoreView?.type === 'commit' ? panel.restoreView.hash : ''}
                data-scope={String(panel.viewScopeKey)}
            />
        </>
    );
}

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
});
afterEach(cleanup);

describe('useSplitGitPanel — identity', () => {
    it('is one tab per workspace scope, not per chat', () => {
        render(<Probe scopeWorkspaceId="ws-a" />);
        act(() => { openPanelGitCommit(() => {}, { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'ws-a' }, 'c1'); });
        const state = readUnifiedPanelState('ws-a');
        expect(state.workspaceTabs).toEqual([expect.objectContaining({ browserUrl: 'coc://git/c1', chatId: null })]);
        expect(state.chatTabs).toEqual({});
    });
});

describe('useSplitGitPanel — external open vs. self-echo round trip', () => {
    it('(a) an external open sets the address and bumps the scope key', () => {
        render(<Probe scopeWorkspaceId="ws-a" />);
        const before = screen.getByTestId('status').dataset.scope;
        act(() => {
            openPanelGitCommit(() => {}, { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'ws-a' }, 'external-x');
        });
        const status = screen.getByTestId('status');
        expect(status.dataset.restored).toBe('external-x');
        expect(status.dataset.scope).not.toBe(before);
    });

    it('(b) the detail\'s own selection writes the address without re-triggering itself as external', () => {
        render(<Probe scopeWorkspaceId="ws-a" />);
        const scope0 = screen.getByTestId('status').dataset.scope;
        act(() => { screen.getByTestId('select-commit').click(); });
        const status = screen.getByTestId('status');
        expect(status.dataset.restored).toBe('internal-y');
        // The scope key must NOT change: this is the panel's own write echoing
        // back, not a signal to re-apply `restoreView` from scratch.
        expect(status.dataset.scope).toBe(scope0);
    });

    it('(c) a real external re-open while already showing a view still lands and signals', () => {
        render(<Probe scopeWorkspaceId="ws-a" />);
        act(() => { screen.getByTestId('select-commit').click(); }); // now showing internal-y
        const scope1 = screen.getByTestId('status').dataset.scope;
        act(() => {
            openPanelGitCommit(() => {}, { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'ws-a' }, 'external-z');
        });
        const status = screen.getByTestId('status');
        expect(status.dataset.restored).toBe('external-z');
        expect(status.dataset.scope).not.toBe(scope1);
    });
});

describe('useSplitGitPanel — revealView from another surface', () => {
    it('is an external open: the address changes and the scope key bumps so the detail switches', () => {
        render(<Probe scopeWorkspaceId="ws-a" />);
        act(() => { screen.getByTestId('select-commit').click(); });
        const scope1 = screen.getByTestId('status').dataset.scope;
        act(() => { screen.getByTestId('reveal-working-tree').click(); });
        expect(readUnifiedPanelState('ws-a').workspaceTabs).toEqual([expect.objectContaining({ browserUrl: 'coc://git/working-changes' })]);
        expect(screen.getByTestId('status').dataset.scope).not.toBe(scope1);
    });
});

describe('useSplitGitPanel — group member scope', () => {
    it('reports the detail closed when the tab\'s address names a different member', () => {
        render(<Probe scopeWorkspaceId="group-a" memberId="repo-a" />);
        act(() => {
            openPanelGitMember(() => {}, { routeWorkspaceId: 'group-a', workspaceId: 'repo-b', sourceSelectionId: 'repo-b' });
        });
        expect(screen.getByTestId('status').dataset.open).toBe('false');
    });

    it('exposes the explicit member through useGitPageTabAddress for a host to resolve against', () => {
        function MemberProbe() {
            const address = useGitPageTabAddress('group-a', null);
            return <span data-testid="member" data-id={address?.gitMemberId ?? ''} />;
        }
        act(() => {
            openPanelGitMember(() => {}, { routeWorkspaceId: 'group-a', workspaceId: 'repo-a', sourceSelectionId: 'repo-a' });
        });
        render(<MemberProbe />);
        expect(screen.getByTestId('member').dataset.id).toBe('repo-a');
    });
});
