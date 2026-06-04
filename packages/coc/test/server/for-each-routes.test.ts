import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../src/server/types';
import { createRouter } from '../../src/server/shared/router';
import { registerForEachRoutes } from '../../src/server/routes/for-each-routes';
import { FileForEachRunStore } from '../../src/server/for-each/for-each-run-store';
import type { ForEachItem } from '../../src/server/for-each/types';
import type { GenerateForEachItemPlanFn } from '../../src/server/for-each/for-each-plan-generator';

const WORKSPACE_ID = 'ws-routes-test';
const GENERATED_ITEMS: ForEachItem[] = [
    {
        id: 'item-1',
        title: 'Generated task',
        prompt: 'Execute the generated task.',
        status: 'pending',
    },
];

let tmpDir: string;
let store: FileForEachRunStore;
let server: http.Server;
let baseUrl: string;
let forEachEnabled = false;
let generateItemPlan: ReturnType<typeof vi.fn<GenerateForEachItemPlanFn>>;

function makeServer(): http.Server {
    const routes: Route[] = [];
    registerForEachRoutes({
        routes,
        store,
        getForEachEnabled: () => forEachEnabled,
        generateItemPlan,
    });
    return http.createServer(createRouter({ routes, spaHtml: '' }));
}

async function startServer(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as any;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    await new Promise<void>(resolve => server.close(() => resolve()));
}

async function request(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(urlPath, baseUrl);
        const req = http.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let parsed: any = raw;
                try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
                resolve({ status: res.statusCode!, body: parsed });
            });
        });
        req.on('error', reject);
        if (body !== undefined) req.write(JSON.stringify(body));
        req.end();
    });
}

describe('For Each routes', () => {
    beforeEach(async () => {
        forEachEnabled = false;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-for-each-routes-'));
        store = new FileForEachRunStore({ dataDir: tmpDir });
        generateItemPlan = vi.fn(async () => GENERATED_ITEMS);
        server = makeServer();
        await startServer();
    });

    afterEach(async () => {
        await stopServer();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('returns 404 and does not invoke AI when forEach.enabled is false', async () => {
        const res = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/generate`, {
            prompt: 'Split this request',
            childMode: 'ask',
        });

        expect(res.status).toBe(404);
        expect(generateItemPlan).not.toHaveBeenCalled();
    });

    it('generates and persists a draft run when enabled', async () => {
        forEachEnabled = true;

        const res = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/generate`, {
            prompt: 'Split this request',
            sharedInstructions: 'Keep each item focused.',
            childMode: 'autopilot',
            provider: 'copilot',
            config: { model: 'gpt-5.5', reasoningEffort: 'high' },
        });

        expect(res.status).toBe(201);
        expect(res.body.run).toMatchObject({
            workspaceId: WORKSPACE_ID,
            status: 'draft',
            originalRequest: 'Split this request',
            sharedInstructions: 'Keep each item focused.',
            childMode: 'autopilot',
            provider: 'copilot',
            model: 'gpt-5.5',
            reasoningEffort: 'high',
        });
        expect(res.body.run.items).toHaveLength(1);
        expect(generateItemPlan).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: WORKSPACE_ID,
            prompt: 'Split this request',
            sharedInstructions: 'Keep each item focused.',
            childMode: 'autopilot',
            provider: 'copilot',
            model: 'gpt-5.5',
            reasoningEffort: 'high',
        }));

        const loaded = await store.getRun(WORKSPACE_ID, res.body.run.runId);
        expect(loaded?.items[0].title).toBe('Generated task');
    });

    it('allows review edits before approval and blocks edits after approval', async () => {
        forEachEnabled = true;
        const created = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/generate`, {
            prompt: 'Split this request',
            childMode: 'ask',
        });
        const runId = created.body.run.runId;

        const updated = await request('PUT', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/plan`, {
            childMode: 'autopilot',
            sharedInstructions: 'Reviewed shared instructions.',
            items: [{
                id: 'item-reviewed',
                title: 'Reviewed task',
                prompt: 'Run the reviewed item only.',
                status: 'pending',
            }],
        });

        expect(updated.status).toBe(200);
        expect(updated.body.run.childMode).toBe('autopilot');
        expect(updated.body.run.items[0].id).toBe('item-reviewed');

        const approved = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/approve`);
        expect(approved.status).toBe(200);
        expect(approved.body.run.status).toBe('approved');
        expect(approved.body.run.items[0].childProcessId).toBeUndefined();

        const editedAfterApproval = await request('PUT', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/plan`, {
            items: [{
                id: 'item-reviewed',
                title: 'Late edit',
                prompt: 'Too late.',
                status: 'pending',
            }],
        });
        expect(editedAfterApproval.status).toBe(409);
    });

    it('lists and reads generated runs', async () => {
        forEachEnabled = true;
        const created = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/generate`, {
            prompt: 'Split this request',
            childMode: 'ask',
        });
        const runId = created.body.run.runId;

        const detail = await request('GET', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}`);
        expect(detail.status).toBe(200);
        expect(detail.body.run.runId).toBe(runId);

        const list = await request('GET', `/api/workspaces/${WORKSPACE_ID}/for-each-runs`);
        expect(list.status).toBe(200);
        expect(list.body.runs).toHaveLength(1);
        expect(list.body.runs[0].itemStatusCounts.pending).toBe(1);
    });

    it('validates required fields and child mode', async () => {
        forEachEnabled = true;

        const missingPrompt = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/generate`, {
            childMode: 'ask',
        });
        expect(missingPrompt.status).toBe(400);

        const invalidMode = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/generate`, {
            prompt: 'Split this request',
            childMode: 'ralph',
        });
        expect(invalidMode.status).toBe(400);
    });

    it('surfaces invalid AI plans as a regeneration-friendly error', async () => {
        forEachEnabled = true;
        generateItemPlan.mockRejectedValueOnce(new Error('AI returned non-JSON For Each item plan: hello'));

        const res = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/generate`, {
            prompt: 'Split this request',
            childMode: 'ask',
        });

        expect(res.status).toBe(502);
        expect(res.body.code).toBe('FOR_EACH_PLAN_GENERATION_FAILED');
        expect(res.body.error).toMatch(/regenerate/i);
    });
});

