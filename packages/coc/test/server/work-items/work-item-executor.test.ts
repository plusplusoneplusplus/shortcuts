import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import {
    executeWorkItem,
    handleWorkItemTaskComplete,
    buildExecutionPrompt,
} from '../../../src/server/work-items/work-item-executor';
import type { WorkItem } from '../../../src/server/work-items/types';

let tmpDir: string;
let store: FileWorkItemStore;

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        repoId: 'test-repo',
        title: 'Test work item',
        description: 'A test description',
        status: 'created',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-exec-'));
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('buildExecutionPrompt', () => {
    it('includes title, description, and plan', () => {
        const item = makeWorkItem({
            title: 'Refactor auth',
            description: 'Refactor the authentication module',
            plan: { version: 1, content: '1. Extract token logic\n2. Add tests', updatedAt: '' },
        });

        const prompt = buildExecutionPrompt(item);
        expect(prompt).toContain('Refactor auth');
        expect(prompt).toContain('Refactor the authentication module');
        expect(prompt).toContain('Extract token logic');
        expect(prompt).toContain('Execute the plan above');
    });

    it('works without plan', () => {
        const item = makeWorkItem({ title: 'Simple task', description: 'Do it' });
        const prompt = buildExecutionPrompt(item);
        expect(prompt).toContain('Simple task');
        expect(prompt).toContain('Do it');
    });
});

