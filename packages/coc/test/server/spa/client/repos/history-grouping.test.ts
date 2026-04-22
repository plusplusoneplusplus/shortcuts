/**
 * @vitest-environment node
 *
 * Tests for history-grouping.ts — groupHistoryByPlanFile utility.
 */
import { describe, it, expect } from 'vitest';
import { groupHistoryByPlanFile, type HistoryGroup, type HistoryEntry } from '../../../../../src/server/spa/client/react/features/git/history-grouping';
import type { ProcessHistoryItem } from '../../../../../src/server/spa/client/react/types/dashboard';

function makeItem(overrides: Partial<ProcessHistoryItem> & { id: string }): ProcessHistoryItem {
    return {
        type: 'chat',
        status: 'completed',
        title: overrides.id,
        startTime: 1000,
        workspaceId: 'ws-1',
        turnCount: 2,
        ...overrides,
    };
}

function isGroup(entry: HistoryEntry): entry is HistoryGroup {
    return entry.kind === 'group';
}

describe('groupHistoryByPlanFile', () => {
    it('returns empty array for empty input', () => {
        expect(groupHistoryByPlanFile([], new Set())).toEqual([]);
    });

    it('returns all items as standalone when none have planFilePath', () => {
        const items = [
            makeItem({ id: 'a', startTime: 3000, lastActivityAt: 3000 }),
            makeItem({ id: 'b', startTime: 2000, lastActivityAt: 2000 }),
            makeItem({ id: 'c', startTime: 1000, lastActivityAt: 1000 }),
        ];
        const result = groupHistoryByPlanFile(items);
        expect(result).toHaveLength(3);
        expect(result.every(e => !isGroup(e))).toBe(true);
        // Sorted by timestamp desc
        expect((result[0] as any).id).toBe('a');
        expect((result[1] as any).id).toBe('b');
        expect((result[2] as any).id).toBe('c');
    });

    it('groups two items sharing the same planFilePath', () => {
        const items = [
            makeItem({ id: 'plan-1', planFilePath: '/repo/auth.plan.md', startTime: 1000, lastActivityAt: 1000, mode: 'plan' }),
            makeItem({ id: 'auto-1', planFilePath: '/repo/auth.plan.md', startTime: 2000, lastActivityAt: 2000, mode: 'autopilot' }),
        ];
        const result = groupHistoryByPlanFile(items);
        expect(result).toHaveLength(1);
        expect(isGroup(result[0])).toBe(true);
        const group = result[0] as HistoryGroup;
        expect(group.kind).toBe('group');
        expect(group.label).toBe('auth.plan.md');
        expect(group.children).toHaveLength(2);
        // Children sorted by startTime ascending
        expect(group.children[0].id).toBe('plan-1');
        expect(group.children[1].id).toBe('auto-1');
        expect(group.latestTimestamp).toBe(2000);
    });

    it('does not create singleton groups (1 item → standalone)', () => {
        const items = [
            makeItem({ id: 'only-one', planFilePath: '/repo/solo.plan.md', startTime: 1000, lastActivityAt: 1000 }),
        ];
        const result = groupHistoryByPlanFile(items);
        expect(result).toHaveLength(1);
        expect(isGroup(result[0])).toBe(false);
        expect((result[0] as any).id).toBe('only-one');
    });

    it('mixes groups and standalone items, sorted by latest timestamp', () => {
        const items = [
            makeItem({ id: 'plan-1', planFilePath: '/repo/old.plan.md', startTime: 1000, lastActivityAt: 1000, mode: 'plan' }),
            makeItem({ id: 'auto-1', planFilePath: '/repo/old.plan.md', startTime: 1500, lastActivityAt: 1500, mode: 'autopilot' }),
            makeItem({ id: 'solo', startTime: 3000, lastActivityAt: 3000 }),
        ];
        const result = groupHistoryByPlanFile(items);
        expect(result).toHaveLength(2);
        // Solo (ts=3000) before group (ts=1500)
        expect(isGroup(result[0])).toBe(false);
        expect((result[0] as any).id).toBe('solo');
        expect(isGroup(result[1])).toBe(true);
    });

    it('group with newer child sorts above standalone with older timestamp', () => {
        const items = [
            makeItem({ id: 'plan-1', planFilePath: '/repo/new.plan.md', startTime: 1000, lastActivityAt: 1000 }),
            makeItem({ id: 'auto-1', planFilePath: '/repo/new.plan.md', startTime: 5000, lastActivityAt: 5000 }),
            makeItem({ id: 'solo', startTime: 3000, lastActivityAt: 3000 }),
        ];
        const result = groupHistoryByPlanFile(items);
        expect(result).toHaveLength(2);
        // Group (ts=5000) before solo (ts=3000)
        expect(isGroup(result[0])).toBe(true);
        expect((result[0] as HistoryGroup).latestTimestamp).toBe(5000);
    });

    it('sorts children within group by startTime ascending', () => {
        const items = [
            makeItem({ id: 'auto-2', planFilePath: '/p.plan.md', startTime: 3000, lastActivityAt: 3000 }),
            makeItem({ id: 'plan-1', planFilePath: '/p.plan.md', startTime: 1000, lastActivityAt: 1000 }),
            makeItem({ id: 'auto-1', planFilePath: '/p.plan.md', startTime: 2000, lastActivityAt: 2000 }),
        ];
        const result = groupHistoryByPlanFile(items);
        expect(result).toHaveLength(1);
        const group = result[0] as HistoryGroup;
        expect(group.children.map(c => c.id)).toEqual(['plan-1', 'auto-1', 'auto-2']);
    });

    it('aggregateStatus: all completed → completed', () => {
        const items = [
            makeItem({ id: 'a', planFilePath: '/p.plan.md', status: 'completed', startTime: 1000 }),
            makeItem({ id: 'b', planFilePath: '/p.plan.md', status: 'completed', startTime: 2000 }),
        ];
        const group = groupHistoryByPlanFile(items)[0] as HistoryGroup;
        expect(group.aggregateStatus).toBe('completed');
    });

    it('aggregateStatus: any failed → failed (overrides cancelled)', () => {
        const items = [
            makeItem({ id: 'a', planFilePath: '/p.plan.md', status: 'completed', startTime: 1000 }),
            makeItem({ id: 'b', planFilePath: '/p.plan.md', status: 'failed', startTime: 2000 }),
            makeItem({ id: 'c', planFilePath: '/p.plan.md', status: 'cancelled', startTime: 3000 }),
        ];
        const group = groupHistoryByPlanFile(items)[0] as HistoryGroup;
        expect(group.aggregateStatus).toBe('failed');
    });

    it('aggregateStatus: cancelled (no failed) → cancelled', () => {
        const items = [
            makeItem({ id: 'a', planFilePath: '/p.plan.md', status: 'completed', startTime: 1000 }),
            makeItem({ id: 'b', planFilePath: '/p.plan.md', status: 'cancelled', startTime: 2000 }),
        ];
        const group = groupHistoryByPlanFile(items)[0] as HistoryGroup;
        expect(group.aggregateStatus).toBe('cancelled');
    });

    it('detects unseen children via unseenIds', () => {
        const items = [
            makeItem({ id: 'a', planFilePath: '/p.plan.md', startTime: 1000 }),
            makeItem({ id: 'b', planFilePath: '/p.plan.md', startTime: 2000 }),
        ];
        const unseenIds = new Set(['b']);
        const group = groupHistoryByPlanFile(items, unseenIds)[0] as HistoryGroup;
        expect(group.hasUnseen).toBe(true);
    });

    it('hasUnseen is false when no child is unseen', () => {
        const items = [
            makeItem({ id: 'a', planFilePath: '/p.plan.md', startTime: 1000 }),
            makeItem({ id: 'b', planFilePath: '/p.plan.md', startTime: 2000 }),
        ];
        const group = groupHistoryByPlanFile(items, new Set())[0] as HistoryGroup;
        expect(group.hasUnseen).toBe(false);
    });

    it('normalizes backslash vs forward slash as same group key', () => {
        const items = [
            makeItem({ id: 'a', planFilePath: 'C:\\repo\\auth.plan.md', startTime: 1000 }),
            makeItem({ id: 'b', planFilePath: 'C:/repo/auth.plan.md', startTime: 2000 }),
        ];
        const result = groupHistoryByPlanFile(items);
        expect(result).toHaveLength(1);
        expect(isGroup(result[0])).toBe(true);
        expect((result[0] as HistoryGroup).children).toHaveLength(2);
    });

    it('case-insensitive path normalization (Windows)', () => {
        const items = [
            makeItem({ id: 'a', planFilePath: 'C:\\Repo\\Auth.plan.md', startTime: 1000 }),
            makeItem({ id: 'b', planFilePath: 'c:/repo/auth.plan.md', startTime: 2000 }),
        ];
        const result = groupHistoryByPlanFile(items);
        expect(result).toHaveLength(1);
        expect(isGroup(result[0])).toBe(true);
    });

    it('handles no unseenIds argument (defaults to no unseen)', () => {
        const items = [
            makeItem({ id: 'a', planFilePath: '/p.plan.md', startTime: 1000 }),
            makeItem({ id: 'b', planFilePath: '/p.plan.md', startTime: 2000 }),
        ];
        const group = groupHistoryByPlanFile(items)[0] as HistoryGroup;
        expect(group.hasUnseen).toBe(false);
    });

    it('uses endTime as fallback when lastActivityAt is undefined', () => {
        const items = [
            makeItem({ id: 'a', planFilePath: '/p.plan.md', startTime: 1000, endTime: 1500 }),
            makeItem({ id: 'b', planFilePath: '/p.plan.md', startTime: 2000, endTime: 2500 }),
        ];
        const group = groupHistoryByPlanFile(items)[0] as HistoryGroup;
        expect(group.latestTimestamp).toBe(2500);
    });

    it('uses startTime as final fallback', () => {
        const items = [
            makeItem({ id: 'a', planFilePath: '/p.plan.md', startTime: 1000 }),
            makeItem({ id: 'b', planFilePath: '/p.plan.md', startTime: 2000 }),
        ];
        // Remove endTime/lastActivityAt
        delete items[0].endTime;
        delete items[0].lastActivityAt;
        delete items[1].endTime;
        delete items[1].lastActivityAt;
        const group = groupHistoryByPlanFile(items)[0] as HistoryGroup;
        expect(group.latestTimestamp).toBe(2000);
    });

    it('multiple groups from different plan files', () => {
        const items = [
            makeItem({ id: 'a1', planFilePath: '/a.plan.md', startTime: 1000, lastActivityAt: 1000 }),
            makeItem({ id: 'a2', planFilePath: '/a.plan.md', startTime: 2000, lastActivityAt: 2000 }),
            makeItem({ id: 'b1', planFilePath: '/b.plan.md', startTime: 3000, lastActivityAt: 3000 }),
            makeItem({ id: 'b2', planFilePath: '/b.plan.md', startTime: 4000, lastActivityAt: 4000 }),
        ];
        const result = groupHistoryByPlanFile(items);
        expect(result).toHaveLength(2);
        expect(result.every(isGroup)).toBe(true);
        // b group (ts=4000) before a group (ts=2000)
        expect((result[0] as HistoryGroup).label).toBe('b.plan.md');
        expect((result[1] as HistoryGroup).label).toBe('a.plan.md');
    });

    it('preserves original planFilePath string from first item (not normalized)', () => {
        const items = [
            makeItem({ id: 'a', planFilePath: 'C:\\Repo\\Plan.plan.md', startTime: 1000 }),
            makeItem({ id: 'b', planFilePath: 'c:/repo/plan.plan.md', startTime: 2000 }),
        ];
        const group = groupHistoryByPlanFile(items)[0] as HistoryGroup;
        // Uses the first item's original path
        expect(group.planFilePath).toBe('C:\\Repo\\Plan.plan.md');
    });
});
