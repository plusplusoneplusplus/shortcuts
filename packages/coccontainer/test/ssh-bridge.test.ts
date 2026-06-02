import { EventEmitter } from 'events';
import { describe, it, expect, vi } from 'vitest';
import { SshBridge, parseSshAddress, isSshAddress } from '../src/proxy/ssh-bridge';

class FakeChild extends EventEmitter {
    killed = false;
    kill(): boolean {
        this.killed = true;
        return true;
    }
    override once(event: string, listener: (...args: any[]) => void): this {
        return super.once(event, listener);
    }
}

describe('parseSshAddress', () => {
    it('parses valid ssh:// address', () => {
        expect(parseSshAddress('ssh://my-host:4000')).toEqual({ host: 'my-host', port: 4000 });
    });

    it('parses ssh:// with hostname containing dots', () => {
        expect(parseSshAddress('ssh://server.example.com:8080')).toEqual({ host: 'server.example.com', port: 8080 });
    });

    it('returns undefined for non-ssh addresses', () => {
        expect(parseSshAddress('http://localhost:4000')).toBeUndefined();
        expect(parseSshAddress('https://example.com')).toBeUndefined();
    });

    it('returns undefined for malformed ssh:// addresses', () => {
        expect(parseSshAddress('ssh://')).toBeUndefined();
        expect(parseSshAddress('ssh://host')).toBeUndefined();
        expect(parseSshAddress('ssh://host:')).toBeUndefined();
        expect(parseSshAddress('ssh://host:abc')).toBeUndefined();
        expect(parseSshAddress('ssh://:4000')).toBeUndefined();
    });

    it('rejects out-of-range ports', () => {
        expect(parseSshAddress('ssh://host:0')).toBeUndefined();
        expect(parseSshAddress('ssh://host:70000')).toBeUndefined();
    });
});

describe('isSshAddress', () => {
    it('returns true for valid ssh:// addresses', () => {
        expect(isSshAddress('ssh://my-host:4000')).toBe(true);
    });

    it('returns false for non-ssh addresses', () => {
        expect(isSshAddress('http://localhost:4000')).toBe(false);
    });
});

describe('SshBridge', () => {
    it('connect: delegates to SshConnector and returns state', async () => {
        const child = new FakeChild();
        const bridge = new SshBridge({
            processStarter: vi.fn(() => child),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        const state = await bridge.connect('agent-1', 'ssh://ubuntu-arm:4000');
        expect(state).toBeDefined();
        expect(state!.status).toBe('online');
        expect(state!.effectiveUrl).toBe('http://127.0.0.1:4000');
    });

    it('connect: returns undefined for non-ssh address', async () => {
        const bridge = new SshBridge();
        const state = await bridge.connect('agent-1', 'http://localhost:4000');
        expect(state).toBeUndefined();
    });

    it('getLocalUrl: returns effective URL for connected agent', async () => {
        const child = new FakeChild();
        const bridge = new SshBridge({
            processStarter: vi.fn(() => child),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        await bridge.connect('agent-1', 'ssh://my-host:5000');
        expect(bridge.getLocalUrl('agent-1')).toBe('http://127.0.0.1:5000');
    });

    it('getLocalUrl: returns undefined for unknown agent', () => {
        const bridge = new SshBridge();
        expect(bridge.getLocalUrl('unknown')).toBeUndefined();
    });

    it('disconnect: stops the SSH process', async () => {
        const child = new FakeChild();
        const bridge = new SshBridge({
            processStarter: vi.fn(() => child),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        await bridge.connect('agent-1', 'ssh://my-host:4000');
        const state = bridge.disconnect('agent-1');
        expect(state.status).toBe('idle');
        expect(child.killed).toBe(true);
    });

    it('reconnect: tears down old process and reconnects', async () => {
        const child1 = new FakeChild();
        const child2 = new FakeChild();
        let idx = 0;
        const children = [child1, child2];
        const bridge = new SshBridge({
            processStarter: vi.fn(() => children[idx++]),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        await bridge.connect('agent-1', 'ssh://my-host:4000');
        expect(child1.killed).toBe(false);

        const state = await bridge.reconnect('agent-1', 'ssh://my-host:4000');
        expect(child1.killed).toBe(true);
        expect(state).toBeDefined();
        expect(state!.status).toBe('online');
    });

    it('getState: returns SSH connection state', async () => {
        const child = new FakeChild();
        const bridge = new SshBridge({
            processStarter: vi.fn(() => child),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        await bridge.connect('agent-1', 'ssh://my-host:4000');
        const state = bridge.getState('agent-1');
        expect(state?.status).toBe('online');
        expect(state?.host).toBe('my-host');
        expect(state?.localPort).toBe(4000);
    });

    it('dispose: cleans up all connections', async () => {
        const child = new FakeChild();
        const bridge = new SshBridge({
            processStarter: vi.fn(() => child),
            healthChecker: async () => true,
            readinessPollMs: 1,
        });

        await bridge.connect('agent-1', 'ssh://my-host:4000');
        bridge.dispose();
        expect(child.killed).toBe(true);
        expect(bridge.getState('agent-1')).toBeUndefined();
    });
});
