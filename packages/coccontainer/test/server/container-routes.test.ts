/**
 * Full-server characterization tests for previously-uncovered container routes
 * (queue/repos/notifications/preferences stubs, messaging status defaults, Teams
 * config persistence) plus the route-level cache-unification regression:
 * a workspace registered via /api/container/workspace-registered must surface in
 * the /api/workspaces aggregation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as jsYaml from 'js-yaml';

async function httpRequest(url: string, options: { method?: string; body?: any } = {}): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const payload = options.body !== undefined ? JSON.stringify(options.body) : undefined;
        const req = http.request(
            {
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                method: options.method ?? 'GET',
                headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
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
            },
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function createMockAgent(workspaces: any[]): Promise<{ server: http.Server; url: string }> {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            if (req.url === '/api/health') { res.writeHead(200); return res.end(JSON.stringify({ status: 'ok' })); }
            if (req.url === '/api/workspaces') { res.writeHead(200); return res.end(JSON.stringify(workspaces)); }
            res.writeHead(404); res.end('{}');
        });
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as { port: number }).port;
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });
}

describe('Container routes (characterization + regression)', () => {
    let tmpDir: string;
    let containerUrl: string;
    let closeContainer: () => void;
    let mockAgent: { server: http.Server; url: string };

    beforeAll(async () => {
        mockAgent = await createMockAgent([]); // agent reports no workspaces
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coccontainer-routes-'));
        const { createContainerServer } = await import('../../src/server');
        const port = 17000 + Math.floor(Math.random() * 3000);
        const server = await createContainerServer({
            serve: { port, host: '127.0.0.1', dataDir: tmpDir },
            healthCheckIntervalMs: 600_000,
        });
        containerUrl = `http://127.0.0.1:${port}`;
        closeContainer = () => server.close();
        await new Promise(r => setTimeout(r, 150));
    }, 15000);

    afterAll(() => {
        closeContainer?.();
        mockAgent?.server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('queue stub returns empty tasks with zeroed stats', async () => {
        const { status, body } = await httpRequest(`${containerUrl}/api/queue`);
        expect(status).toBe(200);
        expect(body).toEqual({ tasks: [], stats: { pending: 0, running: 0, completed: 0, failed: 0, cancelled: 0 } });
    });

    it('queue repos stub returns empty repos', async () => {
        const { body } = await httpRequest(`${containerUrl}/api/queue/repos`);
        expect(body).toEqual({ repos: [] });
    });

    it('notifications stub returns empty notifications', async () => {
        const { body } = await httpRequest(`${containerUrl}/api/notifications`);
        expect(body).toEqual({ notifications: [] });
    });

    it('preferences GET defaults to {}, then PATCH/PUT merge and persist', async () => {
        expect((await httpRequest(`${containerUrl}/api/preferences`)).body).toEqual({});
        expect((await httpRequest(`${containerUrl}/api/preferences`, { method: 'PATCH', body: { theme: 'dark' } })).body).toEqual({ theme: 'dark' });
        expect((await httpRequest(`${containerUrl}/api/preferences`, { method: 'PUT', body: { density: 'compact' } })).body).toEqual({ theme: 'dark', density: 'compact' });
        expect((await httpRequest(`${containerUrl}/api/preferences`)).body).toEqual({ theme: 'dark', density: 'compact' });
    });

    it('preferences with an unsupported method falls through to 404', async () => {
        const { status } = await httpRequest(`${containerUrl}/api/preferences`, { method: 'DELETE' });
        expect(status).toBe(404);
    });

    it('WhatsApp status returns disabled defaults when the bridge is off', async () => {
        const { body } = await httpRequest(`${containerUrl}/api/container/messaging/status`);
        expect(body).toMatchObject({ enabled: false, status: 'disconnected', qr: null, error: null, userName: 'CoC' });
    });

    it('Teams status returns disabled defaults when the bridge is off', async () => {
        const { body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/status`);
        expect(body).toMatchObject({ enabled: false, status: 'disconnected', mode: 'graph', error: null, botName: 'CoC' });
    });

    it('Teams config persists to config.yaml when no bridge is running', async () => {
        const { body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/config`, { method: 'POST', body: { botName: 'Persisted', enabled: false } });
        expect(body.ok).toBe(true);
        expect(body.message).toContain('restart required');
        const doc = jsYaml.load(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as any;
        expect(doc.messaging.teams.botName).toBe('Persisted');
        expect(doc.messaging.teams.enabled).toBe(false);
    });

    it('REGRESSION: workspace-registered seeds aggregation (route → /api/workspaces)', async () => {
        const reg = await httpRequest(`${containerUrl}/api/container/agents`, { method: 'POST', body: { address: mockAgent.url, name: 'RegAgent' } });
        expect(reg.status).toBe(201);
        const agentId = reg.body.id as string;

        const notify = await httpRequest(`${containerUrl}/api/container/workspace-registered`, {
            method: 'POST',
            body: { agentId, workspace: { id: 'ws-reg', rootPath: '/reg', name: 'Reg' } },
        });
        expect(notify.body).toEqual({ ok: true });

        // The agent itself reports no workspaces, but the registered one must appear.
        const agg = await httpRequest(`${containerUrl}/api/workspaces`);
        const workspaces = (agg.body.workspaces || []) as any[];
        const registered = workspaces.find(w => w.id === 'ws-reg');
        expect(registered).toBeDefined();
        expect(registered).toMatchObject({ agentId, agentName: 'RegAgent', agentAddress: mockAgent.url });
    });
});
