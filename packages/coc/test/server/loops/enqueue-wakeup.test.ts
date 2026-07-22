/**
 * createEnqueueWakeup command tests.
 *
 * The command must persist a durable pending record (with an absolute firesAt)
 * *before* handing the entry to the executor to arm — that ordering is what
 * makes a wakeup recoverable across restarts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ScheduleTimerRegistry } from '../../../src/server/schedule/schedule-timer-registry';
import { WakeupStore } from '../../../src/server/loops/wakeup-store';
import { WakeupExecutor } from '../../../src/server/loops/wakeup-executor';
import { createEnqueueWakeup } from '../../../src/server/loops/enqueue-wakeup';
import { createMockProcessStore } from '../helpers/mock-process-store';

const BASE = Date.UTC(2026, 0, 1, 0, 0, 0);

describe('createEnqueueWakeup', () => {
    let db: Database.Database;
    let store: WakeupStore;
    let executor: WakeupExecutor;
    let armSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        db = new Database(':memory:');
        store = new WakeupStore(db);
        executor = new WakeupExecutor({
            store,
            processStore: createMockProcessStore(),
            timerRegistry: new ScheduleTimerRegistry(),
            executeFollowUp: vi.fn().mockResolvedValue(undefined),
            now: () => BASE,
        });
        armSpy = vi.spyOn(executor, 'arm');
    });

    afterEach(() => {
        try { db.close(); } catch { /* ok */ }
    });

    it('persists a pending record with an absolute firesAt, then arms it', () => {
        const enqueue = createEnqueueWakeup({ store, executor, now: () => BASE });
        enqueue({
            processId: 'proc_1',
            prompt: 'resume me',
            delayMs: 90_000,
            wakeupId: 'w1',
            model: 'claude-opus-4-8',
            workspaceId: 'ws-1',
        });

        const got = store.getById('w1')!;
        expect(got).not.toBeNull();
        expect(got.status).toBe('pending');
        expect(got.processId).toBe('proc_1');
        expect(got.prompt).toBe('resume me');
        expect(got.model).toBe('claude-opus-4-8');
        expect(got.workspaceId).toBe('ws-1');
        expect(got.createdAt).toBe(new Date(BASE).toISOString());
        expect(got.firesAt).toBe(new Date(BASE + 90_000).toISOString());

        // The executor was asked to arm the persisted entry.
        expect(armSpy).toHaveBeenCalledTimes(1);
        expect(armSpy.mock.calls[0][0]).toMatchObject({ id: 'w1', status: 'pending' });
    });

    it('persists before arming so the record exists when arm runs', () => {
        let statusAtArm: string | undefined;
        vi.spyOn(executor, 'arm').mockImplementation((entry) => {
            // The row must already be readable from the store at arm time.
            statusAtArm = store.getById(entry.id)?.status;
        });

        const enqueue = createEnqueueWakeup({ store, executor, now: () => BASE });
        enqueue({ processId: 'p', prompt: 'x', delayMs: 1000, wakeupId: 'w2' });

        expect(statusAtArm).toBe('pending');
    });
});
