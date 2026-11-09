import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import {
    chatCommitPanelTarget,
    GIT_OPEN_RECENT_LIMIT,
    gitTabOpenOwners,
    gitTabOpenSource,
    gitTabOwnerClient,
    openPanelGitCommit,
    openPanelGitBranchChanges,
    openPanelGitMember,
    openPanelGitWorkingChanges,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/panelGitCommit';
import { getCocClientFor, getSpaCocClient } from '../../../../src/server/spa/client/react/api/cocClient';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import {
    clearUnifiedPanelState,
    readUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';

const SHA = '713723222abcdef0123456789abcdef012345678';

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
});

describe('chatCommitPanelTarget', () => {
    it('targets a local repo panel with its own chat', () => {
        expect(chatCommitPanelTarget({ workspaceId: 'ws-a', chatId: 'c1', routingRef: null }, 'ws-a')).toEqual({
            routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'ws-a',
        });
    });

    it('keeps a remote repo owner qualified by its clone key', () => {
        expect(chatCommitPanelTarget({ workspaceId: 'ws-a', chatId: 'c1', routingRef: 'remote:srv:ws-a' }, 'ws-a')).toEqual({
            routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'remote:srv:ws-a',
        });
    });

    it('routes a local group member chat to that member under the group page', () => {
        expect(chatCommitPanelTarget({ workspaceId: 'group-g1', chatId: 'c1', routingRef: null }, 'member-1')).toEqual({
            routeWorkspaceId: 'group-g1', workspaceId: 'member-1', sourceSelectionId: 'member-1',
        });
    });

    it('routes a remote group member through the group server', () => {
        expect(chatCommitPanelTarget({ workspaceId: 'group-g1', chatId: 'c1', routingRef: 'remote:srv:group-g1' }, 'member-1')).toEqual({
            routeWorkspaceId: 'remote:srv:group-g1', workspaceId: 'member-1', sourceSelectionId: 'remote:srv:member-1',
        });
    });

    it('does not guess a repo for group-level chats, other repos or unknown owners', () => {
        expect(chatCommitPanelTarget({ workspaceId: 'group-g1', chatId: 'c1', routingRef: null }, 'group-g1')).toBeNull();
        expect(chatCommitPanelTarget({ workspaceId: 'ws-a', chatId: 'c1', routingRef: null }, 'ws-b')).toBeNull();
        expect(chatCommitPanelTarget({ workspaceId: 'ws-a', chatId: 'c1', routingRef: null }, undefined)).toBeNull();
    });
});

describe('openPanelGitCommit', () => {
    it('opens the exact commit on the panel\'s coc://git page, not a hash navigation', () => {
        const dispatch = vi.fn();
        const originalHash = location.hash;
        window.history.replaceState(null, '', '#repos/ws-a/chats/c1');
        try {
            openPanelGitCommit(dispatch, { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'remote:srv:ws-a' }, SHA);
            expect(location.hash).toBe('#repos/ws-a/chats/c1');
            expect(dispatch).not.toHaveBeenCalled();
            const state = readUnifiedPanelState('ws-a');
            expect(state.workspaceTabs).toEqual([expect.objectContaining({
                kind: 'browser', browserUrl: `coc://git/${SHA}`, resourceId: 'coc-git', label: 'Git',
            })]);
        } finally {
            window.history.replaceState(null, '', originalHash || '#');
        }
    });

    it('names the group member in the group\'s Git page address', () => {
        const dispatch = vi.fn();
        openPanelGitCommit(dispatch, { routeWorkspaceId: 'group-g1', workspaceId: 'member-1', sourceSelectionId: 'member-1' }, SHA);
        const state = readUnifiedPanelState('group-g1');
        expect(state.workspaceTabs).toEqual([expect.objectContaining({
            browserUrl: `coc://git/member/member-1/${SHA}`,
        })]);
    });
});

