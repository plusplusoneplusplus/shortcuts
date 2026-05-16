/**
 * Tests for loop infrastructure builder.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { LoopStore } from '../../src/server/loops/loop-store';

// ============================================================================
// Helpers
// ============================================================================

function createTestDb(): Database.Database {
    const db = new Database(':memory:');
    initializeDatabase(db);
    return db;
}

function createTestLoopStore(db: Database.Database): LoopStore {
    return new LoopStore(db);
}

function makeLoop(overrides: Partial<Record<string, unknown>> = {}) {
    const { workspaceId, ...rest } = overrides;
    return {
        id: `loop_${Math.random().toString(36).slice(2, 8)}`,
        processId: 'proc_test1',
        description: 'Test loop',
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

describe('Loop Infrastructure', () => {
    let db: Database.Database;
    let loopStore: LoopStore;

    beforeEach(() => {
        db = createTestDb();
        loopStore = createTestLoopStore(db);
    });

    afterEach(() => {
        try { db.close(); } catch { /* ok */ }
    });

    describe('createLoopInfrastructure pattern', () => {
        it('LoopStore persists and retrieves loops via shared DB', () => {
            const loop = makeLoop();
            loopStore.insert(loop);

            const retrieved = loopStore.getById(loop.id);
            expect(retrieved).toBeDefined();
            expect(retrieved!.id).toBe(loop.id);
            expect(retrieved!.processId).toBe('proc_test1');
            expect(retrieved!.status).toBe('active');
        });

        it('getActive returns only active loops', () => {
            const active = makeLoop({ id: 'loop_active' });
            const paused = makeLoop({ id: 'loop_paused', status: 'paused' });
            loopStore.insert(active);
            loopStore.insert(paused);

            const activeLoops = loopStore.getActive();
            expect(activeLoops).toHaveLength(1);
            expect(activeLoops[0].id).toBe('loop_active');
        });

        it('pauseAllActive marks all active loops as paused with reason', () => {
            loopStore.insert(makeLoop({ id: 'loop_1' }));
            loopStore.insert(makeLoop({ id: 'loop_2' }));
            loopStore.insert(makeLoop({ id: 'loop_3', status: 'paused' }));

            const count = loopStore.pauseAllActive('server-restart');
            expect(count).toBe(2);

            const all = loopStore.getAll();
            const paused = all.filter(l => l.status === 'paused');
            expect(paused).toHaveLength(3);

            const serverRestartPaused = paused.filter(l => l.pausedReason === 'server-restart');
            expect(serverRestartPaused).toHaveLength(2);
        });
    });

    describe('server shutdown flow', () => {
        it('shutdownAll cancels active timers without pausing loops', async () => {
            // Import directly for unit-level testing
            const { LoopExecutor } = await import('../../src/server/loops/loop-executor');
            const { ScheduleTimerRegistry } = await import('../../src/server/schedule/schedule-timer-registry');

            const timerRegistry = new ScheduleTimerRegistry();
            const loop1 = makeLoop({ id: 'loop_shutdown_1' });
            const loop2 = makeLoop({ id: 'loop_shutdown_2' });
            loopStore.insert(loop1);
            loopStore.insert(loop2);

            const executor = new LoopExecutor({
                store: loopStore,
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
            expect(timerRegistry.has('loop_shutdown_1')).toBe(true);
            expect(timerRegistry.has('loop_shutdown_2')).toBe(true);

            // Shutdown
            executor.shutdownAll();

            // Timers should be cancelled
            expect(timerRegistry.has('loop_shutdown_1')).toBe(false);
            expect(timerRegistry.has('loop_shutdown_2')).toBe(false);

            // Loops should remain active for restart continuity.
            const l1 = loopStore.getById('loop_shutdown_1');
            const l2 = loopStore.getById('loop_shutdown_2');
            expect(l1!.status).toBe('active');
            expect(l1!.pausedReason).toBeNull();
            expect(l2!.status).toBe('active');
            expect(l2!.pausedReason).toBeNull();
        });
    });

    describe('close handler integration', () => {
        it('manually paused loops are not armed on restart', () => {
            const pausedLoop = makeLoop({ id: 'loop_was_paused', status: 'paused', pausedReason: 'manual pause', nextTickAt: null });
            loopStore.insert(pausedLoop);

            const active = loopStore.getActive();
            expect(active).toHaveLength(0);

            const all = loopStore.getAll();
            expect(all).toHaveLength(1);
            expect(all[0].status).toBe('paused');
            expect(all[0].pausedReason).toBe('manual pause');
        });

        it('active loops remain eligible for startup re-arming', () => {
            const activeLoop = makeLoop({ id: 'loop_survives_restart', status: 'active' });
            loopStore.insert(activeLoop);

            const active = loopStore.getActive();
            expect(active).toHaveLength(1);
            expect(active[0].id).toBe('loop_survives_restart');
        });
    });

    describe('workspaceId backfill', () => {
        it('backfills workspaceId for legacy rows on startup', async () => {
            // Insert legacy rows without workspaceId
            loopStore.insert(makeLoop({ id: 'loop_legacy1', processId: 'proc_resolvable' }));
            loopStore.insert(makeLoop({ id: 'loop_legacy2', processId: 'proc_unresolvable' }));
            loopStore.insert(makeLoop({ id: 'loop_existing', processId: 'proc_already', workspaceId: 'ws-existing' }));

            const { LoopExecutor } = await import('../../src/server/loops/loop-executor');
            const { ScheduleTimerRegistry } = await import('../../src/server/schedule/schedule-timer-registry');

            const resolveWorkspaceId = vi.fn(async (processId: string) => {
                if (processId === 'proc_resolvable') return 'ws-resolved';
                return undefined;
            });

            const timerRegistry = new ScheduleTimerRegistry();
            const executor = new LoopExecutor({
                store: loopStore,
                processStore: { getProcess: vi.fn().mockResolvedValue(null) } as any,
                timerRegistry,
                queueManager: null,
                emit: vi.fn(),
                resolveWorkspaceId,
            });

            // Simulate what createLoopInfrastructure does
            executor.armAll();

            const allLoops = loopStore.getAll();
            for (const loop of allLoops) {
                if (loop.workspaceId == null) {
                    const wsId = await resolveWorkspaceId(loop.processId);
                    if (wsId) {
                        loop.workspaceId = wsId;
                        loopStore.update(loop);
                    }
                }
            }

            // Resolvable loop should be backfilled
            const legacy1 = loopStore.getById('loop_legacy1')!;
            expect(legacy1.workspaceId).toBe('ws-resolved');

            // Unresolvable loop stays without workspaceId
            const legacy2 = loopStore.getById('loop_legacy2')!;
            expect(legacy2.workspaceId).toBeUndefined();

            // Already-set workspaceId remains unchanged
            const existing = loopStore.getById('loop_existing')!;
            expect(existing.workspaceId).toBe('ws-existing');

            timerRegistry.clear();
        });
    });
});
