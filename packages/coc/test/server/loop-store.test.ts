/**
 * Loop Store Tests
 *
 * Unit tests for `LoopStore` — SQLite CRUD operations for loop entries.
 * Uses in-memory SQLite databases (no file I/O, cross-platform safe).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { LoopStore } from '../../src/server/loops/loop-store';
import type { LoopEntry } from '../../src/server/loops/loop-types';
import { MAX_ACTIVE_LOOPS } from '../../src/server/loops/loop-types';

// ============================================================================
// Helpers
// ============================================================================

function createDb(): Database.Database {
    return new Database(':memory:');
}

function makeLoop(overrides: Partial<LoopEntry> = {}): LoopEntry {
    return {
        id: overrides.id ?? 'loop_test1',
        processId: overrides.processId ?? 'proc_abc',
        description: overrides.description ?? 'Test loop',
        intervalMs: overrides.intervalMs ?? 60_000,
        status: overrides.status ?? 'active',
        createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
        lastTickAt: 'lastTickAt' in overrides ? overrides.lastTickAt! : null,
        nextTickAt: 'nextTickAt' in overrides ? overrides.nextTickAt! : '2026-01-01T00:01:00.000Z',
        tickCount: overrides.tickCount ?? 0,
        consecutiveFailures: overrides.consecutiveFailures ?? 0,
        expiresAt: overrides.expiresAt ?? '2026-01-04T00:00:00.000Z',
        pausedReason: 'pausedReason' in overrides ? overrides.pausedReason! : null,
        prompt: overrides.prompt ?? 'check status',
        model: 'model' in overrides ? overrides.model! : null,
        ...('workspaceId' in overrides ? { workspaceId: overrides.workspaceId } : {}),
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('LoopStore', () => {
    let db: Database.Database;
    let store: LoopStore;

    beforeEach(() => {
        db = createDb();
        store = new LoopStore(db);
    });

    // --------------------------------------------------------------------
    // Insert + getById
    // --------------------------------------------------------------------

    it('inserts and retrieves a loop', () => {
        const loop = makeLoop();
        store.insert(loop);
        const retrieved = store.getById('loop_test1');
        expect(retrieved).toEqual(loop);
    });

    it('returns null for unknown id', () => {
        expect(store.getById('nonexistent')).toBeNull();
    });

    // --------------------------------------------------------------------
    // Update
    // --------------------------------------------------------------------

    it('updates an existing loop', () => {
        const loop = makeLoop();
        store.insert(loop);

        const updated = { ...loop, tickCount: 5, lastTickAt: '2026-01-01T00:05:00.000Z' };
        store.update(updated);

        const retrieved = store.getById('loop_test1');
        expect(retrieved?.tickCount).toBe(5);
        expect(retrieved?.lastTickAt).toBe('2026-01-01T00:05:00.000Z');
    });

    // --------------------------------------------------------------------
    // getByProcess
    // --------------------------------------------------------------------

    it('returns loops for a specific process', () => {
        store.insert(makeLoop({ id: 'loop_a', processId: 'proc_1' }));
        store.insert(makeLoop({ id: 'loop_b', processId: 'proc_1' }));
        store.insert(makeLoop({ id: 'loop_c', processId: 'proc_2' }));

        const loops = store.getByProcess('proc_1');
        expect(loops).toHaveLength(2);
        expect(loops.map(l => l.id).sort()).toEqual(['loop_a', 'loop_b']);
    });

    it('returns empty array for process with no loops', () => {
        expect(store.getByProcess('unknown')).toEqual([]);
    });

    // --------------------------------------------------------------------
    // getActive
    // --------------------------------------------------------------------

    it('returns only active loops', () => {
        store.insert(makeLoop({ id: 'loop_active', status: 'active' }));
        store.insert(makeLoop({ id: 'loop_paused', status: 'paused' }));
        store.insert(makeLoop({ id: 'loop_cancelled', status: 'cancelled' }));

        const active = store.getActive();
        expect(active).toHaveLength(1);
        expect(active[0].id).toBe('loop_active');
    });

    // --------------------------------------------------------------------
    // getAll
    // --------------------------------------------------------------------

    it('returns all loops regardless of status', () => {
        store.insert(makeLoop({ id: 'loop_1', status: 'active' }));
        store.insert(makeLoop({ id: 'loop_2', status: 'paused' }));
        store.insert(makeLoop({ id: 'loop_3', status: 'cancelled' }));
        store.insert(makeLoop({ id: 'loop_4', status: 'expired' }));

        expect(store.getAll()).toHaveLength(4);
    });

    // --------------------------------------------------------------------
    // Delete
    // --------------------------------------------------------------------

    it('deletes a loop by id', () => {
        store.insert(makeLoop());
        expect(store.delete('loop_test1')).toBe(true);
        expect(store.getById('loop_test1')).toBeNull();
    });

    it('returns false when deleting nonexistent loop', () => {
        expect(store.delete('nonexistent')).toBe(false);
    });

    it('deleteAll clears all loops', () => {
        store.insert(makeLoop({ id: 'loop_1' }));
        store.insert(makeLoop({ id: 'loop_2' }));
        store.deleteAll();
        expect(store.getAll()).toHaveLength(0);
    });

    // --------------------------------------------------------------------
    // countActive
    // --------------------------------------------------------------------

    it('counts only active loops', () => {
        store.insert(makeLoop({ id: 'loop_1', status: 'active' }));
        store.insert(makeLoop({ id: 'loop_2', status: 'active' }));
        store.insert(makeLoop({ id: 'loop_3', status: 'paused' }));

        expect(store.countActive()).toBe(2);
    });

    // --------------------------------------------------------------------
    // Active loop limit enforcement
    // --------------------------------------------------------------------

    it('throws when inserting an active loop beyond the server limit', () => {
        // Insert MAX_ACTIVE_LOOPS active loops
        for (let i = 0; i < MAX_ACTIVE_LOOPS; i++) {
            store.insert(makeLoop({ id: `loop_${i}`, status: 'active' }));
        }

        expect(() => {
            store.insert(makeLoop({ id: 'loop_over_limit', status: 'active' }));
        }).toThrow(/active loop limit/i);
    });

    it('allows inserting a paused loop even when active limit is reached', () => {
        for (let i = 0; i < MAX_ACTIVE_LOOPS; i++) {
            store.insert(makeLoop({ id: `loop_${i}`, status: 'active' }));
        }

        // Paused loops should not count toward the active limit
        expect(() => {
            store.insert(makeLoop({ id: 'loop_paused', status: 'paused' }));
        }).not.toThrow();
    });

    // --------------------------------------------------------------------
    // pauseAllActive
    // --------------------------------------------------------------------

    it('pauses all active loops with the given reason', () => {
        store.insert(makeLoop({ id: 'loop_1', status: 'active' }));
        store.insert(makeLoop({ id: 'loop_2', status: 'active' }));
        store.insert(makeLoop({ id: 'loop_3', status: 'paused', pausedReason: 'user' }));

        const count = store.pauseAllActive('server-restart');
        expect(count).toBe(2);

        const all = store.getAll();
        const loop1 = all.find(l => l.id === 'loop_1')!;
        const loop2 = all.find(l => l.id === 'loop_2')!;
        const loop3 = all.find(l => l.id === 'loop_3')!;

        expect(loop1.status).toBe('paused');
        expect(loop1.pausedReason).toBe('server-restart');
        expect(loop1.nextTickAt).toBeNull();

        expect(loop2.status).toBe('paused');
        expect(loop2.pausedReason).toBe('server-restart');

        // Already paused loop should keep its original reason
        expect(loop3.status).toBe('paused');
        expect(loop3.pausedReason).toBe('user');
    });

    // --------------------------------------------------------------------
    // Null handling
    // --------------------------------------------------------------------

    it('handles null optional fields correctly', () => {
        const loop = makeLoop({
            lastTickAt: null,
            nextTickAt: null,
            pausedReason: null,
            model: null,
            status: 'paused',
        });
        store.insert(loop);

        const retrieved = store.getById(loop.id)!;
        expect(retrieved.lastTickAt).toBeNull();
        expect(retrieved.nextTickAt).toBeNull();
        expect(retrieved.pausedReason).toBeNull();
        expect(retrieved.model).toBeNull();
    });

    it('persists non-null optional fields', () => {
        const loop = makeLoop({
            lastTickAt: '2026-01-01T01:00:00.000Z',
            model: 'gpt-4',
            pausedReason: 'testing',
        });
        store.insert(loop);

        const retrieved = store.getById(loop.id)!;
        expect(retrieved.lastTickAt).toBe('2026-01-01T01:00:00.000Z');
        expect(retrieved.model).toBe('gpt-4');
        expect(retrieved.pausedReason).toBe('testing');
    });

    // --------------------------------------------------------------------
    // Idempotent table creation
    // --------------------------------------------------------------------

    it('creating multiple LoopStore instances on same db is safe', () => {
        const store1 = new LoopStore(db);
        const store2 = new LoopStore(db);

        store1.insert(makeLoop({ id: 'loop_from_1' }));
        expect(store2.getById('loop_from_1')).not.toBeNull();
    });

    // --------------------------------------------------------------------
    // workspaceId persistence
    // --------------------------------------------------------------------

    it('persists and retrieves workspaceId', () => {
        const loop = makeLoop({ workspaceId: 'ws-abc' });
        store.insert(loop);

        const retrieved = store.getById(loop.id)!;
        expect(retrieved.workspaceId).toBe('ws-abc');
    });

    it('handles loops without workspaceId (legacy rows)', () => {
        const loop = makeLoop();
        // No workspaceId set — simulates legacy row
        store.insert(loop);

        const retrieved = store.getById(loop.id)!;
        expect(retrieved.workspaceId).toBeUndefined();
    });

    it('updates workspaceId on existing loop', () => {
        const loop = makeLoop();
        store.insert(loop);

        const updated = { ...loop, workspaceId: 'ws-new' };
        store.update(updated);

        const retrieved = store.getById(loop.id)!;
        expect(retrieved.workspaceId).toBe('ws-new');
    });

    // --------------------------------------------------------------------
    // getByWorkspace
    // --------------------------------------------------------------------

    it('returns loops for a specific workspace', () => {
        store.insert(makeLoop({ id: 'loop_a', processId: 'proc_1', workspaceId: 'ws1' }));
        store.insert(makeLoop({ id: 'loop_b', processId: 'proc_2', workspaceId: 'ws1' }));
        store.insert(makeLoop({ id: 'loop_c', processId: 'proc_3', workspaceId: 'ws2' }));
        store.insert(makeLoop({ id: 'loop_d', processId: 'proc_4' })); // no workspaceId

        const ws1Loops = store.getByWorkspace('ws1');
        expect(ws1Loops).toHaveLength(2);
        expect(ws1Loops.map(l => l.id).sort()).toEqual(['loop_a', 'loop_b']);

        const ws2Loops = store.getByWorkspace('ws2');
        expect(ws2Loops).toHaveLength(1);
        expect(ws2Loops[0].id).toBe('loop_c');
    });

    it('returns empty array for workspace with no loops', () => {
        store.insert(makeLoop({ id: 'loop_a', workspaceId: 'ws1' }));
        expect(store.getByWorkspace('ws-other')).toEqual([]);
    });

    // --------------------------------------------------------------------
    // Schema migration (ALTER TABLE idempotency)
    // --------------------------------------------------------------------

    it('migrates existing table without workspace_id column', () => {
        // Create a fresh DB with the old schema (no workspace_id)
        const oldDb = new Database(':memory:');
        oldDb.exec(`
            CREATE TABLE loops (
                id TEXT PRIMARY KEY,
                process_id TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                interval_ms INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                created_at TEXT NOT NULL,
                last_tick_at TEXT,
                next_tick_at TEXT,
                tick_count INTEGER NOT NULL DEFAULT 0,
                consecutive_failures INTEGER NOT NULL DEFAULT 0,
                expires_at TEXT NOT NULL,
                paused_reason TEXT,
                prompt TEXT NOT NULL DEFAULT '',
                model TEXT
            )
        `);

        // Insert a row using old schema
        oldDb.prepare(`
            INSERT INTO loops (id, process_id, description, interval_ms, status, created_at, tick_count, consecutive_failures, expires_at, prompt)
            VALUES ('loop_legacy', 'proc_old', 'Old loop', 60000, 'active', '2026-01-01T00:00:00Z', 0, 0, '2026-01-04T00:00:00Z', 'check')
        `).run();

        // Creating a new LoopStore should migrate the table
        const migratedStore = new LoopStore(oldDb);

        // Legacy row should be readable with undefined workspaceId
        const legacy = migratedStore.getById('loop_legacy')!;
        expect(legacy.processId).toBe('proc_old');
        expect(legacy.workspaceId).toBeUndefined();

        // New rows can include workspaceId
        const newLoop = makeLoop({ id: 'loop_new', workspaceId: 'ws-migrated' });
        migratedStore.insert(newLoop);
        expect(migratedStore.getById('loop_new')!.workspaceId).toBe('ws-migrated');

        oldDb.close();
    });

    it('migration is idempotent — second LoopStore on migrated DB is safe', () => {
        // First store migrates
        const db2 = new Database(':memory:');
        const store1 = new LoopStore(db2);
        store1.insert(makeLoop({ id: 'loop_idem', workspaceId: 'ws-x' }));

        // Second store should not fail
        const store2 = new LoopStore(db2);
        expect(store2.getById('loop_idem')!.workspaceId).toBe('ws-x');

        db2.close();
    });
});
