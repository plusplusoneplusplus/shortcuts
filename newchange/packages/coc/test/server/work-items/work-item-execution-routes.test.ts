import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { registerWorkItemExecutionRoutes } from '../../../src/server/routes/work-item-execution-routes';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';

let tmpDir: string;
let store: FileWorkItemStore;
let server: http.Server;
let baseUrl: string;

const mockProcessStore = {
    getProcess: vi.fn(),
} as any;

function makeServer(enqueue?: any): http.Server {
    const routes: Route[] = [];
    registerWorkItemRoutes({ routes, workItemStore: store });
    registerWorkItemExecutionRoutes({
        routes,
        workItemStore: store,
        processStore: mockProcessStore,
        enqueue,
    });
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as any;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function request(
    method: string,
    urlPath: string,
    body?: unknown,
): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(urlPath, baseUrl);
        const opts: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
        };
        const req = http.request(opts, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let parsed: any = null;
                try { parsed = JSON.parse(raw); } catch { parsed = raw; }
                resolve({ status: res.statusCode!, body: parsed });
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

const REPO_ID = 'test-repo';

describe('Work Item Execution Routes', () => {
    describe('POST /execute', () => {
        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-exec-routes-'));
            store = new FileWorkItemStore({ dataDir: tmpDir });
            const enqueue = vi.fn().mockResolvedValue('task-abc');
            server = makeServer(enqueue);
            await startServer();
        });

        afterEach(async () => {
            await stopServer();
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        it('executes a ready work item', async () => {
            // Create a work item in ready state
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Execute me',
            });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body[0].id;

            // Transition to readyToExecute
            await request('PATCH', `/api/workspaces/${REPO_ID}/work-items/${id}`, { status: 'readyToExecute' });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {});

            expect(res.status).toBe(200);
            expect(res.body.taskId).toBe('task-abc');
        });

        it('rejects non-ready work items', async () => {
            await request('POST', `/api/workspaces/${REPO_ID}/work-items`, {
                title: 'Not ready',
            });
            const list = await request('GET', `/api/workspaces/${REPO_ID}/work-items`);
            const id = list.body[0].id;

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/${id}/execute`, {});
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('Cannot execute');
        });

        it('returns 404 for non-existent work item', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/nonexistent/execute`, {});
            expect(res.status).toBe(404);
        });
    });

    describe('POST /from-chat', () => {
        beforeEach(async () => {
            tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-fromchat-'));
            store = new FileWorkItemStore({ dataDir: tmpDir });
            server = makeServer();
            await startServer();
        });

        afterEach(async () => {
            await stopServer();
            await fs.rm(tmpDir, { recursive: true, force: true });
        });

        it('creates work item from chat process', async () => {
            mockProcessStore.getProcess.mockResolvedValue({
                id: 'proc-1',
                title: 'Chat about auth refactor',
                promptPreview: 'Can you help me refactor...',
                fullPrompt: 'Can you help me refactor the auth module?',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'proc-1',
                title: 'Auth refactor task',
            });

            expect(res.status).toBe(201);
            expect(res.body.title).toBe('Auth refactor task');
            expect(res.body.source).toBe('chat');
            expect(res.body.sourceId).toBe('proc-1');
        });

        it('auto-generates a plan template for chat-created work items', async () => {
            mockProcessStore.getProcess.mockResolvedValue({
                id: 'proc-auto',
                title: 'Implement dark mode',
                fullPrompt: 'Add dark mode support to the dashboard.',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'proc-auto',
            });

            expect(res.status).toBe(201);
            expect(res.body.plan).toBeDefined();
            expect(res.body.plan.content).toContain('## Objective');
            expect(res.body.plan.content).toContain('## Steps');
            expect(res.body.plan.version).toBe(1);
            expect(res.body.status).toBe('planning');
        });

        it('auto-generated plan uses work item title as objective', async () => {
            mockProcessStore.getProcess.mockResolvedValue({
                id: 'proc-title',
                title: 'Refactor auth module',
                fullPrompt: 'Refactor the authentication module for clarity.',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'proc-title',
                title: 'Refactor auth module',
            });

            expect(res.status).toBe(201);
            expect(res.body.plan.content).toContain('Refactor auth module');
        });

        it('extracts title from chat process when not provided', async () => {
            mockProcessStore.getProcess.mockResolvedValue({
                id: 'proc-2',
                title: 'Discuss caching strategy',
                promptPreview: 'What caching...',
                fullPrompt: 'What caching strategy should we use?',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'proc-2',
            });

            expect(res.status).toBe(201);
            expect(res.body.title).toBe('Discuss caching strategy');
            // Always starts as 'planning' now (auto-plan template is generated)
            expect(res.body.status).toBe('planning');
        });

        it('extracts plan from chat result when extractPlan is true', async () => {
            mockProcessStore.getProcess.mockResolvedValue({
                id: 'proc-3',
                title: 'Plan for feature',
                promptPreview: 'Create a plan...',
                fullPrompt: 'Create a plan for implementing caching',
                result: '# Caching Plan\n1. Add Redis\n2. Implement cache layer',
            });

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'proc-3',
                extractPlan: true,
            });

            expect(res.status).toBe(201);
            expect(res.body.plan).toBeDefined();
            expect(res.body.plan.content).toContain('Caching Plan');
            expect(res.body.status).toBe('planning');
        });

        it('rejects missing processId', async () => {
            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                title: 'No process',
            });
            expect(res.status).toBe(400);
            expect(res.body.error).toContain('processId');
        });

        it('returns 404 for non-existent process', async () => {
            mockProcessStore.getProcess.mockResolvedValue(undefined);

            const res = await request('POST', `/api/workspaces/${REPO_ID}/work-items/from-chat`, {
                processId: 'nonexistent',
            });
            expect(res.status).toBe(404);
        });
    });
});
