/**
 * Tests for the Agent ↔ Container call-home protocol and InboundAgentManager.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { InboundAgentManager } from '../../src/inbound/inbound-agent-manager';
import { createMessage, parseMessage, type ChannelMessage } from '../../src/inbound/protocol';

// ============================================================================
// Protocol tests
// ============================================================================

describe('protocol', () => {
    describe('createMessage', () => {
        it('creates a message with auto-generated ID', () => {
            const msg = createMessage('register', { name: 'test-agent' });
            expect(msg.id).toBeTruthy();
            expect(msg.type).toBe('register');
            expect(msg.payload).toEqual({ name: 'test-agent' });
        });

        it('creates a message with provided ID', () => {
            const msg = createMessage('heartbeat', { timestamp: 123 }, 'custom-id');
            expect(msg.id).toBe('custom-id');
        });

        it('generates unique IDs', () => {
            const ids = new Set<string>();
            for (let i = 0; i < 100; i++) {
                ids.add(createMessage('heartbeat', {}).id);
            }
            expect(ids.size).toBe(100);
        });
    });

    describe('parseMessage', () => {
        it('parses valid message', () => {
            const raw = JSON.stringify({ id: 'x', type: 'register', payload: { name: 'a' } });
            const msg = parseMessage(raw);
            expect(msg).toEqual({ id: 'x', type: 'register', payload: { name: 'a' } });
        });

        it('returns null for invalid JSON', () => {
            expect(parseMessage('not json')).toBeNull();
        });

        it('returns null for message without type', () => {
            expect(parseMessage(JSON.stringify({ id: 'x', payload: {} }))).toBeNull();
        });

        it('returns null for message without payload', () => {
            expect(parseMessage(JSON.stringify({ id: 'x', type: 'register' }))).toBeNull();
        });
    });
});

// ============================================================================
// Mock WebSocket
// ============================================================================

class MockWebSocket extends EventEmitter {
    readyState = 1; // OPEN
    sentMessages: string[] = [];

    send(data: string) {
        this.sentMessages.push(data);
    }

    close() {
        this.readyState = 3; // CLOSED
        this.emit('close');
    }

    simulateMessage(msg: ChannelMessage) {
        this.emit('message', Buffer.from(JSON.stringify(msg)));
    }
}

// ============================================================================
// InboundAgentManager tests
// ============================================================================

describe('InboundAgentManager', () => {
    let manager: InboundAgentManager;

    beforeEach(() => {
        manager = new InboundAgentManager({ requestTimeoutMs: 1000 });
    });

    afterEach(() => {
        manager.close();
    });

    describe('agent registration', () => {
        it('registers an agent on register message', () => {
            const ws = new MockWebSocket();
            manager.handleConnection(ws as any);

            ws.simulateMessage(createMessage('register', {
                name: 'test-agent',
                agentId: 'agent-1',
            }));

            expect(manager.hasAgent('agent-1')).toBe(true);
            const agent = manager.getAgent('agent-1');
            expect(agent?.name).toBe('test-agent');
        });

        it('sends registered confirmation', () => {
            const ws = new MockWebSocket();
            manager.handleConnection(ws as any);

            ws.simulateMessage(createMessage('register', {
                name: 'test-agent',
                agentId: 'agent-1',
            }));

            expect(ws.sentMessages.length).toBe(1);
            const response = JSON.parse(ws.sentMessages[0]);
            expect(response.type).toBe('registered');
            expect(response.payload.agentId).toBe('agent-1');
            expect(response.payload.reconnected).toBe(false);
        });

        it('assigns an ID if agent does not provide one', () => {
            const ws = new MockWebSocket();
            manager.handleConnection(ws as any);

            ws.simulateMessage(createMessage('register', { name: 'auto-id-agent' }));

            const agents = manager.listAgents();
            expect(agents.length).toBe(1);
            expect(agents[0].name).toBe('auto-id-agent');
            expect(agents[0].id).toBeTruthy();
        });

        it('handles reconnection (same agentId)', () => {
            const ws1 = new MockWebSocket();
            const ws2 = new MockWebSocket();
            manager.handleConnection(ws1 as any);
            manager.handleConnection(ws2 as any);

            ws1.simulateMessage(createMessage('register', { name: 'a1', agentId: 'x' }));
            ws2.simulateMessage(createMessage('register', { name: 'a1-reconnected', agentId: 'x' }));

            expect(manager.listAgents().length).toBe(1);
            const agent = manager.getAgent('x');
            expect(agent?.name).toBe('a1-reconnected');
            expect(agent?.ws).toBe(ws2);

            const response = JSON.parse(ws2.sentMessages[0]);
            expect(response.payload.reconnected).toBe(true);
        });

        it('emits agent-connected event', () => {
            const ws = new MockWebSocket();
            const handler = vi.fn();
            manager.on('agent-connected', handler);
            manager.handleConnection(ws as any);

            ws.simulateMessage(createMessage('register', { name: 'ev-agent', agentId: 'ev-1' }));

            expect(handler).toHaveBeenCalledOnce();
            expect(handler.mock.calls[0][0].id).toBe('ev-1');
            expect(handler.mock.calls[0][0].name).toBe('ev-agent');
        });

        it('re-register on same WS updates workspaces without closing connection', () => {
            const ws = new MockWebSocket();
            const handler = vi.fn();
            manager.on('agent-connected', handler);
            manager.handleConnection(ws as any);

            // Initial register without workspaces
            ws.simulateMessage(createMessage('register', { name: 'ws-agent', agentId: 'ws-1' }));
            expect(handler).toHaveBeenCalledOnce();

            // Second register on same WS with workspaces (simulating workspace update)
            ws.simulateMessage(createMessage('register', {
                name: 'ws-agent',
                agentId: 'ws-1',
                workspaces: [{ id: 'repo1', name: 'my-repo', rootPath: '/home/user/repo' }],
            }));

            // Should NOT emit agent-connected again (same WS)
            expect(handler).toHaveBeenCalledOnce();
            // Should NOT close the WS
            expect(ws.readyState).not.toBe(3); // 3 = CLOSED
            // Workspaces should be updated
            const agent = manager.getAgent('ws-1');
            expect(agent?.workspaces).toEqual([{ id: 'repo1', name: 'my-repo', rootPath: '/home/user/repo' }]);
        });

        it('reconnection from different WS closes old connection', () => {
            const ws1 = new MockWebSocket();
            const ws2 = new MockWebSocket();
            const handler = vi.fn();
            manager.on('agent-connected', handler);
            manager.handleConnection(ws1 as any);
            manager.handleConnection(ws2 as any);

            ws1.simulateMessage(createMessage('register', { name: 'a', agentId: 'reconn-1' }));
            ws2.simulateMessage(createMessage('register', { name: 'a', agentId: 'reconn-1' }));

            // Should emit agent-connected twice (different WS)
            expect(handler).toHaveBeenCalledTimes(2);
            // Old WS should be closed
            expect(ws1.readyState).toBe(3); // CLOSED
            // New WS should be active
            const agent = manager.getAgent('reconn-1');
            expect(agent?.ws).toBe(ws2);
        });
    });

    describe('agent disconnection', () => {
        it('removes agent on WS close', () => {
            const ws = new MockWebSocket();
            manager.handleConnection(ws as any);
            ws.simulateMessage(createMessage('register', { name: 'a', agentId: 'disc-1' }));

            expect(manager.hasAgent('disc-1')).toBe(true);
            ws.close();
            expect(manager.hasAgent('disc-1')).toBe(false);
        });

        it('emits agent-disconnected event', () => {
            const ws = new MockWebSocket();
            const handler = vi.fn();
            manager.on('agent-disconnected', handler);
            manager.handleConnection(ws as any);
            ws.simulateMessage(createMessage('register', { name: 'disc-agent', agentId: 'disc-2' }));

            ws.close();

            expect(handler).toHaveBeenCalledWith('disc-2', 'disc-agent');
        });
    });

    describe('heartbeat', () => {
        it('updates lastHeartbeat on heartbeat message', () => {
            const ws = new MockWebSocket();
            manager.handleConnection(ws as any);
            ws.simulateMessage(createMessage('register', { name: 'hb', agentId: 'hb-1' }));

            const timestamp = Date.now() + 1000;
            ws.simulateMessage(createMessage('heartbeat', { timestamp }));

            const agent = manager.getAgent('hb-1');
            expect(agent?.lastHeartbeat).toBe(timestamp);
        });
    });

    describe('event forwarding', () => {
        it('emits agent-event on event message', () => {
            const ws = new MockWebSocket();
            const handler = vi.fn();
            manager.on('agent-event', handler);
            manager.handleConnection(ws as any);
            ws.simulateMessage(createMessage('register', { name: 'ev', agentId: 'ev-1' }));

            const eventData = JSON.stringify({ type: 'process:completed', process: { id: 'p1' } });
            ws.simulateMessage(createMessage('event', { data: eventData }));

            expect(handler).toHaveBeenCalledWith('ev-1', 'ev', eventData);
        });
    });

    describe('request proxying', () => {
        it('sends request message to agent', async () => {
            const ws = new MockWebSocket();
            manager.handleConnection(ws as any);
            ws.simulateMessage(createMessage('register', { name: 'px', agentId: 'px-1' }));

            // Start proxy request (don't await yet)
            const promise = manager.proxyRequest('px-1', 'GET', '/api/health', {});

            // Agent should receive request
            expect(ws.sentMessages.length).toBe(2); // registered + request
            const reqMsg = JSON.parse(ws.sentMessages[1]);
            expect(reqMsg.type).toBe('request');
            expect(reqMsg.payload.method).toBe('GET');
            expect(reqMsg.payload.path).toBe('/api/health');

            // Simulate response
            ws.simulateMessage(createMessage('response', {
                requestId: reqMsg.payload.requestId,
                status: 200,
                headers: { 'content-type': 'application/json' },
                body: '{"status":"ok"}',
            }));

            const response = await promise;
            expect(response.status).toBe(200);
            expect(response.body).toBe('{"status":"ok"}');
        });

        it('rejects on timeout', async () => {
            const ws = new MockWebSocket();
            manager.handleConnection(ws as any);
            ws.simulateMessage(createMessage('register', { name: 'to', agentId: 'to-1' }));

            await expect(
                manager.proxyRequest('to-1', 'GET', '/api/slow', {})
            ).rejects.toThrow('timed out');
        });

        it('rejects if agent not connected', async () => {
            await expect(
                manager.proxyRequest('nonexistent', 'GET', '/api/x', {})
            ).rejects.toThrow('not connected');
        });
    });

    describe('SSE subscription', () => {
        it('sends subscribe-sse message to agent', () => {
            const ws = new MockWebSocket();
            manager.handleConnection(ws as any);
            ws.simulateMessage(createMessage('register', { name: 'sse', agentId: 'sse-1' }));

            const result = manager.subscribeSSE('sse-1', 'sub-1', '/api/events');

            expect(result).toBe(true);
            const msg = JSON.parse(ws.sentMessages[1]); // [0] is registered
            expect(msg.type).toBe('subscribe-sse');
            expect(msg.payload.subscriptionId).toBe('sub-1');
            expect(msg.payload.path).toBe('/api/events');
        });

        it('emits agent-sse-event on sse-event message', () => {
            const ws = new MockWebSocket();
            const handler = vi.fn();
            manager.on('agent-sse-event', handler);
            manager.handleConnection(ws as any);
            ws.simulateMessage(createMessage('register', { name: 'sse', agentId: 'sse-1' }));

            ws.simulateMessage(createMessage('sse-event', {
                subscriptionId: 'sub-1',
                event: 'update',
                data: '{"progress":50}',
                id: 'ev-1',
            }));

            expect(handler).toHaveBeenCalledWith('sse-1', 'sub-1', 'update', '{"progress":50}', 'ev-1');
        });

        it('returns false for subscribe on unknown agent', () => {
            expect(manager.subscribeSSE('unknown', 'sub-1', '/api/events')).toBe(false);
        });
    });

    describe('close', () => {
        it('closes all agent connections', () => {
            const ws1 = new MockWebSocket();
            const ws2 = new MockWebSocket();
            manager.handleConnection(ws1 as any);
            manager.handleConnection(ws2 as any);
            ws1.simulateMessage(createMessage('register', { name: 'a', agentId: 'c1' }));
            ws2.simulateMessage(createMessage('register', { name: 'b', agentId: 'c2' }));

            manager.close();

            expect(manager.listAgents().length).toBe(0);
            expect(ws1.readyState).toBe(3);
            expect(ws2.readyState).toBe(3);
        });

        it('rejects pending requests on close', async () => {
            const ws = new MockWebSocket();
            manager.handleConnection(ws as any);
            ws.simulateMessage(createMessage('register', { name: 'a', agentId: 'cl-1' }));

            const promise = manager.proxyRequest('cl-1', 'GET', '/api/x', {});
            manager.close();

            await expect(promise).rejects.toThrow('Manager closed');
        });
    });
});
