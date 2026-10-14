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
import { toTaskId, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { QueueActionExecutor } from '../../../src/server/triggers/queue-action-executor';
import { buildCiFailurePrompt } from '../../../src/server/triggers/ci-failure-prompt';
import type { Trigger, TriggerAction } from '../../../src/server/triggers/trigger-types';
import { createPrRepairOwnerValidator } from '../../../src/server/triggers/pr-repair-owner';
import { PullRequestChatBindingStore } from '../../../src/server/processes/pull-request-chat-binding-store';

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
        revision: 1,
        ...(overrides.binding ? { binding: overrides.binding } : {}),
        ...(overrides.delivery ? { delivery: overrides.delivery } : {}),
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
    it.each(['github-origin', 'ado-origin'])('validates exact bound chat/workspace for %s on its owning server', async origin => {
        const store = new SqliteProcessStore({ dbPath: ':memory:' });
        try {
            const bindings = new PullRequestChatBindingStore(store.getDatabase());
            bindings.bind(origin, '42', 'owner');
            const validate = createPrRepairOwnerValidator(store, async id => id === 'queue_owner' ? 'remote-clone' : 'foreign');
            await expect(validate('remote-clone', 'queue_owner', origin, '42')).resolves.toBeUndefined();
            await expect(validate('local', 'queue_owner', origin, '42')).rejects.toThrow('workspace');
            await expect(validate('foreign', 'another', origin, '42')).rejects.toThrow('PR-bound');
            bindings.bind(origin, '42', 'new-owner');
            await expect(validate('remote-clone', 'queue_owner', origin, '42')).rejects.toThrow('PR-bound');
        } finally { store.close(); }
    });
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
            expect(input.priority).toBe('high');
            expect(input.config.respectQueueBarriers).toBe(true);
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

        it('rejects an unresolved owner rather than falling back to another workspace', async () => {
            const store = makeProcessStore({ [PROC]: { id: PROC, status: 'completed' } });
            const queue = makeQueueManager();
            const exec = new QueueActionExecutor({
                processStore: store as any,
                queueManager: queue as any,
                resolveWorkspaceId: vi.fn(async () => undefined),
            });
            const trigger = makeTrigger();

            await expect(exec.execute(trigger, trigger.action, 'fix it')).rejects.toThrow('owner workspace');
            expect(queue.enqueued).toEqual([]);
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
            expect(msg.queuePriority).toBe('high');
            expect(msg.respectQueueBarriers).toBe(true);
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
        it.each(['ci', 'ci-and-conflicts'] as const)('uses durable %s repair admission and validates the PR-bound owner', async repairScope => {
            const store = makeProcessStore();
            const queue = makeQueueManager();
            const validatePrOwner = vi.fn().mockResolvedValue(undefined);
            const deliverPrRepairOnce = vi.fn().mockResolvedValue({ events: [] });
            const exec = new QueueActionExecutor({
                processStore: store as any, queueManager: queue as any, resolveWorkspaceId: async () => 'ws_a',
                validatePrOwner, messageDelivery: { deliverOnce: vi.fn(), deliverPrRepairOnce },
            });
            const trigger = makeTrigger();
            if (trigger.event.monitor !== 'ci-failure') throw new Error('Expected CI monitor');
            trigger.event.repairScope = repairScope;
            trigger.event.repairDelivery = { id: 'repair-1', prompt: 'Resolve conflict', state: 'pending', attempts: 0 };
            await exec.execute(trigger, trigger.action, 'Resolve conflict');
            expect(validatePrOwner).toHaveBeenCalledWith('ws_a', PROC, 'origin_1', '42');
            expect(deliverPrRepairOnce).toHaveBeenCalledWith('ws_a', PROC, 'repair-1', expect.objectContaining({
                turnSource: { source: 'trigger', triggerId: trigger.id, deliveryId: 'repair-1' },
            }));
            expect(queue.enqueue).not.toHaveBeenCalled();
            validatePrOwner.mockRejectedValueOnce(new Error('Owner changed'));
            await expect(exec.execute(trigger, trigger.action, 'Resolve conflict')).rejects.toThrow('Owner changed');
            expect(deliverPrRepairOnce).toHaveBeenCalledTimes(1);
        });
        it.each(['completed', 'running'])('keeps unrelated trigger delivery normal for a %s owner', async status => {
            const store = makeProcessStore({ [PROC]: { id: PROC, status, pendingMessages: [] } });
            const queue = makeQueueManager();
            const trigger = makeTrigger({ event: {
                type: 'condition-monitor', monitor: 'pr-merged', pollIntervalMs: 60_000, consecutiveErrors: 0,
                pr: { provider: 'github', host: 'github.com', repoPath: 'owner/repo', number: 42, url: 'https://github.com/owner/repo/pull/42' },
            } });
            await makeExecutor(store, queue).execute(trigger, trigger.action, 'Ordinary trigger');
            if (status === 'completed') {
                expect(queue.enqueued[0]).toMatchObject({ priority: 'normal', config: {} });
            } else {
                expect(store.procs.get(PROC).pendingMessages[0]).not.toHaveProperty('queuePriority');
            }
        });
        it('throws when no queue manager is available', async () => {
            const store = makeProcessStore({ [PROC]: { id: PROC, status: 'completed' } });
            const exec = makeExecutor(store, null);
            const trigger = makeTrigger();

            await expect(exec.execute(trigger, trigger.action, 'fix it')).rejects.toThrow(/TaskQueueManager/);
        });

        describe('Sentinel wake delivery', () => {
            function wakeTrigger() {
                return makeTrigger({
                    binding: { kind: 'sentinel-todo', itemId: 'item-1', armedBy: 'sentinel', armedAt: '2026-01-01T00:00:00.000Z' },
                    delivery: { deliveryId: 'delivery-1', firedAt: '2026-01-01T00:00:00.000Z', reason: 'merged', state: 'pending' },
                    action: { type: 'send-message', processId: PROC, prompt: 'wake', mode: 'inherit' },
                });
            }

            it('uses the shared durable admission service with its owner and fixed identity', async () => {
                const store = makeProcessStore();
                const queue = makeQueueManager();
                const deliverOnce = vi.fn().mockResolvedValue({ events: [] });
                const exec = new QueueActionExecutor({
                    processStore: store as any, queueManager: queue as any,
                    resolveWorkspaceId: async () => 'ws_other',
                    messageDelivery: { deliverOnce },
                });
                const trigger = wakeTrigger();
                await exec.execute(trigger, trigger.action, 'wake');
                expect(deliverOnce).toHaveBeenCalledWith('ws_a', PROC, 'delivery-1', {
                    content: 'wake', displayContent: 'wake',
                    turnSource: { source: 'trigger', triggerId: trigger.id, deliveryId: 'delivery-1' },
                });
                expect(queue.enqueue).not.toHaveBeenCalled();
            });

            it('never falls back to unsafe admission when the durable service is missing', async () => {
                const store = makeProcessStore();
                const queue = makeQueueManager();
                const trigger = wakeTrigger();
                await expect(makeExecutor(store, queue).execute(trigger, trigger.action, 'wake'))
                    .rejects.toThrow('durable message admission');
                expect(queue.enqueue).not.toHaveBeenCalled();
                expect(store.updateProcess).not.toHaveBeenCalled();
            });

            it('uses only the isolated stopped-Sentinel outcome entry point', async () => {
                const store = makeProcessStore();
                const queue = makeQueueManager();
                const deliverOnce = vi.fn();
                const deliverSentinelPrOutcomeOnce = vi.fn().mockResolvedValue({ events: [] });
                const exec = new QueueActionExecutor({
                    processStore: store as any, queueManager: queue as any,
                    resolveWorkspaceId: async () => 'foreign',
                    messageDelivery: { deliverOnce, deliverSentinelPrOutcomeOnce },
                });
                const trigger = wakeTrigger();
                trigger.binding!.delegatedPr = { jobId: 'job', receiptId: 'receipt' };
                await exec.execute(trigger, trigger.action, 'review');
                expect(deliverOnce).not.toHaveBeenCalled();
                expect(deliverSentinelPrOutcomeOnce).toHaveBeenCalledWith('ws_a', PROC, 'delivery-1', {
                    content: 'review', displayContent: 'review',
                    turnSource: { source: 'trigger', triggerId: trigger.id, deliveryId: 'delivery-1' },
                });
            });
        });
    });
});
