/**
 * Tests for WebClientBridge.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { WebClientBridge } from '../../src/proxy/webclient-bridge';

function createMockWsRelay() {
    const relay = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
    relay.send = vi.fn().mockReturnValue(true);
    return relay;
}

function createMockWs() {
    const ws = new EventEmitter() as EventEmitter & {
        readyState: number;
        send: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
    };
    ws.readyState = 1; // OPEN
    ws.send = vi.fn();
    ws.close = vi.fn();
    return ws;
}

function createMockAgentConnMgr() {
    return { send: vi.fn().mockReturnValue(true) };
}

describe('WebClientBridge', () => {
    let relay: ReturnType<typeof createMockWsRelay>;
    let agentConnMgr: ReturnType<typeof createMockAgentConnMgr>;
    let bridge: WebClientBridge;

    beforeEach(() => {
        relay = createMockWsRelay();
        agentConnMgr = createMockAgentConnMgr();
        bridge = new WebClientBridge({ wsRelay: relay as any, agentConnMgr: agentConnMgr as any });
    });

    it('tracks connected clients', () => {
        const ws = createMockWs();
        expect(bridge.clientCount).toBe(0);

        bridge.handleConnection(ws as any);
        expect(bridge.clientCount).toBe(1);

        ws.emit('close');
        expect(bridge.clientCount).toBe(0);
    });

    it('forwards WSRelay events to browser client', () => {
        const ws = createMockWs();
        bridge.handleConnection(ws as any);

        relay.emit('message', {
            agentId: 'agent-1',
            agentName: 'Agent-Dev1',
            data: JSON.stringify({ type: 'process-updated', process: { id: 'proc-1', status: 'running' } }),
        });

        expect(ws.send).toHaveBeenCalledTimes(1);
        const sent = JSON.parse(ws.send.mock.calls[0][0]);
        expect(sent.type).toBe('process-updated');
        expect(sent.agentId).toBe('agent-1');
        expect(sent.agentName).toBe('Agent-Dev1');
    });

    it('does not forward to closed clients', () => {
        const ws = createMockWs();
        bridge.handleConnection(ws as any);

        ws.readyState = 3; // CLOSED
        relay.emit('message', {
            agentId: 'agent-1',
            agentName: 'Agent-Dev1',
            data: '{}',
        });

        expect(ws.send).not.toHaveBeenCalled();
    });

    it('forwards browser messages to agent via agentConnMgr', () => {
        const ws = createMockWs();
        bridge.handleConnection(ws as any);

        ws.emit('message', Buffer.from(JSON.stringify({
            agentId: 'agent-1',
            data: { type: 'subscribe', processId: 'proc-1' },
        })));

        expect(agentConnMgr.send).toHaveBeenCalledWith('agent-1', JSON.stringify({ type: 'subscribe', processId: 'proc-1' }));
    });

    it('unsubscribes from wsRelay on client disconnect', () => {
        const ws = createMockWs();
        bridge.handleConnection(ws as any);

        // Should have 1 listener
        expect(relay.listenerCount('message')).toBe(1);

        ws.emit('close');

        // Listener removed
        expect(relay.listenerCount('message')).toBe(0);
    });

    it('supports multiple concurrent clients', () => {
        const ws1 = createMockWs();
        const ws2 = createMockWs();
        bridge.handleConnection(ws1 as any);
        bridge.handleConnection(ws2 as any);
        expect(bridge.clientCount).toBe(2);

        relay.emit('message', {
            agentId: 'agent-1',
            agentName: 'Agent-Dev1',
            data: '{"type":"ping"}',
        });

        expect(ws1.send).toHaveBeenCalledTimes(1);
        expect(ws2.send).toHaveBeenCalledTimes(1);
    });

    it('stop() closes all clients', () => {
        const ws1 = createMockWs();
        const ws2 = createMockWs();
        bridge.handleConnection(ws1 as any);
        bridge.handleConnection(ws2 as any);

        bridge.stop();

        expect(ws1.close).toHaveBeenCalled();
        expect(ws2.close).toHaveBeenCalled();
        expect(bridge.clientCount).toBe(0);
    });

    it('ignores malformed browser messages', () => {
        const ws = createMockWs();
        bridge.handleConnection(ws as any);

        // Should not throw
        ws.emit('message', Buffer.from('not json'));
        ws.emit('message', Buffer.from('{}'));

        expect(agentConnMgr.send).not.toHaveBeenCalled();
    });
});
