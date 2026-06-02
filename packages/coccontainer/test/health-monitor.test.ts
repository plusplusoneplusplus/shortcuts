import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentHealthMonitor } from '../src/server/health-monitor';
import type { AgentStore, Agent } from '../src/store';

vi.mock('../src/proxy/health', () => ({
    checkAgentHealth: vi.fn().mockResolvedValue(false),
}));

import { checkAgentHealth } from '../src/proxy/health';
const mockCheckHealth = vi.mocked(checkAgentHealth);

function fakeAgent(overrides: Partial<Agent> = {}): Agent {
    return {
        id: 'agent-1',
        name: 'test-agent',
        address: 'http://localhost:4000',
        status: 'unknown',
        lastSeenAt: null,
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

function fakeStore(agents: Agent[]): AgentStore {
    return {
        list: vi.fn(() => agents),
        updateStatus: vi.fn(),
        add: vi.fn(),
        remove: vi.fn(),
        rename: vi.fn(),
        update: vi.fn(),
        get: vi.fn(),
        close: vi.fn(),
    } as unknown as AgentStore;
}

function fakeAgentManager(opts: { hasAgent?: boolean; hasOutbound?: boolean } = {}) {
    return {
        hasAgent: vi.fn(() => opts.hasAgent ?? false),
        hasOutboundConnection: vi.fn(() => opts.hasOutbound ?? false),
        listAgents: vi.fn(() => []),
    } as any;
}

describe('AgentHealthMonitor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('marks inbound agents online when call-home WS is active', async () => {
        const agent = fakeAgent({ id: 'store-id', address: 'inbound://ws-id-123' });
        const store = fakeStore([agent]);
        const mgr = fakeAgentManager({ hasAgent: true });
        const monitor = new AgentHealthMonitor(store, 60_000, undefined, mgr);

        monitor.start();
        await vi.waitFor(() => expect(store.updateStatus).toHaveBeenCalled());
        monitor.stop();

        expect(mgr.hasAgent).toHaveBeenCalledWith('ws-id-123');
        expect(store.updateStatus).toHaveBeenCalledWith('store-id', 'online');
    });

    it('marks inbound agents offline when call-home WS is gone', async () => {
        const agent = fakeAgent({ id: 'store-id', address: 'inbound://ws-id-123' });
        const store = fakeStore([agent]);
        const mgr = fakeAgentManager({ hasAgent: false });
        const monitor = new AgentHealthMonitor(store, 60_000, undefined, mgr);

        monitor.start();
        await vi.waitFor(() => expect(store.updateStatus).toHaveBeenCalled());
        monitor.stop();

        expect(store.updateStatus).toHaveBeenCalledWith('store-id', 'offline');
    });

    it('marks outbound agents online when WS connection is open', async () => {
        const agent = fakeAgent({ id: 'agent-1', address: 'http://localhost:4000' });
        const store = fakeStore([agent]);
        const mgr = fakeAgentManager({ hasOutbound: true });
        const monitor = new AgentHealthMonitor(store, 60_000, undefined, mgr);

        monitor.start();
        await vi.waitFor(() => expect(store.updateStatus).toHaveBeenCalled());
        monitor.stop();

        expect(mgr.hasOutboundConnection).toHaveBeenCalledWith('agent-1');
        expect(store.updateStatus).toHaveBeenCalledWith('agent-1', 'online');
        expect(mockCheckHealth).not.toHaveBeenCalled();
    });

    it('falls back to HTTP health check when outbound WS is not connected', async () => {
        const agent = fakeAgent({ id: 'agent-1', address: 'http://localhost:4000' });
        const store = fakeStore([agent]);
        const mgr = fakeAgentManager({ hasOutbound: false });
        mockCheckHealth.mockResolvedValueOnce(true);
        const monitor = new AgentHealthMonitor(store, 60_000, undefined, mgr);

        monitor.start();
        await vi.waitFor(() => expect(store.updateStatus).toHaveBeenCalled());
        monitor.stop();

        expect(mockCheckHealth).toHaveBeenCalledWith('http://localhost:4000');
        expect(store.updateStatus).toHaveBeenCalledWith('agent-1', 'online');
    });

    it('marks outbound agent offline when both WS and HTTP fail', async () => {
        const agent = fakeAgent({ id: 'agent-1', address: 'http://localhost:4000' });
        const store = fakeStore([agent]);
        const mgr = fakeAgentManager({ hasOutbound: false });
        mockCheckHealth.mockResolvedValueOnce(false);
        const monitor = new AgentHealthMonitor(store, 60_000, undefined, mgr);

        monitor.start();
        await vi.waitFor(() => expect(store.updateStatus).toHaveBeenCalled());
        monitor.stop();

        expect(store.updateStatus).toHaveBeenCalledWith('agent-1', 'offline');
    });
});
