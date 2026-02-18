/**
 * WebSocket File-Scoped Subscription Tests
 *
 * Tests for file-scoped subscriptions on ProcessWebSocketServer:
 * - subscribe-file / unsubscribe-file client messages
 * - broadcastFileEvent only delivers to subscribed clients
 * - Multiple files per client
 * - Backward compat: unsubscribed clients don't receive file events
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessWebSocketServer } from '../src/websocket';
import type { WSClient, ServerMessage, MarkdownCommentSummary } from '../src/websocket';

// ============================================================================
// Helpers
// ============================================================================

function createMockClient(id: string, subscribedFiles?: string[]): WSClient {
    const client: WSClient = {
        socket: {} as any,
        id,
        send: vi.fn(),
        close: vi.fn(),
        lastSeen: Date.now(),
    };
    if (subscribedFiles) {
        client.subscribedFiles = new Set(subscribedFiles);
    }
    return client;
}

function createSampleSummary(): MarkdownCommentSummary {
    return {
        id: 'comment_1',
        filePath: 'docs/readme.md',
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello',
        comment: 'test',
        status: 'open',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
    };
}

/**
 * Access the private `clients` set on ProcessWebSocketServer.
 * This is needed for unit testing without a real HTTP server.
 */
function addClientToServer(server: ProcessWebSocketServer, client: WSClient): void {
    (server as any).clients.add(client);
}

// ============================================================================
// Tests
// ============================================================================

