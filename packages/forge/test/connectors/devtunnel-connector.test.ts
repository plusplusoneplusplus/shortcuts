import { EventEmitter } from 'events';
import { describe, it, expect, vi } from 'vitest';
import { DevTunnelConnector } from '../../src/connectors/devtunnel-connector';
import type { ManagedChildProcess } from '../../src/connectors/types';

class FakeChild extends EventEmitter implements ManagedChildProcess {
    killed = false;
    kill(): boolean {
        this.killed = true;
        return true;
    }
    override once(event: 'exit' | 'error', listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }
}

describe('DevTunnelConnector', () => {
    it('deduplicates concurrent connect attempts for the same tunnel ID', async () => {
        const child = new FakeChild();
        let commandRuns = 0;
        const connector = new DevTunnelConnector({
            commandRunner: async () => {
                commandRuns++;
                await new Promise(resolve => setTimeout(resolve, 10));
                return { stdout: '4000 http coc', stderr: '' };
            },
            processStarter: vi.fn(() => child),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const [a, b] = await Promise.all([
            connector.connect('my-tunnel'),
            connector.connect('my-tunnel'),
        ]);

        expect(commandRuns).toBe(1);
        expect(a).toMatchObject({ status: 'online', port: 4000, effectiveUrl: 'http://127.0.0.1:4000' });
        expect(b).toEqual(a);
    });

    it('reports effective local URL when health succeeds', async () => {
        const connector = new DevTunnelConnector({
            commandRunner: async () => ({ stdout: '4173 http coc', stderr: '' }),
            processStarter: () => new FakeChild(),
            healthChecker: async url => url === 'http://127.0.0.1:4173',
            readinessPollMs: 1,
        });

        const state = await connector.connect('my-tunnel');
        expect(state.status).toBe('online');
        expect(state.effectiveUrl).toBe('http://127.0.0.1:4173');
    });

    it('populates publicUrl when port list includes portUri', async () => {
        const portListJson = JSON.stringify({
            ports: [{ portNumber: 4000, protocol: 'http', portUri: 'https://my-tunnel-4000.usw2.devtunnels.ms' }],
        });
        const connector = new DevTunnelConnector({
            commandRunner: async () => ({ stdout: portListJson, stderr: '' }),
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const state = await connector.connect('my-tunnel');
        expect(state.status).toBe('online');
        expect(state.publicUrl).toBe('https://my-tunnel-4000.usw2.devtunnels.ms');
        expect(state.port).toBe(4000);
        expect(state.effectiveUrl).toBe('http://127.0.0.1:4000');
    });

    it('publicUrl is undefined when port list lacks portUri', async () => {
        const connector = new DevTunnelConnector({
            commandRunner: async () => ({ stdout: '4000 http coc', stderr: '' }),
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const state = await connector.connect('my-tunnel');
        expect(state.status).toBe('online');
        expect(state.publicUrl).toBeUndefined();
    });

    it('reports missing CLI and auth failures explicitly', async () => {
        const missing = new DevTunnelConnector({
            commandRunner: async () => { throw Object.assign(new Error('spawn devtunnel ENOENT'), { code: 'ENOENT' }); },
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
        });
        await expect(missing.connect('missing')).rejects.toThrow(/not installed/);
        expect(missing.getState('missing').lastError).toMatch(/not installed/);

        const unauthenticated = new DevTunnelConnector({
            commandRunner: async () => { throw Object.assign(new Error('please login first'), { stderr: 'Unauthorized' }); },
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
        });
        await expect(unauthenticated.connect('auth')).rejects.toThrow(/authenticated/);
        expect(unauthenticated.getState('auth').lastError).toMatch(/authenticated/);
    });

    it('marks the connection failed when the connect process exits unexpectedly', async () => {
        const child = new FakeChild();
        const connector = new DevTunnelConnector({
            commandRunner: async () => ({ stdout: '4000 http coc', stderr: '' }),
            processStarter: () => child,
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        await connector.connect('my-tunnel');
        child.emit('exit', 2, null);

        expect(connector.getState('my-tunnel')).toMatchObject({
            status: 'failed',
            lastError: expect.stringContaining('exited unexpectedly'),
        });
    });

    it('reconnect kills prior child and re-runs port list + spawn', async () => {
        const child1 = new FakeChild();
        let portListCalls = 0;
        let childIndex = 0;
        const children = [child1, new FakeChild()];
        const connector = new DevTunnelConnector({
            commandRunner: async () => {
                portListCalls++;
                return { stdout: '4000 http coc', stderr: '' };
            },
            processStarter: () => children[childIndex++],
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        await connector.connect('t1');
        expect(portListCalls).toBe(1);
        expect(child1.killed).toBe(false);

        const state = await connector.reconnect('t1');
        expect(child1.killed).toBe(true);
        expect(portListCalls).toBe(2);
        expect(state.status).toBe('online');
    });

    it('reconnect from failed state behaves like a fresh connect', async () => {
        const connector = new DevTunnelConnector({
            commandRunner: async () => { throw Object.assign(new Error('boom'), { code: 'ENOENT' }); },
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
        });

        await connector.connect('t1').catch(() => {});
        expect(connector.getState('t1').status).toBe('failed');

        (connector as any).commandRunner = async () => ({ stdout: '4000 http coc', stderr: '' });
        const state = await connector.reconnect('t1');
        expect(state.status).toBe('online');
    });

    it('reconnect from idle state behaves like connect', async () => {
        const connector = new DevTunnelConnector({
            commandRunner: async () => ({ stdout: '4000 http coc', stderr: '' }),
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        expect(connector.getState('t1').status).toBe('idle');
        const state = await connector.reconnect('t1');
        expect(state.status).toBe('online');
    });

    it('old exit listener cannot clobber state after reconnect', async () => {
        const child1 = new FakeChild();
        const child2 = new FakeChild();
        let childIndex = 0;
        const children = [child1, child2];
        const connector = new DevTunnelConnector({
            commandRunner: async () => ({ stdout: '4000 http coc', stderr: '' }),
            processStarter: () => children[childIndex++],
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        await connector.connect('t1');
        await connector.reconnect('t1');

        child1.emit('exit', 1, null);
        expect(connector.getState('t1').status).toBe('online');
    });

    it('reconnect refreshes publicUrl when port list returns a new URL', async () => {
        let callCount = 0;
        const connector = new DevTunnelConnector({
            commandRunner: async () => {
                callCount++;
                const url = callCount === 1
                    ? 'https://old-url.devtunnels.ms'
                    : 'https://new-url.devtunnels.ms';
                return {
                    stdout: JSON.stringify({ ports: [{ portNumber: 4000, protocol: 'http', portUri: url }] }),
                    stderr: '',
                };
            },
            processStarter: () => new FakeChild(),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const first = await connector.connect('t1');
        expect(first.publicUrl).toBe('https://old-url.devtunnels.ms');

        const second = await connector.reconnect('t1');
        expect(second.publicUrl).toBe('https://new-url.devtunnels.ms');
    });

    it('stops child processes on dispose', async () => {
        const child = new FakeChild();
        const connector = new DevTunnelConnector({
            commandRunner: async () => ({ stdout: '4000 http coc', stderr: '' }),
            processStarter: () => child,
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        await connector.connect('my-tunnel');
        connector.dispose();
        expect(child.killed).toBe(true);
        expect(connector.getStates()).toEqual([]);
    });
});
