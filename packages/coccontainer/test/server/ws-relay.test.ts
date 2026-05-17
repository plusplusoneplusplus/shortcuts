/**
 * WebSocket relay tests for the CoCContainer server.
 *
 * Verifies that agent WS messages are forwarded to browser clients with the
 * agent payload flattened (top-level `type` field present) rather than wrapped
 * in a `{ agentId, agentName, data }` envelope — the flattened form is required
 * for `isProcessEvent` in `coc-client` to accept the message.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WebSocketServer, WebSocket } from 'ws';

// ── Mock agent with WS support ──────────────────────────────────────────────

function createMockAgentWithWS(): Promise<{
    server: http.Server;
    port: number;
    url: string;
    emitWS: (data: string) => void;
}> {
    const wsClients: WebSocket[] = [];

    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (req.url === '/api/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end('{"status":"ok"}');
            }
            if (req.url === '/api/workspaces') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end('[]');
            }
            if (req.url === '/api/events') {
                // SSE keep-alive (container also connects here)
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                });
                res.write(':ok\n\n');
                return;
            }
            res.writeHead(404);
            res.end('{}');
        });

        const wss = new WebSocketServer({ noServer: true });
        server.on('upgrade', (req, socket, head) => {
            const url = new URL(req.url!, `http://localhost`);
            if (url.pathname === '/ws') {
                wss.handleUpgrade(req, socket, head, (ws) => {
                    wsClients.push(ws);
                    ws.on('close', () => {
                        const idx = wsClients.indexOf(ws);
                        if (idx !== -1) wsClients.splice(idx, 1);
                    });
                });
            } else {
                socket.destroy();
            }
        });

        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve({
                server,
                port: addr.port,
                url: `http://127.0.0.1:${addr.port}`,
                emitWS: (data: string) => {
                    for (const ws of wsClients) {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(data);
                        }
                    }
                },
            });
        });
    });
}

// ── Helper: open a WS client to the container ──────────────────────────────

function connectContainerWS(containerUrl: string): Promise<{
    ws: WebSocket;
    messages: any[];
    close: () => void;
}> {
    return new Promise((resolve, reject) => {
        const wsUrl = containerUrl.replace(/^http/, 'ws') + '/ws';
        const ws = new WebSocket(wsUrl);
        const messages: any[] = [];

        ws.on('open', () => {
            resolve({
                ws,
                messages,
                close: () => ws.close(),
            });
        });
        ws.on('message', (data) => {
            try {
                messages.push(JSON.parse(data.toString()));
            } catch {
                messages.push(data.toString());
            }
        });
        ws.on('error', reject);
    });
}

// ── HTTP helper ─────────────────────────────────────────────────────────────

function httpReq(url: string, opts: { method?: string; body?: any } = {}): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request(
            {
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                method: opts.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString();
                    let body: any;
                    try { body = JSON.parse(raw); } catch { body = raw; }
                    resolve({ status: res.statusCode || 0, body });
                });
            }
        );
        req.on('error', reject);
        if (opts.body) req.write(JSON.stringify(opts.body));
        req.end();
    });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Container WebSocket relay: message format', () => {
    let agent: Awaited<ReturnType<typeof createMockAgentWithWS>>;
    let containerUrl: string;
    let closeContainer: () => void;
    let tmpDir: string;
    let agentId: string;

    beforeAll(async () => {
        agent = await createMockAgentWithWS();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coccontainer-ws-test-'));

        const port = 17000 + Math.floor(Math.random() * 3000);
        const { createContainerServer } = await import('../../src/server');
        const server = await createContainerServer({
            serve: { port, host: '127.0.0.1', dataDir: tmpDir },
            healthCheckIntervalMs: 600_000,
        });
        containerUrl = `http://127.0.0.1:${port}`;
        closeContainer = () => server.close();

        // Register the mock agent
        await new Promise(r => setTimeout(r, 150));
        const reg = await httpReq(containerUrl + '/api/container/agents', {
            method: 'POST',
            body: { address: agent.url, name: 'WS-Test-Agent' },
        });
        agentId = reg.body.id;

        // Allow the container's wsRelay to connect to the agent's /ws
        await new Promise(r => setTimeout(r, 300));
    }, 15_000);

    afterAll(() => {
        closeContainer?.();
        agent?.server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('forwards agent WS events with a flat top-level type field', async () => {
        const client = await connectContainerWS(containerUrl);

        // Give the client a moment to settle
        await new Promise(r => setTimeout(r, 100));

        // Agent broadcasts a process-updated event
        const agentMsg = { type: 'process-updated', process: { id: 'p1', status: 'running', promptPreview: 'hello' } };
        agent.emitWS(JSON.stringify(agentMsg));

        // Wait for relay
        await new Promise(r => setTimeout(r, 300));
        client.close();

        const processEvents = client.messages.filter(m => m.type === 'process-updated');
        expect(processEvents.length).toBeGreaterThanOrEqual(1);

        const evt = processEvents[0];
        // Must have top-level `type` so isProcessEvent() passes
        expect(evt.type).toBe('process-updated');
        // Agent payload fields must be preserved
        expect(evt.process?.id).toBe('p1');
        expect(evt.process?.status).toBe('running');
        // agentId and agentName injected
        expect(evt.agentId).toBe(agentId);
        expect(evt.agentName).toBe('WS-Test-Agent');
    });

    it('does NOT wrap messages in a { agentId, agentName, data } envelope', async () => {
        const client = await connectContainerWS(containerUrl);
        await new Promise(r => setTimeout(r, 100));

        agent.emitWS(JSON.stringify({ type: 'process-added', process: { id: 'p2', status: 'pending' } }));

        await new Promise(r => setTimeout(r, 300));
        client.close();

        const processEvents = client.messages.filter(m => m.type === 'process-added');
        expect(processEvents.length).toBeGreaterThanOrEqual(1);

        const evt = processEvents[0];
        // The old broken format had no `type` and a string `data` field
        expect(typeof evt.data).not.toBe('string');
        expect(evt.type).toBeTruthy();
    });

    it('handles malformed JSON from agent gracefully (fallback path)', async () => {
        const client = await connectContainerWS(containerUrl);
        await new Promise(r => setTimeout(r, 100));

        // Emit non-JSON text — container should not crash, just use raw fallback
        agent.emitWS('not-valid-json');
        await new Promise(r => setTimeout(r, 200));

        // Verify the container is still alive and relaying by sending a valid message
        agent.emitWS(JSON.stringify({ type: 'pong' }));
        await new Promise(r => setTimeout(r, 300));

        client.close();

        // The valid message must have come through
        const pongs = client.messages.filter(m => m.type === 'pong');
        expect(pongs.length).toBeGreaterThanOrEqual(1);
    });
});