describe('WebSocket file-scoped subscriptions', () => {
    let server: ProcessWebSocketServer;

    beforeEach(() => {
        server = new ProcessWebSocketServer();
    });

    describe('broadcastFileEvent', () => {
        it('should send to client subscribed to the target file', () => {
            const clientA = createMockClient('a', ['docs/readme.md']);
            addClientToServer(server, clientA);

            const msg: ServerMessage = {
                type: 'comment-added',
                filePath: 'docs/readme.md',
                comment: createSampleSummary(),
            };
            server.broadcastFileEvent('docs/readme.md', msg);

            expect(clientA.send).toHaveBeenCalledOnce();
            const parsed = JSON.parse((clientA.send as any).mock.calls[0][0]);
            expect(parsed.type).toBe('comment-added');
            expect(parsed.filePath).toBe('docs/readme.md');
        });

        it('should NOT send to client subscribed to a different file', () => {
            const clientA = createMockClient('a', ['docs/readme.md']);
            const clientB = createMockClient('b', ['src/index.ts']);
            addClientToServer(server, clientA);
            addClientToServer(server, clientB);

            const msg: ServerMessage = {
                type: 'comment-added',
                filePath: 'docs/readme.md',
                comment: createSampleSummary(),
            };
            server.broadcastFileEvent('docs/readme.md', msg);

            expect(clientA.send).toHaveBeenCalledOnce();
            expect(clientB.send).not.toHaveBeenCalled();
        });

        it('should NOT send to client with no file subscriptions', () => {
            const clientNoSub = createMockClient('nosub');
            addClientToServer(server, clientNoSub);

            const msg: ServerMessage = {
                type: 'comment-deleted',
                filePath: 'docs/readme.md',
                commentId: 'c1',
            };
            server.broadcastFileEvent('docs/readme.md', msg);

            expect(clientNoSub.send).not.toHaveBeenCalled();
        });

        it('should send to multiple clients subscribed to the same file', () => {
            const clientA = createMockClient('a', ['docs/readme.md']);
            const clientB = createMockClient('b', ['docs/readme.md']);
            addClientToServer(server, clientA);
            addClientToServer(server, clientB);

            const msg: ServerMessage = {
                type: 'comment-resolved',
                filePath: 'docs/readme.md',
                commentId: 'c1',
            };
            server.broadcastFileEvent('docs/readme.md', msg);

            expect(clientA.send).toHaveBeenCalledOnce();
            expect(clientB.send).toHaveBeenCalledOnce();
        });

        it('should support client subscribed to multiple files', () => {
            const client = createMockClient('multi', ['docs/readme.md', 'src/app.ts']);
            addClientToServer(server, client);

            server.broadcastFileEvent('docs/readme.md', {
                type: 'comment-added',
                filePath: 'docs/readme.md',
                comment: createSampleSummary(),
            });
            server.broadcastFileEvent('src/app.ts', {
                type: 'comment-deleted',
                filePath: 'src/app.ts',
                commentId: 'c2',
            });

            expect(client.send).toHaveBeenCalledTimes(2);
        });

        it('should not interfere with broadcastProcessEvent', () => {
            const client = createMockClient('a', ['docs/readme.md']);
            addClientToServer(server, client);

            // Process events go through broadcastProcessEvent, not file events
            server.broadcastProcessEvent({
                type: 'process-added',
                process: {
                    id: 'p1',
                    promptPreview: 'test',
                    status: 'running',
                    startTime: '2025-01-01T00:00:00.000Z',
                },
            });

            // Client with no workspaceId receives all process events
            expect(client.send).toHaveBeenCalledOnce();
        });
    });

    describe('handleClientMessage (subscribe-file / unsubscribe-file)', () => {
        it('should add file to subscribedFiles on subscribe-file message', () => {
            const client = createMockClient('a');
            addClientToServer(server, client);

            // Simulate handling the message through the private method
            (server as any).handleClientMessage(client, {
                type: 'subscribe-file',
                filePath: 'docs/readme.md',
            });

            expect(client.subscribedFiles).toBeDefined();
            expect(client.subscribedFiles!.has('docs/readme.md')).toBe(true);
        });

        it('should remove file from subscribedFiles on unsubscribe-file message', () => {
            const client = createMockClient('a', ['docs/readme.md', 'src/app.ts']);
            addClientToServer(server, client);

            (server as any).handleClientMessage(client, {
                type: 'unsubscribe-file',
                filePath: 'docs/readme.md',
            });

            expect(client.subscribedFiles!.has('docs/readme.md')).toBe(false);
            expect(client.subscribedFiles!.has('src/app.ts')).toBe(true);
        });

        it('should handle unsubscribe-file when no subscriptions exist', () => {
            const client = createMockClient('a');
            addClientToServer(server, client);

            // Should not throw
            (server as any).handleClientMessage(client, {
                type: 'unsubscribe-file',
                filePath: 'nonexistent.md',
            });

            expect(client.subscribedFiles).toBeUndefined();
        });

        it('should update lastSeen on subscribe-file', () => {
            const client = createMockClient('a');
            client.lastSeen = 1000;
            addClientToServer(server, client);

            (server as any).handleClientMessage(client, {
                type: 'subscribe-file',
                filePath: 'docs/readme.md',
            });

            expect(client.lastSeen).toBeGreaterThan(1000);
        });

        it('should update lastSeen on unsubscribe-file', () => {
            const client = createMockClient('a', ['docs/readme.md']);
            client.lastSeen = 1000;
            addClientToServer(server, client);

            (server as any).handleClientMessage(client, {
                type: 'unsubscribe-file',
                filePath: 'docs/readme.md',
            });

            expect(client.lastSeen).toBeGreaterThan(1000);
        });
    });

    describe('multi-tab scenario', () => {
        it('two tabs editing different files receive only their file events', () => {
            const tab1 = createMockClient('tab1', ['docs/readme.md']);
            const tab2 = createMockClient('tab2', ['src/app.ts']);
            addClientToServer(server, tab1);
            addClientToServer(server, tab2);

            // Event for file A
            server.broadcastFileEvent('docs/readme.md', {
                type: 'comment-added',
                filePath: 'docs/readme.md',
                comment: createSampleSummary(),
            });

            // Event for file B
            server.broadcastFileEvent('src/app.ts', {
                type: 'comment-deleted',
                filePath: 'src/app.ts',
                commentId: 'c2',
            });

            // Tab 1 only got file A event
            expect(tab1.send).toHaveBeenCalledOnce();
            const tab1Msg = JSON.parse((tab1.send as any).mock.calls[0][0]);
            expect(tab1Msg.filePath).toBe('docs/readme.md');

            // Tab 2 only got file B event
            expect(tab2.send).toHaveBeenCalledOnce();
            const tab2Msg = JSON.parse((tab2.send as any).mock.calls[0][0]);
            expect(tab2Msg.filePath).toBe('src/app.ts');
        });
    });
});
