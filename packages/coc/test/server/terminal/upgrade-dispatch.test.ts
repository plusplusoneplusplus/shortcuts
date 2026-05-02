/**
 * Upgrade Dispatch Tests
 *
 * Tests for attachWebSocketUpgradeHandler: path-based routing of
 * WebSocket upgrade requests between ProcessWebSocketServer (/ws)
 * and TerminalWebSocketServer (/ws/terminal).
 */

import { describe, it, expect, vi } from 'vitest';
import * as http from 'http';
import type { Duplex } from 'stream';
import { attachWebSocketUpgradeHandler } from '../../../src/server/streaming/websocket';

// ============================================================================
// Helpers
// ============================================================================

function createMockSocket(): Duplex {
    return { destroy: vi.fn() } as unknown as Duplex;
}

function createMockRequest(url: string): http.IncomingMessage {
    return { url, headers: { host: 'localhost:4000' } } as http.IncomingMessage;
}

function createMockServer(): http.Server & { _upgradeHandler?: Function } {
    const listeners = new Map<string, Function[]>();
    return {
        on(event: string, handler: Function) {
            if (!listeners.has(event)) listeners.set(event, []);
            listeners.get(event)!.push(handler);
            if (event === 'upgrade') (this as any)._upgradeHandler = handler;
            return this;
        },
        _emitUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
            for (const handler of listeners.get('upgrade') ?? []) {
                handler(req, socket, head);
            }
        },
    } as any;
}

// ============================================================================
// Tests
// ============================================================================

describe('attachWebSocketUpgradeHandler', () => {
    it('should route /ws to processWs', () => {
        const server = createMockServer();
        const processWs = { handleUpgrade: vi.fn() };
        const terminalWs = { handleUpgrade: vi.fn() };
        attachWebSocketUpgradeHandler(server, processWs as any, terminalWs);

        const req = createMockRequest('/ws');
        const socket = createMockSocket();
        const head = Buffer.alloc(0);
        server._emitUpgrade(req, socket, head);

        expect(processWs.handleUpgrade).toHaveBeenCalledWith(req, socket, head);
        expect(terminalWs.handleUpgrade).not.toHaveBeenCalled();
        expect(socket.destroy).not.toHaveBeenCalled();
    });

    it('should route /ws/terminal to terminalWs', () => {
        const server = createMockServer();
        const processWs = { handleUpgrade: vi.fn() };
        const terminalWs = { handleUpgrade: vi.fn() };
        attachWebSocketUpgradeHandler(server, processWs as any, terminalWs);

        const req = createMockRequest('/ws/terminal?workspaceId=x&cols=80&rows=24');
        const socket = createMockSocket();
        const head = Buffer.alloc(0);
        server._emitUpgrade(req, socket, head);

        expect(terminalWs.handleUpgrade).toHaveBeenCalledWith(req, socket, head);
        expect(processWs.handleUpgrade).not.toHaveBeenCalled();
        expect(socket.destroy).not.toHaveBeenCalled();
    });

    it('should destroy socket for unknown paths', () => {
        const server = createMockServer();
        const processWs = { handleUpgrade: vi.fn() };
        const terminalWs = { handleUpgrade: vi.fn() };
        attachWebSocketUpgradeHandler(server, processWs as any, terminalWs);

        const req = createMockRequest('/ws/other');
        const socket = createMockSocket();
        const head = Buffer.alloc(0);
        server._emitUpgrade(req, socket, head);

        expect(processWs.handleUpgrade).not.toHaveBeenCalled();
        expect(terminalWs.handleUpgrade).not.toHaveBeenCalled();
        expect(socket.destroy).toHaveBeenCalled();
    });

    it('should destroy socket for /ws/terminal when terminalWs is undefined', () => {
        const server = createMockServer();
        const processWs = { handleUpgrade: vi.fn() };
        attachWebSocketUpgradeHandler(server, processWs as any, undefined);

        const req = createMockRequest('/ws/terminal?workspaceId=x');
        const socket = createMockSocket();
        const head = Buffer.alloc(0);
        server._emitUpgrade(req, socket, head);

        expect(processWs.handleUpgrade).not.toHaveBeenCalled();
        expect(socket.destroy).toHaveBeenCalled();
    });

    it('should handle /ws/terminal with query params correctly', () => {
        const server = createMockServer();
        const processWs = { handleUpgrade: vi.fn() };
        const terminalWs = { handleUpgrade: vi.fn() };
        attachWebSocketUpgradeHandler(server, processWs as any, terminalWs);

        // With query params that would break a naive string comparison
        const req = createMockRequest('/ws/terminal?workspaceId=abc&cols=80&rows=24');
        const socket = createMockSocket();
        const head = Buffer.alloc(0);
        server._emitUpgrade(req, socket, head);

        expect(terminalWs.handleUpgrade).toHaveBeenCalledWith(req, socket, head);
        expect(processWs.handleUpgrade).not.toHaveBeenCalled();
    });

    it('should route /ws with query params to processWs', () => {
        const server = createMockServer();
        const processWs = { handleUpgrade: vi.fn() };
        const terminalWs = { handleUpgrade: vi.fn() };
        attachWebSocketUpgradeHandler(server, processWs as any, terminalWs);

        const req = createMockRequest('/ws?subscribe=true');
        const socket = createMockSocket();
        const head = Buffer.alloc(0);
        server._emitUpgrade(req, socket, head);

        expect(processWs.handleUpgrade).toHaveBeenCalledWith(req, socket, head);
        expect(terminalWs.handleUpgrade).not.toHaveBeenCalled();
    });

    it('should destroy socket for /ws/ (trailing slash)', () => {
        const server = createMockServer();
        const processWs = { handleUpgrade: vi.fn() };
        const terminalWs = { handleUpgrade: vi.fn() };
        attachWebSocketUpgradeHandler(server, processWs as any, terminalWs);

        const req = createMockRequest('/ws/');
        const socket = createMockSocket();
        const head = Buffer.alloc(0);
        server._emitUpgrade(req, socket, head);

        // /ws/ is not the same as /ws — should be destroyed
        expect(processWs.handleUpgrade).not.toHaveBeenCalled();
        expect(terminalWs.handleUpgrade).not.toHaveBeenCalled();
        expect(socket.destroy).toHaveBeenCalled();
    });
});
