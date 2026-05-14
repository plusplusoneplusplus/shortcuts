/**
 * Tests for TunnelBridge
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { TunnelBridge } from '../../src/proxy/tunnel-bridge';

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
});
