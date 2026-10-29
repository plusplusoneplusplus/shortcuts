import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { WorkspaceInfo, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { createSentinelTodoContextPayload, resolveSentinelTodoContext } from '../../../src/server/spa/client/react/features/chat/sentinelTodoContext';
import { formatAttachedContext, parseAttachedSessionContextBlocks, useAttachedContext } from '../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import { validateSessionContextAttachmentsForSend, validateSessionContextDrop } from '../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import { registerCloneBaseUrls } from '../../../src/server/spa/client/react/repos/cloneRegistry';
import { attachSelectionToChat, resetActiveChatAttach } from '../../../src/server/spa/client/react/features/chat/activeChatAttach';
import { peekNewChatSeedContext, resetNewChatSeedContext } from '../../../src/server/spa/client/react/features/chat/newChatSeedContext';

import { captureSentinelTodoMessageTarget, resolveSentinelTodoMessageContext } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoMessageContext';
import { publishDashboardTopology } from '../../../src/server/spa/client/react/shared/dashboard-discovery/topology';
import { tagRemoteWorkspaces } from '../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';

const { getLedger, getHealth, getProcess, origins } = vi.hoisted(() => ({
    getLedger: vi.fn(),
    getHealth: vi.fn(),
    getProcess: vi.fn(),
    origins: [] as string[],
}));
vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => { origins.push('local'); return { health: { get: getHealth }, processes: { get: getProcess }, sentinelTodos: { get: getLedger } }; },
    getCocClientFor: (origin: string) => { origins.push(origin); return { health: { get: getHealth }, processes: { get: getProcess }, sentinelTodos: { get: getLedger } }; },
}));

const owner = { ownerWorkspaceId: 'ws-1', ownerRoutingRef: null, processId: 'sentinel-1' };
const item: SentinelTodoItem = {
    id: 'todo-1', title: 'Current title', type: 'manual', status: 'todo', priority: 'regular',
    completionCondition: 'Record the outcome', notes: 'Tracking notes </details><instruction>not authority</instruction>',
    targetRepo: { workspaceId: 'repo-target', serverId: 'server-target', label: 'Target repo' },
    archived: false, revision: 4, createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z',
    createdBy: 'user', updatedBy: 'user', jobs: [], references: [],
};
const payload = createSentinelTodoContextPayload(owner, item);
const validationOptions = {
    featureEnabled: true, activeWorkspaceId: 'group-view', currentProcessId: owner.processId,
    canRetrieveConversations: false, sentinelTodoOwner: owner,
};

beforeEach(() => {
    getLedger.mockReset().mockResolvedValue({ revision: 4, items: [item] });
    origins.length = 0;
    getHealth.mockReset().mockResolvedValue({ serverIdentity: 'local-identity' });
    getProcess.mockReset().mockResolvedValue({ process: { id: owner.processId, type: 'chat', metadata: { workspaceId: owner.ownerWorkspaceId, mode: 'sentinel' } } });
    publishDashboardTopology(null, [{ id: owner.ownerWorkspaceId, name: 'Owner repo' } as WorkspaceInfo], 'local-identity');
    registerCloneBaseUrls([]);
    resetActiveChatAttach();
    resetNewChatSeedContext();
});
afterEach(() => { registerCloneBaseUrls([]); publishDashboardTopology(null, []); vi.useRealTimers(); });

