import { EventEmitter } from 'events';
import { describe, it, expect, vi } from 'vitest';
import { SshConnector, type SshChildProcess } from '../../src/server/servers/ssh-connector';
import type { SshRemoteServer } from '../../src/server/servers/remote-server-types';

function makeServer(overrides?: Partial<SshRemoteServer>): SshRemoteServer {
    return {
        id: 'srv-1',
        label: 'My SSH Server',
        kind: 'ssh',
        host: 'ubuntu-arm',
        localPort: 4000,
        addedAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

class FakeChild extends EventEmitter implements SshChildProcess {
    killed = false;
    kill(): boolean {
        this.killed = true;
        return true;
    }
    override once(event: 'exit' | 'error', listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }
}

describe('SshConnector', () => {
    it('connect-success: spawns ssh -N and resolves online when health passes', async () => {
        const child = new FakeChild();
        const processStarter = vi.fn(() => child);
        const connector = new SshConnector({
            processStarter,
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const server = makeServer();
        const state = await connector.connect(server);

        expect(processStarter).toHaveBeenCalledWith('ssh', ['-N', 'ubuntu-arm']);
        expect(state.status).toBe('online');
        expect(state.effectiveUrl).toBe('http://127.0.0.1:4000');
        expect(state.serverId).toBe('srv-1');
        expect(state.host).toBe('ubuntu-arm');
        expect(state.localPort).toBe(4000);
    });

    it('deduplicates concurrent connect attempts for the same server', async () => {
        const child = new FakeChild();
        let healthCalls = 0;
        const connector = new SshConnector({
            processStarter: vi.fn(() => child),
            healthChecker: async () => {
                healthCalls++;
                await new Promise(resolve => setTimeout(resolve, 10));
                return true;
            },
            readinessPollMs: 1,
        });

        const server = makeServer();
        const [a, b] = await Promise.all([
            connector.connect(server),
            connector.connect(server),
        ]);

        expect(a).toMatchObject({ status: 'online', effectiveUrl: 'http://127.0.0.1:4000' });
        expect(b).toEqual(a);
    });

    it('connect-timeout: marks failed when health never passes', async () => {
        const child = new FakeChild();
        const connector = new SshConnector({
            processStarter: vi.fn(() => child),
            healthChecker: async () => false,
            readinessTimeoutMs: 20,
            readinessPollMs: 5,
        });

        const server = makeServer();
        await expect(connector.connect(server)).rejects.toThrow(/did not become healthy/);
        expect(connector.getState('srv-1')?.status).toBe('failed');
        expect(connector.getState('srv-1')?.lastError).toMatch(/did not become healthy/);
        expect(child.killed).toBe(true);
    });

    it('binary-not-found: surfaces "ssh binary not found on PATH" when process emits ENOENT error', async () => {
        const child = new FakeChild();
        const connector = new SshConnector({
            processStarter: vi.fn(() => child),
            healthChecker: async () => false,
            readinessTimeoutMs: 50,
            readinessPollMs: 5,
        });

        const server = makeServer();
        // Emit ENOENT error in the next tick (simulating missing binary)
        setTimeout(() => {
            child.emit('error', Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' }));
        }, 1);

        await expect(connector.connect(server)).rejects.toThrow('ssh binary not found on PATH');
        expect(connector.getState('srv-1')?.status).toBe('failed');
        expect(connector.getState('srv-1')?.lastError).toBe('ssh binary not found on PATH');
    });

    it('unexpected-exit: marks failed when ssh process exits after connect', async () => {
        const child = new FakeChild();
        const connector = new SshConnector({
            processStarter: vi.fn(() => child),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const server = makeServer();
        await connector.connect(server);
        expect(connector.getState('srv-1')?.status).toBe('online');

        child.emit('exit', 1, null);

        expect(connector.getState('srv-1')?.status).toBe('failed');
        expect(connector.getState('srv-1')?.lastError).toMatch(/exited unexpectedly/);
    });

    it('reconnect: kills prior child and reconnects successfully', async () => {
        const child1 = new FakeChild();
        const child2 = new FakeChild();
        let childIdx = 0;
        const children = [child1, child2];
        const connector = new SshConnector({
            processStarter: vi.fn(() => children[childIdx++]),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const server = makeServer();
        await connector.connect(server);
        expect(child1.killed).toBe(false);

        const state = await connector.reconnect(server);
        expect(child1.killed).toBe(true);
        expect(state.status).toBe('online');
        expect(state.effectiveUrl).toBe('http://127.0.0.1:4000');
    });

    it('old exit listener cannot clobber state after reconnect', async () => {
        const child1 = new FakeChild();
        const child2 = new FakeChild();
        let childIdx = 0;
        const children = [child1, child2];
        const connector = new SshConnector({
            processStarter: vi.fn(() => children[childIdx++]),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const server = makeServer();
        await connector.connect(server);
        await connector.reconnect(server);

        // Old child exits after reconnect — must NOT flip state to failed
        child1.emit('exit', 1, null);
        expect(connector.getState('srv-1')?.status).toBe('online');
    });

    it('disconnect: kills child and sets status to idle', async () => {
        const child = new FakeChild();
        const connector = new SshConnector({
            processStarter: vi.fn(() => child),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const server = makeServer();
        await connector.connect(server);
        const state = connector.disconnect('srv-1');
        expect(child.killed).toBe(true);
        expect(state.status).toBe('idle');
    });

    it('disconnect on unknown serverId returns idle state gracefully', () => {
        const connector = new SshConnector();
        const state = connector.disconnect('unknown');
        expect(state.status).toBe('idle');
        expect(state.serverId).toBe('unknown');
    });

    it('getState returns undefined for unknown serverId', () => {
        const connector = new SshConnector();
        expect(connector.getState('missing')).toBeUndefined();
    });

    it('getStates returns all connection states', async () => {
        const connector = new SshConnector({
            processStarter: vi.fn(() => new FakeChild()),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const s1 = makeServer({ id: 'srv-1', host: 'host1', localPort: 4001 });
        const s2 = makeServer({ id: 'srv-2', host: 'host2', localPort: 4002 });
        await connector.connect(s1);
        await connector.connect(s2);

        const states = connector.getStates();
        expect(states).toHaveLength(2);
        expect(states.map(s => s.serverId)).toContain('srv-1');
        expect(states.map(s => s.serverId)).toContain('srv-2');
    });

    it('dispose: kills all children and clears state', async () => {
        const child = new FakeChild();
        const connector = new SshConnector({
            processStarter: vi.fn(() => child),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const server = makeServer();
        await connector.connect(server);
        connector.dispose();
        expect(child.killed).toBe(true);
        expect(connector.getStates()).toEqual([]);
    });

    it('connectConfigured connects all ssh-kind servers', async () => {
        const children: FakeChild[] = [];
        const connector = new SshConnector({
            processStarter: vi.fn(() => {
                const c = new FakeChild();
                children.push(c);
                return c;
            }),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const servers = [
            makeServer({ id: 'srv-1', host: 'host1', localPort: 4001 }),
            makeServer({ id: 'srv-2', host: 'host2', localPort: 4002 }),
            { id: 'srv-3', label: 'url-server', kind: 'url' as const, url: 'http://example.com', addedAt: 0, updatedAt: 0 },
        ];
        const states = await connector.connectConfigured(servers);
        expect(states).toHaveLength(2);
        expect(states.every(s => s.status === 'online')).toBe(true);
        expect(children).toHaveLength(2);
    });

    it('returns connected state immediately when already online', async () => {
        const child = new FakeChild();
        let healthCalls = 0;
        const connector = new SshConnector({
            processStarter: vi.fn(() => child),
            healthChecker: async () => { healthCalls++; return true; },
            readinessPollMs: 1,
        });

        const server = makeServer();
        await connector.connect(server);
        const callsAfterFirst = healthCalls;

        await connector.connect(server);
        // Second connect should not spawn a new process or re-poll health
        expect(healthCalls).toBe(callsAfterFirst);
    });
});
