// @vitest-environment jsdom
/**
 * RepoGroupGitTab — the group owns the page, a member owns the git data.
 *
 * The member a group shows is named by the workspace's one `coc://git` page
 * tab (`coc://git/member/<id>/…`), with the remembered per-group pick as the
 * fallback when no page names one. These tests drive the host through the
 * real panel store, with the Git panel's presentation stubbed, so member
 * precedence, in-place canonicalization and the unavailable-member behaviour
 * are exercised end to end — and the hash is never touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { buildRemoteCloneKey } from '../../../src/server/spa/client/react/repos/cloneIdentity';

const panelProps: Record<string, unknown>[] = [];
vi.mock('../../../src/server/spa/client/react/features/git/RepoGitTab', () => ({
    RepoGitTab: (props: { workspaceId: string; sourceSelectionId?: string; repositorySelector?: ReactNode }) => {
        panelProps.push(props);
        return (
            <div data-testid="stub-repo-git-tab" data-workspace={props.workspaceId} data-source={props.sourceSelectionId ?? ''}>
                {props.repositorySelector}
            </div>
        );
    },
}));

vi.mock('../../../src/server/spa/client/react/repos/repositoryService', () => ({
    getWorkspaceGitInfoBatch: vi.fn().mockResolvedValue({ results: {} }),
    getWorkspaceGitInfo: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: () => ({ status: 'open' }),
}));

// AppProvider talks to the preferences API on mount; nothing here cares.
vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: vi.fn().mockResolvedValue({}),
            patchGlobal: vi.fn().mockResolvedValue({}),
            getRepo: vi.fn().mockResolvedValue({}),
            patchRepo: vi.fn().mockResolvedValue({}),
        },
    }),
}));

import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { RepoGroupGitTab } from '../../../src/server/spa/client/react/repos/RepoGroupGitTab';
import type { RepoGroupMember } from '../../../src/server/spa/client/react/repos/repoGroupService';
import { gitPageInput } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import { clearUnifiedPanelState, readUnifiedPanelState, writeUnifiedPanelState } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { EMPTY_UNIFIED_PANEL, activeTabId, openTab } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import type { PersistedGitView } from '../../../src/server/spa/client/react/features/git/repoGitTab/types';

const GROUP = 'group-frontend';
const OTHER_GROUP = 'group-backend';
const MEMBER_STATE_KEY = 'coc-repo-group-git-member-state';

function member(id: string, overrides: Partial<RepoGroupMember> = {}): RepoGroupMember {
    return { workspaceId: id, name: id, rootPath: `/r/${id}`, ...overrides } as RepoGroupMember;
}

/** Put the group's `coc://git` page tab at an address, as an earlier open would have. */
function openGitPage(address: { gitMemberId?: string; view?: PersistedGitView }, groupId = GROUP, ownerRoutingRef: string | null = null) {
    writeUnifiedPanelState(groupId, openTab(readUnifiedPanelState(groupId),
        gitPageInput({ ownerWorkspaceId: groupId, ownerRoutingRef, chatId: null }, address)));
}

function gitPageUrl(groupId = GROUP): string | undefined {
    return readUnifiedPanelState(groupId).workspaceTabs.find(tab => tab.resourceId === 'coc-git')?.browserUrl;
}

function tree(groupId: string, members: readonly RepoGroupMember[] | undefined, selectionId = groupId, ownerRoutingRef: string | null = null) {
    return (
        <AppProvider>
            <RepoGroupGitTab workspaceId={groupId} selectionId={selectionId} members={members}
                layout="split-workspace" rightPanel={{ chatId: null, ownerRoutingRef }} />
        </AppProvider>
    );
}

function mountedMember(): string | null {
    return screen.queryByTestId('stub-repo-git-tab')?.getAttribute('data-workspace') ?? null;
}

function pickMember(id: string) {
    fireEvent.click(screen.getByTestId('repo-group-git-member-trigger'));
    fireEvent.click(screen.getByTestId(`repo-group-git-member-${id}`));
}

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
    panelProps.length = 0;
    location.hash = '';
});
afterEach(() => cleanup());