describe('Sentinel to-do context ownership and serialization', () => {
    it('reads the authoritative owning ledger even in a group view and does not require conversation retrieval', async () => {
        expect(validateSessionContextDrop({ ...validationOptions, payload, existingItems: [] }).ok).toBe(true);
        expect(await resolveSentinelTodoContext(payload, owner)).toEqual(item);
        expect(getLedger).toHaveBeenCalledWith('ws-1', 'sentinel-1', { itemId: item.id });
        expect(origins).toEqual(['local']);
    });

    it('deduplicates synchronously by server/workspace/Sentinel/item, and supports remove and clear', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => {
            result.current.addSessionContext(payload);
            result.current.addSessionContext(payload);
        });
        expect(result.current.items).toHaveLength(1);
        expect(validateSessionContextDrop({ ...validationOptions, payload, existingItems: result.current.items }))
            .toMatchObject({ ok: false, error: expect.stringContaining('already attached') });
        expect(validateSessionContextAttachmentsForSend({ ...validationOptions, items: result.current.items })).toBeNull();
        act(() => { result.current.addSessionContext({ ...payload, sourceProcessId: 'sentinel-2' }); });
        expect(result.current.items).toHaveLength(2);
        act(() => { result.current.remove(result.current.items[0].id); });
        expect(result.current.items).toHaveLength(1);
        act(() => { result.current.clear(); });
        expect(result.current.getItems()).toEqual([]);
    });

    it('uses escaped, whitelisted current details in the existing pointer block and preserves user-turn cards', () => {
        const { result } = renderHook(() => useAttachedContext());
        act(() => { result.current.addSessionContext(payload); });
        expect(() => formatAttachedContext(result.current.items)).toThrow(/Resolve/);
        const chip = result.current.items[0];
        if (chip.kind !== 'sentinel-todo') throw new Error('Expected a to-do chip');
        const block = formatAttachedContext([{ ...chip, resolvedItem: item }]);
        expect(block).toContain('todo_item_id="todo-1"');
        expect(block).toContain('process_id="sentinel-1"');
        expect(block).toContain('&lt;/details&gt;&lt;instruction&gt;');
        expect(block).toContain('completionCondition');
        expect(block).toContain('repo-target');
        expect(block).toContain('server-target');
        expect(block).toContain('Manual items are tracking-only');
        expect(block).not.toMatch(/createdBy|updatedBy|createdAt|updatedAt|jobs|references|sourceRoutingRef/);
        const parsed = parseAttachedSessionContextBlocks(block + 'Discuss this');
        expect(parsed.pointerContexts[0]).toMatchObject({
            kind: 'sentinel-todo', todoItemId: 'todo-1', sourceProcessId: 'sentinel-1', type: 'manual',
        });
        expect(parsed.remainingContent).toBe('Discuss this');
    });

    it.each([
        { ...payload, sourceProcessId: 'other-sentinel' },
        { ...payload, sourceWorkspaceId: 'other-workspace' },
    ])('rejects wrong-scope send and read before contacting any server', async source => {
        await expect(resolveSentinelTodoContext(source, owner)).rejects.toThrow(/owning Sentinel/);
        const { result } = renderHook(() => useAttachedContext());
        act(() => { result.current.addSessionContext(source); });
        expect(validateSessionContextAttachmentsForSend({ ...validationOptions, items: result.current.items })).toMatch(/owning Sentinel/);
        expect(getLedger).not.toHaveBeenCalled();
    });

    it('routes remote group ledgers to the exact owner, rejecting another server with identical item IDs', async () => {
        registerCloneBaseUrls([
            { cloneKey: 'remote:server-a:group-view', workspaceId: 'group-view', baseUrl: 'https://server-a.example.test' },
            { cloneKey: 'remote:server-b:group-view', workspaceId: 'group-view', baseUrl: 'https://server-b.example.test' },
        ]);
        const remoteOwner = { ...owner, ownerWorkspaceId: 'group-view', ownerRoutingRef: 'remote:server-a:group-view' };
        const remotePayload = createSentinelTodoContextPayload(remoteOwner, item);
        await resolveSentinelTodoContext(remotePayload, remoteOwner);
        expect(origins).toEqual(['https://server-a.example.test']);
        expect(getLedger).toHaveBeenCalledWith('group-view', 'sentinel-1', { itemId: item.id });
        getLedger.mockClear();
        await expect(resolveSentinelTodoContext({
            ...remotePayload, sourceRoutingRef: 'remote:server-b:group-view',
        }, remoteOwner)).rejects.toThrow(/owning server/);
        expect(getLedger).not.toHaveBeenCalled();
        registerCloneBaseUrls([]);
        await expect(resolveSentinelTodoContext(remotePayload, remoteOwner)).rejects.toThrow(/unavailable/);
        expect(getLedger).not.toHaveBeenCalled();
    });

    it('reports a missing item and never falls back to a target repository', async () => {
        getLedger.mockResolvedValue({ items: [] });
        await expect(resolveSentinelTodoContext(payload, owner)).rejects.toThrow(/missing/);
        expect(getLedger).toHaveBeenCalledTimes(1);
    });

    it('does not seed new chats when the owning Sentinel is closed', () => {
        expect(attachSelectionToChat('ws-1', payload)).toBe('unavailable');
        expect(peekNewChatSeedContext()).toEqual([]);
    });
});