describe('executeWorkItem', () => {
    it('enqueues a task and transitions to executing', async () => {
        const item = makeWorkItem({
            id: 'wi-exec-1',
            status: 'readyToExecute',
            plan: { version: 1, content: 'Plan content', updatedAt: '' },
            priority: 'high',
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-123');

        const result = await executeWorkItem('wi-exec-1', store, enqueue);

        expect(result.taskId).toBe('task-123');
        expect(enqueue).toHaveBeenCalledOnce();

        const call = enqueue.mock.calls[0][0];
        expect(call.type).toBe('run-workflow');
        expect(call.priority).toBe('high');
        expect(call.payload.kind).toBe('chat');
        expect(call.payload.mode).toBe('autopilot');
        expect(call.payload.prompt).toContain('Plan content');
        expect(call.payload.workItemId).toBe('wi-exec-1');
        expect(call.displayName).toBe('Run #1: Code Implement');

        // Verify status transitioned
        const updated = await store.getWorkItem('wi-exec-1', 'test-repo');
        expect(updated!.status).toBe('executing');
        expect(updated!.executionHistory).toHaveLength(1);
        expect(updated!.executionHistory![0].taskId).toBe('task-123');
        expect(updated!.executionHistory![0].status).toBe('running');
    });

    it('throws for non-ready work items', async () => {
        const item = makeWorkItem({ id: 'wi-not-ready', status: 'created' });
        await store.addWorkItem(item);

        const enqueue = vi.fn();
        await expect(executeWorkItem('wi-not-ready', store, enqueue)).rejects.toThrow(
            /Cannot execute.*created/
        );
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('throws for non-existent work items', async () => {
        const enqueue = vi.fn();
        await expect(executeWorkItem('nonexistent', store, enqueue)).rejects.toThrow('not found');
    });

    it('respects model override', async () => {
        const item = makeWorkItem({ id: 'wi-model', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-456');
        await executeWorkItem('wi-model', store, enqueue, { model: 'gpt-4' });

        const call = enqueue.mock.calls[0][0];
        expect(call.config.model).toBe('gpt-4');
    });
});

describe('handleWorkItemTaskComplete', () => {
    it('marks work item done on completion', async () => {
        const item = makeWorkItem({ id: 'wi-done', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-done', {
            taskId: 'task-1',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });

        await handleWorkItemTaskComplete('wi-done', 'task-1', {
            status: 'completed',
            processId: 'proc-1',
        }, store);

        const updated = await store.getWorkItem('wi-done', 'test-repo');
        expect(updated!.status).toBe('aiDone');
        expect(updated!.processId).toBe('proc-1');
        expect(updated!.executionHistory![0].status).toBe('completed');
    });

    it('marks work item aiFailed on failure', async () => {
        const item = makeWorkItem({ id: 'wi-fail', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-fail', {
            taskId: 'task-2',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });

        await handleWorkItemTaskComplete('wi-fail', 'task-2', {
            status: 'failed',
            error: 'Timeout exceeded',
        }, store);

        const updated = await store.getWorkItem('wi-fail', 'test-repo');
        expect(updated!.status).toBe('aiFailed');
        expect(updated!.completedAt).toBeDefined();
        expect(updated!.executionHistory![0].status).toBe('failed');
        expect(updated!.executionHistory![0].error).toBe('Timeout exceeded');
    });

    it('transitions to readyToExecute on cancellation', async () => {
        const item = makeWorkItem({ id: 'wi-cancel', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-cancel', {
            taskId: 'task-cancel',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });

        await handleWorkItemTaskComplete('wi-cancel', 'task-cancel', {
            status: 'cancelled',
        }, store);

        const updated = await store.getWorkItem('wi-cancel', 'test-repo');
        expect(updated!.status).toBe('readyToExecute');
        expect(updated!.completedAt).toBeUndefined();
        expect(updated!.executionHistory![0].status).toBe('cancelled');
    });

    it('does not set completedAt when transitioning to aiDone', async () => {
        const item = makeWorkItem({ id: 'wi-aidone', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-aidone', {
            taskId: 'task-3',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });

        await handleWorkItemTaskComplete('wi-aidone', 'task-3', {
            status: 'completed',
            processId: 'proc-2',
        }, store);

        const updated = await store.getWorkItem('wi-aidone', 'test-repo');
        expect(updated!.status).toBe('aiDone');
        expect(updated!.completedAt).toBeUndefined();
    });
});

describe('executeWorkItem sessionCategory', () => {
    it('sets sessionCategory to generating-code in the task payload', async () => {
        const item = makeWorkItem({ id: 'wi-cat-payload', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-cat-1');
        await executeWorkItem('wi-cat-payload', store, enqueue);

        const call = enqueue.mock.calls[0][0];
        expect(call.payload.sessionCategory).toBe('generating-code');
    });

    it('sets sessionCategory to generating-code in the execution history record', async () => {
        const item = makeWorkItem({ id: 'wi-cat-exec', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-cat-2');
        await executeWorkItem('wi-cat-exec', store, enqueue);

        const updated = await store.getWorkItem('wi-cat-exec', 'test-repo');
        expect(updated!.executionHistory).toHaveLength(1);
        expect(updated!.executionHistory![0].sessionCategory).toBe('generating-code');
    });
});

describe('executeWorkItem title', () => {
    it('sets title to "Code Implement" on the execution entry', async () => {
        const item = makeWorkItem({ id: 'wi-title-1', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-title-1');
        await executeWorkItem('wi-title-1', store, enqueue);

        const updated = await store.getWorkItem('wi-title-1', 'test-repo');
        expect(updated!.executionHistory![0].title).toBe('Code Implement');
    });

    it('sets displayName to "Run #1: Code Implement" for the first execution', async () => {
        const item = makeWorkItem({ id: 'wi-dn-1', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-dn-1');
        await executeWorkItem('wi-dn-1', store, enqueue);

        const call = enqueue.mock.calls[0][0];
        expect(call.displayName).toBe('Run #1: Code Implement');
    });

    it('increments run number based on existing execution history', async () => {
        const item = makeWorkItem({
            id: 'wi-dn-2',
            status: 'readyToExecute',
            executionHistory: [
                { taskId: 'prev-1', startedAt: '2026-01-01T00:00:00Z', status: 'completed', title: 'Code Implement' },
                { taskId: 'prev-2', startedAt: '2026-01-01T01:00:00Z', status: 'completed', title: 'Resolve comments for Run #1' },
            ],
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-dn-3');
        await executeWorkItem('wi-dn-2', store, enqueue);

        const call = enqueue.mock.calls[0][0];
        expect(call.displayName).toBe('Run #3: Code Implement');
    });

    it('preserves title "Code Implement" on auto-re-executed runs', async () => {
        const item = makeWorkItem({ id: 'wi-auto-title', status: 'readyToExecute' });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-auto-title');
        await executeWorkItem('wi-auto-title', store, enqueue, { autoReExecuted: true });

        const updated = await store.getWorkItem('wi-auto-title', 'test-repo');
        expect(updated!.executionHistory![0].title).toBe('Code Implement');
        expect(updated!.executionHistory![0].autoReExecuted).toBe(true);
    });
});
