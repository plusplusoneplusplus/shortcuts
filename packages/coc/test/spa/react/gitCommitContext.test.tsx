import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { buildRemoteCloneKey } from '../../../src/server/spa/client/react/repos/cloneIdentity';
import { registerCloneBaseUrls, resetCloneRegistryForTests } from '../../../src/server/spa/client/react/repos/cloneRegistry';
import { WorkspaceOwnerContext } from '../../../src/server/spa/client/react/repos/workspaceOwnerContext';
import { gitCommitContextKey, useCommitContextOwner } from '../../../src/server/spa/client/react/features/chat/gitCommitContext';
import { useCommitListDragController } from '../../../src/server/spa/client/react/features/git/commits/useCommitListDragController';
import { formatAttachedContext, parseAttachedSessionContextBlocks, useAttachedContext } from '../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import {
    readSessionContextDropPayloads, validateSessionContextAttachmentsForSend, validateSessionContextDrop,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import { createGitCommitContextDragPayload, SESSION_CONTEXT_BUNDLE_DRAG_MIME } from '../../../src/server/spa/client/react/features/chat/sessionContextDrag';

const member = 'ws-member';
const group = 'group-team';
const hash = 'abcdef1234567890';
const route = (workspaceId: string, serverId = 'server-a') => buildRemoteCloneKey(serverId, workspaceId);
const commit = { hash, shortHash: 'abcdef1', subject: 'Member change', author: 'Example', date: '2026-01-01', parentHashes: [] };

function registerOwners() {
    registerCloneBaseUrls(['server-a', 'server-b'].flatMap(serverId =>
        [member, group, 'ws-other'].map(workspaceId => ({
            workspaceId, serverId, baseUrl: serverId === 'server-a' ? 'https://a.example' : 'https://b.example',
        }))));
}

function transfer() {
    const data = new Map<string, string>();
    return {
        getData: (key: string) => data.get(key) ?? '',
        setData: (key: string, value: string) => { data.set(key, value); },
    };
}

afterEach(resetCloneRegistryForTests);

