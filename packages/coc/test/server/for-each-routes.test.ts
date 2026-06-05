import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../src/server/types';
import { createRouter } from '../../src/server/shared/router';
import { registerForEachRoutes } from '../../src/server/routes/for-each-routes';
import { FileForEachRunStore } from '../../src/server/for-each/for-each-run-store';
import { ForEachRunExecutor } from '../../src/server/for-each/for-each-run-executor';
import type { ForEachItem } from '../../src/server/for-each/types';
import type { GenerateForEachItemPlanFn } from '../../src/server/for-each/for-each-plan-generator';
import type { CreateTaskInput, QueuedTask } from '@plusplusoneplusplus/forge';

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
let executor: ForEachRunExecutor;
let enqueuedTasks: CreateTaskInput[];
let cancelledTaskIds: string[];

function makeServer(): http.Server {
    const routes: Route[] = [];
    registerForEachRoutes({
        routes,
        store,
        getForEachEnabled: () => forEachEnabled,
        generateItemPlan,
        executor,
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
        enqueuedTasks = [];
        cancelledTaskIds = [];
        executor = new ForEachRunExecutor({
            store,
            enqueueChildTask: async (input) => {
                enqueuedTasks.push(input);
                return `task-${enqueuedTasks.length}`;
            },
            cancelChildTask: async (taskId) => {
                cancelledTaskIds.push(taskId);
                return true;
            },
        });
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

    it('creates a reviewed draft run without invoking AI generation', async () => {
        forEachEnabled = true;

        const res = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs`, {
            originalRequest: 'Split this reviewed request',
            sharedInstructions: 'Use the reviewed shared instructions.',
            childMode: 'ask',
            provider: 'copilot',
            config: { model: 'gpt-5.4', reasoningEffort: 'medium' },
            generationProcessId: 'queue_for-each-gen-1',
            generationId: 'for-each-gen-1',
            items: [
                { id: 'item-1', title: 'Reviewed item', prompt: 'Do reviewed work.', status: 'pending' },
            ],
        });

        expect(res.status).toBe(201);
        expect(generateItemPlan).not.toHaveBeenCalled();
        expect(res.body.run).toMatchObject({
            workspaceId: WORKSPACE_ID,
            status: 'draft',
            originalRequest: 'Split this reviewed request',
            sharedInstructions: 'Use the reviewed shared instructions.',
            childMode: 'ask',
            provider: 'copilot',
            model: 'gpt-5.4',
            reasoningEffort: 'medium',
            generationProcessId: 'queue_for-each-gen-1',
            generationId: 'for-each-gen-1',
        });
        expect(res.body.run.items[0].title).toBe('Reviewed item');
    });

    it('keeps generation-linked reviewed runs isolated by workspace', async () => {
        forEachEnabled = true;
        const workspaceA = 'ws-routes-alpha';
        const workspaceB = 'ws-routes-beta';

        const createdA = await request('POST', `/api/workspaces/${workspaceA}/for-each-runs`, {
            originalRequest: 'Split alpha work',
            childMode: 'ask',
            generationProcessId: 'queue_alpha-generation',
            generationId: 'for-each-gen-alpha',
            items: [
                { id: 'alpha-item', title: 'Alpha item', prompt: 'Do alpha work.', status: 'pending' },
            ],
        });
        const createdB = await request('POST', `/api/workspaces/${workspaceB}/for-each-runs`, {
            originalRequest: 'Split beta work',
            childMode: 'autopilot',
            generationProcessId: 'queue_beta-generation',
            generationId: 'for-each-gen-beta',
            items: [
                { id: 'beta-item', title: 'Beta item', prompt: 'Do beta work.', status: 'pending' },
            ],
        });

        expect(createdA.status).toBe(201);
        expect(createdB.status).toBe(201);
        expect(generateItemPlan).not.toHaveBeenCalled();
        expect(createdA.body.run.workspaceId).toBe(workspaceA);
        expect(createdB.body.run.workspaceId).toBe(workspaceB);
        expect(createdA.body.run.generationProcessId).toBe('queue_alpha-generation');
        expect(createdB.body.run.generationProcessId).toBe('queue_beta-generation');

        const listA = await request('GET', `/api/workspaces/${workspaceA}/for-each-runs`);
        const listB = await request('GET', `/api/workspaces/${workspaceB}/for-each-runs`);

        expect(listA.status).toBe(200);
        expect(listB.status).toBe(200);
        expect(listA.body.runs.map((run: { runId: string }) => run.runId)).toEqual([createdA.body.run.runId]);
        expect(listB.body.runs.map((run: { runId: string }) => run.runId)).toEqual([createdB.body.run.runId]);

        const crossWorkspaceRead = await request('GET', `/api/workspaces/${workspaceB}/for-each-runs/${createdA.body.run.runId}`);
        expect(crossWorkspaceRead.status).toBe(404);

        const crossWorkspaceApprove = await request('POST', `/api/workspaces/${workspaceB}/for-each-runs/${createdA.body.run.runId}/approve`);
        expect(crossWorkspaceApprove.status).toBe(404);

        const approvedA = await request('POST', `/api/workspaces/${workspaceA}/for-each-runs/${createdA.body.run.runId}/approve`);
        expect(approvedA.status).toBe(200);
        expect(approvedA.body.run.status).toBe('approved');
        expect(enqueuedTasks).toHaveLength(0);

        const loadedA = await store.getRun(workspaceA, createdA.body.run.runId);
        const loadedB = await store.getRun(workspaceB, createdB.body.run.runId);
        expect(loadedA).toMatchObject({
            workspaceId: workspaceA,
            status: 'approved',
            generationProcessId: 'queue_alpha-generation',
            generationId: 'for-each-gen-alpha',
        });
        expect(loadedB).toMatchObject({
            workspaceId: workspaceB,
            status: 'draft',
            generationProcessId: 'queue_beta-generation',
            generationId: 'for-each-gen-beta',
        });
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

    it('starts approved runs by enqueueing exactly one linked child chat', async () => {
        forEachEnabled = true;
        const created = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/generate`, {
            prompt: 'Split this request',
            sharedInstructions: 'Use shared guardrails.',
            childMode: 'autopilot',
            provider: 'copilot',
            config: { model: 'gpt-5.5', reasoningEffort: 'high' },
        });
        const runId = created.body.run.runId;
        await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/approve`);

        const started = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/start`);

        expect(started.status).toBe(200);
        expect(started.body.run.status).toBe('running');
        expect(started.body.run.items[0]).toMatchObject({
            status: 'running',
            childTaskId: 'task-1',
            childProcessId: 'queue_task-1',
        });
        expect(enqueuedTasks).toHaveLength(1);
        expect(enqueuedTasks[0]).toMatchObject({
            type: 'chat',
            repoId: WORKSPACE_ID,
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                workspaceId: WORKSPACE_ID,
                provider: 'copilot',
                model: 'gpt-5.5',
                reasoningEffort: 'high',
                context: {
                    forEach: {
                        workspaceId: WORKSPACE_ID,
                        runId,
                        itemId: 'item-1',
                        childMode: 'autopilot',
                    },
                },
            },
            config: { model: 'gpt-5.5', reasoningEffort: 'high' },
        });
        expect((enqueuedTasks[0].payload.prompt as string)).toContain('Item task prompt:');
        expect((enqueuedTasks[0].payload.prompt as string)).toContain('Use shared guardrails.');
    });

    it('continues sequentially after completion and stops on child failure', async () => {
        forEachEnabled = true;
        const created = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/generate`, {
            prompt: 'Split this request',
            childMode: 'ask',
        });
        const runId = created.body.run.runId;
        await request('PUT', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/plan`, {
            items: [
                { id: 'item-1', title: 'First', prompt: 'Do first.', status: 'pending' },
                { id: 'item-2', title: 'Second', prompt: 'Do second.', dependsOn: ['item-1'], status: 'pending' },
                { id: 'item-3', title: 'Third', prompt: 'Do third.', status: 'pending' },
            ],
        });
        await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/approve`);
        await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/start`);

        await executor.handleChildTaskCompleted({
            id: 'task-1',
            type: 'chat',
            priority: 'normal',
            status: 'completed',
            createdAt: Date.now(),
            payload: enqueuedTasks[0].payload,
            config: {},
        } as QueuedTask);

        let run = await store.getRun(WORKSPACE_ID, runId);
        expect(enqueuedTasks).toHaveLength(2);
        expect(run?.items.map(i => [i.id, i.status])).toEqual([
            ['item-1', 'completed'],
            ['item-2', 'running'],
            ['item-3', 'pending'],
        ]);

        await executor.handleChildTaskFailed({
            id: 'task-2',
            type: 'chat',
            priority: 'normal',
            status: 'failed',
            createdAt: Date.now(),
            payload: enqueuedTasks[1].payload,
            config: {},
        } as QueuedTask, new Error('boom'));

        run = await store.getRun(WORKSPACE_ID, runId);
        expect(run?.status).toBe('failed');
        expect(run?.items.map(i => [i.id, i.status])).toEqual([
            ['item-1', 'completed'],
            ['item-2', 'failed'],
            ['item-3', 'pending'],
        ]);
        expect(enqueuedTasks).toHaveLength(2);
    });

    it('retries failed items, skips failed items, and cancels remaining work', async () => {
        forEachEnabled = true;
        const created = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/generate`, {
            prompt: 'Split this request',
            childMode: 'ask',
        });
        const runId = created.body.run.runId;
        await request('PUT', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/plan`, {
            items: [
                { id: 'item-1', title: 'First', prompt: 'Do first.', status: 'pending' },
                { id: 'item-2', title: 'Second', prompt: 'Do second.', status: 'pending' },
            ],
        });
        await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/approve`);
        await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/start`);
        await executor.handleChildTaskFailed({
            id: 'task-1',
            type: 'chat',
            priority: 'normal',
            status: 'failed',
            createdAt: Date.now(),
            payload: enqueuedTasks[0].payload,
            config: {},
        } as QueuedTask, new Error('boom'));

        const retry = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/items/item-1/retry`);
        expect(retry.status).toBe(200);
        expect(retry.body.run.items[0]).toMatchObject({ status: 'running', childTaskId: 'task-2' });

        await executor.handleChildTaskFailed({
            id: 'task-2',
            type: 'chat',
            priority: 'normal',
            status: 'failed',
            createdAt: Date.now(),
            payload: enqueuedTasks[1].payload,
            config: {},
        } as QueuedTask, new Error('boom again'));

        const skip = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/items/item-1/skip`);
        expect(skip.status).toBe(200);
        expect(skip.body.run.items.map((i: ForEachItem) => [i.id, i.status])).toEqual([
            ['item-1', 'skipped'],
            ['item-2', 'running'],
        ]);

        const cancel = await request('POST', `/api/workspaces/${WORKSPACE_ID}/for-each-runs/${runId}/cancel`);
        expect(cancel.status).toBe(200);
        expect(cancel.body.run.status).toBe('cancelled');
        expect(cancelledTaskIds).toEqual(['task-3']);
        expect(cancel.body.run.items.map((i: ForEachItem) => [i.id, i.status])).toEqual([
            ['item-1', 'skipped'],
            ['item-2', 'skipped'],
        ]);
    });
});