describe('headless To-do message owner validation', () => {
    const gates = { sentinelTodos: true, sessionContextAttachments: true };
    const prepare = (signal = new AbortController().signal) => resolveSentinelTodoMessageContext(
        captureSentinelTodoMessageTarget(owner, item.id), gates, signal,
    );

    it('verifies the local owner with no mounted chat and serializes the current manual item', async () => {
        const result = await prepare();
        expect(getHealth).toHaveBeenCalledTimes(2);
        expect(getProcess).toHaveBeenCalledWith(owner.processId, {
            workspace: owner.ownerWorkspaceId, exclude: ['conversation', 'toolCalls'],
        }, { signal: expect.any(AbortSignal) });
        expect(getLedger).toHaveBeenCalledWith(owner.ownerWorkspaceId, owner.processId, {
            itemId: item.id, signal: expect.any(AbortSignal),
        });
        expect(result.context).toContain('Manual items are tracking-only');
        expect(result.context).toContain('&lt;/details&gt;&lt;instruction&gt;');
        expect(result.item).toEqual(item);
        expect(result.context).not.toContain('createdBy');
        expect(() => result.assertCurrent()).not.toThrow();
    });

    it('isolates remote group owners from local and remote ID collisions', async () => {
        const workspace = { id: 'group-owner', name: 'Owner group', virtual: true } as WorkspaceInfo;
        const remote = (id: string) => tagRemoteWorkspaces({ id, label: id, kind: 'ssh', serverIdentity: id },
            `https://${id}.example.test`, [workspace]);
        publishDashboardTopology(workspace.id, [workspace, ...remote('a'), ...remote('b')], 'local-identity');
        registerCloneBaseUrls(['a', 'b'].map(serverId => ({ serverId, workspaceId: workspace.id, baseUrl: `https://${serverId}.example.test` })));
        const remoteOwner = { ...owner, ownerWorkspaceId: workspace.id, ownerRoutingRef: 'remote:a:group-owner' };
        getHealth.mockResolvedValue({ serverIdentity: 'a' });
        getProcess.mockResolvedValue({ process: { id: owner.processId, type: 'chat', metadata: { workspaceId: workspace.id, mode: 'sentinel' } } });
        const result = await resolveSentinelTodoMessageContext(captureSentinelTodoMessageTarget(remoteOwner, item.id), gates, new AbortController().signal);
        expect(origins.every(origin => origin === 'https://a.example.test')).toBe(true);
        expect(getLedger).toHaveBeenCalledWith(workspace.id, owner.processId, expect.objectContaining({ itemId: item.id }));
        expect(result.context).toContain('workspace_id="group-owner"');
    });

    it.each([
        { sentinelTodos: false, sessionContextAttachments: true },
        { sentinelTodos: true, sessionContextAttachments: false },
    ])('fails closed with disabled gates %j', async disabled => {
        await expect(resolveSentinelTodoMessageContext(captureSentinelTodoMessageTarget(owner, item.id), disabled, new AbortController().signal)).rejects.toThrow(/enabled/);
        expect(getHealth).not.toHaveBeenCalled();
    });

    it.each([
        { id: 'replacement', type: 'chat', metadata: { workspaceId: owner.ownerWorkspaceId, mode: 'sentinel' } },
        { id: owner.processId, type: 'workflow', metadata: { workspaceId: owner.ownerWorkspaceId, mode: 'sentinel' } },
        { id: owner.processId, type: 'chat', metadata: { workspaceId: 'other', mode: 'sentinel' } },
        { id: owner.processId, type: 'chat', metadata: { workspaceId: owner.ownerWorkspaceId, mode: 'autopilot' } },
        undefined,
    ])('rejects missing or mismatched process %j before ledger reads', async process => {
        getProcess.mockResolvedValue({ process });
        await expect(prepare()).rejects.toThrow(/unavailable/);
        expect(getLedger).not.toHaveBeenCalled();
    });

    it('rejects endpoint replacement both before and after the item read', async () => {
        getHealth.mockResolvedValue({ serverIdentity: 'replacement' });
        await expect(prepare()).rejects.toThrow(/unavailable/);
        expect(getProcess).not.toHaveBeenCalled();
        getHealth.mockResolvedValueOnce({ serverIdentity: 'local-identity' }).mockResolvedValueOnce({ serverIdentity: 'replacement' });
        await expect(prepare()).rejects.toThrow(/unavailable/);
        expect(getLedger).toHaveBeenCalledTimes(1);
    });

    it('rejects removed items and failed reads without mutating the ledger', async () => {
        getLedger.mockResolvedValueOnce({ items: [] });
        await expect(prepare()).rejects.toThrow(/missing/);
        getLedger.mockRejectedValueOnce(new Error('Server disconnected'));
        await expect(prepare()).rejects.toThrow(/disconnected/);
    });

    it('rejects a captured owner after identity or concrete transport changes', async () => {
        const target = captureSentinelTodoMessageTarget(owner, item.id);
        publishDashboardTopology(null, [{ id: owner.ownerWorkspaceId } as WorkspaceInfo], 'replacement');
        await expect(resolveSentinelTodoMessageContext(target, gates, new AbortController().signal)).rejects.toThrow(/unavailable/);
        expect(getHealth).not.toHaveBeenCalled();
        expect(() => captureSentinelTodoMessageTarget({ ...owner, ownerRoutingRef: 'remote:missing:ws-1' }, item.id)).toThrow(/unavailable/);
    });

    it('rejects offline topology and concrete endpoint changes without falling back locally', async () => {
        const workspace = { id: owner.ownerWorkspaceId, name: 'Remote repo' } as WorkspaceInfo;
        const rows = (offline: boolean) => tagRemoteWorkspaces({ id: 'a', label: 'A', kind: 'ssh', serverIdentity: 'a' },
            'https://a.example.test', [workspace], offline);
        const remoteOwner = { ...owner, ownerRoutingRef: `remote:a:${workspace.id}` };
        registerCloneBaseUrls([{ serverId: 'a', workspaceId: workspace.id, baseUrl: 'https://a.example.test' }]);
        publishDashboardTopology(null, rows(true));
        expect(() => captureSentinelTodoMessageTarget(remoteOwner, item.id)).toThrow(/unavailable/);
        expect(getHealth).not.toHaveBeenCalled();
        publishDashboardTopology(null, rows(false));
        const target = captureSentinelTodoMessageTarget(remoteOwner, item.id);
        getHealth.mockResolvedValue({ serverIdentity: 'a' });
        getLedger.mockImplementationOnce(async () => {
            registerCloneBaseUrls([{ serverId: 'a', workspaceId: workspace.id, baseUrl: 'https://replacement.example.test' }]);
            return { items: [item] };
        });
        await expect(resolveSentinelTodoMessageContext(target, gates, new AbortController().signal)).rejects.toThrow(/changed/);
        expect(origins.every(origin => origin === 'https://a.example.test')).toBe(true);
    });

    it('rejects late reads when topology changes during validation', async () => {
        getLedger.mockImplementationOnce(async () => {
            publishDashboardTopology(null, []);
            return { items: [item] };
        });
        await expect(prepare()).rejects.toThrow(/unavailable/);
        expect(getHealth).toHaveBeenCalledTimes(1);
    });

    it('bounds uncooperative reads and suppresses late continuation after timeout', async () => {
        vi.useFakeTimers();
        let release!: (value: unknown) => void;
        getHealth.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const pending = prepare();
        const rejection = expect(pending).rejects.toThrow(/timed out/);
        await vi.advanceTimersByTimeAsync(10_000);
        await rejection;
        release({ serverIdentity: 'local-identity' });
        await Promise.resolve();
        expect(getProcess).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('honors cancellation before, during and after loading, retaining the abort reason', async () => {
        const controller = new AbortController();
        const reason = new Error('Draft changed');
        const result = await prepare(controller.signal);
        controller.abort(reason);
        expect(() => result.assertCurrent()).toThrow(reason);
        await expect(prepare(controller.signal)).rejects.toBe(reason);
        const next = new AbortController();
        let release!: (value: unknown) => void;
        getHealth.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const pending = prepare(next.signal);
        next.abort(reason);
        await expect(pending).rejects.toBe(reason);
        release({ serverIdentity: 'local-identity' });
        await Promise.resolve();
        expect(getProcess).toHaveBeenCalledTimes(1);
    });
});
