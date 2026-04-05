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
        expect(call.type).toBe('chat');
        expect(call.priority).toBe('high');
        expect(call.payload.kind).toBe('chat');
        expect(call.payload.mode).toBe('autopilot');
        expect(call.payload.prompt).toContain('Plan content');
        expect(call.payload.workItemId).toBe('wi-exec-1');
        expect(call.displayName).toContain('Test work item');

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

    it('marks work item failed on failure', async () => {
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
        expect(updated!.status).toBe('failed');
        expect(updated!.completedAt).toBeDefined();
        expect(updated!.executionHistory![0].status).toBe('failed');
        expect(updated!.executionHistory![0].error).toBe('Timeout exceeded');
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
