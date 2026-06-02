/**
 * Unit tests for `features/chat/list-pipeline` — the pure helpers shared by
 * the Activity / Chats / Tasks variants of `ChatListPane`.
 *
 * These are deterministic, OS-independent tests: no clock, no DOM, no fs.
 */

import { describe, it, expect } from 'vitest';
import {
    filterTasks,
    bucketByDate,
    resolveEntryTimestamp,
    partitionPinnedArchived,
    applyRalphGrouping,
    applyPlanGrouping,
} from '../../../../src/server/spa/client/react/features/chat/list-pipeline';

// ── filterTasks ────────────────────────────────────────────────────────────

describe('filterTasks', () => {
    const chat = (id: string, mode = 'ask', extra: any = {}) => ({
        id, type: 'chat', payload: { mode }, displayName: `chat-${id}`, ...extra,
    });
    const workflow = (id: string, extra: any = {}) => ({
        id, type: 'run-workflow', payload: {}, displayName: `wf-${id}`, ...extra,
    });
    const pauseMarker = (id: string) => ({ id, kind: 'pause-marker' });

    it('passes everything through when no options are provided', () => {
        const out = filterTasks(
            [chat('r1')],
            [chat('q1'), pauseMarker('p1')],
            [chat('h1')],
        );
        expect(out.running.map(t => t.id)).toEqual(['r1']);
        expect(out.queued.map(t => t.id)).toEqual(['q1', 'p1']);
        expect(out.history.map(t => t.id)).toEqual(['h1']);
    });

    it('applies excludedTypes to all three buckets', () => {
        const out = filterTasks(
            [chat('r1'), workflow('r2')],
            [workflow('q1'), pauseMarker('p1')],
            [workflow('h1'), chat('h2')],
            { excludedTypes: new Set(['run-workflow']) },
        );
        expect(out.running.map(t => t.id)).toEqual(['r1']);
        expect(out.queued.map(t => t.id)).toEqual(['p1']); // pause marker survives
        expect(out.history.map(t => t.id)).toEqual(['h2']);
    });

    it('keeps pause markers regardless of filter / search / scope', () => {
        const out = filterTasks(
            [],
            [pauseMarker('p1')],
            [],
            {
                excludedTypes: new Set(['chat', 'run-workflow', 'run-script']),
                searchQuery: 'unmatched-query',
                scopePredicate: () => false,
            },
        );
        expect(out.queued.map(t => t.id)).toEqual(['p1']);
    });

    it('applies searchQuery against title/prompt fields', () => {
        const out = filterTasks(
            [chat('r1', 'ask', { displayName: 'Fix login bug' })],
            [],
            [chat('h1', 'ask', { displayName: 'Refactor auth', prompt: 'login flow' })],
            { searchQuery: 'login' },
        );
        expect(out.running.map(t => t.id)).toEqual(['r1']);
        expect(out.history.map(t => t.id)).toEqual(['h1']);
    });

    it('combines excludedTypes AND searchQuery AND scopePredicate', () => {
        const out = filterTasks(
            [chat('r1', 'ask', { displayName: 'login a' }), workflow('r2', { displayName: 'login b' })],
            [],
            [chat('h1', 'ask', { displayName: 'login c' }), chat('h2', 'plan', { displayName: 'login d' })],
            {
                excludedTypes: new Set(['ask']),
                searchQuery: 'login',
                scopePredicate: t => t.type === 'chat',
            },
        );
        expect(out.running.map(t => t.id)).toEqual([]); // ask excluded; workflow fails scope
        expect(out.history.map(t => t.id)).toEqual([]); // legacy plan normalizes to ask and is excluded
    });
});

// ── bucketByDate / resolveEntryTimestamp ──────────────────────────────────

