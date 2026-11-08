// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import type { ComponentProps } from 'react';
import { RepoGroupGitTab } from '../../../../src/server/spa/client/react/repos/RepoGroupGitTab';
import { UnifiedGitTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedGitTab';
import { useGitPageTabAddress } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useSplitGitPanel';
import { openPanelGitCommit, openPanelGitMember } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/panelGitCommit';
import { clearUnifiedPanelState, readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { updateUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { closeTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import type { RepoGitTab } from '../../../../src/server/spa/client/react/features/git/RepoGitTab';

const group = 'group-example';
const dispatch = vi.fn();
let appState: { repoGroupGitMemberState: Record<string, string> };
let lastGitProps: ComponentProps<typeof RepoGitTab> | null = null;

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useAppOptional: () => ({ state: appState, dispatch }),
}));
vi.mock('../../../../src/server/spa/client/react/repos/useRepoGroupMemberGitInfo', () => ({
    useRepoGroupMemberGitInfo: () => ({}),
}));
vi.mock('../../../../src/server/spa/client/react/repos/RepoGroupGitMemberPicker', () => ({
    RepoGroupGitMemberPicker: () => <select data-testid="member-picker" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/git/RepoGitTab', () => ({
    RepoGitTab: (props: ComponentProps<typeof RepoGitTab>) => {
        lastGitProps = props;
        return <div data-testid="member-git" data-member={props.workspaceId}>
            <button onClick={() => props.onViewChange?.({
                type: 'commit',
                commit: {
                    hash: 'abc1234', shortHash: 'abc1234', subject: 'Example',
                    author: 'Test', date: '2026-01-01', parentHashes: [],
                },
            })}>commit</button>
            {props.detailContainer && props.detailActive && createPortal(
                <span data-testid="member-detail">{props.workspaceId}</span>, props.detailContainer,
            )}
        </div>;
    },
}));

const members = [
    { workspaceId: 'repo-a', name: 'A', rootPath: 'repo-a', stale: false },
    { workspaceId: 'repo-b', name: 'B', rootPath: 'repo-b', stale: false },
];

function GroupPanel({ availableMembers = members }: { availableMembers?: typeof members }) {
    return <>
        <RepoGroupGitTab workspaceId={group} members={availableMembers} layout="split-workspace"
            rightPanel={{ chatId: null, ownerRoutingRef: null }} />
        <div data-testid="middle-detail" />
        <GitTabSurface />
    </>;
}

/** The panel's `coc://git` page body, mounted while the page tab exists. */
function GitTabSurface() {
    return useGitPageTabAddress(group, null) ? <UnifiedGitTab scopeWorkspaceId={group} /> : null;
}

/** The group's one `coc://git` page tab. */
function gitPage() {
    return readUnifiedPanelState(group).workspaceTabs.find(tab => tab.resourceId === 'coc-git');
}

/** A group member as `panelGitCommit` openers name it. */
function memberTarget(workspaceId: string) {
    return { routeWorkspaceId: group, workspaceId, sourceSelectionId: workspaceId };
}

beforeEach(() => {
    cleanup();
    localStorage.clear();
    dispatch.mockReset();
    lastGitProps = null;
    clearUnifiedPanelState();
    appState = { repoGroupGitMemberState: {} };
});

describe('repo group desktop Git panel', () => {
    it('opens an explicit member commit address in the far-right panel', () => {
        openPanelGitCommit(dispatch, memberTarget('repo-b'), 'fed9876');
        render(<GroupPanel />);
        expect(gitPage()?.browserUrl).toBe('coc://git/member/repo-b/fed9876');
        expect(screen.getByTestId('member-git').getAttribute('data-member')).toBe('repo-b');
        expect(lastGitProps?.restoreView).toEqual({ type: 'commit', hash: 'fed9876' });
        expect(lastGitProps?.detailOpen).toBe(true);
        expect(screen.getByTestId('unified-git-tab').textContent).toBe('repo-b');
        expect(screen.getByTestId('middle-detail').textContent).toBe('');
    });

    it('portals a member commit to the far-right tab, not the conversation detail, and restores it on remount', () => {
        const view = render(<GroupPanel />);
        expect(gitPage()).toBeUndefined();
        fireEvent.click(screen.getByText('commit'));
        expect(gitPage()).toMatchObject({ chatId: null, browserUrl: 'coc://git/member/repo-a/abc1234' });
        expect(screen.getByTestId('unified-git-tab').textContent).toBe('repo-a');
        expect(screen.getByTestId('middle-detail').textContent).toBe('');
        view.unmount();
        render(<GroupPanel />);
        expect(lastGitProps?.restoreView).toEqual({ type: 'commit', hash: 'abc1234' });
        expect(lastGitProps?.detailOpen).toBe(true);
    });

    it('drops the old member view on member changes and never restores it against a new member', () => {
        render(<GroupPanel />);
        fireEvent.click(screen.getByText('commit'));
        act(() => openPanelGitMember(dispatch, memberTarget('repo-b')));
        expect(screen.getByTestId('member-git').getAttribute('data-member')).toBe('repo-b');
        expect(lastGitProps?.restoreView).toBeUndefined();
        expect(gitPage()?.browserUrl).toBe('coc://git/member/repo-b');
        fireEvent.click(screen.getByText('commit'));
        expect(gitPage()?.browserUrl).toBe('coc://git/member/repo-b/abc1234');
    });

    it('does not mount another member for an unavailable member address', () => {
        render(<GroupPanel />);
        fireEvent.click(screen.getByText('commit'));
        act(() => openPanelGitMember(dispatch, memberTarget('missing-repo')));
        expect(screen.queryByTestId('member-git')).toBeNull();
        expect(screen.getByTestId('repo-group-git-unavailable-member')).toBeTruthy();
        expect(screen.queryByTestId('member-detail')).toBeNull();
    });

    it('clears selection when the right-panel Git tab is closed', () => {
        render(<GroupPanel />);
        fireEvent.click(screen.getByText('commit'));
        const tab = gitPage()!;
        act(() => updateUnifiedPanelState(group, state => closeTab(state, tab.id)));
        expect(lastGitProps?.detailOpen).toBe(false);
        fireEvent.click(screen.getByText('commit'));
        expect(readUnifiedPanelState(group).workspaceTabs.filter(item => item.resourceId === 'coc-git')).toHaveLength(1);
    });
});

it.each(['group-example', 'remote:one:group-example', 'remote:two:group-example'])('derives a member selection destination from group owner %s', selectionId => {
    const view = render(<RepoGroupGitTab workspaceId={group} selectionId={selectionId} members={members} layout="split-workspace" />);
    const server = selectionId.startsWith('remote:') ? selectionId.split(':')[1] : null;
    expect(lastGitProps?.sourceSelectionId).toBe(server ? `remote:${server}:repo-a` : 'repo-a');
    expect(lastGitProps?.workspaceId).toBe('repo-a');
    view.rerender(<RepoGroupGitTab workspaceId={group} selectionId="remote:next:group-example" members={members} layout="split-workspace" />);
    expect(lastGitProps?.sourceSelectionId).toBe('remote:next:repo-a');
});
