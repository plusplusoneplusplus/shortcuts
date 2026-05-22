/**
 * Tests for TunnelBridge
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as childProcess from 'child_process';
import { TunnelBridge } from '../../src/proxy/tunnel-bridge';

// Create a fake JWT token with a given expiry (seconds from epoch)
function fakeJwt(expSeconds: number): string {
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp: expSeconds, scp: 'connect' })).toString('base64url');
    return `${header}.${payload}.fake-signature`;
}

// Mock execFile to return a fake token
vi.mock('child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof childProcess>();
    return {
        ...actual,
        execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
            const exp = Math.floor(Date.now() / 1000) + 86400; // 24h from now
            const token = fakeJwt(exp);
            cb(null, `Token tunnel ID: test-tunnel\nToken scope: connect\nToken lifetime: 1.00:00:00\nToken expiration: 2026-05-23 00:00:00 UTC\nToken: ${token}\n`, '');
        }),
    };
});

describe('TunnelBridge', () => {
    let bridge: TunnelBridge;
    let targetServer: http.Server;
    let targetPort: number;

    beforeEach(async () => {
        bridge = new TunnelBridge({ basePort: 19400 });

        // Create a target server that echoes requests
        targetServer = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                method: req.method,
                url: req.url,
            }));
        });

        await new Promise<void>((resolve) => {
            targetServer.listen(0, '127.0.0.1', () => {
                const addr = targetServer.address() as { port: number };
                targetPort = addr.port;
                resolve();
            });
        });
    });

    afterEach(() => {
        bridge.stopAll();
        targetServer.close();
    });

    it('should start a bridge and return local URL', async () => {
        const localUrl = await bridge.start('agent-1', 'tunnel-1', `http://127.0.0.1:${targetPort}`);
        expect(localUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(localUrl).toContain('19400');
    });

    it('should return existing bridge on duplicate start', async () => {
        const url1 = await bridge.start('agent-1', 'tunnel-1', `http://127.0.0.1:${targetPort}`);
        const url2 = await bridge.start('agent-1', 'tunnel-1', `http://127.0.0.1:${targetPort}`);
        expect(url1).toBe(url2);
    });

    it('should auto-increment ports', async () => {
        const url1 = await bridge.start('agent-1', 'tunnel-1', `http://127.0.0.1:${targetPort}`);
        const url2 = await bridge.start('agent-2', 'tunnel-2', `http://127.0.0.1:${targetPort}`);
        expect(url1).toContain('19400');
        expect(url2).toContain('19401');
    });

    it('should proxy requests to target', async () => {
        const localUrl = await bridge.start('agent-1', 'tunnel-1', `http://127.0.0.1:${targetPort}`);

        const resp = await fetch(`${localUrl}/api/health`);
        expect(resp.status).toBe(200);
        const body = await resp.json() as any;
        expect(body.url).toBe('/api/health');
        expect(body.method).toBe('GET');
    });

    it('should stop a bridge', async () => {
        await bridge.start('agent-1', 'tunnel-1', `http://127.0.0.1:${targetPort}`);
        expect(bridge.getLocalUrl('agent-1')).toBeDefined();
        bridge.stop('agent-1');
        expect(bridge.getLocalUrl('agent-1')).toBeUndefined();
    });

    it('should list active bridges', async () => {
        await bridge.start('agent-1', 'tunnel-1', `http://127.0.0.1:${targetPort}`);
        await bridge.start('agent-2', 'tunnel-2', `http://127.0.0.1:${targetPort}`);
        const list = bridge.list();
        expect(list).toHaveLength(2);
        expect(list[0].agentId).toBe('agent-1');
        expect(list[1].agentId).toBe('agent-2');
    });

    it('should stopAll bridges', async () => {
        await bridge.start('agent-1', 'tunnel-1', `http://127.0.0.1:${targetPort}`);
        await bridge.start('agent-2', 'tunnel-2', `http://127.0.0.1:${targetPort}`);
        bridge.stopAll();
        expect(bridge.list()).toHaveLength(0);
    });

    it('should return 502 if target is unreachable', async () => {
        const localUrl = await bridge.start('agent-x', 'tunnel-x', 'http://127.0.0.1:1');
        const resp = await fetch(`${localUrl}/api/health`);
        expect(resp.status).toBe(502);
    });

    it('should send X-Tunnel-Authorization header on proxied HTTP requests', async () => {
        // Replace target server with one that captures headers
        targetServer.close();
        let capturedHeaders: http.IncomingHttpHeaders = {};
        targetServer = http.createServer((req, res) => {
            capturedHeaders = req.headers;
            res.writeHead(200);
            res.end('ok');
        });
        await new Promise<void>((resolve) => {
            targetServer.listen(0, '127.0.0.1', () => {
                const addr = targetServer.address() as { port: number };
                targetPort = addr.port;
                resolve();
            });
        });

        const localUrl = await bridge.start('agent-auth', 'tunnel-auth', `http://127.0.0.1:${targetPort}`);
        await fetch(`${localUrl}/api/test`);
        expect(capturedHeaders['user-agent']).toBe('CoCContainer/1.0');
        expect(capturedHeaders['x-tunnel-authorization']).toMatch(/^tunnel /);
    });

    it('should send X-Tunnel-Authorization header on WebSocket upgrade requests', async () => {
        // Replace target server with one that captures upgrade headers
        targetServer.close();
        let capturedHeaders: http.IncomingHttpHeaders = {};
        targetServer = http.createServer((_req, res) => {
            res.writeHead(404);
            res.end();
        });
        targetServer.on('upgrade', (req, socket) => {
            capturedHeaders = req.headers;
            // Respond with a proper 101 to complete the handshake
            socket.write(
                'HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                '\r\n'
            );
            socket.end();
        });
        await new Promise<void>((resolve) => {
            targetServer.listen(0, '127.0.0.1', () => {
                const addr = targetServer.address() as { port: number };
                targetPort = addr.port;
                resolve();
            });
        });

        const localUrl = await bridge.start('agent-ws', 'tunnel-ws', `http://127.0.0.1:${targetPort}`);
        const { WebSocket } = await import('ws');
        const ws = new WebSocket(`${localUrl.replace('http', 'ws')}/ws`);
        await new Promise<void>((resolve) => {
            ws.on('open', () => { ws.close(); resolve(); });
            ws.on('error', () => { resolve(); });
        });

        expect(capturedHeaders['user-agent']).toBe('CoCContainer/1.0');
        expect(capturedHeaders['x-tunnel-authorization']).toMatch(/^tunnel /);
    });
});
