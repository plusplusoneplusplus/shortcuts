import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { CreateTaskInput, QueuedTask } from '@plusplusoneplusplus/forge';
import type { Route } from '../../src/server/types';
import { createRouter } from '../../src/server/shared/router';
import { registerMapReduceRoutes } from '../../src/server/routes/map-reduce-routes';
import { FileMapReduceRunStore } from '../../src/server/map-reduce/map-reduce-run-store';
import { MapReduceRunExecutor } from '../../src/server/map-reduce/map-reduce-run-executor';
import type { GenerateMapReducePlanFn } from '../../src/server/map-reduce/map-reduce-plan-generator';
import type { MapReduceItem } from '../../src/server/map-reduce/types';
import type { AutoProviderResolutionResult } from '../../src/server/agent-providers/auto-provider-router';

const WORKSPACE_ID = 'ws-map-reduce-routes-test';
const GENERATED_PLAN = {
    maxParallel: 2,
    reduceInstructions: 'Combine every map result into a concise final answer.',
    items: [
        {
            id: 'item-1',
            title: 'Generated first task',
            prompt: 'Execute the first generated task.',
            status: 'pending' as const,
        },
        {
            id: 'item-2',
            title: 'Generated second task',
            prompt: 'Execute the second generated task.',
            status: 'pending' as const,
        },
    ],
};

let tmpDir: string;
let store: FileMapReduceRunStore;
let server: http.Server;
let baseUrl: string;
let mapReduceEnabled = false;
let generatePlan: ReturnType<typeof vi.fn<GenerateMapReducePlanFn>>;
let executor: MapReduceRunExecutor;
let enqueuedTasks: CreateTaskInput[];
let cancelledTaskIds: string[];
let resolveDefaultProvider: ReturnType<typeof vi.fn<() => Promise<AutoProviderResolutionResult>>> | undefined;

