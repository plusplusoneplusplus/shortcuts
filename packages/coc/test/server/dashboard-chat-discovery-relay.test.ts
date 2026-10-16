import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DashboardChatQuery } from '@plusplusoneplusplus/coc-client';
import { DashboardDiscoveryRelay } from '../../src/server/streaming/dashboard-discovery-relay';

const query = (): DashboardChatQuery => ({
    target: { serverIdentity: 'destination', workspaceId: 'project' }, title: 'release', limit: 10, offset: 0,
});
const result = (extra: object = {}) => ({
    target: query().target, serverLabel: 'Remote', workspaceLabel: 'Project', serverKind: 'ssh',
    verification: 'verified', total: 1, conversations: [{ processId: 'chat', title: 'Release plan' }], ...extra,
});
function setup() {
    const relay = new DashboardDiscoveryRelay();
    const client = { id: 'selected', send: vi.fn<(data: string) => void>() };
    relay.advertise(client, 'owner', 'revision', true);
    const sent = () => JSON.parse(client.send.mock.calls.at(-1)![0]);
    const reply = (value: unknown) => relay.reply(client, { id: sent().request.id, ok: true, result: value }, 'chats');
    return { relay, client, sent, reply };
}
afterEach(() => vi.useRealTimers());

describe('dashboard chat discovery relay', () => {
    it.each(['ssh', 'devtunnel'])('binds %s searches to an owner socket/revision and durable destination', async serverKind => {
        const { relay, client, sent, reply } = setup();
        const other = { id: 'other', send: vi.fn() };
        relay.advertise(other, 'elsewhere', 'revision', true);
        const pending = relay.searchChats('owner', query());
        expect(sent()).toEqual({ type: 'dashboard-chats-request', request: {
            id: expect.any(String), workspaceId: 'owner', revision: 'revision', query: query(),
        } });
        const value = result({ serverKind });
        reply(value);
        value.conversations[0].title = 'mutated';
        await expect(pending).resolves.toEqual(result({ serverKind }));
        expect(client.send).toHaveBeenCalledTimes(1);
        expect(other.send).not.toHaveBeenCalled();
    });

    it('preserves offline unverified matches and full ambiguity counts before pagination', async () => {
        const { relay, reply } = setup();
        const pending = relay.searchChats('owner', { ...query(), limit: 1, offset: 2 });
        reply(result({ verification: 'unverified', total: 5 }));
        await expect(pending).resolves.toEqual(result({ verification: 'unverified', total: 5 }));
        const empty = relay.searchChats('owner', { ...query(), offset: 10 });
        reply(result({ total: 5, conversations: [] }));
        await expect(empty).resolves.toMatchObject({ total: 5, conversations: [] });
    });

    it('keeps concurrent equal workspace/chat ids on distinct installations separate from topology replies', async () => {
        const { relay, client, sent } = setup();
        const first = relay.searchChats('owner', query());
        const firstId = sent().request.id;
        const secondTarget = { ...query().target, serverIdentity: 'second-installation' };
        const second = relay.searchChats('owner', { ...query(), target: secondTarget });
        const secondId = sent().request.id;
        const topology = relay.listWorkspaces('owner');
        const topologyId = sent().request.id;
        relay.advertise(client, 'owner', 'revision', false);
        relay.reply(client, { id: secondId, ok: true, result: result({ target: secondTarget }) }, 'chats');
        relay.reply(client, { id: topologyId, ok: true, workspaces: [] });
        relay.reply(client, { id: firstId, ok: true, result: result() }, 'chats');
        await expect(first).resolves.toEqual(result());
        await expect(second).resolves.toEqual(result({ target: secondTarget }));
        await expect(topology).resolves.toEqual([]);
    });

    it('snapshots caller-owned query objects and ignores foreign sockets and reply kinds', async () => {
        const { relay, client, sent, reply } = setup();
        const input = query();
        const pending = relay.searchChats('owner', input);
        const id = sent().request.id;
        input.target.serverIdentity = 'replacement';
        input.title = 'unrelated';
        input.limit = 99;
        const settled = vi.fn();
        void pending.then(settled);
        relay.reply({ ...client }, { id, ok: true, result: result() }, 'chats');
        relay.reply(client, { id, ok: true, result: result() });
        relay.reply(client, { id: 'stale', ok: true, result: result() }, 'chats');
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        reply(result());
        await expect(pending).resolves.toEqual(result());
    });

    it.each([
        { target: { serverIdentity: '', workspaceId: 'project' } },
        { target: { serverIdentity: 'destination', workspaceId: ' ' } },
        { title: ' ' }, { title: 'x'.repeat(513) }, { limit: 0 }, { limit: 101 }, { limit: 1.5 },
        { offset: -1 }, { offset: Infinity }, { offset: Number.MAX_SAFE_INTEGER + 1 },
    ])('rejects invalid queries before contacting a dashboard (%#)', async invalid => {
        const { relay, client } = setup();
        await expect(relay.searchChats('owner', { ...query(), ...invalid })).rejects.toThrow('Invalid dashboard chat query');
        expect(client.send).not.toHaveBeenCalled();
    });

    it.each([
        null, {},
        result({ target: { serverIdentity: 'replacement', workspaceId: 'project' } }),
        result({ target: { serverIdentity: 'destination', workspaceId: 'other' } }),
        result({ target: { ...query().target, url: 'private' } }),
        result({ endpoint: 'private' }), result({ serverLabel: ' ' }), result({ workspaceLabel: 1 }),
        result({ serverKind: 'invalid' }), result({ verification: 'unknown' }),
        result({ total: -1 }), result({ total: 1.5 }), result({ total: Infinity }),
        result({ total: 0 }), result({ total: 2 }),
        result({ conversations: [{ processId: '', title: 'release' }] }),
        result({ conversations: [{ processId: 'chat', title: 'unrelated' }] }),
        result({ conversations: [{ processId: 'chat', title: `release${'x'.repeat(4096)}` }] }),
        result({ conversations: [{ processId: 'chat', title: 'release', transcript: 'private' }] }),
        result({ total: 2, conversations: [{ processId: 'chat', title: 'release' }, { processId: 'chat', title: 'release' }] }),
    ])('rejects malformed, misattributed or partial results as a whole (%#)', async value => {
        const { relay, reply } = setup();
        const pending = relay.searchChats('owner', query());
        reply(value);
        await expect(pending).rejects.toThrow('Invalid dashboard chat discovery response');
    });

    it.each(['revision', 'workspace', 'disconnect', 'replacement'] as const)('revokes pending title reads on %s without fallback', async change => {
        vi.useFakeTimers();
        const { relay, client, sent } = setup();
        const fallback = { id: 'fallback', send: vi.fn() };
        relay.advertise(fallback, 'owner', 'other', false);
        const pending = relay.searchChats('owner', query());
        const id = sent().request.id;
        if (change === 'revision') relay.advertise(client, 'owner', 'new', true);
        if (change === 'workspace') relay.advertise(client, 'elsewhere', 'revision', true);
        if (change === 'disconnect') relay.disconnect(client);
        if (change === 'replacement') relay.advertise({ ...client }, 'owner', 'revision', true);
        await expect(pending).rejects.toThrow('disconnected or changed');
        expect(sent()).toEqual({ type: 'dashboard-discovery-cancel', id });
        relay.reply(client, { id, ok: true, result: result() }, 'chats');
        expect(fallback.send).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves abort reasons, cancels on deadline, and drains timers/listeners on success', async () => {
        vi.useFakeTimers();
        const { relay, sent, reply } = setup();
        const controller = new AbortController();
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const aborted = relay.searchChats('owner', query(), controller.signal);
        const id = sent().request.id;
        const reason = new Error('turn cancelled');
        controller.abort(reason);
        await expect(aborted).rejects.toBe(reason);
        expect(sent()).toEqual({ type: 'dashboard-discovery-cancel', id });
        await expect(relay.searchChats('owner', query(), controller.signal)).rejects.toBe(reason);
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        const timed = relay.searchChats('owner', query());
        const assertion = expect(timed).rejects.toThrow('timed out after 10s');
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
        expect(sent().type).toBe('dashboard-discovery-cancel');
        const successController = new AbortController();
        const successRemove = vi.spyOn(successController.signal, 'removeEventListener');
        const success = relay.searchChats('owner', query(), successController.signal);
        reply(result());
        await success;
        expect(successRemove).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
    });

    it('fails generically for unavailable scope, rejected reads and transport send failures', async () => {
        const { relay, client, sent } = setup();
        await expect(relay.searchChats('foreign', query())).rejects.toThrow('No dashboard');
        await expect(relay.searchChats('', query())).rejects.toThrow('owning workspace');
        const pending = relay.searchChats('owner', query());
        relay.reply(client, { id: sent().request.id, ok: false, error: 'private connection' }, 'chats');
        await expect(pending).rejects.toThrow(/^Dashboard chat discovery unavailable$/);
        client.send.mockImplementationOnce(() => { throw new Error('private connection'); });
        await expect(relay.searchChats('owner', query())).rejects.toThrow(/^Dashboard chat discovery unavailable$/);
    });
});
