/**
 * WebSocket broadcastGitChanged Tests
 *
 * Tests for the git-changed event broadcast on ProcessWebSocketServer:
 * - Workspace-scoped delivery
 * - Unsubscribed clients receive all events
 * - Message shape validation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessWebSocketServer } from '../src/websocket';
import type { WSClient } from '../src/websocket';

// ============================================================================
// Helpers
// ============================================================================

function createMockClient(id: string, workspaceId?: string): WSClient {
    return {
        socket: {} as any,
        id,
        send: vi.fn(),
        close: vi.fn(),
        lastSeen: Date.now(),
        workspaceId,
    };
}

function addClientToServer(server: ProcessWebSocketServer, client: WSClient): void {
    (server as any).clients.add(client);
}

// ============================================================================
// Tests
// ============================================================================

describe('ProcessWebSocketServer.broadcastGitChanged', () => {
    let server: ProcessWebSocketServer;

    beforeEach(() => {
        server = new ProcessWebSocketServer();
    });

    it('sends git-changed event to client subscribed to matching workspace', () => {
        const client = createMockClient('c1', 'ws-1');
        addClientToServer(server, client);

        server.broadcastGitChanged('ws-1', 'stage');

        expect(client.send).toHaveBeenCalledTimes(1);
        const msg = JSON.parse((client.send as any).mock.calls[0][0]);
        expect(msg.type).toBe('git-changed');
        expect(msg.workspaceId).toBe('ws-1');
        expect(msg.trigger).toBe('stage');
        expect(typeof msg.timestamp).toBe('number');
    });

    it('does not send to client subscribed to a different workspace', () => {
        const client = createMockClient('c1', 'ws-2');
        addClientToServer(server, client);

        server.broadcastGitChanged('ws-1', 'push');

        expect(client.send).not.toHaveBeenCalled();
    });

    it('sends to unsubscribed clients (no workspaceId filter)', () => {
        const client = createMockClient('c1');
        addClientToServer(server, client);

        server.broadcastGitChanged('ws-1', 'pull');

        expect(client.send).toHaveBeenCalledTimes(1);
    });

    it('sends to multiple matching clients', () => {
        const c1 = createMockClient('c1', 'ws-1');
        const c2 = createMockClient('c2', 'ws-1');
        const c3 = createMockClient('c3', 'ws-2');
        addClientToServer(server, c1);
        addClientToServer(server, c2);
        addClientToServer(server, c3);

        server.broadcastGitChanged('ws-1', 'merge');

        expect(c1.send).toHaveBeenCalledTimes(1);
        expect(c2.send).toHaveBeenCalledTimes(1);
        expect(c3.send).not.toHaveBeenCalled();
    });

    it('includes different trigger strings in the message', () => {
        const client = createMockClient('c1', 'ws-1');
        addClientToServer(server, client);

        const triggers = ['branch-switch', 'push', 'pull', 'fetch', 'merge', 'stash', 'stash-pop', 'stage', 'unstage', 'discard', 'stage-batch', 'unstage-batch'];
        for (const trigger of triggers) {
            (client.send as any).mockClear();
            server.broadcastGitChanged('ws-1', trigger);
            const msg = JSON.parse((client.send as any).mock.calls[0][0]);
            expect(msg.trigger).toBe(trigger);
        }
    });

    it('handles no connected clients without error', () => {
        expect(() => server.broadcastGitChanged('ws-1', 'stage')).not.toThrow();
    });
});

describe('ServerMessage git-changed type in broadcastProcessEvent', () => {
    let server: ProcessWebSocketServer;

    beforeEach(() => {
        server = new ProcessWebSocketServer();
    });

    it('routes git-changed via broadcastProcessEvent using workspace filtering', () => {
        const c1 = createMockClient('c1', 'ws-1');
        const c2 = createMockClient('c2', 'ws-2');
        addClientToServer(server, c1);
        addClientToServer(server, c2);

        server.broadcastProcessEvent({
            type: 'git-changed',
            workspaceId: 'ws-1',
            trigger: 'stage',
            timestamp: Date.now(),
        });

        expect(c1.send).toHaveBeenCalledTimes(1);
        expect(c2.send).not.toHaveBeenCalled();
    });
});
