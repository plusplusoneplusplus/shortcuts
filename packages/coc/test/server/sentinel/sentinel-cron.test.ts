import Database from 'better-sqlite3';
import { rmSync } from 'fs';
import { mkdir, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { TaskQueueManager } from '@plusplusoneplusplus/forge';
import { CronStore } from '../../../src/server/cron/cron-store';
import {
    cancelSentinelCron,
    checkSentinelNow,
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

describe('Sentinel manual check', () => {
    it('fires the active cron owned by the workspace watchlist', async () => {
        const dataDir = await mkdtemp(path.join(tmpdir(), 'sentinel-check-'));
        const workspaceId = 'workspace-a';
        const processId = 'queue_sentinel-task';
        const watchlistDir = path.join(dataDir, 'repos', workspaceId, 'notes', 'Sentinel');
        await mkdir(watchlistDir, { recursive: true });
        await writeFile(path.join(watchlistDir, '.watchlist.json'), JSON.stringify({
            version: 1,
            sentinelProcessId: processId,
            claimedAt: new Date().toISOString(),
            excludedProcessIds: [processId],
            entries: [],
        }));
        const triggerNow = vi.fn(async () => undefined);

        const result = await checkSentinelNow(workspaceId, {
            dataDir,
            processStore: {
                getProcess: vi.fn(async () => ({
                    id: processId,
                    status: 'completed',
                    archived: false,
                    metadata: { workspaceId, mode: 'sentinel' },
                })),
            },
            store: {
                getByProcess: vi.fn(() => [{
                    id: 'cron_sentinel',
                    processId,
                    description: SENTINEL_CRON_DESCRIPTION,
                    status: 'active',
                }]),
            } as Pick<CronStore, 'getByProcess'>,
            executor: { isInflight: () => false, triggerNow },
        });

        expect(result).toEqual({ status: 'triggered', processId, cronId: 'cron_sentinel' });
        expect(triggerNow).toHaveBeenCalledWith('cron_sentinel');
        rmSync(dataDir, { recursive: true, force: true });
    });

    it('does not fire for another workspace or while the Sentinel is busy', async () => {
        const dataDir = await mkdtemp(path.join(tmpdir(), 'sentinel-check-'));
        const watchlistDir = path.join(dataDir, 'repos', 'workspace-a', 'notes', 'Sentinel');
        await mkdir(watchlistDir, { recursive: true });
        await writeFile(path.join(watchlistDir, '.watchlist.json'), JSON.stringify({
            sentinelProcessId: 'queue_sentinel-task',
        }));
        const triggerNow = vi.fn(async () => undefined);
        const processStore = {
            getProcess: vi.fn(async (_processId: string, workspaceId: string) => workspaceId === 'workspace-a'
                ? {
                    id: 'queue_sentinel-task',
                    status: 'completed' as const,
                    archived: false,
                    metadata: { workspaceId, mode: 'sentinel' },
                }
                : undefined),
        };

        await expect(checkSentinelNow('workspace-b', {
            dataDir,
            processStore,
            store: { getByProcess: vi.fn() },
            executor: { isInflight: () => false, triggerNow },
        })).resolves.toEqual({ status: 'not-found' });

        await expect(checkSentinelNow('workspace-a', {
            dataDir,
            processStore,
            store: { getByProcess: vi.fn() },
            executor: { isInflight: () => true, triggerNow },
        })).resolves.toEqual({ status: 'busy', processId: 'queue_sentinel-task' });

        await expect(checkSentinelNow('workspace-a', {
            dataDir,
            processStore,
            store: { getByProcess: vi.fn(() => []) },
            executor: { isInflight: () => false, triggerNow },
        })).resolves.toEqual({ status: 'not-ready', processId: 'queue_sentinel-task' });
        expect(triggerNow).not.toHaveBeenCalled();
        rmSync(dataDir, { recursive: true, force: true });
    });
});