describe('resolveEntryTimestamp', () => {
    it('prefers latestTimestamp for grouped entries', () => {
        expect(resolveEntryTimestamp({ kind: 'group', latestTimestamp: 42 })).toBe(42);
        expect(resolveEntryTimestamp({ kind: 'ralph-session', latestTimestamp: 100 })).toBe(100);
    });

    it('returns 0 for grouped entries lacking latestTimestamp', () => {
        expect(resolveEntryTimestamp({ kind: 'group' })).toBe(0);
    });

    it('walks the canonical fallback chain in order', () => {
        // lastActivityAt wins
        expect(resolveEntryTimestamp({
            lastActivityAt: 5, endTime: 4, completedAt: 3, startTime: 2, startedAt: 1, createdAt: 0,
        })).toBe(5);
        // endTime when lastActivityAt missing
        expect(resolveEntryTimestamp({ endTime: 4, completedAt: 3 })).toBe(4);
        // completedAt
        expect(resolveEntryTimestamp({ completedAt: 3, startTime: 2 })).toBe(3);
        // createdAt last
        expect(resolveEntryTimestamp({ createdAt: 7 })).toBe(7);
    });

    it('parses ISO string timestamps', () => {
        const iso = '2024-01-02T03:04:05.000Z';
        expect(resolveEntryTimestamp({ completedAt: iso })).toBe(+new Date(iso));
    });

    it('returns 0 for empty / unparseable / missing entries', () => {
        expect(resolveEntryTimestamp({})).toBe(0);
        expect(resolveEntryTimestamp({ completedAt: 'not-a-date' })).toBe(0);
        expect(resolveEntryTimestamp(null as any)).toBe(0);
    });
});

describe('bucketByDate', () => {
    const now = 1_000_000_000_000;
    const hoursAgo = (h: number) => now - h * 3_600_000;

    it('classifies entries into today (<24h) / week (<7d) / older', () => {
        const entries = [
            { id: 'a', completedAt: hoursAgo(1) },
            { id: 'b', completedAt: hoursAgo(23.9) },
            { id: 'c', completedAt: hoursAgo(25) },
            { id: 'd', completedAt: hoursAgo(24 * 7 - 1) },
            { id: 'e', completedAt: hoursAgo(24 * 7 + 1) },
            { id: 'f', completedAt: hoursAgo(24 * 365) },
        ];
        const out = bucketByDate(entries, { now });
        expect(out.today.map(e => e.id)).toEqual(['a', 'b']);
        expect(out.week.map(e => e.id)).toEqual(['c', 'd']);
        expect(out.older.map(e => e.id)).toEqual(['e', 'f']);
    });

    it('treats entries without timestamps as older', () => {
        const out = bucketByDate([{ id: 'x' }, { id: 'y', completedAt: undefined }], { now });
        expect(out.older.map(e => e.id)).toEqual(['x', 'y']);
    });

    it('uses latestTimestamp for plan groups and ralph sessions', () => {
        const out = bucketByDate(
            [
                { kind: 'group', planFilePath: 'p1', latestTimestamp: hoursAgo(2) },
                { kind: 'ralph-session', sessionId: 's1', latestTimestamp: hoursAgo(48) },
            ] as any[],
            { now },
        );
        expect(out.today).toHaveLength(1);
        expect(out.week).toHaveLength(1);
        expect(out.older).toHaveLength(0);
    });

    it('honors custom hour boundaries', () => {
        const entries = [
            { id: 'a', completedAt: hoursAgo(0.5) },
            { id: 'b', completedAt: hoursAgo(2) },
        ];
        const out = bucketByDate(entries, { now, todayHours: 1, weekHours: 3 });
        expect(out.today.map(e => e.id)).toEqual(['a']);
        expect(out.week.map(e => e.id)).toEqual(['b']);
    });
});

// ── partitionPinnedArchived ───────────────────────────────────────────────