describe('member commit context ownership', () => {
    it.each([
        [false, group], [true, group], [false, member], [true, member],
    ])('keeps the concrete repo through drag, drop, send and persisted pointer (remote=%s, owner=%s)', (remote, owner) => {
        registerOwners();
        const sourceRoutingRef = remote ? route(member) : null;
        const { result: drag } = renderHook(() => useCommitListDragController({
            commits: [commit], workspaceId: member, sourceSelectionId: remote ? route(member) : member,
            sourceWorkspaceName: 'Member repository',
            sessionContextDragEnabled: true, unpushedCount: 1,
        }));
        const dataTransfer = transfer();
        const payload = drag.current.buildContextPayload(commit)!;
        act(() => drag.current.handleCommitContextDragStart({ dataTransfer, stopPropagation() {} } as React.DragEvent, payload));
        const [dropped] = readSessionContextDropPayloads(dataTransfer);
        expect(dropped).toMatchObject({ sourceWorkspaceId: member, sourceRoutingRef, sourceWorkspaceName: 'Member repository', commitHash: hash });
        const validation = validateSessionContextDrop({
            payload: dropped, activeWorkspaceId: owner, activeRoutingRef: remote ? route(owner) : null,
            featureEnabled: true, canRetrieveConversations: false, existingItems: [],
        });
        expect(validation.ok).toBe(true);
        const { result: context } = renderHook(useAttachedContext);
        act(() => context.current.addSessionContext(dropped));
        expect(validateSessionContextAttachmentsForSend({
            activeWorkspaceId: owner, activeRoutingRef: remote ? route(owner) : null,
            featureEnabled: true, canRetrieveConversations: false, items: context.current.items,
        })).toBeNull();
        const formatted = formatAttachedContext(context.current.items);
        const parsed = parseAttachedSessionContextBlocks(formatted + 'Review this');
        expect(parsed.pointerContexts[0]).toMatchObject({ sourceWorkspaceId: member, sourceRoutingRef, sourceWorkspaceName: 'Member repository', commitHash: hash });
        expect(parsed.remainingContent).toBe('Review this');
        expect(formatted).toContain('concrete source repository');
        expect(formatted).toContain('Never resolve this commit against the chat/group working directory');
        expect(formatted).not.toContain(`workspace_id="${group}"`);
        expect(formatted).not.toContain('from the active workspace');
    });

    it.each([
        [null, route(group)], [route(member), null], [route(member), route(group, 'server-b')],
        [route('other-member'), route(group)], ['not-a-clone', route(group)],
    ])('rejects mismatched source/owner routes on drop and send (%s, %s)', (sourceRoutingRef, activeRoutingRef) => {
        registerOwners();
        const payload = createGitCommitContextDragPayload(commit, { activeWorkspaceId: member, sourceRoutingRef })!;
        const options = { featureEnabled: true, activeWorkspaceId: group, activeRoutingRef, canRetrieveConversations: false };
        expect(validateSessionContextDrop({ ...options, payload, existingItems: [] }).ok).toBe(false);
        const { result } = renderHook(useAttachedContext);
        act(() => result.current.addGitCommit(payload));
        expect(validateSessionContextAttachmentsForSend({ ...options, items: result.current.items })).toBeTruthy();
    });

    it('revalidates unavailable remote routes before sending without local fallback', () => {
        registerOwners();
        const payload = createGitCommitContextDragPayload(commit, { activeWorkspaceId: member, sourceRoutingRef: route(member) })!;
        const { result } = renderHook(useAttachedContext);
        act(() => result.current.addGitCommit(payload));
        registerCloneBaseUrls([]);
        expect(validateSessionContextAttachmentsForSend({
            featureEnabled: true, activeWorkspaceId: group, activeRoutingRef: route(group),
            canRetrieveConversations: false, items: result.current.items,
        })).toContain('unavailable');
    });

    it('carries source ownership on every selected commit in a remote drag bundle', () => {
        registerOwners();
        const other = { ...commit, hash: '1234567890abcdef', shortHash: '1234567' };
        const { result } = renderHook(() => useCommitListDragController({
            commits: [commit, other], selectedHashes: new Set([commit.hash, other.hash]),
            workspaceId: member, sourceSelectionId: route(member), sessionContextDragEnabled: true, unpushedCount: 2,
        }));
        const dataTransfer = transfer();
        act(() => result.current.handleCommitContextDragStart({
            dataTransfer, stopPropagation() {},
        } as React.DragEvent, result.current.buildContextPayload(commit)!));
        const payloads = readSessionContextDropPayloads(dataTransfer);
        expect(payloads).toHaveLength(2);
        for (const payload of payloads) expect(payload).toMatchObject({
            sourceWorkspaceId: member, sourceRoutingRef: route(member),
        });
    });

    it('does not label an ambiguous remote source as local when its concrete selection is missing', () => {
        registerOwners();
        const { result } = renderHook(() => useCommitListDragController({
            commits: [commit], workspaceId: member, sessionContextDragEnabled: true, unpushedCount: 1,
        }));
        expect(result.current.buildContextPayload(commit)).toBeNull();
    });

    it('deduplicates only an exact server/repo/hash source in bundles, drops and sends', () => {
        registerOwners();
        const payload = createGitCommitContextDragPayload(commit, { activeWorkspaceId: member, sourceRoutingRef: route(member) })!;
        const otherRepo = { ...payload, sourceWorkspaceId: 'ws-other', sourceRoutingRef: route('ws-other') };
        const otherServer = { ...payload, sourceRoutingRef: route(member, 'server-b') };
        const dataTransfer = transfer();
        dataTransfer.setData(SESSION_CONTEXT_BUNDLE_DRAG_MIME, JSON.stringify([payload, payload, otherRepo, otherServer]));
        expect(readSessionContextDropPayloads(dataTransfer)).toHaveLength(3);
        expect(new Set([payload, otherRepo, otherServer].map(gitCommitContextKey)).size).toBe(3);
        const { result } = renderHook(useAttachedContext);
        act(() => result.current.addGitCommit(payload));
        const options = { featureEnabled: true, activeWorkspaceId: group, activeRoutingRef: route(group), canRetrieveConversations: false };
        expect(validateSessionContextDrop({ ...options, payload, existingItems: result.current.items })).toMatchObject({
            ok: false, error: 'This commit is already attached to the message.',
        });
        expect(validateSessionContextAttachmentsForSend({
            ...options, items: [...result.current.items, { ...result.current.items[0], id: 'duplicate' }],
        })).toContain('already attached');
        expect(validateSessionContextDrop({ ...options, payload: otherRepo, existingItems: result.current.items }).ok).toBe(true);
        act(() => result.current.addGitCommit(otherRepo));
        expect(validateSessionContextAttachmentsForSend({ ...options, items: result.current.items })).toBeNull();
    });

    it('deduplicates synchronous chip additions without conflating another repo or server', () => {
        const payload = createGitCommitContextDragPayload(commit, { activeWorkspaceId: member, sourceRoutingRef: route(member) })!;
        const { result } = renderHook(useAttachedContext);
        act(() => {
            result.current.addGitCommit(payload);
            result.current.addGitCommit(payload);
            result.current.addGitCommit({ ...payload, sourceWorkspaceId: 'ws-other', sourceRoutingRef: route('ws-other') });
            result.current.addGitCommit({ ...payload, sourceRoutingRef: route(member, 'server-b') });
        });
        expect(result.current.items).toHaveLength(3);
    });

    it('matches a raw destination only to its resolved source endpoint', () => {
        registerCloneBaseUrls([member, group].map(workspaceId => ({
            workspaceId, serverId: 'server-a', baseUrl: 'https://a.example',
        })));
        const payload = createGitCommitContextDragPayload(commit, { activeWorkspaceId: member, sourceRoutingRef: route(member) })!;
        const options = { featureEnabled: true, activeWorkspaceId: group, canRetrieveConversations: false, existingItems: [] };
        expect(validateSessionContextDrop({ ...options, payload }).ok).toBe(true);
        registerCloneBaseUrls([
            { workspaceId: member, serverId: 'server-a', baseUrl: 'https://a.example' },
            { workspaceId: group, serverId: 'server-b', baseUrl: 'https://b.example' },
        ]);
        expect(validateSessionContextDrop({ ...options, payload }).ok).toBe(false);
    });

    it('uses explicit subtree ownership rather than a colliding global remote route', () => {
        registerOwners();
        const wrapper = ({ children }: { children: React.ReactNode }) =>
            <WorkspaceOwnerContext.Provider value={{ workspaceId: group, selectionId: group }}>{children}</WorkspaceOwnerContext.Provider>;
        const { result } = renderHook(() => useCommitContextOwner(group, route(group)), { wrapper });
        expect(result.current).toBeNull();
    });

    it('retains the feature gate and shared three-item limit for cross-workspace commits', () => {
        const payload = createGitCommitContextDragPayload(commit, { activeWorkspaceId: member })!;
        const options = { activeWorkspaceId: group, activeRoutingRef: null, canRetrieveConversations: false };
        expect(validateSessionContextDrop({ ...options, featureEnabled: false, payload, existingItems: [] }).ok).toBe(false);
        const { result } = renderHook(useAttachedContext);
        act(() => [1, 2, 3, 4].forEach(i => result.current.addGitCommit({ ...payload, commitHash: `${hash}${i}` })));
        expect(validateSessionContextDrop({ ...options, featureEnabled: true, payload, existingItems: result.current.items.slice(0, 3) })).toMatchObject({
            ok: false, error: 'You can attach up to 3 context items.',
        });
        expect(validateSessionContextAttachmentsForSend({ ...options, featureEnabled: true, items: result.current.items })).toContain('up to 3');
        expect(validateSessionContextAttachmentsForSend({
            ...options, featureEnabled: false, items: result.current.items.slice(0, 1),
        })).toBe('Session context attachments are disabled.');
    });
});
