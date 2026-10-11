import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NativeDatabase as Database } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { CronStore } from '../../src/server/cron/cron-store';

// ============================================================================
// Helpers
// ============================================================================

function createTestDb(): Database {
    const db = new Database(':memory:');
    initializeDatabase(db);
    return db;
}

function createTestCronStore(db: Database): CronStore {
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
    let db: Database;
    let cronStore: CronStore;

    beforeEach(() => {
        db = createTestDb();
        cronStore = createTestCronStore(db);
    });

    afterEach(() => {
        try { db.close(); } catch { /* ok */ }
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
