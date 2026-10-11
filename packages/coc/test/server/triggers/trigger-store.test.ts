/**
 * Unit tests for `TriggerStore` — SQLite CRUD for the generic trigger
 * framework. Uses in-memory SQLite (no file I/O, cross-platform safe).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NativeDatabase as Database } from '@plusplusoneplusplus/coc-native';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import type { Trigger } from '../../../src/server/triggers/trigger-types';
import { MAX_ACTIVE_TRIGGERS } from '../../../src/server/triggers/trigger-types';

function createDb(): Database {
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
        expiresAt: 'expiresAt' in overrides ? overrides.expiresAt! : '2026-01-04T00:00:00.000Z',
        lastTickAt: 'lastTickAt' in overrides ? overrides.lastTickAt! : null,
        nextTickAt: 'nextTickAt' in overrides ? overrides.nextTickAt! : '2026-01-01T00:01:00.000Z',
        revision: overrides.revision ?? 1,
        ...(overrides.binding ? { binding: overrides.binding } : {}),
        ...(overrides.outcome ? { outcome: overrides.outcome } : {}),
        ...(overrides.outcomeReason ? { outcomeReason: overrides.outcomeReason } : {}),
        ...(overrides.delivery ? { delivery: overrides.delivery } : {}),
    };
}

function makePrMergeTrigger(overrides: Partial<Trigger> = {}): Trigger {
    return makeTrigger({
        id: 'trigger_pr1',
        expiresAt: null,
        event: {
            type: 'condition-monitor',
            monitor: 'pr-merged',
            pr: { provider: 'github', host: 'github.com', repoPath: 'o/r', number: 7, url: 'https://github.com/o/r/pull/7' },
            pollIntervalMs: 300_000,
            consecutiveErrors: 0,
        },
        action: { type: 'send-message', processId: 'proc_abc', prompt: '', mode: 'inherit' },
        binding: { kind: 'sentinel-todo', itemId: 'item-1', instruction: 'ship it', armedBy: 'sentinel', armedAt: '2026-01-01T00:00:00.000Z' },
        ...overrides,
    });
}

describe('TriggerStore', () => {
    let db: Database;
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

    it('round-trips a never-expiring Sentinel To-do rule with binding, outcome and delivery', () => {
        const trigger = makePrMergeTrigger({
            status: 'disarmed',
            outcome: 'fired',
            outcomeReason: 'PR merged',
            delivery: { deliveryId: 'd-1', firedAt: '2026-01-02T00:00:00.000Z', reason: 'merged', state: 'pending', itemRevision: 3 },
            revision: 4,
        });
        store.insert(trigger);
        expect(store.getById('trigger_pr1')).toEqual(trigger);
        expect(store.getById('trigger_pr1')!.expiresAt).toBeNull();
    });

    it('updateIfRevision writes only when the stored revision matches', () => {
        store.insert(makePrMergeTrigger({ revision: 2 }));
        const stale = { ...store.getById('trigger_pr1')!, status: 'paused' as const, revision: 3 };
        expect(store.updateIfRevision(stale, 1)).toBe(false);
        expect(store.getById('trigger_pr1')!.status).toBe('active');
        expect(store.updateIfRevision(stale, 2)).toBe(true);
        expect(store.getById('trigger_pr1')).toMatchObject({ status: 'paused', revision: 3 });
    });

    it('adds the Sentinel To-do columns to a pre-existing triggers table', () => {
        const legacy = createDb();
        legacy.exec(`CREATE TABLE triggers (
            id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, process_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active', event TEXT NOT NULL, action TEXT NOT NULL,
            in_flight INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
            last_tick_at TEXT, next_tick_at TEXT)`);
        legacy.prepare(`INSERT INTO triggers (id, workspace_id, process_id, status, event, action, in_flight, created_at, expires_at)
            VALUES ('old', 'ws', 'p', 'active', '{"type":"condition-monitor","monitor":"ci-failure"}', '{"type":"send-message"}', 0, '2026-01-01T00:00:00.000Z', '2026-01-04T00:00:00.000Z')`).run();
        const migrated = new TriggerStore(legacy);
        new TriggerStore(legacy); // idempotent
        expect(migrated.getById('old')).toMatchObject({ revision: 1, expiresAt: '2026-01-04T00:00:00.000Z' });
        expect(migrated.getById('old')!.binding).toBeUndefined();
        migrated.insert(makePrMergeTrigger());
        expect(migrated.getById('trigger_pr1')!.binding?.itemId).toBe('item-1');
    });
});
