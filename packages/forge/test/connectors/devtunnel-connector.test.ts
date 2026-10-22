import { EventEmitter } from 'events';
import { afterEach, describe, it, expect, vi } from 'vitest';
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

describe('DevTunnel six-hour renewal', () => {
    const sixHours = 6 * 60 * 60 * 1000;
    const connectors: DevTunnelConnector[] = [];
    afterEach(() => {
        connectors.splice(0).forEach(connector => connector.dispose());
        vi.useRealTimers();
    });
    function setup() {
        vi.useFakeTimers();
        const children: FakeChild[] = [];
        const commandRunner = vi.fn(async (_command: string, _args: string[]) => ({ stdout: '4000 http coc', stderr: '' }));
        const healthChecker = vi.fn(async () => true);
        const processStarter = vi.fn(() => {
            const child = new FakeChild();
            children.push(child);
            return child;
        });
        const connector = new DevTunnelConnector({ commandRunner, processStarter, healthChecker, readinessTimeoutMs: 10, readinessPollMs: 1 });
        connectors.push(connector);
        return { connector, children, commandRunner, processStarter, healthChecker };
    }
    it('renews at six hours, repeats, and refreshes endpoint and connection age', async () => {
        const { connector, children, commandRunner, healthChecker } = setup();
        const first = await connector.connect('t1');
        expect((connector as any).connections.get('t1').renewalTimer.hasRef()).toBe(false);
        await vi.advanceTimersByTimeAsync(sixHours - 1);
        expect(commandRunner).toHaveBeenCalledTimes(1);
        commandRunner.mockResolvedValue({ stdout: '5000 http coc', stderr: '' });
        await vi.advanceTimersByTimeAsync(1);
        expect(children[0].killed).toBe(true);
        expect(commandRunner).toHaveBeenCalledTimes(2);
        expect(healthChecker).toHaveBeenLastCalledWith('http://127.0.0.1:5000', expect.any(AbortSignal));
        expect(connector.getState('t1')).toMatchObject({ status: 'online', port: 5000, startedAt: first.startedAt! + sixHours });
        await vi.advanceTimersByTimeAsync(sixHours);
        expect(commandRunner).toHaveBeenCalledTimes(3);
        expect(children[1].killed).toBe(true);
    });
    it('uses the newly forwarded local port during renewal', async () => {
        const { connector, processStarter, healthChecker } = setup();
        await connector.connect('t1');
        processStarter.mockImplementation(() => {
            const child = new FakeChild();
            (child as any).stdout = new EventEmitter();
            setTimeout(() => (child as any).stdout.emit('data', 'Forwarding from 127.0.0.1:51234 to host port 4000'), 1);
            return child;
        });
        await vi.advanceTimersByTimeAsync(sixHours + 2);
        expect(healthChecker).toHaveBeenLastCalledWith('http://127.0.0.1:51234', expect.any(AbortSignal));
        expect(connector.getState('t1').effectiveUrl).toBe('http://127.0.0.1:51234');
    });
    it('deduplicates aliases and excludes SSH and direct URL registrations', async () => {
        const { connector, commandRunner } = setup();
        await connector.connectConfigured([
            { id: 'workspace-a', kind: 'devtunnel', tunnelId: 'shared' },
            { id: 'workspace-b', kind: 'devtunnel', tunnelId: 'shared' },
            { id: 'ssh', kind: 'ssh', host: 'example' },
            { id: 'url', kind: 'url', url: 'https://example.com' },
        ] as any);
        await vi.advanceTimersByTimeAsync(sixHours);
        expect(commandRunner).toHaveBeenCalledTimes(2);
        expect(connector.getStates()).toHaveLength(1);
        expect(commandRunner.mock.calls.every(call => call[1][2] === 'shared')).toBe(true);
    });
    it('manual reconnect resets the deadline and joins concurrent requests', async () => {
        const { connector, commandRunner } = setup();
        await connector.connect('t1');
        await vi.advanceTimersByTimeAsync(sixHours - 1);
        await Promise.all([connector.reconnect('t1'), connector.reconnect('t1'), connector.connect('t1')]);
        expect(commandRunner).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(commandRunner).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(sixHours - 1);
        expect(commandRunner).toHaveBeenCalledTimes(3);
    });
    it('joins renewal in flight without overlapping or scheduling storms', async () => {
        const { connector, commandRunner, processStarter } = setup();
        await connector.connect('t1');
        let finish!: (value: { stdout: string; stderr: string }) => void;
        commandRunner.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        await vi.advanceTimersByTimeAsync(sixHours);
        const manual = connector.reconnect('t1');
        const connect = connector.connect('t1');
        await vi.advanceTimersByTimeAsync(sixHours * 3);
        expect(commandRunner).toHaveBeenCalledTimes(2);
        expect(processStarter).toHaveBeenCalledTimes(1);
        finish({ stdout: '4000 http coc', stderr: '' });
        await Promise.all([manual, connect]);
        await vi.advanceTimersByTimeAsync(sixHours - 1);
        expect(commandRunner).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(commandRunner).toHaveBeenCalledTimes(3);
    });
    it.each(['command', 'health', 'spawn'])('surfaces %s failure without an unbounded retry loop', async failure => {
        const { connector, commandRunner, processStarter, healthChecker, children } = setup();
        await connector.connect('t1');
        if (failure === 'command') commandRunner.mockRejectedValue(new Error('renewal failed'));
        if (failure === 'spawn') processStarter.mockImplementation(() => { throw new Error('spawn failed'); });
        if (failure === 'health') healthChecker.mockResolvedValue(false);
        await vi.advanceTimersByTimeAsync(sixHours + 20);
        expect(connector.getState('t1')).toMatchObject({ status: 'failed', lastError: expect.any(String) });
        expect(children.every(child => child.killed)).toBe(true);
        await vi.advanceTimersByTimeAsync(sixHours * 3);
        expect(commandRunner).toHaveBeenCalledTimes(2);
    });
    it.each(['disconnect', 'dispose', 'exit', 'error'])('cancels renewal on %s', async action => {
        const { connector, children, commandRunner } = setup();
        await connector.connect('t1');
        if (action === 'disconnect') connector.disconnect('t1');
        if (action === 'dispose') connector.dispose();
        if (action === 'exit') children[0].emit('exit', 1, null);
        if (action === 'error') children[0].emit('error', new Error('lost tunnel'));
        await vi.advanceTimersByTimeAsync(sixHours * 2);
        expect(commandRunner).toHaveBeenCalledTimes(1);
    });
    it.each(['command', 'health'])('rejects late %s results after disconnect or replacement', async stage => {
        const { connector, commandRunner, processStarter, healthChecker } = setup();
        await connector.connect('t1');
        let finish!: () => void;
        if (stage === 'command') commandRunner.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ stdout: '4000 http coc', stderr: '' }); }));
        else healthChecker.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(true); }));
        await vi.advanceTimersByTimeAsync(sixHours);
        const stale = connector.connect('t1').catch(error => error);
        connector.disconnect('t1');
        const replacement = await connector.connect('t1');
        const spawnCount = processStarter.mock.calls.length;
        finish();
        expect(await stale).toBeInstanceOf(Error);
        expect(connector.getState('t1')).toEqual(replacement);
        expect(processStarter).toHaveBeenCalledTimes(spawnCount);
        await vi.advanceTimersByTimeAsync(sixHours);
        expect(commandRunner).toHaveBeenCalledTimes(4);
    });
    it('a stale attempt cannot clear the replacement single-flight promise', async () => {
        const { connector, commandRunner } = setup();
        let finishOld!: (value: { stdout: string; stderr: string }) => void;
        let finishNew!: (value: { stdout: string; stderr: string }) => void;
        commandRunner.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
        const stale = connector.connect('t1').catch(error => error);
        connector.disconnect('t1');
        commandRunner.mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
        const replacement = connector.connect('t1');
        finishOld({ stdout: '4000 http coc', stderr: '' });
        expect(await stale).toBeInstanceOf(Error);
        const joined = connector.reconnect('t1');
        expect(commandRunner).toHaveBeenCalledTimes(2);
        finishNew({ stdout: '5000 http coc', stderr: '' });
        expect(await joined).toEqual(await replacement);
    });
    it.each(['exit', 'error'])('does not publish late readiness success after child %s', async event => {
        const { connector, children, healthChecker } = setup();
        let finish!: () => void;
        healthChecker.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(true); }));
        const pending = connector.connect('t1').catch(error => error);
        await vi.advanceTimersByTimeAsync(0);
        if (event === 'exit') children[0].emit('exit', 1, null);
        else children[0].emit('error', new Error('child failed'));
        finish();
        expect(await pending).toBeInstanceOf(Error);
        expect(connector.getState('t1').status).toBe('failed');
        expect(vi.getTimerCount()).toBe(0);
    });
    it('settles configured startup safely when shutdown revokes port discovery', async () => {
        const { connector, commandRunner, processStarter } = setup();
        let finish!: () => void;
        commandRunner.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ stdout: '4000 http coc', stderr: '' }); }));
        const startup = connector.connectConfigured([{ kind: 'devtunnel', tunnelId: 't1' }] as any);
        connector.dispose();
        finish();
        await expect(startup).resolves.toEqual([{ tunnelId: 't1', status: 'idle' }]);
        expect(processStarter).not.toHaveBeenCalled();
        expect(connector.getStates()).toEqual([]);
    });
    it.each(['command', 'health'])('ignores late %s completion after shutdown', async stage => {
        const { connector, commandRunner, healthChecker, processStarter } = setup();
        await connector.connect('t1');
        let finish!: () => void;
        if (stage === 'command') commandRunner.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({ stdout: '4000 http coc', stderr: '' }); }));
        else healthChecker.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(true); }));
        await vi.advanceTimersByTimeAsync(sixHours);
        connector.dispose();
        const spawnCount = processStarter.mock.calls.length;
        finish();
        await vi.advanceTimersByTimeAsync(sixHours * 2);
        expect(connector.getStates()).toEqual([]);
        expect(processStarter).toHaveBeenCalledTimes(spawnCount);
        await expect(connector.connect('t1')).rejects.toThrow('disposed');
    });
});
