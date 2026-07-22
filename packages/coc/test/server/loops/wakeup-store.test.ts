/**
 * Wakeup Store Tests
 *
 * Unit tests for `WakeupStore` — SQLite CRUD for durable one-shot wakeups.
 * Uses in-memory SQLite databases (no file I/O, cross-platform safe).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { WakeupStore } from '../../../src/server/loops/wakeup-store';
import type { WakeupEntry } from '../../../src/server/loops/wakeup-types';

function createDb(): Database.Database {
    return new Database(':memory:');
}

function makeWakeup(overrides: Partial<WakeupEntry> = {}): WakeupEntry {
    return {
        id: overrides.id ?? 'wakeup_test1',
        processId: overrides.processId ?? 'proc_abc',
        prompt: overrides.prompt ?? 'resume me',
        model: 'model' in overrides ? overrides.model! : null,
        status: overrides.status ?? 'pending',
        createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
        firesAt: overrides.firesAt ?? '2026-01-01T00:01:00.000Z',
        firedAt: 'firedAt' in overrides ? overrides.firedAt! : null,
        failureReason: 'failureReason' in overrides ? overrides.failureReason! : null,
        ...('workspaceId' in overrides ? { workspaceId: overrides.workspaceId } : {}),
    };
}

describe('WakeupStore', () => {
    let db: Database.Database;
    let store: WakeupStore;

    beforeEach(() => {
        db = createDb();
        store = new WakeupStore(db);
    });

    describe('insert & get', () => {
        it('inserts and retrieves a wakeup by id', () => {
            const w = makeWakeup({ id: 'w1', model: 'claude-opus-4-8', workspaceId: 'ws-1' });
            store.insert(w);

            const got = store.getById('w1');
            expect(got).not.toBeNull();
            expect(got!.id).toBe('w1');
            expect(got!.processId).toBe('proc_abc');
            expect(got!.prompt).toBe('resume me');
            expect(got!.model).toBe('claude-opus-4-8');
            expect(got!.status).toBe('pending');
            expect(got!.firesAt).toBe('2026-01-01T00:01:00.000Z');
            expect(got!.firedAt).toBeNull();
            expect(got!.failureReason).toBeNull();
            expect(got!.workspaceId).toBe('ws-1');
        });

        it('returns null for a missing wakeup', () => {
            expect(store.getById('nope')).toBeNull();
        });

        it('omits workspaceId when the column is null', () => {
            store.insert(makeWakeup({ id: 'w1' }));
            expect(store.getById('w1')!.workspaceId).toBeUndefined();
        });
    });

    describe('getByProcess & getByWorkspace', () => {
        it('lists wakeups scoped to a process, newest first', () => {
            store.insert(makeWakeup({ id: 'w1', processId: 'p1', createdAt: '2026-01-01T00:00:00.000Z' }));
            store.insert(makeWakeup({ id: 'w2', processId: 'p1', createdAt: '2026-01-02T00:00:00.000Z' }));
            store.insert(makeWakeup({ id: 'w3', processId: 'p2' }));

            const list = store.getByProcess('p1');
            expect(list.map(w => w.id)).toEqual(['w2', 'w1']);
        });

        it('lists wakeups scoped to a workspace', () => {
            store.insert(makeWakeup({ id: 'w1', workspaceId: 'ws-a' }));
            store.insert(makeWakeup({ id: 'w2', workspaceId: 'ws-b' }));
            expect(store.getByWorkspace('ws-a').map(w => w.id)).toEqual(['w1']);
        });
    });

    describe('getPending', () => {
        it('returns only pending wakeups, soonest fire time first', () => {
            store.insert(makeWakeup({ id: 'late', firesAt: '2026-01-01T00:05:00.000Z' }));
            store.insert(makeWakeup({ id: 'soon', firesAt: '2026-01-01T00:01:00.000Z' }));
            store.insert(makeWakeup({ id: 'done', status: 'fired', firedAt: '2026-01-01T00:00:30.000Z' }));

            const pending = store.getPending();
            expect(pending.map(w => w.id)).toEqual(['soon', 'late']);
        });
    });

    describe('markFired', () => {
        it('marks a pending wakeup fired and stamps firedAt', () => {
            store.insert(makeWakeup({ id: 'w1' }));
            const ok = store.markFired('w1', '2026-01-01T00:01:05.000Z');
            expect(ok).toBe(true);

            const got = store.getById('w1')!;
            expect(got.status).toBe('fired');
            expect(got.firedAt).toBe('2026-01-01T00:01:05.000Z');
            expect(got.failureReason).toBeNull();
        });

        it('is a no-op on an already-terminal wakeup', () => {
            store.insert(makeWakeup({ id: 'w1', status: 'fired', firedAt: '2026-01-01T00:01:05.000Z' }));
            expect(store.markFired('w1', '2026-01-01T00:02:00.000Z')).toBe(false);
            expect(store.getById('w1')!.firedAt).toBe('2026-01-01T00:01:05.000Z');
        });
    });

    describe('markFailed', () => {
        it('marks a pending wakeup failed with a reason', () => {
            store.insert(makeWakeup({ id: 'w1' }));
            const ok = store.markFailed('w1', 'boom', '2026-01-01T00:01:05.000Z');
            expect(ok).toBe(true);

            const got = store.getById('w1')!;
            expect(got.status).toBe('failed');
            expect(got.failureReason).toBe('boom');
            expect(got.firedAt).toBe('2026-01-01T00:01:05.000Z');
        });

        it('is a no-op on an already-terminal wakeup', () => {
            store.insert(makeWakeup({ id: 'w1', status: 'fired', firedAt: 'x' }));
            expect(store.markFailed('w1', 'boom', 'y')).toBe(false);
        });
    });

    describe('cancel', () => {
        it('cancels a pending wakeup', () => {
            store.insert(makeWakeup({ id: 'w1' }));
            expect(store.cancel('w1')).toBe(true);
            expect(store.getById('w1')!.status).toBe('cancelled');
        });

        it('is a no-op on a fired wakeup', () => {
            store.insert(makeWakeup({ id: 'w1', status: 'fired', firedAt: 'x' }));
            expect(store.cancel('w1')).toBe(false);
            expect(store.getById('w1')!.status).toBe('fired');
        });
    });

    describe('delete & deleteAll', () => {
        it('deletes a single wakeup', () => {
            store.insert(makeWakeup({ id: 'w1' }));
            expect(store.delete('w1')).toBe(true);
            expect(store.getById('w1')).toBeNull();
        });

        it('deletes all wakeups', () => {
            store.insert(makeWakeup({ id: 'w1' }));
            store.insert(makeWakeup({ id: 'w2' }));
            store.deleteAll();
            expect(store.getAll()).toHaveLength(0);
        });
    });

    describe('pruneTerminalBefore', () => {
        it('prunes terminal rows older than the cutoff but keeps pending rows', () => {
            store.insert(makeWakeup({ id: 'old-fired', status: 'fired', firedAt: 'x', createdAt: '2026-01-01T00:00:00.000Z' }));
            store.insert(makeWakeup({ id: 'old-pending', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' }));
            store.insert(makeWakeup({ id: 'new-fired', status: 'fired', firedAt: 'x', createdAt: '2026-06-01T00:00:00.000Z' }));

            const pruned = store.pruneTerminalBefore('2026-03-01T00:00:00.000Z');
            expect(pruned).toBe(1);
            expect(store.getById('old-fired')).toBeNull();
            expect(store.getById('old-pending')).not.toBeNull();
            expect(store.getById('new-fired')).not.toBeNull();
        });
    });
});
