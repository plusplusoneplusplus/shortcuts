/**
 * Loopback Cross-Origin Policy Tests (AC-02)
 *
 * The dashboard SPA is served from one localhost origin but talks directly to a
 * forwarded remote CoC server at `http://127.0.0.1:{localPort}` — a different
 * origin (differs by port). That target server must therefore allow cross-origin
 * REST + WebSocket from loopback/localhost origins ONLY, and must NEVER use a
 * wildcard `*` or reflect a non-loopback origin.
 *
 * Three layers are covered here:
 *   1. `isLoopbackOrigin` predicate (shared by REST CORS + WS upgrade).
 *   2. `isWebSocketOriginAllowed` WS-origin decision.
 *   3. An integration-style boot of a real HTTP server with the upgrade handler:
 *      a loopback WS upgrade connects; a non-loopback WS upgrade is rejected.
 *
 * Cross-platform compatible (Linux/macOS/Windows).
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { isLoopbackOrigin } from '../../src/server/shared/cors';
import {
    ProcessWebSocketServer,
    attachWebSocketUpgradeHandler,
    isWebSocketOriginAllowed,
} from '../../src/server/streaming/websocket';

// ============================================================================
// 1) isLoopbackOrigin predicate
// ============================================================================

describe('isLoopbackOrigin', () => {
    const allowed = [
        'http://127.0.0.1:4000',
        'http://127.0.0.1',
        'http://localhost:5000',
        'http://localhost',
        'https://localhost:5000',
        'https://127.0.0.1:4000',
        'http://[::1]:4000',
        'https://[::1]',
    ];
    for (const origin of allowed) {
        it(`allows loopback origin ${origin}`, () => {
            expect(isLoopbackOrigin(origin)).toBe(true);
        });
    }

    const rejected = [
        'http://evil.com',
        'https://evil.com',
        'http://192.168.1.10',
        'http://192.168.1.10:4000',
        'http://10.0.0.5:4000',
        'http://attacker.localhost.evil.com',
        'http://localhost.evil.com',
        'http://notlocalhost',
        'http://remote.devtunnels.ms',
        'https://remote.devtunnels.ms',
        // Non-http(s) schemes are rejected even on loopback hosts.
        'ws://127.0.0.1:4000',
        'file://localhost/etc/passwd',
        // Malformed / empty values.
        'not a url',
        '',
    ];
    for (const origin of rejected) {
        it(`rejects non-loopback origin ${JSON.stringify(origin)}`, () => {
            expect(isLoopbackOrigin(origin)).toBe(false);
        });
    }

    it('rejects undefined / null', () => {
        expect(isLoopbackOrigin(undefined)).toBe(false);
        expect(isLoopbackOrigin(null)).toBe(false);
    });
});

// ============================================================================
// 2) isWebSocketOriginAllowed (WS upgrade decision)
// ============================================================================

describe('isWebSocketOriginAllowed', () => {
    it('allows a missing Origin (non-browser client)', () => {
        expect(isWebSocketOriginAllowed(undefined)).toBe(true);
    });

    it('allows loopback origins', () => {
        expect(isWebSocketOriginAllowed('http://127.0.0.1:4000')).toBe(true);
        expect(isWebSocketOriginAllowed('http://localhost:5000')).toBe(true);
        expect(isWebSocketOriginAllowed('http://[::1]:4000')).toBe(true);
    });

    it('rejects non-loopback origins', () => {
        expect(isWebSocketOriginAllowed('http://evil.com')).toBe(false);
        expect(isWebSocketOriginAllowed('http://192.168.1.10')).toBe(false);
        expect(isWebSocketOriginAllowed('http://attacker.localhost.evil.com')).toBe(false);
    });

    it('rejects a duplicated (array) Origin header', () => {
        expect(isWebSocketOriginAllowed(['http://localhost:5000', 'http://evil.com'])).toBe(false);
    });
});

// ============================================================================
// 3) Integration: real server upgrade handler honors the WS-origin rule
// ============================================================================

describe('attachWebSocketUpgradeHandler origin enforcement', () => {
    let server: http.Server | undefined;
    let wsServer: ProcessWebSocketServer | undefined;

    afterEach(async () => {
        try { wsServer?.closeAll(); } catch { /* ignore */ }
        if (server) {
            await new Promise<void>(resolve => server!.close(() => resolve()));
        }
        server = undefined;
        wsServer = undefined;
    });

    async function boot(): Promise<number> {
        wsServer = new ProcessWebSocketServer();
        wsServer.attachConnectionHandler();
        server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
        attachWebSocketUpgradeHandler(server, wsServer);
        await new Promise<void>((resolve, reject) => {
            server!.on('error', reject);
            server!.listen(0, '127.0.0.1', resolve);
        });
        return (server!.address() as AddressInfo).port;
    }

    /** Attempt a WS connection with an explicit Origin; resolve open/close/error. */
    function tryConnect(port: number, origin?: string): Promise<{ opened: boolean; code?: number; errored: boolean }> {
        return new Promise((resolve) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin ? { origin } : undefined);
            let settled = false;
            const settle = (result: { opened: boolean; code?: number; errored: boolean }) => {
                if (settled) { return; }
                settled = true;
                ws.removeAllListeners();
                resolve(result);
            };
            ws.on('open', () => {
                // Only an established connection can be cleanly closed; the
                // rejection paths must NOT call close()/terminate() on the ws
                // wrapper (it throws "closed before connection established").
                try { ws.close(); } catch { /* ignore */ }
                settle({ opened: true, errored: false });
            });
            ws.on('unexpected-response', (_req, res) => {
                const code = res.statusCode;
                res.resume(); // drain so the socket can close
                settle({ opened: false, code, errored: true });
            });
            ws.on('error', () => settle({ opened: false, errored: true }));
        });
    }

    it('accepts a loopback Origin WS upgrade', async () => {
        const port = await boot();
        const result = await tryConnect(port, `http://127.0.0.1:${port}`);
        expect(result.opened).toBe(true);
        expect(result.errored).toBe(false);
    });

    it('accepts a localhost Origin WS upgrade (cross-port)', async () => {
        const port = await boot();
        const result = await tryConnect(port, 'http://localhost:5173');
        expect(result.opened).toBe(true);
    });

    it('accepts an upgrade with no Origin (non-browser client)', async () => {
        const port = await boot();
        const result = await tryConnect(port, undefined);
        expect(result.opened).toBe(true);
    });

    it('rejects a non-loopback Origin WS upgrade with 403', async () => {
        const port = await boot();
        const result = await tryConnect(port, 'http://evil.com');
        expect(result.opened).toBe(false);
        expect(result.errored).toBe(true);
        expect(result.code).toBe(403);
    });

    it('rejects a private-LAN Origin WS upgrade', async () => {
        const port = await boot();
        const result = await tryConnect(port, 'http://192.168.1.10:4000');
        expect(result.opened).toBe(false);
        expect(result.errored).toBe(true);
    });
});
