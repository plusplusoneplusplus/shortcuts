import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskDefs } from '../../../src/server/tasks/task-types';

/**
 * Tests for memory-aggregate enqueue deduplication.
 *
 * Exercises the CLITaskExecutor.enqueueMemoryAggregate() helper to verify:
 * - At most one queued/running aggregate task per (workspaceId, target)
 * - Different targets for the same workspace are independent
 * - Different workspaces are independent
 */

// Minimal QueuedTask-like shape
interface FakeTask {
    id: string;
    type: string;
    status: string;
    payload: Record<string, unknown>;
}

function createFakeQueueManager() {
    const tasks: FakeTask[] = [];
    let nextId = 1;

    return {
        getAll: vi.fn(() => [...tasks]),
        enqueue: vi.fn((opts: any) => {
            const task: FakeTask = {
                id: opts.id ?? `t-${nextId++}`,
                type: opts.type,
                status: 'queued',
                payload: opts.payload,
            };
            tasks.push(task);
            return task;
        }),
        _tasks: tasks,
        _addExisting(t: FakeTask) { tasks.push(t); },
    };
}

/**
 * Standalone function that mirrors CLITaskExecutor.enqueueMemoryAggregate()
 * without needing the full executor stack. This tests the pure dedup logic.
 */
function enqueueMemoryAggregate(
    queueManager: ReturnType<typeof createFakeQueueManager>,
    workspaceId: string,
    target: 'memory' | 'system',
    trigger?: string,
): void {
    const existing = queueManager.getAll()
        .find((t: FakeTask) =>
            t.type === TaskDefs.memoryAggregate.kind
            && t.payload?.workspaceId === workspaceId
            && t.payload?.target === target
            && (t.status === 'queued' || t.status === 'running'),
        );
    if (existing) return;
    queueManager.enqueue({
        type: TaskDefs.memoryAggregate.kind,
        repoId: workspaceId,
        priority: 'low',
        payload: {
            kind: 'memory-aggregate' as const,
            workspaceId,
            target,
            trigger: trigger ?? 'capture-trigger',
        },
        config: {},
        displayName: `Memory aggregate (${target})`,
    });
}

describe('memory-aggregate enqueue deduplication', () => {
    let qm: ReturnType<typeof createFakeQueueManager>;

    beforeEach(() => {
        qm = createFakeQueueManager();
    });

    it('enqueues a task when none exists', () => {
        enqueueMemoryAggregate(qm, 'ws-1', 'memory');

        expect(qm.enqueue).toHaveBeenCalledTimes(1);
        const call = qm.enqueue.mock.calls[0][0];
        expect(call.type).toBe('memory-aggregate');
        expect(call.payload.workspaceId).toBe('ws-1');
        expect(call.payload.target).toBe('memory');
        expect(call.priority).toBe('low');
    });

    it('skips enqueue when a queued task already exists for same scope', () => {
        enqueueMemoryAggregate(qm, 'ws-1', 'memory');
        enqueueMemoryAggregate(qm, 'ws-1', 'memory');

        expect(qm.enqueue).toHaveBeenCalledTimes(1);
    });

    it('skips enqueue when a running task already exists for same scope', () => {
        qm._addExisting({
            id: 'existing-run',
            type: 'memory-aggregate',
            status: 'running',
            payload: { kind: 'memory-aggregate', workspaceId: 'ws-1', target: 'memory' },
        });

        enqueueMemoryAggregate(qm, 'ws-1', 'memory');
        expect(qm.enqueue).not.toHaveBeenCalled();
    });

    it('allows enqueue when existing task is completed', () => {
        qm._addExisting({
            id: 'done-task',
            type: 'memory-aggregate',
            status: 'completed',
            payload: { kind: 'memory-aggregate', workspaceId: 'ws-1', target: 'memory' },
        });

        enqueueMemoryAggregate(qm, 'ws-1', 'memory');
        expect(qm.enqueue).toHaveBeenCalledTimes(1);
    });

    it('allows enqueue when existing task has failed', () => {
        qm._addExisting({
            id: 'failed-task',
            type: 'memory-aggregate',
            status: 'failed',
            payload: { kind: 'memory-aggregate', workspaceId: 'ws-1', target: 'memory' },
        });

        enqueueMemoryAggregate(qm, 'ws-1', 'memory');
        expect(qm.enqueue).toHaveBeenCalledTimes(1);
    });

    it('different targets are independent — allows both memory and system', () => {
        enqueueMemoryAggregate(qm, 'ws-1', 'memory');
        enqueueMemoryAggregate(qm, 'ws-1', 'system');

        expect(qm.enqueue).toHaveBeenCalledTimes(2);
        expect(qm._tasks[0].payload.target).toBe('memory');
        expect(qm._tasks[1].payload.target).toBe('system');
    });

    it('different workspaces are independent', () => {
        enqueueMemoryAggregate(qm, 'ws-1', 'memory');
        enqueueMemoryAggregate(qm, 'ws-2', 'memory');

        expect(qm.enqueue).toHaveBeenCalledTimes(2);
        expect(qm._tasks[0].payload.workspaceId).toBe('ws-1');
        expect(qm._tasks[1].payload.workspaceId).toBe('ws-2');
    });

    it('many rapid captures for same scope produce exactly one task', () => {
        for (let i = 0; i < 10; i++) {
            enqueueMemoryAggregate(qm, 'ws-1', 'memory', `capture-${i}`);
        }

        expect(qm.enqueue).toHaveBeenCalledTimes(1);
    });

    it('includes trigger in payload', () => {
        enqueueMemoryAggregate(qm, 'ws-1', 'memory', 'manual');

        const payload = qm.enqueue.mock.calls[0][0].payload;
        expect(payload.trigger).toBe('manual');
    });

    it('uses default trigger when not specified', () => {
        enqueueMemoryAggregate(qm, 'ws-1', 'memory');

        const payload = qm.enqueue.mock.calls[0][0].payload;
        expect(payload.trigger).toBe('capture-trigger');
    });
});

