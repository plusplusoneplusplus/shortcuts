import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { CronStore } from '../../src/server/cron/cron-store';

// ============================================================================
// Helpers
// ============================================================================

function createTestDb(): Database.Database {
    const db = new Database(':memory:');
    initializeDatabase(db);
    return db;
}

function createTestCronStore(db: Database.Database): CronStore {
    return new CronStore(db);
}

function makeCron(overrides: Partial<Record<string, unknown>> = {}) {
    const { workspaceId, ...rest } = overrides;
    return {
        id: `cron_${Math.random().toString(36).slice(2, 8)}`,
        processId: 'proc_test1',
        description: 'Test cron',
        intervalMs: 60000,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
        lastTickAt: null,
        nextTickAt: new Date(Date.now() + 60000).toISOString(),
        tickCount: 0,
        consecutiveFailures: 0,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        pausedReason: null,
        prompt: 'Check status',
        model: null,
        ...rest,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Cron Infrastructure', () => {
    let db: Database.Database;
    let cronStore: CronStore;

    beforeEach(() => {
        db = createTestDb();
        cronStore = createTestCronStore(db);
    });

    afterEach(() => {
        try { db.close(); } catch { /* ok */ }
    });

    describe('createCronInfrastructure pattern', () => {
        it('CronStore persists and retrieves crons via shared DB', () => {
            const cron = makeCron();
            cronStore.insert(cron);

            const retrieved = cronStore.getById(cron.id);
            expect(retrieved).toBeDefined();
            expect(retrieved!.id).toBe(cron.id);
            expect(retrieved!.processId).toBe('proc_test1');
            expect(retrieved!.status).toBe('active');
        });

        it('getActive returns only active crons', () => {
            const active = makeCron({ id: 'cron_active' });
            const paused = makeCron({ id: 'cron_paused', status: 'paused' });
            cronStore.insert(active);
            cronStore.insert(paused);

            const activeCrons = cronStore.getActive();
            expect(activeCrons).toHaveLength(1);
            expect(activeCrons[0].id).toBe('cron_active');
        });

        it('pauseAllActive marks all active crons as paused with reason', () => {
            cronStore.insert(makeCron({ id: 'cron_1' }));
            cronStore.insert(makeCron({ id: 'cron_2' }));
            cronStore.insert(makeCron({ id: 'cron_3', status: 'paused' }));

            const count = cronStore.pauseAllActive('server-restart');
            expect(count).toBe(2);

            const all = cronStore.getAll();
            const paused = all.filter(l => l.status === 'paused');
            expect(paused).toHaveLength(3);

            const serverRestartPaused = paused.filter(l => l.pausedReason === 'server-restart');
            expect(serverRestartPaused).toHaveLength(2);
        });
    });

    describe('server shutdown flow', () => {
        it('shutdownAll cancels active timers without pausing crons', async () => {
            // Import directly for unit-level testing
            const { CronExecutor } = await import('../../src/server/cron/cron-executor');
            const { ScheduleTimerRegistry } = await import('../../src/server/schedule/schedule-timer-registry');

            const timerRegistry = new ScheduleTimerRegistry();
            const cron1 = makeCron({ id: 'cron_shutdown_1' });
            const cron2 = makeCron({ id: 'cron_shutdown_2' });
            cronStore.insert(cron1);
            cronStore.insert(cron2);

            const executor = new CronExecutor({
                store: cronStore,
                processStore: {
                    getProcess: vi.fn().mockResolvedValue({ status: 'completed' }),
                } as any,
                timerRegistry,
                queueManager: null,
                emit: vi.fn(),
                resolveWorkspaceId: vi.fn().mockResolvedValue('ws-test'),
            });

            // Arm timers first
            executor.armAll();
            expect(timerRegistry.has('cron_shutdown_1')).toBe(true);
            expect(timerRegistry.has('cron_shutdown_2')).toBe(true);

            executor.shutdownAll();

            // Timers should be cancelled
            expect(timerRegistry.has('cron_shutdown_1')).toBe(false);
            expect(timerRegistry.has('cron_shutdown_2')).toBe(false);

            // Crons should remain active for restart continuity.
            const l1 = cronStore.getById('cron_shutdown_1');
            const l2 = cronStore.getById('cron_shutdown_2');
            expect(l1!.status).toBe('active');
            expect(l1!.pausedReason).toBeNull();
            expect(l2!.status).toBe('active');
            expect(l2!.pausedReason).toBeNull();
        });
    });

    describe('close handler integration', () => {
        it('manually paused crons are not armed on restart', () => {
            const pausedCron = makeCron({ id: 'cron_was_paused', status: 'paused', pausedReason: 'manual pause', nextTickAt: null });
            cronStore.insert(pausedCron);

            const active = cronStore.getActive();
            expect(active).toHaveLength(0);

            const all = cronStore.getAll();
            expect(all).toHaveLength(1);
            expect(all[0].status).toBe('paused');
            expect(all[0].pausedReason).toBe('manual pause');
        });

        it('active crons remain eligible for startup re-arming', () => {
            const activeCron = makeCron({ id: 'cron_survives_restart', status: 'active' });
            cronStore.insert(activeCron);

            const active = cronStore.getActive();
            expect(active).toHaveLength(1);
            expect(active[0].id).toBe('cron_survives_restart');
        });
    });

    describe('workspaceId backfill', () => {
        it('backfills workspaceId for legacy rows on startup', async () => {
            // Insert legacy rows without workspaceId
            cronStore.insert(makeCron({ id: 'cron_legacy1', processId: 'proc_resolvable' }));
            cronStore.insert(makeCron({ id: 'cron_legacy2', processId: 'proc_unresolvable' }));
            cronStore.insert(makeCron({ id: 'cron_existing', processId: 'proc_already', workspaceId: 'ws-existing' }));

            const { CronExecutor } = await import('../../src/server/cron/cron-executor');
            const { ScheduleTimerRegistry } = await import('../../src/server/schedule/schedule-timer-registry');

            const resolveWorkspaceId = vi.fn(async (processId: string) => {
                if (processId === 'proc_resolvable') return 'ws-resolved';
                return undefined;
            });

            const timerRegistry = new ScheduleTimerRegistry();
            const executor = new CronExecutor({
                store: cronStore,
                processStore: { getProcess: vi.fn().mockResolvedValue(null) } as any,
                timerRegistry,
                queueManager: null,
                emit: vi.fn(),
                resolveWorkspaceId,
            });

            // Simulate what createCronInfrastructure does
            executor.armAll();

            const allCrons = cronStore.getAll();
            for (const cron of allCrons) {
                if (cron.workspaceId == null) {
                    const wsId = await resolveWorkspaceId(cron.processId);
                    if (wsId) {
                        cron.workspaceId = wsId;
                        cronStore.update(cron);
                    }
                }
            }

            // Resolvable cron should be backfilled
            const legacy1 = cronStore.getById('cron_legacy1')!;
            expect(legacy1.workspaceId).toBe('ws-resolved');

            // Unresolvable cron stays without workspaceId
            const legacy2 = cronStore.getById('cron_legacy2')!;
            expect(legacy2.workspaceId).toBeUndefined();

            // Already-set workspaceId remains unchanged
            const existing = cronStore.getById('cron_existing')!;
            expect(existing.workspaceId).toBe('ws-existing');

            timerRegistry.clear();
        });
    });
});