describe('the group owns the page, the member owns the data', () => {
    it('mounts the member the page names, routed on the group server for a remote group', async () => {
        const remoteGroup = buildRemoteCloneKey('box-b', GROUP);
        openGitPage({ gitMemberId: 'repo-b' }, GROUP, remoteGroup);
        render(tree(GROUP, [member('repo-a'), member('repo-b')], remoteGroup, remoteGroup));
        await act(async () => {});

        expect(mountedMember()).toBe('repo-b');
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-source')).toBe(buildRemoteCloneKey('box-b', 'repo-b'));
        expect(location.hash).toBe('');
    });

    it('never opens, focuses or reveals a Git page just because the group is shown', async () => {
        render(tree(GROUP, [member('repo-a'), member('repo-b')]));
        await act(async () => {});

        expect(mountedMember()).toBe('repo-a');
        expect(readUnifiedPanelState(GROUP).workspaceTabs).toEqual([]);
        expect(location.hash).toBe('');
    });
});

describe('member resolution', () => {
    it('lets the page member win over a conflicting remembered preference', async () => {
        render(tree(GROUP, [member('repo-a'), member('repo-b'), member('repo-c')]));
        await act(async () => {});
        pickMember('repo-c');
        await act(async () => {});
        expect(JSON.parse(localStorage.getItem(MEMBER_STATE_KEY) ?? '{}')[GROUP]).toBe('repo-c');

        act(() => openGitPage({ gitMemberId: 'repo-b' }));
        await act(async () => {});

        expect(mountedMember()).toBe('repo-b');
        // …and the validated choice becomes the new preference.
        expect(JSON.parse(localStorage.getItem(MEMBER_STATE_KEY) ?? '{}')[GROUP]).toBe('repo-b');
    });

    it('canonicalizes an open member-less page to the remembered member in place', async () => {
        render(tree(GROUP, [member('repo-a'), member('repo-b')]));
        await act(async () => {});
        pickMember('repo-b');
        await act(async () => {});

        act(() => writeUnifiedPanelState(GROUP, openTab(openTab(EMPTY_UNIFIED_PANEL,
            gitPageInput({ ownerWorkspaceId: GROUP, ownerRoutingRef: null, chatId: null })),
            { kind: 'terminal', ownerWorkspaceId: GROUP, chatId: null, resourceId: 's1', label: 'bash' })));
        const activeBefore = activeTabId(readUnifiedPanelState(GROUP), null);
        await act(async () => {});

        expect(gitPageUrl()).toBe('coc://git/member/repo-b');
        expect(mountedMember()).toBe('repo-b');
        // In place: the other tab keeps focus.
        expect(activeTabId(readUnifiedPanelState(GROUP), null)).toBe(activeBefore);
    });

    it('waits for membership before selecting, canonicalizing or persisting', async () => {
        openGitPage({});
        const { rerender } = render(tree(GROUP, undefined));
        await act(async () => {});

        expect(screen.getByTestId('repo-group-git-loading')).toBeTruthy();
        expect(gitPageUrl()).toBe('coc://git');
        expect(localStorage.getItem(MEMBER_STATE_KEY)).toBeNull();

        rerender(tree(GROUP, [member('repo-a')]));
        await act(async () => {});
        expect(gitPageUrl()).toBe('coc://git/member/repo-a');
    });
});