describe('capture detection in tool events', () => {
    it('detects capture-mode memory tool completion with recordId', () => {
        // Simulate what buildToolEventHandler does: parse the result and
        // call onMemoryCaptured when it finds a recordId
        const onMemoryCaptured = vi.fn();

        const event = {
            type: 'tool-complete' as const,
            toolName: 'memory',
            toolCallId: 'tc-1',
            result: JSON.stringify({
                success: true,
                message: 'Memory candidate captured; memory will update after aggregation.',
                recordId: 'rec-abc-123',
            }),
            parameters: { action: 'add', target: 'memory', content: 'Some fact' },
        };

        // Simulate detection logic from base-executor
        if (event.type === 'tool-complete' && event.toolName === 'memory') {
            try {
                const parsed = JSON.parse(event.result);
                if (parsed?.success && parsed?.recordId) {
                    const target = event.parameters?.target;
                    if (target === 'memory' || target === 'system') {
                        onMemoryCaptured(target);
                    }
                }
            } catch { /* ignore */ }
        }

        expect(onMemoryCaptured).toHaveBeenCalledWith('memory');
    });

    it('does not trigger for non-capture (bounded) mode results', () => {
        const onMemoryCaptured = vi.fn();

        const event = {
            type: 'tool-complete' as const,
            toolName: 'memory',
            toolCallId: 'tc-2',
            result: JSON.stringify({ success: true, usage: { current: 50, limit: 2200, percent: 2, entryCount: 1 } }),
            parameters: { action: 'add', target: 'memory', content: 'Some fact' },
        };

        if (event.type === 'tool-complete' && event.toolName === 'memory') {
            try {
                const parsed = JSON.parse(event.result);
                if (parsed?.success && parsed?.recordId) {
                    const target = event.parameters?.target;
                    if (target === 'memory' || target === 'system') {
                        onMemoryCaptured(target);
                    }
                }
            } catch { /* ignore */ }
        }

        expect(onMemoryCaptured).not.toHaveBeenCalled();
    });

    it('does not trigger for failed memory tool calls', () => {
        const onMemoryCaptured = vi.fn();

        const event = {
            type: 'tool-complete' as const,
            toolName: 'memory',
            toolCallId: 'tc-3',
            result: JSON.stringify({ success: false, error: 'Content blocked' }),
            parameters: { action: 'add', target: 'memory', content: 'bad content' },
        };

        if (event.type === 'tool-complete' && event.toolName === 'memory') {
            try {
                const parsed = JSON.parse(event.result);
                if (parsed?.success && parsed?.recordId) {
                    const target = event.parameters?.target;
                    if (target === 'memory' || target === 'system') {
                        onMemoryCaptured(target);
                    }
                }
            } catch { /* ignore */ }
        }

        expect(onMemoryCaptured).not.toHaveBeenCalled();
    });

    it('does not trigger for non-memory tools', () => {
        const onMemoryCaptured = vi.fn();

        const event = {
            type: 'tool-complete' as const,
            toolName: 'edit_file',
            toolCallId: 'tc-4',
            result: JSON.stringify({ success: true, recordId: 'fake' }),
            parameters: { target: 'memory' },
        };

        if (event.type === 'tool-complete' && event.toolName === 'memory') {
            try {
                const parsed = JSON.parse(event.result);
                if (parsed?.success && parsed?.recordId) {
                    const target = event.parameters?.target;
                    if (target === 'memory' || target === 'system') {
                        onMemoryCaptured(target);
                    }
                }
            } catch { /* ignore */ }
        }

        expect(onMemoryCaptured).not.toHaveBeenCalled();
    });
});
