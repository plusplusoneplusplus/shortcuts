import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { DashboardDiscoveryRelay } from '../../src/server/streaming/dashboard-discovery-relay';
import { ProcessWebSocketServer } from '../../src/server/streaming/websocket';

const client = (id: string) => ({ id, send: vi.fn<(data: string) => void>() });
const request = (target: ReturnType<typeof client>) => JSON.parse(target.send.mock.calls.at(-1)![0]).request;
const workspace = (extra: object = {}) => ({ serverIdentity: 'destination', serverLabel: 'Remote', serverKind: 'ssh',
    workspaceId: 'same-workspace', workspaceLabel: 'Project', type: 'repo', online: true, ...extra });
const reply = (relay: DashboardDiscoveryRelay, target: ReturnType<typeof client>, workspaces: unknown[] = []) => {
    relay.reply(target, { id: request(target).id, ok: true, workspaces });
};
afterEach(() => vi.useRealTimers());

describe('dashboard workspace discovery relay', () => {
    it('requires an available dashboard for the exact owning workspace', async () => {
        const relay = new DashboardDiscoveryRelay(), a = client('a');
        await expect(relay.listWorkspaces('')).rejects.toThrow('owning workspace');
        await expect(relay.listWorkspaces('owner')).rejects.toThrow('No dashboard');
        for (const args of [[null, 'r', true], ['owner', '', true], ['owner', 'r', 1], [' ', 'r', true], ['owner', 'x'.repeat(513), true]]) {
            relay.advertise(a, ...args as [unknown, unknown, unknown]);
        }
        relay.advertise(a, 'other', 'r', true);
        await expect(relay.listWorkspaces('owner')).rejects.toThrow('No dashboard');
        expect(a.send).not.toHaveBeenCalled();
    });

    it('targets only the most recently focused matching dashboard and retains focus across background updates', async () => {
        const relay = new DashboardDiscoveryRelay(), a = client('a'), b = client('b'), other = client('other');
        relay.advertise(a, 'owner', 'a1', true);
        relay.advertise(b, 'owner', 'b1', true);
        relay.advertise(other, 'other', 'r', true);
        relay.advertise(a, 'owner', 'a1', false);
        const first = relay.listWorkspaces('owner');
        expect(request(b)).toEqual({ id: expect.any(String), workspaceId: 'owner', revision: 'b1' });
        expect(a.send).not.toHaveBeenCalled();
        expect(other.send).not.toHaveBeenCalled();
        reply(relay, b);
        await expect(first).resolves.toEqual([]);
        relay.advertise(a, 'owner', 'a1', true);
        const second = relay.listWorkspaces('owner');
        reply(relay, a);
        await expect(second).resolves.toEqual([]);
    });

    it.each(['ssh', 'devtunnel'])('preserves %s labels, offline rows, unknown ownership and equal workspace ids on distinct servers', async serverKind => {
        const relay = new DashboardDiscoveryRelay(), a = client('a');
        relay.advertise(a, 'owner', 'r', true);
        const result = relay.listWorkspaces('owner');
        const unknown = workspace({ serverKind, serverIdentity: undefined, online: false });
        const rows = [workspace({ serverKind }), workspace({ serverKind, serverIdentity: 'second', type: 'group', online: false }), unknown];
        reply(relay, a, rows);
        // The relay owns a projection, not a mutable reference to a dashboard result.
        rows[0].serverLabel = 'mutated';
        await expect(result).resolves.toEqual([workspace({ serverKind }), workspace({ serverKind, serverIdentity: 'second', type: 'group', online: false }), unknown]);
    });

    it('ignores foreign, stale and uncorrelated replies', async () => {
        const relay = new DashboardDiscoveryRelay(), a = client('a'), b = client('b');
        relay.advertise(a, 'owner', 'r', true);
        const result = relay.listWorkspaces('owner');
        const id = request(a).id;
        const settled = vi.fn();
        void result.then(settled);
        for (const value of [null, [], {}, { id: 'stale', ok: true, workspaces: [] }, { id, ok: 'yes', workspaces: [] }]) relay.reply(a, value);
        relay.reply(b, { id, ok: true, workspaces: [] });
        await Promise.resolve();
        expect(settled).not.toHaveBeenCalled();
        reply(relay, a, [workspace()]);
        await expect(result).resolves.toEqual([workspace()]);
        relay.reply(a, { id, ok: false });
    });

    it.each([
        undefined, [null], [workspace({ serverIdentity: '' })], [workspace({ workspaceId: ' ' })],
        [workspace({ type: 'invalid' })], [workspace({ serverKind: 'invalid' })], [workspace({ online: 'true' })], [workspace({ workspaceLabel: 1 })],
        [workspace({ serverLabel: 'x'.repeat(513) })], [workspace({ effectiveUrl: 'http://private:4000' })],
        [workspace(), workspace()], Array.from({ length: 2001 }, () => workspace()),
    ])('rejects malformed or oversized responses without publishing partial rows (%#)', async workspaces => {
        const relay = new DashboardDiscoveryRelay(), a = client('a');
        relay.advertise(a, 'owner', 'r', true);
        const result = relay.listWorkspaces('owner');
        relay.reply(a, { id: request(a).id, ok: true, workspaces });
        await expect(result).rejects.toThrow('Invalid dashboard workspace discovery response');
    });

    it('returns a generic failure without exposing dashboard error or connection details', async () => {
        const relay = new DashboardDiscoveryRelay(), a = client('a');
        relay.advertise(a, 'owner', 'r', true);
        const result = relay.listWorkspaces('owner');
        relay.reply(a, { id: request(a).id, ok: false, error: 'secret endpoint credentials' });
        await expect(result).rejects.toThrow(/^Dashboard workspace discovery unavailable$/);
    });

    it.each(['disconnect', 'workspace', 'revision', 'replacement'] as const)('cancels pending reads on %s and rejects late replies without retrying elsewhere', async change => {
        vi.useFakeTimers();
        const relay = new DashboardDiscoveryRelay(), a = client('a'), b = client('b');
        relay.advertise(b, 'owner', 'r', false);
        relay.advertise(a, 'owner', 'r', true);
        const result = relay.listWorkspaces('owner');
        const id = request(a).id;
        if (change === 'disconnect') relay.disconnect(a);
        if (change === 'workspace') relay.advertise(a, 'other', 'r', true);
        if (change === 'revision') relay.advertise(a, 'owner', 'new', false);
        if (change === 'replacement') relay.advertise(client('a'), 'owner', 'r', true);
        await expect(result).rejects.toThrow('scope disconnected or changed');
        expect(JSON.parse(a.send.mock.calls.at(-1)![0])).toEqual({ type: 'dashboard-discovery-cancel', id });
        relay.reply(a, { id, ok: true, workspaces: [workspace()] });
        expect(b.send).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not revoke an admitted read on focus-only changes or unrelated disconnects', async () => {
        const relay = new DashboardDiscoveryRelay(), a = client('a'), b = client('b');
        relay.advertise(a, 'owner', 'r', true);
        relay.advertise(b, 'other', 'r', true);
        const one = relay.listWorkspaces('owner');
        relay.advertise(a, 'owner', 'r', false);
        relay.disconnect(b);
        reply(relay, a);
        await expect(one).resolves.toEqual([]);
    });

    it('preserves abort reasons and releases timers and listeners on every outcome', async () => {
        vi.useFakeTimers();
        const relay = new DashboardDiscoveryRelay(), a = client('a'), controller = new AbortController();
        relay.advertise(a, 'owner', 'r', true);
        const remove = vi.spyOn(controller.signal, 'removeEventListener');
        const result = relay.listWorkspaces('owner', controller.signal);
        const id = request(a).id;
        const reason = new Error('turn stopped');
        controller.abort(reason);
        await expect(result).rejects.toBe(reason);
        expect(JSON.parse(a.send.mock.calls.at(-1)![0])).toEqual({ type: 'dashboard-discovery-cancel', id });
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        const sent = a.send.mock.calls.length;
        await expect(relay.listWorkspaces('owner', controller.signal)).rejects.toBe(reason);
        expect(a.send).toHaveBeenCalledTimes(sent);
        expect(vi.getTimerCount()).toBe(0);
        const successController = new AbortController();
        const successRemove = vi.spyOn(successController.signal, 'removeEventListener');
        const success = relay.listWorkspaces('owner', successController.signal);
        reply(relay, a);
        await success;
        expect(successRemove).toHaveBeenCalledWith('abort', expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
    });

    it('times out after 10 seconds and never forwards a late response', async () => {
        vi.useFakeTimers();
        const relay = new DashboardDiscoveryRelay(), a = client('a');
        relay.advertise(a, 'owner', 'r', true);
        const result = relay.listWorkspaces('owner');
        const assertion = expect(result).rejects.toThrow('timed out after 10s');
        const id = request(a).id;
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
        expect(JSON.parse(a.send.mock.calls.at(-1)![0])).toEqual({ type: 'dashboard-discovery-cancel', id });
        relay.reply(a, { id, ok: true, workspaces: [workspace()] });
        expect(vi.getTimerCount()).toBe(0);
    });

    it('sanitizes send failures and drains all concurrent reads on withdrawal', async () => {
        vi.useFakeTimers();
        const relay = new DashboardDiscoveryRelay(), a = client('a');
        relay.advertise(a, 'owner', 'r', true);
        a.send.mockImplementationOnce(() => { throw new Error('secret endpoint'); });
        await expect(relay.listWorkspaces('owner')).rejects.toThrow(/^Dashboard workspace discovery unavailable$/);
        const one = relay.listWorkspaces('owner'), two = relay.listWorkspaces('owner');
        relay.disconnect(a);
        await expect(one).rejects.toThrow('disconnected');
        await expect(two).rejects.toThrow('disconnected');
        expect(vi.getTimerCount()).toBe(0);
    });
});

async function barrier(socket: WebSocket) {
    const pong = new Promise<void>(resolve => {
        const listener = (data: unknown) => {
            if (JSON.parse(String(data)).type !== 'pong') return;
            socket.off('message', listener);
            resolve();
        };
        socket.on('message', listener);
    });
    socket.send(JSON.stringify({ type: 'ping' }));
    await pong;
}

describe('dashboard discovery on real WebSocket connections', () => {
    it('wires capability, results, withdrawal, close and shutdown without broadcasts or cross-socket delivery', async () => {
        const server = createServer(), sockets = new ProcessWebSocketServer();
        sockets.attach(server);
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const url = `ws://127.0.0.1:${(server.address() as { port: number }).port}/ws`;
        const a = new WebSocket(url), b = new WebSocket(url);
        const observed: string[] = [];
        b.on('message', data => observed.push(JSON.parse(String(data)).type));
        const broadcasts = vi.fn();
        sockets.onBroadcast(broadcasts);
        try {
            await Promise.all([a, b].map(socket => new Promise<void>(resolve => socket.once('open', resolve))));
            a.send(JSON.stringify({ type: 'dashboard-discovery-capability', workspaceId: 'owner', revision: 'r', focused: true }));
            await barrier(a);
            a.on('message', data => {
                const message = JSON.parse(String(data));
                if (message.type === 'dashboard-workspaces-request') a.send(JSON.stringify({
                    type: 'dashboard-workspaces-result', reply: { id: message.request.id, ok: true, workspaces: [workspace()] },
                }));
            });
            await expect(sockets.dashboardDiscovery.listWorkspaces('owner')).resolves.toEqual([workspace()]);
            a.removeAllListeners('message');
            const withdrawn = sockets.dashboardDiscovery.listWorkspaces('owner');
            const withdrawnAssertion = expect(withdrawn).rejects.toThrow('disconnected');
            a.send(JSON.stringify({ type: 'dashboard-discovery-clear' }));
            await withdrawnAssertion;
            await barrier(a);
            await expect(sockets.dashboardDiscovery.listWorkspaces('owner')).rejects.toThrow('No dashboard');
            a.send(JSON.stringify({ type: 'dashboard-discovery-capability', workspaceId: 'owner', revision: 'r2', focused: true }));
            await barrier(a);
            const closed = sockets.dashboardDiscovery.listWorkspaces('owner');
            const closedAssertion = expect(closed).rejects.toThrow('disconnected');
            a.close();
            await closedAssertion;
            await barrier(b);
            expect(observed).not.toContain('dashboard-workspaces-request');
            expect(observed).not.toContain('dashboard-discovery-cancel');
            b.send(JSON.stringify({ type: 'dashboard-discovery-capability', workspaceId: 'owner', revision: 'r', focused: true }));
            await barrier(b);
            const shutdown = sockets.dashboardDiscovery.listWorkspaces('owner');
            const shutdownAssertion = expect(shutdown).rejects.toThrow('disconnected');
            sockets.closeAll();
            await shutdownAssertion;
            expect(broadcasts).not.toHaveBeenCalled();
        } finally {
            a.terminate(); b.terminate(); sockets.closeAll();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
