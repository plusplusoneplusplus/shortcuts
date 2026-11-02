import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import {
    chatCommitPanelTarget,
    GIT_OPEN_RECENT_LIMIT,
    gitTabOpenOwners,
    gitTabOpenSource,
    gitTabOwnerClient,
    openPanelGitCommit,
    openPanelGitWorkingChanges,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/panelGitCommit';
import { getCocClientFor, getSpaCocClient } from '../../../../src/server/spa/client/react/api/cocClient';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const SHA = '713723222abcdef0123456789abcdef012345678';

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
    let originalHash: string;
    beforeEach(() => {
        originalHash = location.hash;
        window.history.replaceState(null, '', '#repos/ws-a/chats/c1');
    });
    afterEach(() => {
        window.history.replaceState(null, '', originalHash || '#');
    });

    it('publishes the exact commit in place without a hash navigation', () => {
        const dispatch = vi.fn();
        const onHashChange = vi.fn();
        window.addEventListener('hashchange', onHashChange);
        try {
            openPanelGitCommit(dispatch, { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'remote:srv:ws-a' }, SHA);
        } finally {
            window.removeEventListener('hashchange', onHashChange);
        }
        expect(location.hash).toBe(`#repos/${encodeURIComponent('remote:srv:ws-a')}/git/${SHA}`);
        expect(onHashChange).not.toHaveBeenCalled();
        // Only the route: no sub-tab switch or chat deselection.
        expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
            { type: 'RECORD_REPO_ROUTE_SUFFIX', repoId: 'remote:srv:ws-a', suffix: `/git/${SHA}` },
            { type: 'SET_GIT_ROUTE', routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', commitHash: SHA, filePath: null },
        ]);
    });

    it('names the group member in a group route', () => {
        const dispatch = vi.fn();
        openPanelGitCommit(dispatch, { routeWorkspaceId: 'group-g1', workspaceId: 'member-1', sourceSelectionId: 'member-1' }, SHA);
        expect(location.hash).toBe(`#repos/group-g1/git/member/member-1/${SHA}`);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_GIT_ROUTE', routeWorkspaceId: 'group-g1', workspaceId: 'member-1', commitHash: SHA, filePath: null,
        });
    });
});

describe('openPanelGitWorkingChanges', () => {
    let originalHash: string;
    beforeEach(() => {
        originalHash = location.hash;
        window.history.replaceState(null, '', '#repos/ws-a/chats/c1');
    });
    afterEach(() => {
        window.history.replaceState(null, '', originalHash || '#');
    });

    it.each([
        { owner: 'local repo', target: { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'ws-a' },
            hash: '#repos/ws-a/git/working-changes', repoId: 'ws-a', suffix: '/git/working-changes' },
        { owner: 'remote repo', target: { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'remote:srv:ws-a' },
            hash: `#repos/${encodeURIComponent('remote:srv:ws-a')}/git/working-changes`, repoId: 'remote:srv:ws-a', suffix: '/git/working-changes' },
        { owner: 'remote group member', target: { routeWorkspaceId: 'remote:srv:group-g1', workspaceId: 'member-1', sourceSelectionId: 'remote:srv:member-1' },
            hash: `#repos/${encodeURIComponent('remote:srv:group-g1')}/git/member/member-1/working-changes`, repoId: 'remote:srv:group-g1', suffix: '/git/member/member-1/working-changes' },
    ])('publishes the $owner working changes in place with a fresh open request', ({ target, hash, repoId, suffix }) => {
        const dispatch = vi.fn();
        const onHashChange = vi.fn();
        window.addEventListener('hashchange', onHashChange);
        try {
            openPanelGitWorkingChanges(dispatch, target);
            openPanelGitWorkingChanges(dispatch, target);
        } finally {
            window.removeEventListener('hashchange', onHashChange);
        }
        expect(location.hash).toBe(hash);
        expect(onHashChange).not.toHaveBeenCalled();
        const actions = dispatch.mock.calls.map(([action]) => action);
        expect(actions[0]).toEqual({ type: 'RECORD_REPO_ROUTE_SUFFIX', repoId, suffix });
        expect(actions[1]).toEqual({
            type: 'SET_GIT_ROUTE', routeWorkspaceId: target.routeWorkspaceId, workspaceId: target.workspaceId,
            commitHash: 'working-changes', filePath: null, openRequest: {},
        });
        // Each open is its own request, so an unchanged route still reapplies.
        expect(actions[3].openRequest).not.toBe(actions[1].openRequest);
    });
});

describe('Git tab Open owners', () => {
    const members = [{ workspaceId: 'member-1', label: 'One' }, { workspaceId: 'member-2', label: 'Two' }];

    it('targets a repo tab at its own repo and server', () => {
        expect(gitTabOpenOwners({ ownerWorkspaceId: 'ws-a', ownerRoutingRef: 'remote:srv:ws-a' }, members)).toEqual({
            owner: {
                workspaceId: 'ws-a', label: 'ws-a',
                target: { routeWorkspaceId: 'ws-a', workspaceId: 'ws-a', sourceSelectionId: 'remote:srv:ws-a' },
            },
            choices: [],
        });
    });

    it('targets a group tab at its named member through the group server', () => {
        expect(gitTabOpenOwners(
            { ownerWorkspaceId: 'group-g1', ownerRoutingRef: 'remote:srv:group-g1', gitMemberId: 'member-2' }, members,
        ).owner).toEqual({
            workspaceId: 'member-2', label: 'Two',
            target: { routeWorkspaceId: 'remote:srv:group-g1', workspaceId: 'member-2', sourceSelectionId: 'remote:srv:member-2' },
        });
    });

    it('never guesses a member for a group tab without one, even with a single member', () => {
        const owners = gitTabOpenOwners({ ownerWorkspaceId: 'group-g1', ownerRoutingRef: null }, members.slice(0, 1));
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
    let originalHash: string;
    beforeEach(() => {
        originalHash = location.hash;
        window.history.replaceState(null, '', '#repos/group-g1/chats/c1');
    });
    afterEach(() => {
        window.history.replaceState(null, '', originalHash || '#');
    });

    const tab = { ownerWorkspaceId: 'group-g1', ownerRoutingRef: 'remote:srv:group-g1', gitMemberId: 'member-1' };

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

    it('opens the working tree or a commit on the member route without switching surfaces', () => {
        const dispatch = vi.fn();
        const source = gitTabOpenSource(tab, [], dispatch, null);
        source.open(source.owner!, null);
        expect(dispatch).toHaveBeenCalledWith({
            type: 'SET_GIT_ROUTE', routeWorkspaceId: 'remote:srv:group-g1', workspaceId: 'member-1',
            commitHash: 'working-changes', filePath: null, openRequest: {},
        });
        const commit = { hash: SHA, shortHash: SHA.slice(0, 7), subject: 's', author: 'a', date: '', parentHashes: [] };
        source.open(source.owner!, commit);
        expect(dispatch).toHaveBeenLastCalledWith({
            type: 'SET_GIT_ROUTE', routeWorkspaceId: 'remote:srv:group-g1', workspaceId: 'member-1',
            commitHash: SHA, filePath: null, knownCommit: { sourceSelectionId: 'remote:srv:member-1', commit },
        });
        expect(dispatch.mock.calls.map(([action]) => action.type)).not.toContain('SET_REPO_SUB_TAB');
    });
});