describe('openPanelGitMember', () => {
    it('opens the member\'s plain history, with no view in the address', () => {
        const dispatch = vi.fn();
        openPanelGitMember(dispatch, { routeWorkspaceId: 'group-g1', workspaceId: 'member-1', sourceSelectionId: 'member-1' });
        const state = readUnifiedPanelState('group-g1');
        expect(state.workspaceTabs).toEqual([expect.objectContaining({ browserUrl: 'coc://git/member/member-1' })]);
    });

    it('replaces an existing member\'s view when switching members', () => {
        const dispatch = vi.fn();
        openPanelGitCommit(dispatch, { routeWorkspaceId: 'group-g1', workspaceId: 'member-1', sourceSelectionId: 'member-1' }, SHA);
        openPanelGitMember(dispatch, { routeWorkspaceId: 'group-g1', workspaceId: 'member-2', sourceSelectionId: 'member-2' });
        const state = readUnifiedPanelState('group-g1');
        expect(state.workspaceTabs).toEqual([expect.objectContaining({ browserUrl: 'coc://git/member/member-2' })]);
    });
});

describe('openPanelGitWorkingChanges', () => {
    it.each([
        { owner: 'local repo', target: { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'ws-a' },
            workspaceId: 'ws-a', routingRef: null, url: 'coc://git/working-changes' },
        { owner: 'remote repo', target: { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'remote:srv:ws-a' },
            workspaceId: 'ws-a', routingRef: 'remote:srv:ws-a', url: 'coc://git/working-changes' },
        { owner: 'remote group member', target: { routeWorkspaceId: 'remote:srv:group-g1', workspaceId: 'member-1', sourceSelectionId: 'remote:srv:member-1' },
            workspaceId: 'group-g1', routingRef: 'remote:srv:group-g1', url: 'coc://git/member/member-1/working-changes' },
    ])('opens the $owner working changes on the panel\'s Git page, reusing the same tab on reopen', ({ target, workspaceId, routingRef, url }) => {
        const dispatch = vi.fn();
        openPanelGitWorkingChanges(dispatch, target);
        openPanelGitWorkingChanges(dispatch, target);
        const state = readUnifiedPanelState(workspaceId);
        expect(state.workspaceTabs).toHaveLength(1);
        expect(state.workspaceTabs[0].browserUrl).toBe(url);
        // A remote owner's clone key is the tab's routing ref, never its panel scope.
        expect(state.workspaceTabs[0].ownerRoutingRef ?? null).toBe(routingRef);
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('openPanelGitBranchChanges', () => {
    it('opens the branch range on the panel\'s Git page and keeps reusing that one tab', () => {
        const dispatch = vi.fn();
        const target = { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'ws-a' };
        openPanelGitBranchChanges(dispatch, target);
        openPanelGitBranchChanges(dispatch, target);
        const state = readUnifiedPanelState('ws-a');
        expect(state.workspaceTabs).toEqual([expect.objectContaining({ browserUrl: 'coc://git/branch-range' })]);
        expect(dispatch).not.toHaveBeenCalled();
    });
});

describe('Git tab Open owners', () => {
    const members = [{ workspaceId: 'member-1', label: 'One' }, { workspaceId: 'member-2', label: 'Two' }];

    it('targets a repo tab at its own repo and server', () => {
        expect(gitTabOpenOwners({ ownerWorkspaceId: 'ws-a', ownerRoutingRef: 'remote:srv:ws-a', browserUrl: 'coc://git' }, members)).toEqual({
            owner: {
                workspaceId: 'ws-a', label: 'ws-a',
                target: { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'remote:srv:ws-a' },
            },
            choices: [],
        });
    });

    it('targets a group tab at the member its own address names, through the group server', () => {
        expect(gitTabOpenOwners(
            { ownerWorkspaceId: 'group-g1', ownerRoutingRef: 'remote:srv:group-g1', browserUrl: 'coc://git/member/member-2' },
            members,
        ).owner).toEqual({
            workspaceId: 'member-2', label: 'Two',
            target: { routeWorkspaceId: 'remote:srv:group-g1', workspaceId: 'member-2', sourceSelectionId: 'remote:srv:member-2' },
        });
    });

    it('never guesses a member for a group tab without one, even with a single member', () => {
        const owners = gitTabOpenOwners({ ownerWorkspaceId: 'group-g1', ownerRoutingRef: null, browserUrl: 'coc://git' }, members.slice(0, 1));
        expect(owners.owner).toBeNull();
        expect(owners.choices).toEqual([{
            workspaceId: 'member-1', label: 'One',
            target: { routeWorkspaceId: 'group-g1', workspaceId: 'member-1', sourceSelectionId: 'member-1' },
        }]);
    });
});

describe('gitTabOwnerClient', () => {
    afterEach(() => resetCloneRegistryForTests());

    it('reads an explicit local owner from the page origin', () => {
        expect(gitTabOwnerClient({ ownerWorkspaceId: 'ws-a', ownerRoutingRef: null }, null)).toBe(getSpaCocClient());
    });

    it('reads a registered remote owner from its own server', () => {
        registerCloneBaseUrls([{ workspaceId: 'ws-a', baseUrl: 'http://127.0.0.1:7101', cloneKey: 'remote:srv:ws-a' }]);
        const client = gitTabOwnerClient({ ownerWorkspaceId: 'ws-a', ownerRoutingRef: 'remote:srv:ws-a' }, null);
        expect(client).toBe(getCocClientFor('http://127.0.0.1:7101'));
        expect(client).not.toBe(getSpaCocClient());
    });

    it('returns null, not the page origin, for an unconnected remote owner', () => {
        expect(gitTabOwnerClient({ ownerWorkspaceId: 'ws-a', ownerRoutingRef: 'remote:srv:ws-a' }, null)).toBeNull();
    });

    it('reads a remote group through the group server and honours a matching workspace owner', () => {
        const group = { ownerWorkspaceId: 'group-g1', ownerRoutingRef: 'remote:srv:group-g1' };
        expect(gitTabOwnerClient(group, null, 'http://127.0.0.1:7102')).toBe(getCocClientFor('http://127.0.0.1:7102'));
        const ownerClient = {} as CocClient;
        expect(gitTabOwnerClient(group, { workspaceId: 'group-g1', selectionId: 'remote:srv:group-g1', client: ownerClient }))
            .toBe(ownerClient);
        // An owner context for another workspace is not this tab's owner.
        expect(gitTabOwnerClient(group, { workspaceId: 'ws-z', selectionId: 'ws-z', client: ownerClient })).toBeNull();
    });
});

describe('gitTabOpenSource', () => {
    const tab = { ownerWorkspaceId: 'group-g1', ownerRoutingRef: 'remote:srv:group-g1', browserUrl: 'coc://git/member/member-1' };

    it('reads the owner member recent commits from the given client', async () => {
        const commits = Array.from({ length: 7 }, (_, index) => ({ hash: `h${index}` }));
        const listCommits = vi.fn(async () => ({ commits, unpushedCount: 0 }));
        const source = gitTabOpenSource(tab, [], vi.fn(), { git: { listCommits } } as unknown as CocClient);
        expect(source.unavailable).toBeUndefined();
        const recent = await source.loadRecent(source.owner!);
        expect(listCommits).toHaveBeenCalledWith('member-1', { limit: GIT_OPEN_RECENT_LIMIT, refresh: true });
        expect(recent).toHaveLength(GIT_OPEN_RECENT_LIMIT);
    });

    it('reports an unconnected owner instead of reading elsewhere', async () => {
        const source = gitTabOpenSource(tab, [], vi.fn(), null);
        expect(source.unavailable).toMatch(/not connected/);
        await expect(source.loadRecent(source.owner!)).rejects.toThrow(/not connected/);
    });

    it('opens the working tree or a commit on the member\'s Git page without a dispatch', () => {
        const dispatch = vi.fn();
        const source = gitTabOpenSource(tab, [], dispatch, null);
        source.open(source.owner!, null);
        expect(readUnifiedPanelState('group-g1').workspaceTabs).toEqual([expect.objectContaining({
            ownerWorkspaceId: 'group-g1',
            ownerRoutingRef: 'remote:srv:group-g1',
            browserUrl: 'coc://git/member/member-1/working-changes',
        })]);
        expect(readUnifiedPanelState('remote:srv:group-g1').workspaceTabs).toEqual([]);
        const commit = { hash: SHA, shortHash: SHA.slice(0, 7), subject: 's', author: 'a', date: '', parentHashes: [] };
        source.open(source.owner!, commit);
        expect(readUnifiedPanelState('group-g1').workspaceTabs).toEqual([expect.objectContaining({
            browserUrl: `coc://git/member/member-1/${SHA}`,
        })]);
        expect(dispatch).not.toHaveBeenCalled();
    });
});
