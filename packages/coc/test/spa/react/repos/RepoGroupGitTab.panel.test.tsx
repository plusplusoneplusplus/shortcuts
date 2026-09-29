// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { useEffect, type ComponentProps } from 'react';
import { RepoGroupGitTab } from '../../../../src/server/spa/client/react/repos/RepoGroupGitTab';
import { UnifiedGitTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedGitTab';
import { useUnifiedGitTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedGitTabHost';
import { readUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { updateUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { closeTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import type { RepoGitTab } from '../../../../src/server/spa/client/react/features/git/RepoGitTab';

const group = 'group-example';
const dispatch = vi.fn();
let appState: {
    gitRouteScope: { routeWorkspaceId: string; workspaceId: string } | null;
    selectedGitCommitHash: string | null;
    selectedGitFilePath: string | null;
    repoGroupGitMemberState: Record<string, string>;
};
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
        useEffect(() => {
            if (appState.gitRouteScope?.workspaceId === props.workspaceId && appState.selectedGitCommitHash) {
                props.onViewChange?.({
                    type: 'commit',
                    commit: {
                        hash: appState.selectedGitCommitHash, shortHash: appState.selectedGitCommitHash,
                        subject: 'Linked commit', author: 'Test', date: '2026-01-01', parentHashes: [],
                    },
                });
            }
        }, [props.workspaceId, props.onViewChange]);
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

function GitTabSurface() {
    const tab = useUnifiedGitTab(group, { ownerWorkspaceId: group, ownerRoutingRef: null });
    return tab ? <UnifiedGitTab scopeWorkspaceId={group} /> : null;
}

beforeEach(() => {
    cleanup();
    localStorage.clear();
    dispatch.mockReset();
    lastGitProps = null;
    appState = {
        gitRouteScope: { routeWorkspaceId: group, workspaceId: 'repo-a' },
        selectedGitCommitHash: null,
        selectedGitFilePath: null,
        repoGroupGitMemberState: {},
    };
});

describe('repo group desktop Git panel', () => {
    it('opens an explicit member commit deep link in the far-right panel', () => {
        appState.gitRouteScope = { routeWorkspaceId: group, workspaceId: 'repo-b' };
        appState.selectedGitCommitHash = 'fed9876';
        render(<GroupPanel />);
        expect(readUnifiedPanelState(group).workspaceTabs.find(item => item.kind === 'git'))
            .toMatchObject({ gitMemberId: 'repo-b', gitView: { type: 'commit', hash: 'fed9876' } });
        expect(screen.getByTestId('unified-git-tab').textContent).toBe('repo-b');
        expect(screen.getByTestId('middle-detail').textContent).toBe('');
    });

    it('portals a member commit to the far-right tab, not the conversation detail, and restores it on remount', () => {
        const view = render(<GroupPanel />);
        fireEvent.click(screen.getByText('commit'));
        const tab = readUnifiedPanelState(group).workspaceTabs.find(item => item.kind === 'git');
        expect(tab).toMatchObject({ gitMemberId: 'repo-a', gitView: { type: 'commit', hash: 'abc1234' } });
        expect(screen.getByTestId('unified-git-tab').textContent).toBe('repo-a');
        expect(screen.getByTestId('middle-detail').textContent).toBe('');
        view.unmount();
        render(<GroupPanel />);
        expect(lastGitProps?.restoreView).toEqual({ type: 'commit', hash: 'abc1234' });
        expect(lastGitProps?.detailOpen).toBe(true);
    });

    it('drops the old member view on route changes and never restores it against a new member', () => {
        const view = render(<GroupPanel />);
        fireEvent.click(screen.getByText('commit'));
        appState.gitRouteScope = { routeWorkspaceId: group, workspaceId: 'repo-b' };
        view.rerender(<GroupPanel />);
        expect(screen.getByTestId('member-git').getAttribute('data-member')).toBe('repo-b');
        expect(lastGitProps?.restoreView).toBeUndefined();
        expect(readUnifiedPanelState(group).workspaceTabs.filter(item => item.kind === 'git')).toHaveLength(0);
        expect(screen.queryByTestId('unified-git-tab')).toBeNull();
        fireEvent.click(screen.getByText('commit'));
        expect(readUnifiedPanelState(group).workspaceTabs.filter(item => item.kind === 'git'))
            .toEqual([expect.objectContaining({ gitMemberId: 'repo-b' })]);
    });

    it('does not mount another member for an unavailable deep link or keep its old Git tab', () => {
        const view = render(<GroupPanel />);
        fireEvent.click(screen.getByText('commit'));
        appState.gitRouteScope = { routeWorkspaceId: group, workspaceId: 'missing-repo' };
        view.rerender(<GroupPanel />);
        expect(screen.queryByTestId('member-git')).toBeNull();
        expect(screen.getByTestId('repo-group-git-unavailable-member')).toBeTruthy();
        expect(readUnifiedPanelState(group).workspaceTabs.filter(item => item.kind === 'git')).toHaveLength(0);
    });

    it('clears selection when the right-panel Git tab is closed', () => {
        render(<GroupPanel />);
        fireEvent.click(screen.getByText('commit'));
        const tab = readUnifiedPanelState(group).workspaceTabs.find(item => item.kind === 'git')!;
        act(() => updateUnifiedPanelState(group, state => closeTab(state, tab.id)));
        expect(lastGitProps?.detailOpen).toBe(false);
        fireEvent.click(screen.getByText('commit'));
        expect(readUnifiedPanelState(group).workspaceTabs.filter(item => item.kind === 'git')).toHaveLength(1);
    });
});