function makeServer(): http.Server {
    const routes: Route[] = [];
    registerMapReduceRoutes({
        routes,
        store,
        getMapReduceEnabled: () => mapReduceEnabled,
        generatePlan,
        executor,
        ...(resolveDefaultProvider ? { resolveDefaultProvider } : {}),
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
        const headers: http.OutgoingHttpHeaders = {};
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json';
        }
        const req = http.request({
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method,
            headers,
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
        if (body !== undefined) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

function queuedTask(input: CreateTaskInput, taskId: string, result?: unknown): QueuedTask {
    return {
        id: taskId,
        repoId: input.repoId,
        type: input.type,
        priority: input.priority,
        status: 'completed',
        createdAt: Date.now(),
        payload: input.payload,
        config: input.config,
        displayName: input.displayName,
        ...(result !== undefined ? { result } : {}),
    };
}

async function createReviewedRun(options: {
    items: MapReduceItem[];
    maxParallel?: number;
    provider?: string;
    model?: string;
    reasoningEffort?: string;
}): Promise<string> {
    const created = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs`, {
        originalRequest: 'Map these tasks and reduce the outputs',
        sharedInstructions: 'Keep each map item isolated.',
        reduceInstructions: 'Aggregate every output into one final answer.',
        childMode: 'autopilot',
        maxParallel: options.maxParallel,
        provider: options.provider,
        config: {
            model: options.model,
            reasoningEffort: options.reasoningEffort,
        },
        items: options.items,
    });
    expect(created.status).toBe(201);
    return created.body.run.runId;
}

describe('Map Reduce routes', () => {
    beforeEach(async () => {
        mapReduceEnabled = false;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-map-reduce-routes-'));
        store = new FileMapReduceRunStore({ dataDir: tmpDir });
        generatePlan = vi.fn(async () => GENERATED_PLAN);
        resolveDefaultProvider = undefined;
        enqueuedTasks = [];
        cancelledTaskIds = [];
        executor = new MapReduceRunExecutor({
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

    it('returns 404 and does not invoke AI when mapReduce.enabled is false', async () => {
        const res = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/generate`, {
            prompt: 'Split this request',
            childMode: 'ask',
        });

        expect(res.status).toBe(404);
        expect(generatePlan).not.toHaveBeenCalled();
    });

    it('generates and persists a draft run with map plan and reduce instructions', async () => {
        mapReduceEnabled = true;

        const res = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/generate`, {
            prompt: 'Split this request',
            sharedInstructions: 'Keep outputs source-linked.',
            childMode: 'autopilot',
            provider: 'copilot',
            config: { model: 'gpt-5.5', reasoningEffort: 'high' },
        });

        expect(res.status).toBe(201);
        expect(res.body.run).toMatchObject({
            workspaceId: WORKSPACE_ID,
            status: 'draft',
            originalRequest: 'Split this request',
            sharedInstructions: 'Keep outputs source-linked.',
            reduceInstructions: GENERATED_PLAN.reduceInstructions,
            maxParallel: 2,
            childMode: 'autopilot',
            provider: 'copilot',
            model: 'gpt-5.5',
            reasoningEffort: 'high',
            reduceStep: { status: 'pending' },
        });
        expect(res.body.run.items).toHaveLength(2);
        expect(generatePlan).toHaveBeenCalledWith(expect.objectContaining({
            workspaceId: WORKSPACE_ID,
            prompt: 'Split this request',
            sharedInstructions: 'Keep outputs source-linked.',
            childMode: 'autopilot',
            provider: 'copilot',
            model: 'gpt-5.5',
            reasoningEffort: 'high',
        }));

        const loaded = await store.getRun(WORKSPACE_ID, res.body.run.runId);
        expect(loaded?.reduceInstructions).toBe(GENERATED_PLAN.reduceInstructions);
    });

    it('creates reviewed draft runs without AI and keeps workspaces isolated', async () => {
        mapReduceEnabled = true;
        const workspaceA = 'ws-map-reduce-alpha';
        const workspaceB = 'ws-map-reduce-beta';

        const createdA = await request('POST', `/api/workspaces/${workspaceA}/map-reduce-runs`, {
            originalRequest: 'Split alpha work',
            reduceInstructions: 'Reduce alpha outputs.',
            childMode: 'ask',
            maxParallel: 4,
            generationProcessId: 'queue_alpha-generation',
            generationId: 'map-reduce-gen-alpha',
            items: [
                { id: 'alpha-item', title: 'Alpha item', prompt: 'Do alpha work.', status: 'pending' },
            ],
        });
        const createdB = await request('POST', `/api/workspaces/${workspaceB}/map-reduce-runs`, {
            originalRequest: 'Split beta work',
            reduceInstructions: 'Reduce beta outputs.',
            childMode: 'autopilot',
            items: [
                { id: 'beta-item', title: 'Beta item', prompt: 'Do beta work.', status: 'pending' },
            ],
        });

        expect(createdA.status).toBe(201);
        expect(createdB.status).toBe(201);
        expect(generatePlan).not.toHaveBeenCalled();
        expect(createdA.body.run).toMatchObject({
            workspaceId: workspaceA,
            maxParallel: 4,
            generationProcessId: 'queue_alpha-generation',
            generationId: 'map-reduce-gen-alpha',
        });
        expect(createdB.body.run.workspaceId).toBe(workspaceB);

        const listA = await request('GET', `/api/workspaces/${workspaceA}/map-reduce-runs`);
        const listB = await request('GET', `/api/workspaces/${workspaceB}/map-reduce-runs`);
        expect(listA.status).toBe(200);
        expect(listB.status).toBe(200);
        expect(listA.body.runs.map((run: { runId: string }) => run.runId)).toEqual([createdA.body.run.runId]);
        expect(listA.body.runs[0]).toMatchObject({
            itemCount: 1,
            reduceStatus: 'pending',
        });
        expect(listB.body.runs.map((run: { runId: string }) => run.runId)).toEqual([createdB.body.run.runId]);

        const crossWorkspaceRead = await request('GET', `/api/workspaces/${workspaceB}/map-reduce-runs/${createdA.body.run.runId}`);
        expect(crossWorkspaceRead.status).toBe(404);

        const approvedA = await request('POST', `/api/workspaces/${workspaceA}/map-reduce-runs/${createdA.body.run.runId}/approve`);
        expect(approvedA.status).toBe(200);
        expect(approvedA.body.run.status).toBe('approved');
    });

    it('allows review edits before approval and blocks edits after approval', async () => {
        mapReduceEnabled = true;
        const created = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/generate`, {
            prompt: 'Split this request',
            childMode: 'ask',
        });
        const runId = created.body.run.runId;

        const updated = await request('PUT', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/plan`, {
            childMode: 'autopilot',
            sharedInstructions: 'Reviewed shared instructions.',
            reduceInstructions: 'Reviewed reduce instructions.',
            maxParallel: 1,
            items: [{
                id: 'item-reviewed',
                title: 'Reviewed task',
                prompt: 'Run the reviewed item only.',
                status: 'pending',
            }],
        });

        expect(updated.status).toBe(200);
        expect(updated.body.run).toMatchObject({
            childMode: 'autopilot',
            sharedInstructions: 'Reviewed shared instructions.',
            reduceInstructions: 'Reviewed reduce instructions.',
            maxParallel: 1,
        });
        expect(updated.body.run.items[0].id).toBe('item-reviewed');

        const approved = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/approve`);
        expect(approved.status).toBe(200);
        expect(approved.body.run.status).toBe('approved');

        const editedAfterApproval = await request('PUT', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/plan`, {
            reduceInstructions: 'Too late.',
            items: [{
                id: 'item-reviewed',
                title: 'Late edit',
                prompt: 'Too late.',
                status: 'pending',
            }],
        });
        expect(editedAfterApproval.status).toBe(409);
    });

    it('starts approved runs by enqueueing map children in parallel', async () => {
        mapReduceEnabled = true;
        const runId = await createReviewedRun({
            maxParallel: 2,
            provider: 'copilot',
            model: 'gpt-5.5',
            reasoningEffort: 'high',
            items: [
                { id: 'item-1', title: 'First', prompt: 'Map first.', status: 'pending' },
                { id: 'item-2', title: 'Second', prompt: 'Map second.', status: 'pending' },
                { id: 'item-3', title: 'Third', prompt: 'Map third.', status: 'pending' },
            ],
        });
        await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/approve`);

        const started = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/start`);
        const continued = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/continue`);

        expect(started.status).toBe(200);
        expect(continued.status).toBe(200);
        expect(enqueuedTasks).toHaveLength(2);
        expect(started.body.run.status).toBe('running');
        expect(started.body.run.items.map((entry: MapReduceItem) => [entry.id, entry.status])).toEqual([
            ['item-1', 'running'],
            ['item-2', 'running'],
            ['item-3', 'pending'],
        ]);
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
                    mapReduce: {
                        workspaceId: WORKSPACE_ID,
                        runId,
                        itemId: 'item-1',
                        phase: 'map',
                        childMode: 'autopilot',
                    },
                },
            },
            config: { model: 'gpt-5.5', reasoningEffort: 'high' },
        });
        expect(enqueuedTasks[0].payload.prompt).toContain('Map item task prompt:');
        expect(enqueuedTasks[0].payload.prompt).toContain('Keep each map item isolated.');
    });

    it('uses Auto only for plan generation and marks generated Map Reduce children for execution-time routing', async () => {
        mapReduceEnabled = true;
        await stopServer();
        resolveDefaultProvider = vi.fn(async () => ({
            provider: 'claude',
            selectedByAuto: true,
            fallbackUsed: false,
            warnings: [],
            decisions: [],
        }));
        server = makeServer();
        await startServer();

        const created = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/generate`, {
            prompt: 'Split this request',
            childMode: 'ask',
        });

        expect(created.status).toBe(201);
        expect(created.body.run.provider).toBeUndefined();
        expect(created.body.run.autoProviderRouting).toEqual({ requested: true });
        expect(resolveDefaultProvider).toHaveBeenCalledOnce();
        expect(generatePlan).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'claude',
        }));

        await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${created.body.run.runId}/approve`);
        const started = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${created.body.run.runId}/start`);

        expect(started.status).toBe(200);
        expect(enqueuedTasks[0].payload.provider).toBeUndefined();
        expect((enqueuedTasks[0].payload as any).context.autoProviderRouting).toEqual({ requested: true });
    });

    it('retries failed map items, skips failed map items, and cancels active children', async () => {
        mapReduceEnabled = true;
        const runId = await createReviewedRun({
            maxParallel: 1,
            items: [
                { id: 'item-1', title: 'First', prompt: 'Map first.', status: 'pending' },
                { id: 'item-2', title: 'Second', prompt: 'Map second.', status: 'pending' },
            ],
        });
        await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/approve`);
        await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/start`);
        await executor.handleChildTaskFailed(queuedTask(enqueuedTasks[0], 'task-1'), new Error('boom'));

        const retry = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/items/item-1/retry`);
        expect(retry.status).toBe(200);
        expect(retry.body.run.items[0]).toMatchObject({ status: 'running', childTaskId: 'task-2' });

        await executor.handleChildTaskFailed(queuedTask(enqueuedTasks[1], 'task-2'), new Error('boom again'));

        const skip = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/items/item-1/skip`);
        expect(skip.status).toBe(200);
        expect(skip.body.run.items.map((entry: MapReduceItem) => [entry.id, entry.status])).toEqual([
            ['item-1', 'skipped'],
            ['item-2', 'running'],
        ]);

        const cancel = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/cancel`);
        expect(cancel.status).toBe(200);
        expect(cancel.body.run.status).toBe('cancelled');
        expect(cancelledTaskIds).toEqual(['task-3']);
        expect(cancel.body.run.reduceStep.status).toBe('cancelled');
    });

    it('retries a failed reduce step', async () => {
        mapReduceEnabled = true;
        const runId = await createReviewedRun({
            maxParallel: 1,
            items: [
                { id: 'item-1', title: 'Only item', prompt: 'Map once.', status: 'pending' },
            ],
        });
        await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/approve`);
        await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/start`);
        await executor.handleChildTaskCompleted(queuedTask(enqueuedTasks[0], 'task-1'), 'map output');
        expect(enqueuedTasks).toHaveLength(2);
        expect(enqueuedTasks[1].payload).toMatchObject({
            context: {
                mapReduce: {
                    workspaceId: WORKSPACE_ID,
                    runId,
                    phase: 'reduce',
                    childMode: 'autopilot',
                },
            },
        });
        await executor.handleChildTaskFailed(queuedTask(enqueuedTasks[1], 'task-2'), 'reduce failed');

        const retry = await request('POST', `/api/workspaces/${WORKSPACE_ID}/map-reduce-runs/${runId}/reduce/retry`);

        expect(retry.status).toBe(200);
        expect(retry.body.run.status).toBe('reducing');
        expect(retry.body.run.reduceStep).toMatchObject({
            status: 'running',
            childTaskId: 'task-3',
            childProcessId: 'queue_task-3',
        });
        expect(enqueuedTasks[2].payload.prompt).toContain('Reduce instructions:');
        expect(enqueuedTasks[2].payload.prompt).toContain('map output');
    });
});
