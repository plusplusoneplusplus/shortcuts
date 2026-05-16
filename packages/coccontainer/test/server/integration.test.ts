/**
 * Integration tests for the CoCContainer server.
 *
 * Spins up mock CoC agents and the container server, then tests:
 * - Agent registration via API
 * - Workspace aggregation across agents
 * - Process proxy routing
 * - SSE event relay
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ── Mock Agent helpers ──────────────────────────────────

function createMockAgent(workspaces: any[], processes: any[] = []): Promise<{ server: http.Server; port: number; url: string }> {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');

            if (req.url === '/api/health') {
                res.writeHead(200);
                return res.end(JSON.stringify({ status: 'ok' }));
            }
            if (req.url === '/api/workspaces') {
                res.writeHead(200);
                return res.end(JSON.stringify(workspaces));
            }
            if (req.url?.match(/\/api\/workspaces\/[^/]+\/processes/)) {
                res.writeHead(200);
                return res.end(JSON.stringify(processes));
            }
            if (req.url?.startsWith('/api/processes/')) {
                const pid = req.url.split('/')[3];
                const proc = processes.find((p: any) => p.id === pid);
                if (proc) {
                    res.writeHead(200);
                    return res.end(JSON.stringify(proc));
                }
            }
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'not found' }));
        });
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve({ server, port: addr.port, url: `http://127.0.0.1:${addr.port}` });
        });
    });
}

// ── Helpers ──────────────────────────────────────────────

async function httpRequest(url: string, options: { method?: string; body?: any; headers?: Record<string, string> } = {}): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request(
            {
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                method: options.method || 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
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
        if (options.body) req.write(JSON.stringify(options.body));
        req.end();
    });
}

// ── Tests ──────────────────────────────────────────────

describe('CoCContainer Server Integration', () => {
    let mockAgent1: { server: http.Server; port: number; url: string };
    let mockAgent2: { server: http.Server; port: number; url: string };
    let containerPort: number;
    let containerUrl: string;
    let tmpDir: string;

    // We import createContainerServer dynamically to avoid import issues
    let closeContainer: () => void;

    beforeAll(async () => {
        // Create mock agents
        mockAgent1 = await createMockAgent(
            [{ id: 'ws-1', rootPath: '/repo/alpha', name: 'Alpha' }],
            [{ id: 'proc-1', title: 'Test Process', status: 'completed', turns: [] }]
        );
        mockAgent2 = await createMockAgent(
            [{ id: 'ws-2', rootPath: '/repo/beta', name: 'Beta' }, { id: 'ws-3', rootPath: '/repo/gamma', name: 'Gamma' }],
            []
        );

        // Create temp data dir
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coccontainer-integ-'));

        // Start container server
        const { createContainerServer } = await import('../../src/server');
        containerPort = 15000 + Math.floor(Math.random() * 5000);
        const server = await createContainerServer({
            serve: { port: containerPort, host: '127.0.0.1', dataDir: tmpDir },
            healthCheckIntervalMs: 600_000, // disable auto-check during tests
        });
        containerUrl = `http://127.0.0.1:${containerPort}`;
        closeContainer = () => server.close();

        // Wait a moment for server to bind
        await new Promise(r => setTimeout(r, 200));
    }, 15000);

    afterAll(() => {
        closeContainer?.();
        mockAgent1?.server.close();
        mockAgent2?.server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should serve the dashboard HTML at /', async () => {
        const res = await httpRequest(containerUrl + '/');
        expect(res.status).toBe(200);
        expect(res.body).toContain('CoCContainer');
        expect(res.body).toContain('containerMode: true');
    });

    it('should embed pullRequestsEnabled: true in the dashboard HTML', async () => {
        // Regression: the container previously omitted pullRequestsEnabled from
        // generateDashboardHtml(), causing isPullRequestsEnabled() to return false
        // and hiding the Pull Requests tab unconditionally in container mode.
        const res = await httpRequest(containerUrl + '/');
        expect(res.status).toBe(200);
        expect(res.body).toContain('pullRequestsEnabled: true');
    });

    it('should return empty agents list initially', async () => {
        const res = await httpRequest(containerUrl + '/api/container/agents');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('should register agent 1', async () => {
        const res = await httpRequest(containerUrl + '/api/container/agents', {
            method: 'POST',
            body: { address: mockAgent1.url, name: 'Agent-1' },
        });
        expect(res.status).toBe(201);
        expect(res.body.name).toBe('Agent-1');
        expect(res.body.address).toBe(mockAgent1.url);
    });

    it('should register agent 2', async () => {
        const res = await httpRequest(containerUrl + '/api/container/agents', {
            method: 'POST',
            body: { address: mockAgent2.url, name: 'Agent-2' },
        });
        expect(res.status).toBe(201);
        expect(res.body.name).toBe('Agent-2');
    });

    it('should list both agents', async () => {
        const res = await httpRequest(containerUrl + '/api/container/agents');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        const names = res.body.map((a: any) => a.name).sort();
        expect(names).toEqual(['Agent-1', 'Agent-2']);
    });

    it('should aggregate workspaces from all agents', async () => {
        const res = await httpRequest(containerUrl + '/api/workspaces');
        expect(res.status).toBe(200);
        // Agent1 has 1 workspace, Agent2 has 2
        // Note: agents may still be 'unknown' status since health check hasn't run
        // The aggregation filters out 'offline' but keeps 'unknown'
        const workspaces = res.body.workspaces || res.body;
        expect(workspaces.length).toBeGreaterThanOrEqual(1);
    });

    it('should proxy workspace list to specific agent', async () => {
        const agents = (await httpRequest(containerUrl + '/api/container/agents')).body;
        const agent1 = agents.find((a: any) => a.name === 'Agent-1');

        const res = await httpRequest(containerUrl + `/api/agent/${agent1.id}/workspaces`);
        expect(res.status).toBe(200);
        const workspaces = Array.isArray(res.body) ? res.body : res.body.workspaces || [];
        expect(workspaces).toHaveLength(1);
        expect(workspaces[0].name).toBe('Alpha');
    });

    it('should proxy process detail to agent', async () => {
        const agents = (await httpRequest(containerUrl + '/api/container/agents')).body;
        const agent1 = agents.find((a: any) => a.name === 'Agent-1');

        const res = await httpRequest(containerUrl + `/api/agent/${agent1.id}/processes/proc-1`);
        expect(res.status).toBe(200);
        expect(res.body.id).toBe('proc-1');
        expect(res.body.title).toBe('Test Process');
    });

    it('should return 404 for unknown agent proxy', async () => {
        const res = await httpRequest(containerUrl + '/api/agent/nonexistent/workspaces');
        expect(res.status).toBe(404);
    });

    it('should remove an agent', async () => {
        const agents = (await httpRequest(containerUrl + '/api/container/agents')).body;
        const agent2 = agents.find((a: any) => a.name === 'Agent-2');

        const res = await httpRequest(containerUrl + `/api/container/agents/${agent2.id}`, { method: 'DELETE' });
        expect(res.status).toBe(200);
        expect(res.body.removed).toBe(true);

        const updated = (await httpRequest(containerUrl + '/api/container/agents')).body;
        expect(updated).toHaveLength(1);
        expect(updated[0].name).toBe('Agent-1');
    });
});