describe('partitionPinnedArchived', () => {
    const t = (id: string) => ({ id, displayName: id });

    it('returns all items as unpinned when no pinned/archived sets', () => {
        const out = partitionPinnedArchived([t('a'), t('b')]);
        expect(out.pinned).toEqual([]);
        expect(out.unpinned.map(x => x.id)).toEqual(['a', 'b']);
        expect(out.archived).toEqual([]);
    });

    it('moves archived items into the archived bucket and excludes them from pinned', () => {
        const out = partitionPinnedArchived(
            [t('a'), t('b'), t('c')],
            new Set(['a', 'c']),
            new Set(['c']),
        );
        // c is archived → not pinned
        expect(out.archived.map(x => x.id)).toEqual(['c']);
        expect(out.pinned.map(x => x.id)).toEqual(['a']);
        expect(out.unpinned.map(x => x.id)).toEqual(['b']);
    });

    it('preserves pinned-set iteration order rather than item order', () => {
        const items = [t('a'), t('b'), t('c')];
        // Set iteration order is insertion order: c first, then a
        const pinnedIds = new Set(['c', 'a']);
        const out = partitionPinnedArchived(items, pinnedIds);
        expect(out.pinned.map(x => x.id)).toEqual(['c', 'a']);
        expect(out.unpinned.map(x => x.id)).toEqual(['b']);
    });

    it('skips pinned ids that have no matching item', () => {
        const out = partitionPinnedArchived([t('a')], new Set(['missing', 'a']));
        expect(out.pinned.map(x => x.id)).toEqual(['a']);
    });
});

// ── applyRalphGrouping ────────────────────────────────────────────────────

describe('applyRalphGrouping', () => {
    it('groups items sharing a ralph.sessionId', () => {
        const items = [
            { id: 'g', payload: { context: { ralph: { sessionId: 's1', phase: 'grilling' } }, mode: 'ask' } },
            { id: 'i1', payload: { mode: 'ralph', context: { ralph: { sessionId: 's1', phase: 'executing', currentIteration: 1 } } } },
            { id: 'plain', payload: {} },
        ];
        const out = applyRalphGrouping(items as any[]);
        const session = out.find((e: any) => e.kind === 'ralph-session') as any;
        expect(session).toBeDefined();
        expect(session.sessionId).toBe('s1');
        expect(session.iterations.map((t: any) => t.id)).toEqual(['i1']);
        expect(out.some((e: any) => e.id === 'plain')).toBe(true);
    });

    it('flags hasUnseen when any session item is in the unseen set', () => {
        const items = [
            { id: 'g', payload: { context: { ralph: { sessionId: 's1', phase: 'grilling' } } } },
            { id: 'i1', payload: { mode: 'ralph', context: { ralph: { sessionId: 's1', phase: 'executing' } } } },
        ];
        const out = applyRalphGrouping(items as any[], new Set(['i1']));
        const session = out.find((e: any) => e.kind === 'ralph-session') as any;
        expect(session.hasUnseen).toBe(true);
    });
});

// ── applyPlanGrouping ─────────────────────────────────────────────────────

describe('applyPlanGrouping', () => {
    it('groups consecutive history entries sharing a planFilePath', () => {
        const items = [
            { id: 'a', planFilePath: '/repo/plan.md', completedAt: 3, status: 'completed', type: 'chat' },
            { id: 'b', planFilePath: '/repo/plan.md', completedAt: 2, status: 'completed', type: 'chat' },
            { id: 'c', completedAt: 1, status: 'completed', type: 'chat' },
        ];
        const out = applyPlanGrouping(items as any[]);
        const group = out.find((e: any) => e.kind === 'group') as any;
        expect(group).toBeDefined();
        expect(group.planFilePath).toBe('/repo/plan.md');
        expect(group.children.map((c: any) => c.id).sort()).toEqual(['a', 'b']);
        expect(out.some((e: any) => (e as any).id === 'c')).toBe(true);
    });

    it('returns standalone entries unchanged when no shared plan files', () => {
        const items = [
            { id: 'a', completedAt: 2, status: 'completed', type: 'chat' },
            { id: 'b', completedAt: 1, status: 'completed', type: 'chat' },
        ];
        const out = applyPlanGrouping(items as any[]);
        expect(out.every((e: any) => e.kind !== 'group')).toBe(true);
    });
});
