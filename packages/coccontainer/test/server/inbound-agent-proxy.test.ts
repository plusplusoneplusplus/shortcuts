/**
 * Tests for the agent-scoped proxy routing through inbound (WebSocket) agents.
 *
 * Verifies that:
 * - The proxy extracts the inbound registration ID from the agent store address
 * - Requests are correctly routed via the InboundAgentManager
 * - Hop-by-hop headers are filtered from responses
 * - Correct content-length is set on forwarded responses
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import WebSocket from 'ws';
import { createMessage, type ChannelMessage } from '../../src/inbound/protocol';

// Helper: make HTTP requests
async function httpRequest(url: string): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request(
            {
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString();
                    let body: any;
                    try { body = JSON.parse(raw); } catch { body = raw; }
                    resolve({ status: res.statusCode || 0, body, headers: res.headers });
                });
            }
        );
        req.on('error', reject);
        req.end();
    });
}

describe('Inbound Agent Proxy (agent-scoped)', () => {
    let containerPort: number;
    let containerUrl: string;
    let tmpDir: string;
    let closeContainer: () => void;
    let agentWs: WebSocket;
    let registeredAgentId: string;
    let storeAgentId: string;

    beforeAll(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coccontainer-inbound-proxy-'));

        // Start container server
        const { createContainerServer } = await import('../../src/server');
        containerPort = 16000 + Math.floor(Math.random() * 4000);
        const server = await createContainerServer({
            serve: { port: containerPort, host: '127.0.0.1', dataDir: tmpDir },
            healthCheckIntervalMs: 600_000,
        });
        containerUrl = `http://127.0.0.1:${containerPort}`;
        closeContainer = () => server.close();

        await new Promise(r => setTimeout(r, 200));

        // Connect a mock agent via WebSocket (inbound call-home)
        registeredAgentId = 'test-inbound-agent-' + Date.now();
        agentWs = new WebSocket(`ws://127.0.0.1:${containerPort}/ws/agent-link`);
        await new Promise<void>((resolve, reject) => {
            agentWs.on('open', resolve);
            agentWs.on('error', reject);
        });

        // Register the agent
        const registerMsg = createMessage('register', {
            name: 'TestInboundAgent',
            agentId: registeredAgentId,
            workspaces: [
                { id: 'ws-inbound-1', name: 'InboundRepo', rootPath: '/home/user/inbound-repo' },
            ],
        });
        agentWs.send(JSON.stringify(registerMsg));

        // Wait for registered confirmation
        await new Promise<void>((resolve) => {
            agentWs.on('message', function onMsg(data) {
                const msg = JSON.parse(data.toString()) as ChannelMessage;
                if (msg.type === 'registered') {
                    agentWs.off('message', onMsg);
                    resolve();
                }
            });
        });

        // Get the store ID for this agent (the container assigns a different UUID)
        await new Promise(r => setTimeout(r, 100));
        const agents = (await httpRequest(containerUrl + '/api/container/agents')).body;
        const agent = agents.find((a: any) => a.name === 'TestInboundAgent');
        storeAgentId = agent.id;
    }, 15000);

    afterAll(async () => {
        // Close agent WebSocket first to avoid DB-closed errors on disconnect event
        if (agentWs?.readyState === WebSocket.OPEN) {
            agentWs.close();
            await new Promise(r => setTimeout(r, 100));
        }
        closeContainer?.();
        try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
    });

    it('store ID differs from inbound registration ID', () => {
        expect(storeAgentId).toBeTruthy();
        expect(registeredAgentId).toBeTruthy();
        expect(storeAgentId).not.toBe(registeredAgentId);
    });

    it('agent address uses inbound:// scheme with registration ID', async () => {
        const agents = (await httpRequest(containerUrl + '/api/container/agents')).body;
        const agent = agents.find((a: any) => a.id === storeAgentId);
        expect(agent.address).toBe(`inbound://${registeredAgentId}`);
    });

    it('proxies GET request through inbound WebSocket channel', async () => {
        // Set up agent-side to respond to proxied requests
        const responsePromise = new Promise<void>((resolve) => {
            agentWs.on('message', function onMsg(data) {
                const msg = JSON.parse(data.toString()) as ChannelMessage;
                if (msg.type === 'request') {
                    // Agent responds with mock history data
                    const payload = msg.payload as any;
                    const responseMsg = createMessage('response', {
                        requestId: payload.requestId,
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                            'transfer-encoding': 'chunked', // hop-by-hop: should be filtered
                        },
                        body: JSON.stringify({
                            history: [{ id: 'proc-1', title: 'Test Chat', status: 'completed' }],
                            hasMore: false,
                            offset: 0,
                            limit: 100,
                        }),
                    });
                    agentWs.send(JSON.stringify(responseMsg));
                    agentWs.off('message', onMsg);
                    resolve();
                }
            });
        });

        // Make request through agent-scoped proxy using STORE ID
        const res = await httpRequest(
            `${containerUrl}/api/agent/${storeAgentId}/workspaces/ws-inbound-1/history?limit=100&offset=0`
        );

        await responsePromise;

        expect(res.status).toBe(200);
        expect(res.body.history).toHaveLength(1);
        expect(res.body.history[0].title).toBe('Test Chat');
        expect(res.body.hasMore).toBe(false);
    });

    it('filters hop-by-hop headers from proxied response', async () => {
        const responsePromise = new Promise<void>((resolve) => {
            agentWs.on('message', function onMsg(data) {
                const msg = JSON.parse(data.toString()) as ChannelMessage;
                if (msg.type === 'request') {
                    const payload = msg.payload as any;
                    const responseMsg = createMessage('response', {
                        requestId: payload.requestId,
                        status: 200,
                        headers: {
                            'content-type': 'application/json',
                            'transfer-encoding': 'chunked',
                            'connection': 'keep-alive',
                            'x-custom': 'preserved',
                        },
                        body: '{"ok":true}',
                    });
                    agentWs.send(JSON.stringify(responseMsg));
                    agentWs.off('message', onMsg);
                    resolve();
                }
            });
        });

        const res = await httpRequest(
            `${containerUrl}/api/agent/${storeAgentId}/workspaces/ws-inbound-1/history`
        );

        await responsePromise;

        expect(res.status).toBe(200);
        // Hop-by-hop headers from the PROXY response should NOT be forwarded
        expect(res.headers['transfer-encoding']).toBeUndefined();
        // Note: Node.js HTTP server adds its own 'connection' header, so we can't check absence
        // Custom headers should be preserved
        expect(res.headers['x-custom']).toBe('preserved');
        // Content-length should be set correctly
        expect(res.headers['content-length']).toBe(String(Buffer.byteLength('{"ok":true}', 'utf8')));
    });

    it('returns 503 when inbound agent is disconnected', async () => {
        // Create another agent, register, then disconnect
        const ws2 = new WebSocket(`ws://127.0.0.1:${containerPort}/ws/agent-link`);
        await new Promise<void>((resolve, reject) => {
            ws2.on('open', resolve);
            ws2.on('error', reject);
        });

        const agentId2 = 'disc-agent-' + Date.now();
        ws2.send(JSON.stringify(createMessage('register', {
            name: 'DisconnectedAgent',
            agentId: agentId2,
            workspaces: [],
        })));

        // Wait for registration
        await new Promise<void>((resolve) => {
            ws2.on('message', function onMsg(data) {
                const msg = JSON.parse(data.toString()) as ChannelMessage;
                if (msg.type === 'registered') {
                    ws2.off('message', onMsg);
                    resolve();
                }
            });
        });

        await new Promise(r => setTimeout(r, 100));
        const agents = (await httpRequest(containerUrl + '/api/container/agents')).body;
        const agent2 = agents.find((a: any) => a.name === 'DisconnectedAgent');

        // Disconnect the agent
        ws2.close();
        await new Promise(r => setTimeout(r, 100));

        // Try to proxy to disconnected agent — should get 503
        const res = await httpRequest(
            `${containerUrl}/api/agent/${agent2.id}/workspaces`
        );
        expect(res.status).toBe(503);
        expect(res.body.error).toContain('not connected');
    });

    it('proxied request path includes query string', async () => {
        let receivedPath = '';
        const responsePromise = new Promise<void>((resolve) => {
            agentWs.on('message', function onMsg(data) {
                const msg = JSON.parse(data.toString()) as ChannelMessage;
                if (msg.type === 'request') {
                    const payload = msg.payload as any;
                    receivedPath = payload.path;
                    const responseMsg = createMessage('response', {
                        requestId: payload.requestId,
                        status: 200,
                        headers: { 'content-type': 'application/json' },
                        body: '{"history":[]}',
                    });
                    agentWs.send(JSON.stringify(responseMsg));
                    agentWs.off('message', onMsg);
                    resolve();
                }
            });
        });

        await httpRequest(
            `${containerUrl}/api/agent/${storeAgentId}/workspaces/ws-inbound-1/history?limit=50&offset=10`
        );

        await responsePromise;

        // The path sent to agent should be /api/workspaces/ws-inbound-1/history with query
        expect(receivedPath).toBe('/api/workspaces/ws-inbound-1/history?limit=50&offset=10');
    });
});
