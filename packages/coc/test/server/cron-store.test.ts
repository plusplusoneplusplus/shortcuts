/**
 * Cron Store Tests
 *
 * Unit tests for `CronStore` — SQLite CRUD operations for cron entries.
 * Uses in-memory SQLite databases (no file I/O, cross-platform safe).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { CronStore } from '../../src/server/cron/cron-store';
import type { CronEntry } from '../../src/server/cron/cron-types';
import { MAX_ACTIVE_CRONS } from '../../src/server/cron/cron-types';

// ============================================================================
// Helpers
// ============================================================================

function createDb(): Database.Database {
    return new Database(':memory:');
}

function makeCron(overrides: Partial<CronEntry> = {}): CronEntry {
    return {
        id: overrides.id ?? 'cron_test1',
        processId: overrides.processId ?? 'proc_abc',
        description: overrides.description ?? 'Test cron',
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

describe('CronStore', () => {
    let db: Database.Database;
    let store: CronStore;

    beforeEach(() => {
        db = createDb();
        store = new CronStore(db);
    });

    // --------------------------------------------------------------------
    // Insert + getById
    // --------------------------------------------------------------------

    it('inserts and retrieves a cron', () => {
        const cron = makeCron();
        store.insert(cron);
        const retrieved = store.getById('cron_test1');
        expect(retrieved).toEqual(cron);
    });

    it('returns null for unknown id', () => {
        expect(store.getById('nonexistent')).toBeNull();
    });

    // --------------------------------------------------------------------
    // Update
    // --------------------------------------------------------------------

    it('updates an existing cron', () => {
        const cron = makeCron();
        store.insert(cron);

        const updated = { ...cron, tickCount: 5, lastTickAt: '2026-01-01T00:05:00.000Z' };
        store.update(updated);

        const retrieved = store.getById('cron_test1');
        expect(retrieved?.tickCount).toBe(5);
        expect(retrieved?.lastTickAt).toBe('2026-01-01T00:05:00.000Z');
    });

    // --------------------------------------------------------------------
    // getByProcess
    // --------------------------------------------------------------------

    it('returns crons for a specific process', () => {
        store.insert(makeCron({ id: 'cron_a', processId: 'proc_1' }));
        store.insert(makeCron({ id: 'cron_b', processId: 'proc_1' }));
        store.insert(makeCron({ id: 'cron_c', processId: 'proc_2' }));

        const crons = store.getByProcess('proc_1');
        expect(crons).toHaveLength(2);
        expect(crons.map(l => l.id).sort()).toEqual(['cron_a', 'cron_b']);
    });

    it('returns empty array for process with no crons', () => {
        expect(store.getByProcess('unknown')).toEqual([]);
    });

    // --------------------------------------------------------------------
    // getActive
    // --------------------------------------------------------------------

    it('returns only active crons', () => {
        store.insert(makeCron({ id: 'cron_active', status: 'active' }));
        store.insert(makeCron({ id: 'cron_paused', status: 'paused' }));
        store.insert(makeCron({ id: 'cron_cancelled', status: 'cancelled' }));

        const active = store.getActive();
        expect(active).toHaveLength(1);
        expect(active[0].id).toBe('cron_active');
    });

    // --------------------------------------------------------------------
    // getAll
    // --------------------------------------------------------------------

    it('returns all crons regardless of status', () => {
        store.insert(makeCron({ id: 'cron_1', status: 'active' }));
        store.insert(makeCron({ id: 'cron_2', status: 'paused' }));
        store.insert(makeCron({ id: 'cron_3', status: 'cancelled' }));
        store.insert(makeCron({ id: 'cron_4', status: 'expired' }));

        expect(store.getAll()).toHaveLength(4);
    });

    // --------------------------------------------------------------------
    // Delete
    // --------------------------------------------------------------------

    it('deletes a cron by id', () => {
        store.insert(makeCron());
        expect(store.delete('cron_test1')).toBe(true);
        expect(store.getById('cron_test1')).toBeNull();
    });

    it('returns false when deleting nonexistent cron', () => {
        expect(store.delete('nonexistent')).toBe(false);
    });

    it('deleteAll clears all crons', () => {
        store.insert(makeCron({ id: 'cron_1' }));
        store.insert(makeCron({ id: 'cron_2' }));
        store.deleteAll();
        expect(store.getAll()).toHaveLength(0);
    });

    // --------------------------------------------------------------------
    // countActive
    // --------------------------------------------------------------------

    it('counts only active crons', () => {
        store.insert(makeCron({ id: 'cron_1', status: 'active' }));
        store.insert(makeCron({ id: 'cron_2', status: 'active' }));
        store.insert(makeCron({ id: 'cron_3', status: 'paused' }));

        expect(store.countActive()).toBe(2);
    });

    // --------------------------------------------------------------------
    // Active cron limit enforcement
    // --------------------------------------------------------------------

    it('throws when inserting an active cron beyond the server limit', () => {
        // Insert MAX_ACTIVE_CRONS active crons
        for (let i = 0; i < MAX_ACTIVE_CRONS; i++) {
            store.insert(makeCron({ id: `cron_${i}`, status: 'active' }));
        }

        expect(() => {
            store.insert(makeCron({ id: 'cron_over_limit', status: 'active' }));
        }).toThrow(/active cron limit/i);
    });

    it('allows inserting a paused cron even when active limit is reached', () => {
        for (let i = 0; i < MAX_ACTIVE_CRONS; i++) {
            store.insert(makeCron({ id: `cron_${i}`, status: 'active' }));
        }

        // Paused crons should not count toward the active limit
        expect(() => {
            store.insert(makeCron({ id: 'cron_paused', status: 'paused' }));
        }).not.toThrow();
    });

    // --------------------------------------------------------------------
    // pauseAllActive
    // --------------------------------------------------------------------

    it('pauses all active crons with the given reason', () => {
        store.insert(makeCron({ id: 'cron_1', status: 'active' }));
        store.insert(makeCron({ id: 'cron_2', status: 'active' }));
        store.insert(makeCron({ id: 'cron_3', status: 'paused', pausedReason: 'user' }));

        const count = store.pauseAllActive('server-restart');
        expect(count).toBe(2);

        const all = store.getAll();
        const cron1 = all.find(l => l.id === 'cron_1')!;
        const cron2 = all.find(l => l.id === 'cron_2')!;
        const cron3 = all.find(l => l.id === 'cron_3')!;

        expect(cron1.status).toBe('paused');
        expect(cron1.pausedReason).toBe('server-restart');
        expect(cron1.nextTickAt).toBeNull();

        expect(cron2.status).toBe('paused');
        expect(cron2.pausedReason).toBe('server-restart');

        // Already paused cron should keep its original reason
        expect(cron3.status).toBe('paused');
        expect(cron3.pausedReason).toBe('user');
    });

    // --------------------------------------------------------------------
    // Null handling
    // --------------------------------------------------------------------

    it('handles null optional fields correctly', () => {
        const cron = makeCron({
            lastTickAt: null,
            nextTickAt: null,
            pausedReason: null,
            model: null,
            status: 'paused',
        });
        store.insert(cron);

        const retrieved = store.getById(cron.id)!;
        expect(retrieved.lastTickAt).toBeNull();
        expect(retrieved.nextTickAt).toBeNull();
        expect(retrieved.pausedReason).toBeNull();
        expect(retrieved.model).toBeNull();
    });

    it('persists non-null optional fields', () => {
        const cron = makeCron({
            lastTickAt: '2026-01-01T01:00:00.000Z',
            model: 'gpt-4',
            pausedReason: 'testing',
        });
        store.insert(cron);

        const retrieved = store.getById(cron.id)!;
        expect(retrieved.lastTickAt).toBe('2026-01-01T01:00:00.000Z');
        expect(retrieved.model).toBe('gpt-4');
        expect(retrieved.pausedReason).toBe('testing');
    });

    // --------------------------------------------------------------------
    // Idempotent table creation
    // --------------------------------------------------------------------

    it('creating multiple CronStore instances on same db is safe', () => {
        const store1 = new CronStore(db);
        const store2 = new CronStore(db);

        store1.insert(makeCron({ id: 'cron_from_1' }));
        expect(store2.getById('cron_from_1')).not.toBeNull();
    });

    // --------------------------------------------------------------------
    // workspaceId persistence
    // --------------------------------------------------------------------

    it('persists and retrieves workspaceId', () => {
        const cron = makeCron({ workspaceId: 'ws-abc' });
        store.insert(cron);

        const retrieved = store.getById(cron.id)!;
        expect(retrieved.workspaceId).toBe('ws-abc');
    });

    it('handles crons without workspaceId (legacy rows)', () => {
        const cron = makeCron();
        // No workspaceId set — simulates legacy row
        store.insert(cron);

        const retrieved = store.getById(cron.id)!;
        expect(retrieved.workspaceId).toBeUndefined();
    });

    it('updates workspaceId on existing cron', () => {
        const cron = makeCron();
        store.insert(cron);

        const updated = { ...cron, workspaceId: 'ws-new' };
        store.update(updated);

        const retrieved = store.getById(cron.id)!;
        expect(retrieved.workspaceId).toBe('ws-new');
    });

    // --------------------------------------------------------------------
    // getByWorkspace
    // --------------------------------------------------------------------

    it('returns crons for a specific workspace', () => {
        store.insert(makeCron({ id: 'cron_a', processId: 'proc_1', workspaceId: 'ws1' }));
        store.insert(makeCron({ id: 'cron_b', processId: 'proc_2', workspaceId: 'ws1' }));
        store.insert(makeCron({ id: 'cron_c', processId: 'proc_3', workspaceId: 'ws2' }));
        store.insert(makeCron({ id: 'cron_d', processId: 'proc_4' })); // no workspaceId

        const ws1Crons = store.getByWorkspace('ws1');
        expect(ws1Crons).toHaveLength(2);
        expect(ws1Crons.map(l => l.id).sort()).toEqual(['cron_a', 'cron_b']);

        const ws2Crons = store.getByWorkspace('ws2');
        expect(ws2Crons).toHaveLength(1);
        expect(ws2Crons[0].id).toBe('cron_c');
    });

    it('returns empty array for workspace with no crons', () => {
        store.insert(makeCron({ id: 'cron_a', workspaceId: 'ws1' }));
        expect(store.getByWorkspace('ws-other')).toEqual([]);
    });

    // --------------------------------------------------------------------
    // Schema migration (ALTER TABLE idempotency)
    // --------------------------------------------------------------------

    it('migrates existing table without workspace_id column', () => {
        // Create a fresh DB with the old schema (no workspace_id)
        const oldDb = new Database(':memory:');
        oldDb.exec(`
            CREATE TABLE crons (
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
            INSERT INTO crons (id, process_id, description, interval_ms, status, created_at, tick_count, consecutive_failures, expires_at, prompt)
            VALUES ('cron_legacy', 'proc_old', 'Old cron', 60000, 'active', '2026-01-01T00:00:00Z', 0, 0, '2026-01-04T00:00:00Z', 'check')
        `).run();

        // Creating a new CronStore should migrate the table
        const migratedStore = new CronStore(oldDb);

        // Legacy row should be readable with undefined workspaceId
        const legacy = migratedStore.getById('cron_legacy')!;
        expect(legacy.processId).toBe('proc_old');
        expect(legacy.workspaceId).toBeUndefined();

        // New rows can include workspaceId
        const newCron = makeCron({ id: 'cron_new', workspaceId: 'ws-migrated' });
        migratedStore.insert(newCron);
        expect(migratedStore.getById('cron_new')!.workspaceId).toBe('ws-migrated');

        oldDb.close();
    });

    it('migration is idempotent — second CronStore on migrated DB is safe', () => {
        // First store migrates
        const db2 = new Database(':memory:');
        const store1 = new CronStore(db2);
        store1.insert(makeCron({ id: 'cron_idem', workspaceId: 'ws-x' }));

        // Second store should not fail
        const store2 = new CronStore(db2);
        expect(store2.getById('cron_idem')!.workspaceId).toBe('ws-x');

        db2.close();
    });
});
