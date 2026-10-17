/** @vitest-environment jsdom */
import { useContext, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CocClient, GitCommit, GitInfoResponse } from '@plusplusoneplusplus/coc-client';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { useRepoGitSelection } from '../../../../src/server/spa/client/react/features/git/repoGitTab/useRepoGitSelection';
import { GroupRailGit, RepoRailGit } from '../../../../src/server/spa/client/react/features/repo-detail/RailGitSummary';
import { RailControlsContext } from '../../../../src/server/spa/client/react/features/repo-detail/RailHoverPreview';
import { SplitWorkspacePanel, splitWorkspaceGitCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/SplitWorkspacePanel';
import { splitWorkspaceLeftCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';
import { useSplitGitPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useSplitGitPanel';
import { UnifiedGitTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedGitTab';
import { parseGitRoute } from '../../../../src/server/spa/client/react/layout/gitRoute';
import { routingRefForPanelOwner } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOwnerRouting';

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', async importOriginal => ({
    ...(await importOriginal<object>()),
    useCocClient: () => client,
}));
vi.mock('../../../../src/server/spa/client/react/utils/config', async importOriginal => ({
    ...(await importOriginal<object>()),
    isGitCommitLookupEnabled: () => false,
}));

const commits: GitCommit[] = Array.from({ length: 51 }, (_, index) => ({
    hash: (51 - index).toString(16).padStart(40, '0'),
    shortHash: (51 - index).toString(16).padStart(7, '0'),
    subject: `Outgoing change ${index}`,
    author: 'Example', date: '2026-10-01T12:00:00Z',
    parentHashes: ['a'.repeat(40)], body: `Full metadata ${index}`,
}));
const selected = commits[50];
const info: GitInfoResponse = {
    branch: 'feature', dirty: false, ahead: 51, behind: 0, upstream: 'origin/feature',
    detached: false, isGitRepo: true, remoteUrl: null,
};
const getCommit = vi.fn();
const listCommits = vi.fn(async (_id: string, query: { skip?: number }) => ({
    commits: commits.slice(query.skip ?? 0, (query.skip ?? 0) + 50), unpushedCount: 51,
}));
let client: CocClient;
let selection: ReturnType<typeof useRepoGitSelection>;

function GitSelection({ scope, page, member, owner }: { scope: string; page: string; member: string; owner: string }) {
    const current = useRepoGitSelection({ workspaceId: member, routeWorkspaceId: page,
        sourceSelectionId: owner, commits: [], loading: false });
    selection = current;
    const panel = useSplitGitPanel({ scopeWorkspaceId: scope, ownerRoutingRef: page,
        chatId: null, memberId: page === member ? undefined : member, enabled: true });
    useEffect(() => { current.hydrateFromInitialLoad([]); }, [member]);
    useEffect(() => { panel.onViewChange?.(current.view); }, [current.view, panel.onViewChange]);
    return panel.detailContainer && current.selectedCommit
        ? createPortal(<div data-testid="commit-detail">{current.selectedCommit.hash}{current.selectedCommit.body}</div>, panel.detailContainer)
        : null;
}

function Harness({ group, remote }: { group: boolean; remote: boolean }) {
    const scope = group ? 'group-preview' : 'repo-preview';
    const routingRef = remote ? `remote:owner:${scope}` : scope;
    const { state } = useApp();
    const member = group ? state.gitRouteScope?.workspaceId ?? 'repo-first' : scope;
    const page = group ? routingRef : scope;
    const panel = useSplitGitPanel({ scopeWorkspaceId: scope, ownerRoutingRef: page,
        chatId: null, memberId: group ? member : undefined, enabled: true });
    return <>
        <SplitWorkspacePanel workspaceId={scope} chatList={<div>Chats</div>}
            gitList={<GitSelection key={member} scope={scope} page={page} member={member}
                owner={group ? routingRefForPanelOwner(routingRef, member) ?? member : routingRef} />}
            detail={<div>Chat detail</div>}
            railGit={group
                ? <GroupRailGit selectionId={routingRef} routingRef={routingRef} client={client} scopeLabel="Group" members={[
                    { workspaceId: 'repo-first', name: 'First', stale: false, readOnly: false },
                    { workspaceId: 'repo-member', name: 'Member', stale: false, readOnly: false },
                ]} />
                : <RepoRailGit workspaceId={scope} routingRef={routingRef} client={client} scopeLabel="Repo" />} />
        <div data-testid="right-panel" data-open={String(panel.detailOpen)}>
            {panel.detailOpen && <UnifiedGitTab scopeWorkspaceId={scope} />}
        </div>
        <output data-testid="route-state">{JSON.stringify({
            scope: state.gitRouteScope, hash: state.selectedGitCommitHash, tab: state.activeRepoSubTab,
            remembered: state.repoRouteState[routingRef],
        })}</output>
    </>;
}

beforeEach(() => {
    localStorage.clear();
    getCommit.mockClear();
    listCommits.mockClear();
    window.history.replaceState(null, '', '#repos/repo-preview/activity');
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    Element.prototype.scrollIntoView = vi.fn();
    const fake = {
        options: { baseUrl: 'https://example.invalid' },
        workspaces: {
            gitInfo: vi.fn(async () => info),
            gitInfoBatch: vi.fn(async () => ({ results: {
                'repo-first': { ...info, ahead: 0 }, 'repo-member': info,
            } })),
        },
        git: { listCommits, getCommit, getWorkingTreeChanges: vi.fn(async () => ({
            changes: [], repoState: { operation: 'none', conflictFiles: [] },
        })) },
    };
    client = fake as typeof fake & CocClient;
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('Sync preview detail-only navigation', () => {
    it.each([
        { group: false, remote: false }, { group: false, remote: true },
        { group: true, remote: false }, { group: true, remote: true },
    ].flatMap(owner => [false, true].map(peekOpen => ({ ...owner, peekOpen }))))(
        'keeps paged commit selection and collapsed sidebar for owner %j', async ({ group, remote, peekOpen }) => {
        const scope = group ? 'group-preview' : 'repo-preview';
        const routingRef = remote ? `remote:owner:${scope}` : scope;
        const member = group ? 'repo-member' : scope;
        const page = group ? routingRef : scope;
        localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey(scope), '1');
        localStorage.setItem(splitWorkspaceGitCollapsedStorageKey(scope), '1');
        render(<AppProvider><Harness group={group} remote={remote} /></AppProvider>);
        const trigger = screen.getByTestId('split-workspace-left-git-sync');
        await waitFor(() => expect(trigger).toHaveTextContent(group ? '↕1' : '↑51'));
        act(() => trigger.focus());
        const more = await screen.findByRole('button', { name: /Load more outgoing commits/ });
        fireEvent.click(more);
        const row = await screen.findByRole('button', { name: `Open commit ${selected.shortHash}: ${selected.subject}` });
        const tabBefore = JSON.parse(screen.getByTestId('route-state').textContent!).tab;
        if (!remote) vi.useFakeTimers();
        act(() => row.focus());
        await act(async () => {
            if (remote) await new Promise(resolve => setTimeout(resolve, 1050));
            else await vi.advanceTimersByTimeAsync(1000);
        });
        expect(screen.getByTestId('tooltip-body')).toHaveTextContent(selected.body!);
        expect(getCommit).not.toHaveBeenCalled();
        // Schedule a full-sidebar peek AFTER the popup opened, plus popup timers.
        fireEvent.mouseMove(screen.getByTestId('split-workspace-left-rail'));
        if (peekOpen) {
            await act(async () => {
                if (remote) await new Promise(resolve => setTimeout(resolve, 1100));
                else await vi.advanceTimersByTimeAsync(1000);
            });
            expect(screen.getByTestId('split-workspace-left')).not.toHaveClass('hidden');
            fireEvent.mouseLeave(screen.getByTestId('split-workspace-left'));
        }
        fireEvent.pointerLeave(screen.getByTestId('rail-job-preview'));
        if (remote) {
            const user = userEvent.setup();
            act(() => row.focus());
            await user.keyboard(group ? ' ' : '{Enter}');
        } else {
            fireEvent.click(row);
        }
        const assertSelection = () => {
            expect(selection.view).toEqual({ type: 'commit', commit: selected });
            expect(selection.selectedCommit).toBe(selected);
            expect(selection.selectedHashes.has(selected.hash)).toBe(true);
            expect(screen.getByTestId('right-panel')).toHaveAttribute('data-open', 'true');
            expect(screen.getByTestId('unified-git-tab')).toContainElement(screen.getByTestId('commit-detail'));
            expect(screen.getByTestId('commit-detail')).toHaveTextContent(selected.body!);
            expect(screen.getByTestId('split-workspace-left')).toHaveClass('hidden');
            expect(screen.getByTestId('split-workspace-left-rail')).toBeInTheDocument();
            expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey(scope))).toBe('1');
            expect(localStorage.getItem(splitWorkspaceGitCollapsedStorageKey(scope))).toBe('1');
            expect(screen.queryByRole('dialog')).toBeNull();
            expect(screen.queryByTestId('commit-tooltip')).toBeNull();
            expect(getCommit).not.toHaveBeenCalled();
            expect(parseGitRoute(location.hash)).toEqual({
                routeWorkspaceId: routingRef, workspaceId: group ? member : routingRef,
                commitHash: selected.hash, filePath: null,
            });
            expect(JSON.parse(screen.getByTestId('route-state').textContent!)).toEqual({
                scope: { routeWorkspaceId: page, workspaceId: member, knownCommit: {
                    sourceSelectionId: remote ? `remote:owner:${member}` : member, commit: selected,
                } },
                hash: selected.hash, tab: tabBefore,
                remembered: group ? `/git/member/${member}/${selected.hash}` : `/git/${selected.hash}`,
            });
        };
        assertSelection();
        await act(async () => {
            if (remote) await new Promise(resolve => setTimeout(resolve, 1100));
            else await vi.advanceTimersByTimeAsync(2000);
        });
        assertSelection();
        // Ordinary expanded history still uses the existing selection path.
        fireEvent.click(screen.getByTestId('split-workspace-left-expand'));
        act(() => selection.selectCommit(commits[0]));
        expect(selection.selectedCommit).toBe(commits[0]);
        expect(screen.queryByTestId('split-workspace-left-rail')).toBeNull();
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey(scope))).toBe('0');
    });

    it('detail intent does not collapse an expanded sidebar or reveal a collapsed Git half', () => {
        function Action() {
            const rail = useContext(RailControlsContext);
            return <button onClick={() => rail?.onOpenGit?.('branch', 'detail')}>Open detail</button>;
        }
        localStorage.setItem(splitWorkspaceGitCollapsedStorageKey('repo-expanded'), '1');
        render(<SplitWorkspacePanel workspaceId="repo-expanded" chatList={<Action />} gitList={<div>History</div>} detail={null} />);
        fireEvent.click(screen.getByText('Open detail'));
        expect(screen.queryByTestId('split-workspace-left-rail')).toBeNull();
        expect(screen.getByTestId('split-workspace-left')).not.toHaveClass('hidden');
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('repo-expanded'))).toBeNull();
        expect(localStorage.getItem(splitWorkspaceGitCollapsedStorageKey('repo-expanded'))).toBe('1');
    });
});
