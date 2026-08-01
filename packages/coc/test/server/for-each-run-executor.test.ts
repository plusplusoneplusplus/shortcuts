import { describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { CreateTaskInput, QueuedTask } from '@plusplusoneplusplus/forge';
import { FileForEachRunStore } from '../../src/server/for-each/for-each-run-store';
import {
    buildForEachChildPrompt,
    ForEachRunExecutor,
} from '../../src/server/for-each/for-each-run-executor';
import type { ForEachItem, ForEachRun } from '../../src/server/for-each/types';

const WORKSPACE_ID = 'ws-for-each-executor-test';

function item(overrides: Partial<ForEachItem> = {}): ForEachItem {
    return {
        id: 'item-1',
        title: 'Do one thing',
        prompt: 'Do exactly one thing.',
        status: 'pending',
        ...overrides,
    };
}

function queuedTask(input: CreateTaskInput, taskId: string): QueuedTask {
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
    };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-for-each-executor-'));
    try {
        return await fn(dir);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

async function createApprovedRun(
    store: FileForEachRunStore,
    items: ForEachItem[],
    options: Partial<Pick<ForEachRun, 'childMode' | 'provider' | 'autoProviderRouting' | 'model' | 'reasoningEffort'>> = {},
): Promise<ForEachRun> {
    const run = await store.createDraftRun({
        workspaceId: WORKSPACE_ID,
        originalRequest: 'Split this request into items',
        sharedInstructions: 'Keep each item isolated.',
        childMode: options.childMode ?? 'ask',
        provider: options.provider,
        autoProviderRouting: options.autoProviderRouting,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        items,
    });
    return store.approveRun(WORKSPACE_ID, run.runId);
}

describe('ForEachRunExecutor', () => {
    it('builds a byte-identical CreateTaskInput for a For Each item', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileForEachRunStore({ dataDir });
            const enqueued: CreateTaskInput[] = [];
            const executor = new ForEachRunExecutor({
                store,
                enqueueChildTask: async (input) => {
                    enqueued.push(input);
                    return `task-${enqueued.length}`;
                },
            });
            const run = await createApprovedRun(store, [item({ id: 'item-1', title: 'First', prompt: 'Do first.' })], {
                childMode: 'autopilot',
                provider: 'copilot',
                model: 'gpt-5.5',
                reasoningEffort: 'high',
            });

            await executor.startOrContinueRun(WORKSPACE_ID, run.runId);

            expect(enqueued).toHaveLength(1);
            expect(enqueued[0]).toEqual({
                type: 'chat',
                priority: 'normal',
                repoId: WORKSPACE_ID,
                payload: {
                    kind: 'chat',
                    mode: 'autopilot',
                    prompt: buildForEachChildPrompt(run, run.items[0]),
                    workspaceId: WORKSPACE_ID,
                    provider: 'copilot',
                    model: 'gpt-5.5',
                    reasoningEffort: 'high',
                    context: {
                        forEach: {
                            workspaceId: WORKSPACE_ID,
                            runId: run.runId,
                            itemId: 'item-1',
                            childMode: 'autopilot',
                        },
                        taskGroup: {
                            groupId: run.runId,
                            groupType: 'for-each',
                            role: 'item',
                            itemKey: 'item-1',
                            workspaceId: WORKSPACE_ID,
                        },
                    },
                },
                config: { model: 'gpt-5.5', reasoningEffort: 'high' },
                displayName: '[For Each] First',
            });
        });
    });

    it('carries auto-provider routing without a concrete provider', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileForEachRunStore({ dataDir });
            const enqueued: CreateTaskInput[] = [];
            const executor = new ForEachRunExecutor({
                store,
                enqueueChildTask: async (input) => {
                    enqueued.push(input);
                    return `task-${enqueued.length}`;
                },
            });
            const run = await createApprovedRun(store, [item()], {
                childMode: 'autopilot',
                autoProviderRouting: { requested: true },
            });

            await executor.startOrContinueRun(WORKSPACE_ID, run.runId);

            expect(enqueued).toHaveLength(1);
            expect(enqueued[0].payload.provider).toBeUndefined();
            expect((enqueued[0].payload as any).context.autoProviderRouting).toEqual({ requested: true });
            expect((enqueued[0].payload as any).context.forEach.itemId).toBe('item-1');
        });
    });

    it('advances to the next item as each child completes and finishes the run', async () => {
        await withTempDir(async (dataDir) => {
            const store = new FileForEachRunStore({ dataDir });
            const enqueued: CreateTaskInput[] = [];
            const executor = new ForEachRunExecutor({
                store,
                enqueueChildTask: async (input) => {
                    enqueued.push(input);
                    return `task-${enqueued.length}`;
                },
            });
            const run = await createApprovedRun(store, [
                item({ id: 'item-1', title: 'First', prompt: 'Do first.' }),
                item({ id: 'item-2', title: 'Second', prompt: 'Do second.' }),
            ]);

            await executor.startOrContinueRun(WORKSPACE_ID, run.runId);
            expect(enqueued.map(task => task.displayName)).toEqual(['[For Each] First']);

            await executor.handleChildTaskCompleted(queuedTask(enqueued[0], 'task-1'));
            expect(enqueued.map(task => task.displayName)).toEqual(['[For Each] First', '[For Each] Second']);

            await executor.handleChildTaskCompleted(queuedTask(enqueued[1], 'task-2'));
            const completed = await store.getRun(WORKSPACE_ID, run.runId);
            expect(completed?.status).toBe('completed');
            expect(completed?.items.map(entry => entry.status)).toEqual(['completed', 'completed']);
        });
    });
});
