import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { TaskQueueManager } from '@plusplusoneplusplus/forge';
import { CronStore } from '../../../src/server/cron/cron-store';
import {
    cancelSentinelCron,
    ensureSentinelCron,
    registerSentinelCronProvisioning,
    SENTINEL_CRON_DESCRIPTION,
    SENTINEL_TICK_INTERVAL_MS,
    SENTINEL_TICK_PROMPT,
} from '../../../src/server/sentinel/sentinel-cron';
import type { CronExecutor } from '../../../src/server/cron/cron-executor';

function createHarness() {
    const db = new Database(':memory:');
    const queueManager = new TaskQueueManager();
    const store = new CronStore(db);
    const armTimer = vi.fn();
    const emit = vi.fn();
    const now = new Date('2026-09-16T20:00:00.000Z');
    const dispose = registerSentinelCronProvisioning({
        queueManager,
        store,
        executor: { armTimer } as Pick<CronExecutor, 'armTimer'>,
        emit,
        now: () => now,
        createId: () => 'cron_sentinel',
        onError: vi.fn(),
    });
    return { db, queueManager, store, armTimer, emit, now, dispose };
}

describe('Sentinel cron provisioning', () => {
    it('creates and arms an hourly process-bound cron after enqueue', () => {
        const harness = createHarness();

        const taskId = harness.queueManager.enqueue({
            id: 'sentinel-task',
            type: 'chat',
            priority: 'normal',
            payload: {
                kind: 'chat',
                mode: 'sentinel',
                prompt: 'Supervise this workspace',
                workspaceId: 'workspace-a',
            },
            config: {},
        });

        const cron = harness.store.getByProcess(`queue_${taskId}`)[0];
        expect(cron).toMatchObject({
            id: 'cron_sentinel',
            processId: 'queue_sentinel-task',
            workspaceId: 'workspace-a',
            description: SENTINEL_CRON_DESCRIPTION,
            intervalMs: SENTINEL_TICK_INTERVAL_MS,
            prompt: SENTINEL_TICK_PROMPT,
            status: 'active',
        });
        expect(cron.nextTickAt).toBe('2026-09-16T21:00:00.000Z');
        expect(harness.armTimer).toHaveBeenCalledWith(cron);
        expect(harness.emit).toHaveBeenCalledWith({ type: 'cron-created', cron });
        harness.dispose();
        harness.db.close();
    });

    it('ignores ordinary chats and Sentinel follow-ups', () => {
        const harness = createHarness();

        harness.queueManager.enqueue({
            id: 'ordinary',
            type: 'chat',
            priority: 'normal',
            payload: { kind: 'chat', mode: 'ask', prompt: 'Hello', workspaceId: 'workspace-a' },
            config: {},
        });
        harness.queueManager.enqueue({
            id: 'follow-up',
            type: 'chat',
            priority: 'normal',
            payload: {
                kind: 'chat',
                mode: 'sentinel',
                processId: 'queue_existing',
                prompt: SENTINEL_TICK_PROMPT,
                workspaceId: 'workspace-a',
            },
            config: {},
        });

        expect(harness.store.getAll()).toEqual([]);
        expect(harness.armTimer).not.toHaveBeenCalled();
        harness.dispose();
        harness.db.close();
    });

    it('does not create a duplicate cron for the same Sentinel process', () => {
        const harness = createHarness();
        const task = {
            id: 'sentinel-task',
            type: 'chat',
            priority: 'normal' as const,
            status: 'queued' as const,
            createdAt: harness.now.getTime(),
            retryCount: 0,
            payload: {
                kind: 'chat',
                mode: 'sentinel',
                prompt: 'Supervise this workspace',
                workspaceId: 'workspace-a',
            },
            config: {},
        };

        const first = ensureSentinelCron(task, {
            store: harness.store,
            executor: { armTimer: harness.armTimer } as Pick<CronExecutor, 'armTimer'>,
            now: () => harness.now,
            createId: () => 'cron_sentinel',
        });
        const second = ensureSentinelCron(task, {
            store: harness.store,
            executor: { armTimer: harness.armTimer } as Pick<CronExecutor, 'armTimer'>,
            now: () => harness.now,
            createId: () => 'cron_other',
        });

        expect(second).toEqual(first);
        expect(harness.store.getAll()).toHaveLength(1);
        harness.dispose();
        harness.db.close();
    });

    it('stops provisioning after disposal', () => {
        const harness = createHarness();
        harness.dispose();

        harness.queueManager.enqueue({
            id: 'sentinel-task',
            type: 'chat',
            priority: 'normal',
            payload: {
                kind: 'chat',
                mode: 'sentinel',
                prompt: 'Supervise this workspace',
                workspaceId: 'workspace-a',
            },
            config: {},
        });

        expect(harness.store.getAll()).toEqual([]);
        harness.db.close();
    });

    it('cancels only the old process Sentinel cron during replacement', () => {
        const harness = createHarness();
        const task = {
            id: 'sentinel-task',
            type: 'chat',
            priority: 'normal' as const,
            status: 'queued' as const,
            createdAt: harness.now.getTime(),
            retryCount: 0,
            payload: {
                kind: 'chat',
                mode: 'sentinel',
                prompt: 'Supervise this workspace',
                workspaceId: 'workspace-a',
            },
            config: {},
        };
        const cron = ensureSentinelCron(task, {
            store: harness.store,
            executor: { armTimer: harness.armTimer } as Pick<CronExecutor, 'armTimer'>,
            now: () => harness.now,
            createId: () => 'cron_sentinel',
        })!;
        const disarmTimer = vi.fn();

        expect(cancelSentinelCron(cron.processId, {
            store: harness.store,
            executor: { disarmTimer },
            emit: harness.emit,
        })).toBe(1);

        expect(harness.store.getById(cron.id)).toMatchObject({
            status: 'cancelled',
            nextTickAt: null,
        });
        expect(disarmTimer).toHaveBeenCalledWith(cron.id);
        expect(harness.emit).toHaveBeenCalledWith({
            type: 'cron-cancelled',
            cron: expect.objectContaining({ id: cron.id, status: 'cancelled' }),
        });
        harness.dispose();
        harness.db.close();
    });
});
