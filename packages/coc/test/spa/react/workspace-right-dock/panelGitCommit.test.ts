import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    chatCommitPanelTarget,
    openPanelGitCommit,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/panelGitCommit';

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
