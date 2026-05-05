import { EventEmitter } from 'events';
import { describe, it, expect, vi } from 'vitest';
import { DevTunnelConnector, type DevTunnelChildProcess } from '../../src/server/servers/devtunnel-connector';

class FakeChild extends EventEmitter implements DevTunnelChildProcess {
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
