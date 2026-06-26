/**
 * QueueActionExecutor Tests (AC-03)
 *
 * Unit tests for the queue-backed `send-message` action delivery:
 *  - idle/terminal target → enqueues a chat follow-up carrying the templated
 *    prompt, `mode: 'autopilot'`, and the `trigger` turnSource context.
 *  - mid-turn target → buffers a pending message (carrying the trigger context)
 *    instead of double-enqueuing.
 *
 * Uses lightweight fakes for `ProcessStore` and `TaskQueueManager`. No I/O.
 */

import { describe, it, expect, vi } from 'vitest';
import { toTaskId } from '@plusplusoneplusplus/forge';
import { QueueActionExecutor } from '../../../src/server/triggers/queue-action-executor';
import { buildCiFailurePrompt } from '../../../src/server/triggers/ci-failure-prompt';
import type { Trigger, TriggerAction } from '../../../src/server/triggers/trigger-types';

// ============================================================================
// Fakes
// ============================================================================

function makeProcessStore(seed: Record<string, any> = {}) {
    const procs = new Map<string, any>(Object.entries(seed));
    return {
        procs,
        getProcess: vi.fn(async (id: string) => procs.get(id)),
        updateProcess: vi.fn(async (id: string, patch: any) => {
            const existing = procs.get(id) ?? { id };
            procs.set(id, { ...existing, ...patch });
        }),
    };
}

function makeQueueManager(seedTasks: Record<string, { status: string }> = {}) {
    const enqueued: any[] = [];
    const tasks = new Map<string, { status: string }>(Object.entries(seedTasks));
    return {
        enqueued,
        tasks,
        enqueue: vi.fn((input: any) => {
            enqueued.push(input);
            return `task_${enqueued.length}`;
        }),
        getTask: vi.fn((id: string) => tasks.get(id)),
    };
}

const PROC = 'queue_proc_a';

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
    const action: TriggerAction = overrides.action ?? {
        type: 'send-message',
        processId: PROC,
        prompt: 'fallback prompt',
        mode: 'autopilot',
    };
    return {
        id: overrides.id ?? 'trigger_1',
        workspaceId: overrides.workspaceId ?? 'ws_a',
        processId: overrides.processId ?? PROC,
        status: overrides.status ?? 'active',
        event: overrides.event ?? {
            type: 'condition-monitor',
            monitor: 'ci-failure',
            originId: 'origin_1',
            prId: '42',
            pollIntervalMs: 60_000,
            lastSeenChecks: {},
        },
        action,
        inFlight: overrides.inFlight ?? true,
        createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
        expiresAt: overrides.expiresAt ?? '2099-01-01T00:00:00.000Z',
        lastTickAt: null,
        nextTickAt: null,
    };
}

function makeExecutor(
    store: ReturnType<typeof makeProcessStore>,
    queue: ReturnType<typeof makeQueueManager> | null,
    workspaceId: string | undefined = 'ws_a',
) {
    return new QueueActionExecutor({
        processStore: store as any,
        queueManager: queue as any,
        resolveWorkspaceId: vi.fn(async () => workspaceId),
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('QueueActionExecutor', () => {
    describe('idle/terminal target → enqueue follow-up', () => {
        it('enqueues a follow-up carrying the templated prompt, autopilot mode, and trigger turnSource', async () => {
            const prompt = buildCiFailurePrompt(42, [
                { name: 'build', detailsUrl: 'https://ci.example/build/1' },
            ]);
            const store = makeProcessStore({ [PROC]: { id: PROC, status: 'completed' } });
            const queue = makeQueueManager();
            const exec = makeExecutor(store, queue);
            const trigger = makeTrigger({ action: { type: 'send-message', processId: PROC, prompt, mode: 'autopilot' } });

            await exec.execute(trigger, trigger.action, prompt);

            expect(queue.enqueue).toHaveBeenCalledTimes(1);
            expect(store.updateProcess).not.toHaveBeenCalled();

            const input = queue.enqueued[0];
            expect(input.type).toBe('chat');
            expect(input.processId).toBe(PROC);
            expect(input.repoId).toBe('ws_a');
            expect(input.payload.prompt).toBe(prompt);
            expect(input.payload.prompt).toContain('#42');
            expect(input.payload.prompt).toContain('https://ci.example/build/1');
            expect(input.payload.mode).toBe('autopilot');
            expect(input.payload.processId).toBe(PROC);
            expect(input.payload.context).toEqual({ triggerId: 'trigger_1', source: 'trigger' });
        });

        it('omits repoId when the workspace cannot be resolved', async () => {
            const store = makeProcessStore({ [PROC]: { id: PROC, status: 'completed' } });
            const queue = makeQueueManager();
            const exec = new QueueActionExecutor({
                processStore: store as any,
                queueManager: queue as any,
                resolveWorkspaceId: vi.fn(async () => undefined),
            });
            const trigger = makeTrigger();

            await exec.execute(trigger, trigger.action, 'fix it');

            expect(queue.enqueued[0].repoId).toBeUndefined();
        });
    });

    describe('mid-turn target → buffer pending message', () => {
        it('buffers (does not enqueue) when the process status is running', async () => {
            const store = makeProcessStore({ [PROC]: { id: PROC, status: 'running', pendingMessages: [] } });
            const queue = makeQueueManager();
            const exec = makeExecutor(store, queue);
            const trigger = makeTrigger();

            await exec.execute(trigger, trigger.action, 'fix the CI');

            expect(queue.enqueue).not.toHaveBeenCalled();
            expect(store.updateProcess).toHaveBeenCalledTimes(1);

            const patch = store.updateProcess.mock.calls[0][1];
            expect(patch.pendingMessages).toHaveLength(1);
            const msg = patch.pendingMessages[0];
            expect(msg.content).toBe('fix the CI');
            expect(msg.mode).toBe('autopilot');
            expect(msg.context).toEqual({ triggerId: 'trigger_1', source: 'trigger' });
        });

        it('buffers when a queue task for the process is already running', async () => {
            const store = makeProcessStore({ [PROC]: { id: PROC, status: 'completed', pendingMessages: [] } });
            const queue = makeQueueManager({ [toTaskId(PROC)]: { status: 'running' } });
            const exec = makeExecutor(store, queue);
            const trigger = makeTrigger();

            await exec.execute(trigger, trigger.action, 'fix the CI');

            expect(queue.enqueue).not.toHaveBeenCalled();
            expect(store.updateProcess).toHaveBeenCalledTimes(1);
        });

        it('appends to existing pending messages rather than replacing them', async () => {
            const existing = { id: 'm0', content: 'earlier', createdAt: '2026-01-01T00:00:00.000Z' };
            const store = makeProcessStore({ [PROC]: { id: PROC, status: 'running', pendingMessages: [existing] } });
            const queue = makeQueueManager();
            const exec = makeExecutor(store, queue);
            const trigger = makeTrigger();

            await exec.execute(trigger, trigger.action, 'fix the CI');

            const patch = store.updateProcess.mock.calls[0][1];
            expect(patch.pendingMessages).toHaveLength(2);
            expect(patch.pendingMessages[0]).toBe(existing);
            expect(patch.pendingMessages[1].content).toBe('fix the CI');
        });
    });

    describe('guards', () => {
        it('throws when no queue manager is available', async () => {
            const store = makeProcessStore({ [PROC]: { id: PROC, status: 'completed' } });
            const exec = makeExecutor(store, null);
            const trigger = makeTrigger();

            await expect(exec.execute(trigger, trigger.action, 'fix it')).rejects.toThrow(/TaskQueueManager/);
        });
    });
});