describe('changing member', () => {
    it('points the page at the new member’s history and drops the old view', async () => {
        openGitPage({ gitMemberId: 'repo-a', view: { type: 'commit-file', hash: 'abc1234', filePath: 'src/a.ts' } });
        render(tree(GROUP, [member('repo-a'), member('repo-b')]));
        await act(async () => {});

        pickMember('repo-b');
        await act(async () => {});

        expect(gitPageUrl()).toBe('coc://git/member/repo-b');
        expect(mountedMember()).toBe('repo-b');
        expect(JSON.parse(localStorage.getItem(MEMBER_STATE_KEY) ?? '{}')[GROUP]).toBe('repo-b');
    });

    it('switches the remembered member when no Git page is open', async () => {
        render(tree(GROUP, [member('repo-a'), member('repo-b')]));
        await act(async () => {});

        pickMember('repo-b');
        await act(async () => {});

        expect(mountedMember()).toBe('repo-b');
        expect(readUnifiedPanelState(GROUP).workspaceTabs).toEqual([]);
    });

    it('is a no-op when the already selected member is chosen again', async () => {
        openGitPage({ gitMemberId: 'repo-a', view: { type: 'commit', hash: 'abc1234' } });
        render(tree(GROUP, [member('repo-a'), member('repo-b')]));
        await act(async () => {});

        pickMember('repo-a');
        await act(async () => {});

        expect(gitPageUrl()).toBe('coc://git/member/repo-a/abc1234');
    });
});

describe('an explicit member the group cannot show', () => {
    it('keeps the group open with a usable picker and mounts no git panel', async () => {
        openGitPage({ gitMemberId: 'repo-gone', view: { type: 'commit', hash: 'abc1234' } });
        render(tree(GROUP, [member('repo-a'), member('repo-b')]));
        await act(async () => {});

        expect(screen.getByTestId('repo-group-git-unavailable-member')).toBeTruthy();
        expect(screen.queryByTestId('stub-repo-git-tab')).toBeNull();
        // No git panel was mounted, so no request can target the wrong repo.
        expect(panelProps).toHaveLength(0);
    });

    it('does the same for a member that has gone stale', async () => {
        openGitPage({ gitMemberId: 'repo-b' });
        render(tree(GROUP, [member('repo-a'), member('repo-b', { stale: true, staleReason: 'path-missing' })]));
        await act(async () => {});

        expect(screen.getByTestId('repo-group-git-unavailable-member')).toBeTruthy();
        expect(screen.queryByTestId('stub-repo-git-tab')).toBeNull();
    });

    it('opens the picked repository’s history when the user recovers', async () => {
        openGitPage({ gitMemberId: 'repo-gone', view: { type: 'commit', hash: 'abc1234' } });
        render(tree(GROUP, [member('repo-a'), member('repo-b')]));
        await act(async () => {});

        pickMember('repo-a');
        await act(async () => {});

        expect(gitPageUrl()).toBe('coc://git/member/repo-a');
        expect(mountedMember()).toBe('repo-a');
    });

    it('keeps the ordinary empty state when the group has no healthy member', async () => {
        openGitPage({ gitMemberId: 'gone', view: { type: 'commit', hash: 'abc1234' } });
        render(tree(GROUP, [member('gone', { stale: true, staleReason: 'workspace-removed' })]));
        await act(async () => {});

        expect(screen.getByTestId('repo-group-git-empty')).toBeTruthy();
        expect(screen.queryByTestId('repo-group-git-unavailable-member')).toBeNull();
    });
});

describe('groups stay independent', () => {
    it('remembers a different member per group, sharing the same repos', async () => {
        const members = [member('repo-a'), member('repo-b')];
        const { rerender } = render(tree(GROUP, members));
        await act(async () => {});
        pickMember('repo-b');
        await act(async () => {});

        rerender(tree(OTHER_GROUP, members));
        await act(async () => {});
        expect(mountedMember()).toBe('repo-a');

        // Back to the first group with no page naming a member: its own pick returns.
        rerender(tree(GROUP, members));
        await act(async () => {});
        expect(mountedMember()).toBe('repo-b');
        expect(JSON.parse(localStorage.getItem(MEMBER_STATE_KEY) ?? '{}')).toEqual({
            [GROUP]: 'repo-b', [OTHER_GROUP]: 'repo-a',
        });
    });

    it('reads each group’s own Git page, never another group’s', async () => {
        const members = [member('repo-a'), member('repo-b')];
        openGitPage({ gitMemberId: 'repo-b' }, OTHER_GROUP);
        render(tree(GROUP, members));
        await act(async () => {});

        expect(mountedMember()).toBe('repo-a');
        expect(gitPageUrl(OTHER_GROUP)).toBe('coc://git/member/repo-b');
    });
});
