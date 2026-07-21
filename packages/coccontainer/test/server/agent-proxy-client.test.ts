/**
 * Unit tests for AgentProxyClient — the shared inbound-vs-HTTP transport policy.
 */

import { describe, it, expect, vi } from 'vitest';
import { URL } from 'url';
import { AgentProxyClient } from '../../src/server/agent-proxy-client';
import type { Agent } from '../../src/store';

function agent(partial: Partial<Agent>): Agent {
    return { id: 'a1', name: 'A', address: 'http://host:1', status: 'unknown', lastSeenAt: null, createdAt: '', ...partial };
}

describe('AgentProxyClient.resolveEffectiveAddress', () => {
    it('prefers SSH, then tunnel, then the raw address', () => {
        const ssh = { getLocalUrl: vi.fn() };
        const tunnel = { getLocalUrl: vi.fn() };
        const client = new AgentProxyClient({} as any, tunnel as any, ssh as any);

        ssh.getLocalUrl.mockReturnValue('http://ssh');
        tunnel.getLocalUrl.mockReturnValue('http://tunnel');
        expect(client.resolveEffectiveAddress('a1', 'http://raw')).toBe('http://ssh');

        ssh.getLocalUrl.mockReturnValue(undefined);
        expect(client.resolveEffectiveAddress('a1', 'http://raw')).toBe('http://tunnel');

        tunnel.getLocalUrl.mockReturnValue(undefined);
        expect(client.resolveEffectiveAddress('a1', 'http://raw')).toBe('http://raw');
    });
});

describe('AgentProxyClient.proxy', () => {
    it('routes inbound agents through the AgentManager channel', async () => {
        const mgr = {
            hasAgent: vi.fn().mockReturnValue(true),
            proxyRequest: vi.fn().mockResolvedValue({ status: 200, body: '[]', headers: {} }),
        };
        const client = new AgentProxyClient(mgr as any, { getLocalUrl: () => undefined } as any, { getLocalUrl: () => undefined } as any);

        const res = await client.proxy(agent({ address: 'inbound://xyz' }), 'GET', '/api/workspaces');
        expect(mgr.hasAgent).toHaveBeenCalledWith('xyz');
        expect(mgr.proxyRequest).toHaveBeenCalledWith('xyz', 'GET', '/api/workspaces');
        expect(res.status).toBe(200);
    });
});

describe('AgentProxyClient.forward', () => {
    it('returns 503 when an inbound agent has no live channel', async () => {
        const mgr = { hasAgent: vi.fn().mockReturnValue(false) };
        const client = new AgentProxyClient(mgr as any, { getLocalUrl: () => undefined } as any, { getLocalUrl: () => undefined } as any);

        const writeHead = vi.fn();
        const end = vi.fn();
        const req = { method: 'GET', headers: {} } as any;
        const res = { writeHead, end } as any;

        await client.forward(agent({ address: 'inbound://xyz' }), req, res, new URL('http://localhost/api/agent/a1/workspaces'), 'workspaces');
        expect(writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'application/json' });
        expect(end).toHaveBeenCalledWith(JSON.stringify({ error: 'Agent not connected via WebSocket channel' }));
    });

    it('proxies inbound requests and strips hop-by-hop headers + accept-encoding', async () => {
        const proxyRequest = vi.fn().mockResolvedValue({
            status: 201,
            body: '{"ok":true}',
            headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked', 'x-keep': '1' },
        });
        const mgr = { hasAgent: vi.fn().mockReturnValue(true), proxyRequest };
        const client = new AgentProxyClient(mgr as any, { getLocalUrl: () => undefined } as any, { getLocalUrl: () => undefined } as any);

        const writeHead = vi.fn();
        const end = vi.fn();
        // Async-iterable request body
        const req: any = {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'accept-encoding': 'gzip' },
            async *[Symbol.asyncIterator]() { yield Buffer.from('{"a":1}'); },
        };
        const res = { writeHead, end } as any;

        await client.forward(agent({ address: 'inbound://xyz' }), req, res, new URL('http://localhost/api/agent/a1/things?q=1'), 'things');

        // Forwarded request: accept-encoding stripped, path preserves query
        expect(proxyRequest).toHaveBeenCalledWith(
            'xyz',
            'POST',
            '/api/things?q=1',
            { 'content-type': 'application/json' },
            '{"a":1}',
        );
        // Response: hop-by-hop stripped, content-length recomputed, status forwarded
        const [status, headers] = writeHead.mock.calls[0];
        expect(status).toBe(201);
        expect(headers['transfer-encoding']).toBeUndefined();
        expect(headers['x-keep']).toBe('1');
        expect(headers['content-length']).toBe(String(Buffer.byteLength('{"ok":true}', 'utf8')));
        expect(end).toHaveBeenCalledWith('{"ok":true}');
    });

    it('returns 502 when the inbound channel throws', async () => {
        const mgr = { hasAgent: vi.fn().mockReturnValue(true), proxyRequest: vi.fn().mockRejectedValue(new Error('boom')) };
        const client = new AgentProxyClient(mgr as any, { getLocalUrl: () => undefined } as any, { getLocalUrl: () => undefined } as any);
        const writeHead = vi.fn();
        const end = vi.fn();
        const req: any = { method: 'GET', headers: {}, async *[Symbol.asyncIterator]() {} };
        const res = { writeHead, end } as any;

        await client.forward(agent({ address: 'inbound://xyz' }), req, res, new URL('http://localhost/api/agent/a1/x'), 'x');
        expect(writeHead).toHaveBeenCalledWith(502, { 'Content-Type': 'application/json' });
        expect(end).toHaveBeenCalledWith(JSON.stringify({ error: 'Proxy via channel failed', message: 'boom' }));
    });
});
