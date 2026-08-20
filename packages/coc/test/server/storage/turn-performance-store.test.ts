/**
 * TurnPerformanceStore Unit Tests
 *
 * Verifies the SQLite persistence for per-turn TTFT/TPS metric events:
 * - insert → query round-trip including NULL columns
 * - upsert idempotency (retried settlement cannot double-count)
 * - `days` windowing, `processId`, `firstTurnOnly`, and status filtering
 * - pruneOlderThan
 * - idempotent construction (fresh DB and pre-existing table)
 * - safe no-op behavior when no DB handle is supplied
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import type { TurnPerformanceEvent } from '@plusplusoneplusplus/forge';
import { TurnPerformanceStore } from '../../../src/server/storage/turn-performance-store';

function makeEvent(overrides: Partial<TurnPerformanceEvent> = {}): TurnPerformanceEvent {
    const processId = overrides.processId ?? 'proc-1';
    const turnIndex = overrides.turnIndex ?? 0;
    return {
        id: `${processId}:${turnIndex}`,
        processId,
        turnIndex,
        workspaceId: 'ws-1',
        provider: 'claude',
        model: 'claude-fable-5',
        effortTier: 'high',
        mode: 'ask',
        kind: 'chat',
        enqueuedAt: '2026-08-20T10:00:00.000Z',
        startedAt: '2026-08-20T10:00:01.000Z',
        firstOutputAt: '2026-08-20T10:00:04.000Z',
        endedAt: '2026-08-20T10:00:11.000Z',
        ttftMs: 3000,
        queueWaitMs: 1000,
        generationMs: 7000,
        wallMs: 10000,
        inputTokens: 1200,
        outputTokens: 350,
        totalTokens: 1550,
        tpsGeneration: 50,
        tpsWall: 35,
        status: 'completed',
        ...overrides,
    };
}

describe('TurnPerformanceStore', () => {
    let db: Database.Database;
    let store: TurnPerformanceStore;

    beforeEach(() => {
        db = new Database(':memory:');
        store = new TurnPerformanceStore(db);
    });

    afterEach(() => {
        db.close();
    });

    // -------------------------------------------------------------------------
    // Round-trip
    // -------------------------------------------------------------------------

    it('round-trips a fully populated event', () => {
        const event = makeEvent();
        expect(store.record(event)).toBe(true);

        const events = store.queryEvents();
        expect(events).toHaveLength(1);
        expect(events[0]).toEqual(event);
    });

    it('round-trips NULL columns as null, never zero', () => {
        const event = makeEvent({
            workspaceId: null,
            provider: null,
            model: null,
            effortTier: null,
            mode: null,
            kind: null,
            enqueuedAt: null,
            firstOutputAt: null,
            ttftMs: null,
            queueWaitMs: null,
            generationMs: null,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            tpsGeneration: null,
            tpsWall: null,
            status: 'errored',
        });
        store.record(event);

        const [read] = store.queryEvents();
        expect(read).toEqual(event);
        expect(read.ttftMs).toBeNull();
        expect(read.outputTokens).toBeNull();
    });

    it('preserves REAL tps values with decimals', () => {
        store.record(makeEvent({ tpsGeneration: 27.413, tpsWall: 24.099 }));
        const [read] = store.queryEvents();
        expect(read.tpsGeneration).toBeCloseTo(27.413, 3);
        expect(read.tpsWall).toBeCloseTo(24.099, 3);
    });

    // -------------------------------------------------------------------------
    // Upsert idempotency
    // -------------------------------------------------------------------------

    it('upserts on the primary key so a retried settlement cannot double-count', () => {
        store.record(makeEvent({ outputTokens: 100 }));
        store.record(makeEvent({ outputTokens: 250, status: 'completed' }));

        const events = store.queryEvents();
        expect(events).toHaveLength(1);
        expect(events[0].outputTokens).toBe(250);
    });

    // -------------------------------------------------------------------------
    // Query filters
    // -------------------------------------------------------------------------

    it('windows by days on startedAt', () => {
        const now = Date.parse('2026-08-20T12:00:00.000Z');
        store.record(makeEvent({ processId: 'old', startedAt: '2026-08-01T00:00:00.000Z' }));
        store.record(makeEvent({ processId: 'recent', startedAt: '2026-08-19T00:00:00.000Z' }));

        const events = store.queryEvents({ days: 7, now });
        expect(events).toHaveLength(1);
        expect(events[0].processId).toBe('recent');
    });

    it('filters by processId', () => {
        store.record(makeEvent({ processId: 'proc-a', turnIndex: 0 }));
        store.record(makeEvent({ processId: 'proc-a', turnIndex: 1 }));
        store.record(makeEvent({ processId: 'proc-b', turnIndex: 0 }));

        const events = store.queryEvents({ processId: 'proc-a' });
        expect(events).toHaveLength(2);
        expect(events.every(e => e.processId === 'proc-a')).toBe(true);
    });

    it('filters to turn_index = 0 with firstTurnOnly', () => {
        store.record(makeEvent({ processId: 'proc-a', turnIndex: 0 }));
        store.record(makeEvent({ processId: 'proc-a', turnIndex: 3 }));
        store.record(makeEvent({ processId: 'proc-b', turnIndex: 0 }));

        const events = store.queryEvents({ firstTurnOnly: true });
        expect(events).toHaveLength(2);
        expect(events.every(e => e.turnIndex === 0)).toBe(true);
    });

    it('filters by statuses', () => {
        store.record(makeEvent({ processId: 'ok', status: 'completed' }));
        store.record(makeEvent({ processId: 'bad', status: 'errored' }));
        store.record(makeEvent({ processId: 'stop', status: 'cancelled' }));

        const events = store.queryEvents({ statuses: ['completed'] });
        expect(events).toHaveLength(1);
        expect(events[0].processId).toBe('ok');
    });

    it('combines filters (days + processId + firstTurnOnly)', () => {
        const now = Date.parse('2026-08-20T12:00:00.000Z');
        store.record(makeEvent({ processId: 'proc-a', turnIndex: 0, startedAt: '2026-08-19T00:00:00.000Z' }));
        store.record(makeEvent({ processId: 'proc-a', turnIndex: 1, startedAt: '2026-08-19T01:00:00.000Z' }));
        store.record(makeEvent({ processId: 'proc-a', turnIndex: 2, startedAt: '2026-07-01T00:00:00.000Z' }));
        store.record(makeEvent({ processId: 'proc-b', turnIndex: 0, startedAt: '2026-08-19T00:00:00.000Z' }));

        const events = store.queryEvents({ days: 7, processId: 'proc-a', firstTurnOnly: true, now });
        expect(events).toHaveLength(1);
        expect(events[0].id).toBe('proc-a:0');
    });

    it('orders newest first by startedAt', () => {
        store.record(makeEvent({ processId: 'a', startedAt: '2026-08-18T00:00:00.000Z' }));
        store.record(makeEvent({ processId: 'b', startedAt: '2026-08-19T00:00:00.000Z' }));

        const events = store.queryEvents();
        expect(events.map(e => e.processId)).toEqual(['b', 'a']);
    });

    // -------------------------------------------------------------------------
    // Prune
    // -------------------------------------------------------------------------

    it('pruneOlderThan deletes rows started before the cutoff and returns the count', () => {
        store.record(makeEvent({ processId: 'old-1', startedAt: '2026-07-01T00:00:00.000Z' }));
        store.record(makeEvent({ processId: 'old-2', startedAt: '2026-07-02T00:00:00.000Z' }));
        store.record(makeEvent({ processId: 'kept', startedAt: '2026-08-19T00:00:00.000Z' }));

        expect(store.pruneOlderThan('2026-08-01T00:00:00.000Z')).toBe(2);
        const events = store.queryEvents();
        expect(events).toHaveLength(1);
        expect(events[0].processId).toBe('kept');
    });

    it('deleteAll clears the table', () => {
        store.record(makeEvent());
        store.deleteAll();
        expect(store.queryEvents()).toHaveLength(0);
    });

    // -------------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------------

    it('constructs cleanly against a DB where the table already exists', () => {
        store.record(makeEvent());
        const second = new TurnPerformanceStore(db);
        expect(second.queryEvents()).toHaveLength(1);
        expect(second.record(makeEvent({ turnIndex: 1 }))).toBe(true);
    });

    it('record never throws on a broken database', () => {
        db.exec('DROP TABLE turn_performance');
        expect(() => store.record(makeEvent())).not.toThrow();
        expect(store.record(makeEvent())).toBe(false);
    });

    // -------------------------------------------------------------------------
    // No DB handle → safe no-op
    // -------------------------------------------------------------------------

    it('is a safe no-op when constructed without a DB handle', () => {
        const noDb = new TurnPerformanceStore();
        expect(noDb.isEnabled()).toBe(false);
        expect(noDb.record(makeEvent())).toBe(false);
        expect(noDb.queryEvents()).toEqual([]);
        expect(noDb.pruneOlderThan('2026-08-01T00:00:00.000Z')).toBe(0);
        expect(() => noDb.deleteAll()).not.toThrow();
    });
});
