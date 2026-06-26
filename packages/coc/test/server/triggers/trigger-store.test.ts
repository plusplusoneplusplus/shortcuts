/**
 * Trigger Store Tests
 *
 * Unit tests for `TriggerStore` — SQLite CRUD for the generic trigger
 * framework. Uses in-memory SQLite (no file I/O, cross-platform safe).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import type { Trigger } from '../../../src/server/triggers/trigger-types';
import { MAX_ACTIVE_TRIGGERS } from '../../../src/server/triggers/trigger-types';

function createDb(): Database.Database {
    return new Database(':memory:');
}

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
    return {
        id: overrides.id ?? 'trigger_test1',
        workspaceId: overrides.workspaceId ?? 'ws_abc',
        processId: overrides.processId ?? 'proc_abc',
        status: overrides.status ?? 'active',
        event: overrides.event ?? {
            type: 'condition-monitor',
            monitor: 'ci-failure',
            originId: 'origin_1',
            prId: '42',
            pollIntervalMs: 60_000,
            lastSeenChecks: { build: 'success' },
        },
        action: overrides.action ?? {
            type: 'send-message',
            processId: 'proc_abc',
            prompt: 'fix the CI',
            mode: 'autopilot',
        },
        inFlight: overrides.inFlight ?? false,
        createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
        expiresAt: overrides.expiresAt ?? '2026-01-04T00:00:00.000Z',
        lastTickAt: 'lastTickAt' in overrides ? overrides.lastTickAt! : null,
        nextTickAt: 'nextTickAt' in overrides ? overrides.nextTickAt! : '2026-01-01T00:01:00.000Z',
    };
}

describe('TriggerStore', () => {
    let db: Database.Database;
    let store: TriggerStore;

    beforeEach(() => {
        db = createDb();
        store = new TriggerStore(db);
    });

    it('inserts and retrieves a trigger (round-trips event/action JSON)', () => {
        const trigger = makeTrigger();
        store.insert(trigger);
        expect(store.getById('trigger_test1')).toEqual(trigger);
    });

    it('returns null for unknown id', () => {
        expect(store.getById('nope')).toBeNull();
    });

    it('round-trips inFlight boolean', () => {
        store.insert(makeTrigger({ id: 't_flag', inFlight: true }));
        expect(store.getById('t_flag')?.inFlight).toBe(true);
    });

    it('updates an existing trigger', () => {
        const trigger = makeTrigger();
        store.insert(trigger);
        const updated = {
            ...trigger,
            status: 'disarmed' as const,
            inFlight: true,
            nextTickAt: null,
            event: { ...trigger.event, lastSeenChecks: { build: 'failure' } },
        };
        store.update(updated);
        expect(store.getById('trigger_test1')).toEqual(updated);
    });

    it('lists triggers by workspace, newest first', () => {
        store.insert(makeTrigger({ id: 't1', workspaceId: 'ws_a', createdAt: '2026-01-01T00:00:00.000Z' }));
        store.insert(makeTrigger({ id: 't2', workspaceId: 'ws_a', createdAt: '2026-01-02T00:00:00.000Z' }));
        store.insert(makeTrigger({ id: 't3', workspaceId: 'ws_b', createdAt: '2026-01-03T00:00:00.000Z' }));

        const wsA = store.getByWorkspace('ws_a');
        expect(wsA.map(t => t.id)).toEqual(['t2', 't1']);
        expect(store.getByWorkspace('ws_b').map(t => t.id)).toEqual(['t3']);
    });

    it('lists triggers by process', () => {
        store.insert(makeTrigger({ id: 't1', processId: 'p1' }));
        store.insert(makeTrigger({ id: 't2', processId: 'p2' }));
        expect(store.getByProcess('p1').map(t => t.id)).toEqual(['t1']);
    });

    it('lists only active triggers', () => {
        store.insert(makeTrigger({ id: 't1', status: 'active' }));
        store.insert(makeTrigger({ id: 't2', status: 'paused' }));
        store.insert(makeTrigger({ id: 't3', status: 'disarmed' }));
        expect(store.getActive().map(t => t.id)).toEqual(['t1']);
    });

    it('lists all triggers newest first', () => {
        store.insert(makeTrigger({ id: 't1', createdAt: '2026-01-01T00:00:00.000Z' }));
        store.insert(makeTrigger({ id: 't2', createdAt: '2026-01-02T00:00:00.000Z' }));
        expect(store.getAll().map(t => t.id)).toEqual(['t2', 't1']);
    });

    it('deletes a trigger by id', () => {
        store.insert(makeTrigger());
        expect(store.delete('trigger_test1')).toBe(true);
        expect(store.getById('trigger_test1')).toBeNull();
        expect(store.delete('trigger_test1')).toBe(false);
    });

    it('deletes all triggers', () => {
        store.insert(makeTrigger({ id: 't1' }));
        store.insert(makeTrigger({ id: 't2' }));
        store.deleteAll();
        expect(store.getAll()).toEqual([]);
    });

    it('counts active triggers', () => {
        store.insert(makeTrigger({ id: 't1', status: 'active' }));
        store.insert(makeTrigger({ id: 't2', status: 'paused' }));
        expect(store.countActive()).toBe(1);
    });

    it('rejects inserting an active trigger past the server-wide limit', () => {
        for (let i = 0; i < MAX_ACTIVE_TRIGGERS; i++) {
            store.insert(makeTrigger({ id: `t_${i}`, status: 'active' }));
        }
        expect(() => store.insert(makeTrigger({ id: 't_overflow', status: 'active' }))).toThrow(/active trigger limit/);
        // Non-active inserts are still allowed past the limit.
        expect(() => store.insert(makeTrigger({ id: 't_paused', status: 'paused' }))).not.toThrow();
    });
});
