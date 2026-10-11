/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import {
    buildRepoGroupChatHash,
    parseActivityDeepLink,
    parseRepoGroupChatDeepLink,
} from '../../../../src/server/spa/client/react/layout/dashboardRoutes';
import { useRepoGroupChatSelection } from '../../../../src/server/spa/client/react/repos/useRepoGroupChatSelection';
import { buildRepoGroupChatFeedModel } from '../../../../src/server/spa/client/react/repos/repoGroupChatFeed';

afterEach(() => { cleanup(); location.hash = ''; });

function navigate(hash: string) {
    act(() => {
        location.hash = hash;
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
}

describe('group member chat route contract', () => {
    it.each(['group-ai', 'remote:server-a:group-ai'])('round trips group and concrete owner: %s', group => {
        const hash = buildRepoGroupChatHash(group, 'ws-member', 'queue_chat/with space');
        expect(parseRepoGroupChatDeepLink(hash + '?view=agents')).toEqual({
            groupSelectionId: group,
            ownerWorkspaceId: 'ws-member',
            ownerSelectionId: group.startsWith('remote:') ? 'remote:server-a:ws-member' : 'ws-member',
            processId: 'queue_chat/with space',
        });
        expect(parseActivityDeepLink(hash)).toBeNull();
    });

    it('encodes server ids independently of path segments', () => {
        const group = 'remote:server%3Aone:group-ai';
        const link = parseRepoGroupChatDeepLink(buildRepoGroupChatHash(group, 'ws-member', 'chat'));
        expect(link?.ownerSelectionId).toBe('remote:server%3Aone:ws-member');
    });

    it.each([
        '#repos/ws-a/chats/member/ws-b/chat',
        '#repos/group-ai/chats/member',
        '#repos/group-ai/chats/member/ws-b',
        '#repos/group-ai/chats/member//chat',
        '#repos/group-ai/chats/member/ws-b/chat/extra',
        '#repos/group-ai/chats/member/remote%3Aother%3Aws-b/chat',
    ])('rejects incomplete or non-group member links: %s', hash => {
        expect(parseRepoGroupChatDeepLink(hash)).toBeNull();
    });

    it('leaves ordinary chat links and a repo chat named member unchanged', () => {
        expect(parseActivityDeepLink('#repos/group-ai/chats/chat?view=agents')).toBe('chat');
        expect(parseActivityDeepLink('#repos/ws-a/chats/member')).toBe('member');
        expect(() => buildRepoGroupChatHash('ws-a', 'ws-b', 'chat')).toThrow();
        expect(() => buildRepoGroupChatHash('group-ai', 'remote:other:ws-b', 'chat')).toThrow();
    });
});

describe('URL-backed group chat selection', () => {
    it('restores the concrete owner before any feed page has loaded', () => {
        location.hash = buildRepoGroupChatHash('remote:server-a:group-ai', 'ws-member', 'queue_chat');
        const { result } = renderHook(() => useRepoGroupChatSelection('remote:server-a:group-ai', true));
        expect(result.current.selectedKey).toBe('server-a|ws-member|queue_chat');
        expect(result.current.selection?.ownerSelectionId).toBe('remote:server-a:ws-member');
    });

    it('selects the canonical process identity, not the queue representation id', () => {
        const model = buildRepoGroupChatFeedModel({
            groupId: 'group-ai', membershipKey: 'm1',
            sources: [{ workspaceId: 'ws-member', role: 'member', name: 'Member', available: true }],
            running: [{ id: 'task', processId: 'queue_original', ownerWorkspaceId: 'ws-member' }],
            queued: [], history: [], hasMore: false,
            counts: { total: 1, running: 1, queued: 0, history: 0, byOwner: {}, partial: false },
        }, 'local');
        const { result } = renderHook(() => useRepoGroupChatSelection('group-ai', true));
        act(() => result.current.selectMember(model.running[0]));
        expect(result.current.selectedKey).toBe('local|ws-member|queue_original');
        expect(location.hash).toBe('#repos/group-ai/chats/member/ws-member/queue_original');
    });

    it('back and forward restore distinct owners even when process ids collide', () => {
        const { result } = renderHook(() => useRepoGroupChatSelection('group-ai', true));
        navigate(buildRepoGroupChatHash('group-ai', 'ws-a', 'same'));
        expect(result.current.selectedKey).toBe('local|ws-a|same');
        navigate(buildRepoGroupChatHash('group-ai', 'ws-b', 'same'));
        expect(result.current.selectedKey).toBe('local|ws-b|same');
        navigate(buildRepoGroupChatHash('group-ai', 'ws-a', 'same'));
        expect(result.current.selectedKey).toBe('local|ws-a|same');
        navigate('#repos/group-ai/chats/group-owned');
        expect(result.current.selection).toBeNull();
    });

    it('returning to the list and New Chat retain the remote group scope', () => {
        const group = 'remote:server-a:group-ai';
        location.hash = buildRepoGroupChatHash(group, 'ws-a', 'chat');
        const { result } = renderHook(() => useRepoGroupChatSelection(group, true));
        act(() => result.current.backToGroupChats());
        expect(result.current.selection).toBeNull();
        expect(location.hash).toBe('#repos/remote%3Aserver-a%3Agroup-ai/chats');
    });

    it('does not reuse an owner from a different group server or when disabled', () => {
        const group = 'remote:server-a:group-ai';
        location.hash = buildRepoGroupChatHash(group, 'ws-a', 'chat');
        const { result, rerender } = renderHook(
            ({ scope, enabled }) => useRepoGroupChatSelection(scope, enabled),
            { initialProps: { scope: group, enabled: true } },
        );
        rerender({ scope: 'remote:server-b:group-ai', enabled: true });
        expect(result.current.selection).toBeNull();
        rerender({ scope: group, enabled: false });
        expect(result.current.selection).toBeNull();
    });
});
