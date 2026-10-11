import { describe, expect, it } from 'vitest';
import { selectRailPinnedJobs, type RailPinnedInput } from '../../../../src/server/spa/client/react/features/chat/rail-pinned-jobs';

const base = (overrides: Partial<RailPinnedInput> = {}): RailPinnedInput => ({
    snapshot: null, running: [], history: [], pinnedIds: [], archivedIds: new Set(), excludedTypes: new Set(), tab: 'activity', ...overrides,
});
const ids = (rows: any[]) => rows.map(row => row.id);

describe('selectRailPinnedJobs', () => {
    it('leads with an optimistic sidebar pin, then newest pin first', () => {
        const rows = selectRailPinnedJobs(base({
            snapshot: { entries: [
                { id: 'queue_old', type: 'chat', status: 'completed', pinnedAt: '2026-01-01T00:00:00Z' },
                { id: 'queue_new', type: 'chat', status: 'failed', pinnedAt: '2026-02-01T00:00:00Z' },
            ] },
            history: [{ id: 'queue_fresh', type: 'chat', status: 'completed' }],
            pinnedIds: ['queue_fresh'],
        }));
        expect(ids(rows)).toEqual(['queue_fresh', 'queue_new', 'queue_old']);
    });

    it('matches running task ids to their queue process and prefers live rows', () => {
        const rows = selectRailPinnedJobs(base({
            snapshot: { entries: [{ id: 'queue_t1', type: 'chat', status: 'queued', pinnedAt: '2026-01-01T00:00:00Z' }] },
            running: [{ id: 't1', processId: 'queue_t1', type: 'chat', status: 'running' }],
        }));
        expect(rows).toEqual([expect.objectContaining({ id: 't1', status: 'running', pinnedAt: '2026-01-01T00:00:00Z' })]);
    });

    it('keeps a reordered local stamp over an older server stamp', () => {
        const rows = selectRailPinnedJobs(base({
            snapshot: { entries: [
                { id: 'queue_a', type: 'chat', status: 'completed', pinnedAt: '2026-01-02T00:00:00Z' },
                { id: 'queue_b', type: 'chat', status: 'completed', pinnedAt: '2026-01-01T00:00:00Z' },
            ] },
            history: [
                { id: 'queue_a', type: 'chat', status: 'completed', pinnedAt: '2026-01-02T00:00:00Z' },
                { id: 'queue_b', type: 'chat', status: 'completed', pinnedAt: '2026-03-01T00:00:00Z' },
            ],
            pinnedIds: ['queue_b', 'queue_a'],
        }));
        expect(ids(rows)).toEqual(['queue_b', 'queue_a']);
    });

    it('drops server-archived unloaded rows and locally archived rows', () => {
        const rows = selectRailPinnedJobs(base({
            snapshot: { entries: [
                { id: 'queue_x', type: 'chat', status: 'completed', pinnedAt: '2026-01-01T00:00:00Z', archived: true },
                { id: 'queue_y', type: 'chat', status: 'completed', pinnedAt: '2026-01-01T00:00:00Z' },
            ] },
            archivedIds: new Set(['queue_y']),
        }));
        expect(rows).toEqual([]);
    });

    it('trusts the server for loaded rows until sidebar pin state has loaded', () => {
        const input = base({
            snapshot: { entries: [{ id: 'queue_a', type: 'chat', status: 'completed', pinnedAt: '2026-01-01T00:00:00Z' }] },
            history: [{ id: 'queue_a', type: 'chat', status: 'completed' }],
        });
        expect(ids(selectRailPinnedJobs({ ...input, pinnedIds: null }))).toEqual(['queue_a']);
        expect(ids(selectRailPinnedJobs({ ...input, pinnedIds: [] }))).toEqual([]);
    });

    it('matches the current Chats or Tasks sidebar visibility', () => {
        const input = base({
            snapshot: { entries: [
                { id: 'queue_chat', type: 'chat', status: 'completed', pinnedAt: '2026-01-03T00:00:00Z' },
                { id: 'queue_work_item', type: 'chat', status: 'completed', workItemId: '42', pinnedAt: '2026-01-02T00:00:00Z' },
                { id: 'queue_script', type: 'run-script', status: 'completed', sessionCategory: 'generating-code', pinnedAt: '2026-01-01T00:00:00Z' },
            ] },
            excludedTypes: new Set(['cat:generating-code']),
        });
        expect(ids(selectRailPinnedJobs({ ...input, tab: 'chats' }))).toEqual(['queue_chat']);
        expect(ids(selectRailPinnedJobs({ ...input, tab: 'tasks' }))).toEqual(['queue_work_item']);
    });
});
