import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { CreateTaskInput, QueuedTask } from '@plusplusoneplusplus/forge';
import { FileMapReduceRunStore } from '../../src/server/map-reduce/map-reduce-run-store';
import {
    buildMapReduceMapChildPrompt,
    buildMapReduceReduceChildPrompt,
    MapReduceRunExecutor,
} from '../../src/server/map-reduce/map-reduce-run-executor';
import type { MapReduceItem, MapReduceRun } from '../../src/server/map-reduce/types';

const WORKSPACE_ID = 'ws-map-reduce-executor-test';

function item(overrides: Partial<MapReduceItem> = {}): MapReduceItem {
    return {
        id: 'item-1',
        title: 'Map one thing',
        prompt: 'Do exactly one map step.',
        status: 'pending',
        ...overrides,
    };
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

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-map-reduce-executor-'));
    try {
        return await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

async function createApprovedRun(
    store: FileMapReduceRunStore,
    items: MapReduceItem[],
    options: Partial<Pick<MapReduceRun, 'childMode' | 'provider' | 'autoProviderRouting' | 'model' | 'reasoningEffort' | 'maxParallel'>> = {},
): Promise<MapReduceRun> {
    const run = await store.createDraftRun({
        workspaceId: WORKSPACE_ID,
        originalRequest: 'Map these tasks and reduce the results',
        sharedInstructions: 'Keep each map item isolated.',
        reduceInstructions: 'Combine every map output into one final result.',
        childMode: options.childMode ?? 'ask',
        maxParallel: options.maxParallel ?? 2,
        provider: options.provider,
        autoProviderRouting: options.autoProviderRouting,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        items,
    });
    return store.approveRun(WORKSPACE_ID, run.runId);
}

describe('MapReduceRunExecutor', () => {
    it('enqueues claimed map items concurrently', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileMapReduceRunStore({ dataDir });
            const startedTasks: string[] = [];
            const releases: Array<() => void> = [];
            const executor = new MapReduceRunExecutor({
                store,
                enqueueChildTask: async (input) => {
                    const taskId = `task-${startedTasks.length + 1}`;
                    startedTasks.push(input.displayName ?? '');
                    await new Promise<void>(resolve => releases.push(resolve));
                    return taskId;
                },
            });
            const run = await createApprovedRun(store, [
                item({ id: 'item-1', title: 'First', prompt: 'Map first.' }),
                item({ id: 'item-2', title: 'Second', prompt: 'Map second.' }),
            ], { maxParallel: 2 });

            const startPromise = executor.startOrContinueRun(WORKSPACE_ID, run.runId);
            await vi.waitFor(() => {
                expect(startedTasks).toEqual(['[Map Reduce] First', '[Map Reduce] Second']);
                expect(releases).toHaveLength(2);
            });
            for (const release of releases) {
                release();
            }

            const started = await startPromise;
            expect(started.items.map(entry => entry.childTaskId)).toEqual(['task-1', 'task-2']);
        });
    });

    it('starts map items in parallel up to maxParallel and chains reduce with all outputs', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileMapReduceRunStore({ dataDir });
            const enqueuedTasks: CreateTaskInput[] = [];
            const executor = new MapReduceRunExecutor({
                store,
                enqueueChildTask: async (input) => {
                    enqueuedTasks.push(input);
                    return `task-${enqueuedTasks.length}`;
                },
            });
            const run = await createApprovedRun(store, [
                item({ id: 'item-1', title: 'First', prompt: 'Map first.' }),
                item({ id: 'item-2', title: 'Second', prompt: 'Map second.' }),
                item({ id: 'item-3', title: 'Third', prompt: 'Map third.', dependsOn: ['item-1'] }),
            ], {
                childMode: 'autopilot',
                provider: 'copilot',
                model: 'gpt-5.5',
                reasoningEffort: 'high',
                maxParallel: 2,
            });

            const started = await executor.startOrContinueRun(WORKSPACE_ID, run.runId);

            expect(started.status).toBe('running');
            expect(enqueuedTasks).toHaveLength(2);
            expect(enqueuedTasks.map(task => task.displayName)).toEqual([
                '[Map Reduce] First',
                '[Map Reduce] Second',
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
                            runId: run.runId,
                            itemId: 'item-1',
                            phase: 'map',
                            childMode: 'autopilot',
                        },
                    },
                },
                config: { model: 'gpt-5.5', reasoningEffort: 'high' },
            });
            expect(enqueuedTasks[0].payload.prompt).toContain('Focus only on this map item.');
            expect(enqueuedTasks[0].payload.prompt).toContain('Map item task prompt:');
            expect(enqueuedTasks[0].payload.prompt).toContain('Keep each map item isolated.');

            await executor.handleChildTaskCompleted(queuedTask(enqueuedTasks[0], 'task-1'), {
                response: 'first output',
                tokenUsage: { total: 10 },
            });
            expect(enqueuedTasks).toHaveLength(3);
            expect(enqueuedTasks[2].displayName).toBe('[Map Reduce] Third');

            await executor.handleChildTaskCompleted(queuedTask(enqueuedTasks[1], 'task-2'), 'second output');
            expect(enqueuedTasks).toHaveLength(3);

            await executor.handleChildTaskCompleted(queuedTask(enqueuedTasks[2], 'task-3'), { response: 'third output' });
            expect(enqueuedTasks).toHaveLength(4);
            expect(enqueuedTasks[3]).toMatchObject({
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
                            runId: run.runId,
                            phase: 'reduce',
                            childMode: 'autopilot',
                        },
                    },
                },
                config: { model: 'gpt-5.5', reasoningEffort: 'high' },
                displayName: `[Map Reduce] Reduce ${run.runId}`,
            });
            const reducePrompt = enqueuedTasks[3].payload.prompt as string;
            expect(reducePrompt).toContain('Reduce instructions:');
            expect(reducePrompt).toContain('Combine every map output into one final result.');
            expect(reducePrompt).toContain('first output');
            expect(reducePrompt).toContain('second output');
            expect(reducePrompt).toContain('third output');

            const reducing = await store.getRun(WORKSPACE_ID, run.runId);
            expect(reducing?.status).toBe('reducing');
            expect(reducing?.reduceStep).toMatchObject({
                status: 'running',
                childTaskId: 'task-4',
                childProcessId: 'queue_task-4',
            });

            await executor.handleChildTaskCompleted(queuedTask(enqueuedTasks[3], 'task-4'), 'final result');
            const completed = await store.getRun(WORKSPACE_ID, run.runId);
            expect(completed?.status).toBe('completed');
            expect(completed?.reduceStep.status).toBe('completed');
        });
    });

    it('does not launch new map items after failure until the run is manually skipped or retried', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileMapReduceRunStore({ dataDir });
            const enqueuedTasks: CreateTaskInput[] = [];
            const executor = new MapReduceRunExecutor({
                store,
                enqueueChildTask: async (input) => {
                    enqueuedTasks.push(input);
                    return `task-${enqueuedTasks.length}`;
                },
            });
            const run = await createApprovedRun(store, [
                item({ id: 'item-1', title: 'First', prompt: 'Map first.' }),
                item({ id: 'item-2', title: 'Second', prompt: 'Map second.' }),
                item({ id: 'item-3', title: 'Third', prompt: 'Map third.', dependsOn: ['item-1'] }),
            ], { maxParallel: 2 });

            await executor.startOrContinueRun(WORKSPACE_ID, run.runId);
            expect(enqueuedTasks).toHaveLength(2);

            await executor.handleChildTaskFailed(queuedTask(enqueuedTasks[0], 'task-1'), new Error('boom'));
            await executor.handleChildTaskCompleted(queuedTask(enqueuedTasks[1], 'task-2'), 'second output');
            expect(enqueuedTasks).toHaveLength(2);
            const failed = await store.getRun(WORKSPACE_ID, run.runId);
            expect(failed?.status).toBe('failed');
            expect(failed?.items.find(entry => entry.id === 'item-1')?.error).toBe('boom');

            const skipped = await executor.skipItemAndContinue(WORKSPACE_ID, run.runId, 'item-1');
            expect(skipped.status).toBe('running');
            expect(enqueuedTasks).toHaveLength(3);
            expect(enqueuedTasks[2].displayName).toBe('[Map Reduce] Third');
        });
    });

    it('carries auto-provider routing to map and reduce children without a concrete provider', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileMapReduceRunStore({ dataDir });
            const enqueuedTasks: CreateTaskInput[] = [];
            const executor = new MapReduceRunExecutor({
                store,
                enqueueChildTask: async (input) => {
                    enqueuedTasks.push(input);
                    return `task-${enqueuedTasks.length}`;
                },
            });
            const run = await createApprovedRun(store, [item()], {
                childMode: 'autopilot',
                maxParallel: 1,
                autoProviderRouting: { requested: true },
            });

            await executor.startOrContinueRun(WORKSPACE_ID, run.runId);

            expect(enqueuedTasks).toHaveLength(1);
            expect(enqueuedTasks[0].payload.provider).toBeUndefined();
            expect((enqueuedTasks[0].payload as any).context.autoProviderRouting).toEqual({ requested: true });

            await executor.handleChildTaskCompleted(queuedTask(enqueuedTasks[0], 'task-1'), 'map output');

            expect(enqueuedTasks).toHaveLength(2);
            expect(enqueuedTasks[1].payload.provider).toBeUndefined();
            expect((enqueuedTasks[1].payload as any).context.autoProviderRouting).toEqual({ requested: true });
            expect((enqueuedTasks[1].payload as any).context.mapReduce.phase).toBe('reduce');
        });
    });

    it('retries failed map and reduce steps and cancels active children', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileMapReduceRunStore({ dataDir });
            const enqueuedTasks: CreateTaskInput[] = [];
            const cancelledTaskIds: string[] = [];
            const executor = new MapReduceRunExecutor({
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
            const run = await createApprovedRun(store, [item()]);

            await executor.startOrContinueRun(WORKSPACE_ID, run.runId);
            await executor.handleChildTaskFailed(queuedTask(enqueuedTasks[0], 'task-1'), 'map failed');
            const retriedMap = await executor.retryItem(WORKSPACE_ID, run.runId, 'item-1');
            expect(retriedMap.items[0]).toMatchObject({
                status: 'running',
                childTaskId: 'task-2',
                childProcessId: 'queue_task-2',
            });

            await executor.handleChildTaskCompleted(queuedTask(enqueuedTasks[1], 'task-2'), 'map output');
            await executor.handleChildTaskFailed(queuedTask(enqueuedTasks[2], 'task-3'), 'reduce failed');
            const retriedReduce = await executor.retryReduce(WORKSPACE_ID, run.runId);
            expect(retriedReduce.status).toBe('reducing');
            expect(retriedReduce.reduceStep).toMatchObject({
                status: 'running',
                childTaskId: 'task-4',
                childProcessId: 'queue_task-4',
            });

            const cancelled = await executor.cancelRun(WORKSPACE_ID, run.runId);
            expect(cancelled.status).toBe('cancelled');
            expect(cancelledTaskIds).toEqual(['task-4']);
        });
    });

    it('builds prompts without mutating run data', async () => {
        const run = {
            runId: 'map-reduce-test',
            workspaceId: WORKSPACE_ID,
            status: 'reducing',
            originalRequest: 'Original request',
            sharedInstructions: 'Shared map instructions.',
            reduceInstructions: 'Reduce all outputs.',
            maxParallel: 3,
            childMode: 'ask',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            items: [
                item({ id: 'item-1', title: 'First', output: { response: 'first output' }, status: 'completed' }),
            ],
            reduceStep: { status: 'pending' },
        } satisfies MapReduceRun;

        expect(buildMapReduceMapChildPrompt(run, run.items[0])).toContain('Do exactly one map step.');
        expect(buildMapReduceReduceChildPrompt(run)).toContain('first output');
        expect(run.items[0].output).toEqual({ response: 'first output' });
    });
});
