import { describe, it, expect } from 'vitest';
import {
    WORK_ITEM_STATUSES,
    TERMINAL_WORK_ITEM_STATUSES,
    VALID_TRANSITIONS,
    WORK_ITEM_TYPES,
    HIERARCHY_CONTAINER_TYPES,
    LEAF_WORK_ITEM_TYPES,
    ALLOWED_PARENT_TYPES,
    ALLOWED_CHILD_TYPES,
    isKnownWorkItemStatus,
    isTerminalStatus,
    isValidTransition,
    toIndexEntry,
    getLastRunTime,
    getEffectiveType,
    isContainerType,
    isLeafType,
    isValidParentChildTypes,
} from '../../../src/server/work-items/types';
import type {
    WorkItem,
    WorkItemStatus,
    WorkItemType,
    WorkItemIndexEntry,
    WorkItemExecution,
} from '../../../src/server/work-items/types';

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: 'wi-001',
        repoId: 'repo-1',
        title: 'Test work item',
        description: 'A test work item',
        status: 'created',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        ...overrides,
    };
}

describe('Work Item Types', () => {
    describe('WORK_ITEM_STATUSES', () => {
        it('contains all expected statuses', () => {
            expect(WORK_ITEM_STATUSES).toEqual([
                'created', 'drafting', 'planning', 'readyToExecute', 'executing', 'aiDone', 'aiFailed', 'done', 'failed',
            ]);
        });

        it('is frozen (readonly)', () => {
            expect(() => {
                (WORK_ITEM_STATUSES as string[]).push('invalid');
            }).toThrow();
        });
    });

    describe('TERMINAL_WORK_ITEM_STATUSES', () => {
        it('contains done and failed', () => {
            expect(TERMINAL_WORK_ITEM_STATUSES.has('done')).toBe(true);
            expect(TERMINAL_WORK_ITEM_STATUSES.has('failed')).toBe(true);
        });

        it('does not contain non-terminal statuses', () => {
            expect(TERMINAL_WORK_ITEM_STATUSES.has('created')).toBe(false);
            expect(TERMINAL_WORK_ITEM_STATUSES.has('planning')).toBe(false);
            expect(TERMINAL_WORK_ITEM_STATUSES.has('readyToExecute')).toBe(false);
            expect(TERMINAL_WORK_ITEM_STATUSES.has('executing')).toBe(false);
            expect(TERMINAL_WORK_ITEM_STATUSES.has('aiDone')).toBe(false);
            expect(TERMINAL_WORK_ITEM_STATUSES.has('aiFailed')).toBe(false);
        });
    });

    describe('isTerminalStatus', () => {
        it('returns true for terminal statuses', () => {
            expect(isTerminalStatus('done')).toBe(true);
            expect(isTerminalStatus('failed')).toBe(true);
        });

        it('returns false for non-terminal statuses', () => {
            expect(isTerminalStatus('created')).toBe(false);
            expect(isTerminalStatus('planning')).toBe(false);
            expect(isTerminalStatus('readyToExecute')).toBe(false);
            expect(isTerminalStatus('executing')).toBe(false);
            expect(isTerminalStatus('aiDone')).toBe(false);
            expect(isTerminalStatus('aiFailed')).toBe(false);
        });

        it('returns false for unknown remote statuses', () => {
            expect(isTerminalStatus('Blocked by dependency')).toBe(false);
        });
    });

    describe('isKnownWorkItemStatus', () => {
        it('recognizes built-in statuses only', () => {
            expect(isKnownWorkItemStatus('created')).toBe(true);
            expect(isKnownWorkItemStatus('Blocked by dependency')).toBe(false);
            expect(isKnownWorkItemStatus(undefined)).toBe(false);
        });
    });

    describe('isValidTransition', () => {
        it('allows created → planning', () => {
            expect(isValidTransition('created', 'planning')).toBe(true);
        });

        it('allows created → drafting (goal spec phase)', () => {
            expect(isValidTransition('created', 'drafting')).toBe(true);
        });

        it('allows drafting → planning (spec ready)', () => {
            expect(isValidTransition('drafting', 'planning')).toBe(true);
        });

        it('allows drafting → readyToExecute (skip planning)', () => {
            expect(isValidTransition('drafting', 'readyToExecute')).toBe(true);
        });

        it('allows planning → drafting (back to refine spec)', () => {
            expect(isValidTransition('planning', 'drafting')).toBe(true);
        });

        it('allows created → readyToExecute (skip planning)', () => {
            expect(isValidTransition('created', 'readyToExecute')).toBe(true);
        });

        it('allows planning → readyToExecute', () => {
            expect(isValidTransition('planning', 'readyToExecute')).toBe(true);
        });

        it('allows readyToExecute → executing', () => {
            expect(isValidTransition('readyToExecute', 'executing')).toBe(true);
        });

        it('allows executing → aiDone', () => {
            expect(isValidTransition('executing', 'aiDone')).toBe(true);
        });

        it('allows executing → failed', () => {
            expect(isValidTransition('executing', 'failed')).toBe(true);
        });

        it('allows readyToExecute → planning (go back to refine)', () => {
            expect(isValidTransition('readyToExecute', 'planning')).toBe(true);
        });

        it('allows aiDone → readyToExecute (request changes)', () => {
            expect(isValidTransition('aiDone', 'readyToExecute')).toBe(true);
        });

        it('allows aiDone → done (accept)', () => {
            expect(isValidTransition('aiDone', 'done')).toBe(true);
        });

        it('allows done → created (re-open)', () => {
            expect(isValidTransition('done', 'created')).toBe(true);
        });

        it('allows failed → created (re-open)', () => {
            expect(isValidTransition('failed', 'created')).toBe(true);
        });

        it('allows executing → readyToExecute (retry)', () => {
            expect(isValidTransition('executing', 'readyToExecute')).toBe(true);
        });

        it('allows executing → aiFailed (AI execution failure)', () => {
            expect(isValidTransition('executing', 'aiFailed')).toBe(true);
        });

        it('allows aiFailed → readyToExecute (retry after AI failure)', () => {
            expect(isValidTransition('aiFailed', 'readyToExecute')).toBe(true);
        });

        it('allows aiFailed → created (reset after AI failure)', () => {
            expect(isValidTransition('aiFailed', 'created')).toBe(true);
        });

        it('allows aiFailed → failed (give up after AI failure)', () => {
            expect(isValidTransition('aiFailed', 'failed')).toBe(true);
        });

        it('allows created → done (manual close)', () => {
            expect(isValidTransition('created', 'done')).toBe(true);
        });

        it('allows planning → done (manual close)', () => {
            expect(isValidTransition('planning', 'done')).toBe(true);
        });

        it('allows readyToExecute → done (manual close)', () => {
            expect(isValidTransition('readyToExecute', 'done')).toBe(true);
        });

        it('rejects invalid transitions', () => {
            expect(isValidTransition('created', 'executing')).toBe(false);
            expect(isValidTransition('planning', 'executing')).toBe(false);
            expect(isValidTransition('done', 'executing')).toBe(false);
            expect(isValidTransition('failed', 'executing')).toBe(false);
            expect(isValidTransition('created', 'aiDone')).toBe(false);
        });

        it('rejects transitions involving unknown remote statuses', () => {
            expect(isValidTransition('Blocked by dependency', 'done')).toBe(false);
            expect(isValidTransition('created', 'Blocked by dependency')).toBe(false);
        });

        it('every status has at least one valid transition', () => {
            for (const status of WORK_ITEM_STATUSES) {
                expect(VALID_TRANSITIONS[status].length).toBeGreaterThan(0);
            }
        });
    });

    describe('toIndexEntry', () => {
        it('extracts index fields from a full work item', () => {
            const item = makeWorkItem({
                plan: { version: 3, content: 'some plan', updatedAt: '2026-01-02T00:00:00.000Z' },
                priority: 'high',
                tags: ['backend', 'auth'],
            });

            const entry = toIndexEntry(item);

            expect(entry).toMatchObject<Partial<WorkItemIndexEntry>>({
                id: 'wi-001',
                repoId: 'repo-1',
                title: 'Test work item',
                description: 'A test work item',
                status: 'created',
                source: 'manual',
                priority: 'high',
                planVersion: 3,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                tags: ['backend', 'auth'],
            });
            expect(entry.completedAt).toBeUndefined();
            expect(entry.lastRunAt).toBeUndefined();
        });

        it('includes parentId when set', () => {
            const item = makeWorkItem({ parentId: 'epic-parent' });
            const entry = toIndexEntry(item);
            expect(entry.parentId).toBe('epic-parent');
        });

        it('omits parentId when not set', () => {
            const item = makeWorkItem();
            const entry = toIndexEntry(item);
            expect(entry.parentId).toBeUndefined();
        });

        it('handles work item without optional fields', () => {
            const item = makeWorkItem();
            const entry = toIndexEntry(item);

            expect(entry.planVersion).toBeUndefined();
            expect(entry.priority).toBeUndefined();
            expect(entry.tags).toBeUndefined();
            expect(entry.completedAt).toBeUndefined();
        });

        it('includes description but not execution history', () => {
            const item = makeWorkItem({
                description: 'A very long description...',
                executionHistory: [{ taskId: 't-1', startedAt: '2026-01-01T00:00:00.000Z', status: 'completed' }],
            });

            const entry = toIndexEntry(item);
            expect(entry.description).toBe('A very long description...');
            expect(entry).not.toHaveProperty('executionHistory');
        });

        it('includes lastRunAt derived from execution history', () => {
            const item = makeWorkItem({
                executionHistory: [
                    { taskId: 't-1', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T01:00:00.000Z', status: 'completed' },
                    { taskId: 't-2', startedAt: '2026-01-02T00:00:00.000Z', status: 'running' },
                ],
            });

            const entry = toIndexEntry(item);
            expect(entry.lastRunAt).toBe('2026-01-02T00:00:00.000Z');
        });

        it('sets lastRunAt to undefined when no execution history', () => {
            const item = makeWorkItem();
            const entry = toIndexEntry(item);
            expect(entry.lastRunAt).toBeUndefined();
        });
    });

    describe('getLastRunTime', () => {
        it('returns undefined for undefined history', () => {
            expect(getLastRunTime(undefined)).toBeUndefined();
        });

        it('returns undefined for empty history', () => {
            expect(getLastRunTime([])).toBeUndefined();
        });

        it('returns startedAt when no completedAt', () => {
            const history: WorkItemExecution[] = [
                { taskId: 't-1', startedAt: '2026-03-01T10:00:00.000Z', status: 'running' },
            ];
            expect(getLastRunTime(history)).toBe('2026-03-01T10:00:00.000Z');
        });

        it('prefers completedAt over startedAt for the same entry', () => {
            const history: WorkItemExecution[] = [
                { taskId: 't-1', startedAt: '2026-03-01T10:00:00.000Z', completedAt: '2026-03-01T11:00:00.000Z', status: 'completed' },
            ];
            expect(getLastRunTime(history)).toBe('2026-03-01T11:00:00.000Z');
        });

        it('returns the most recent timestamp across multiple entries', () => {
            const history: WorkItemExecution[] = [
                { taskId: 't-1', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T01:00:00.000Z', status: 'completed' },
                { taskId: 't-2', startedAt: '2026-02-01T00:00:00.000Z', completedAt: '2026-02-01T01:00:00.000Z', status: 'failed' },
                { taskId: 't-3', startedAt: '2026-03-01T00:00:00.000Z', status: 'running' },
            ];
            expect(getLastRunTime(history)).toBe('2026-03-01T00:00:00.000Z');
        });

        it('picks completedAt of an older entry if it is the most recent timestamp', () => {
            const history: WorkItemExecution[] = [
                { taskId: 't-1', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-06-01T00:00:00.000Z', status: 'completed' },
                { taskId: 't-2', startedAt: '2026-03-01T00:00:00.000Z', status: 'running' },
            ];
            expect(getLastRunTime(history)).toBe('2026-06-01T00:00:00.000Z');
        });
    });

    describe('Hierarchy type constants', () => {
        it('WORK_ITEM_TYPES includes all six types', () => {
            expect(WORK_ITEM_TYPES).toContain('work-item');
            expect(WORK_ITEM_TYPES).toContain('bug');
            expect(WORK_ITEM_TYPES).toContain('goal');
            expect(WORK_ITEM_TYPES).toContain('epic');
            expect(WORK_ITEM_TYPES).toContain('feature');
            expect(WORK_ITEM_TYPES).toContain('pbi');
        });

        it('HIERARCHY_CONTAINER_TYPES contains epic, feature, pbi', () => {
            expect(HIERARCHY_CONTAINER_TYPES.has('epic')).toBe(true);
            expect(HIERARCHY_CONTAINER_TYPES.has('feature')).toBe(true);
            expect(HIERARCHY_CONTAINER_TYPES.has('pbi')).toBe(true);
            expect(HIERARCHY_CONTAINER_TYPES.has('work-item')).toBe(false);
            expect(HIERARCHY_CONTAINER_TYPES.has('bug')).toBe(false);
            expect(HIERARCHY_CONTAINER_TYPES.has('goal')).toBe(false);
        });

        it('LEAF_WORK_ITEM_TYPES contains work-item, bug, and goal', () => {
            expect(LEAF_WORK_ITEM_TYPES.has('work-item')).toBe(true);
            expect(LEAF_WORK_ITEM_TYPES.has('bug')).toBe(true);
            expect(LEAF_WORK_ITEM_TYPES.has('goal')).toBe(true);
            expect(LEAF_WORK_ITEM_TYPES.has('epic')).toBe(false);
            expect(LEAF_WORK_ITEM_TYPES.has('feature')).toBe(false);
            expect(LEAF_WORK_ITEM_TYPES.has('pbi')).toBe(false);
        });

        it('ALLOWED_PARENT_TYPES defines correct hierarchy', () => {
            expect(ALLOWED_PARENT_TYPES.epic).toEqual([]);
            expect(ALLOWED_PARENT_TYPES.feature).toEqual(['epic']);
            expect(ALLOWED_PARENT_TYPES.pbi).toEqual(['feature']);
            expect(ALLOWED_PARENT_TYPES['work-item']).toEqual(['pbi']);
            expect(ALLOWED_PARENT_TYPES.bug).toEqual(['pbi']);
            expect(ALLOWED_PARENT_TYPES.goal).toEqual(['pbi']);
        });

        it('ALLOWED_CHILD_TYPES defines correct hierarchy', () => {
            expect(ALLOWED_CHILD_TYPES.epic).toEqual(['feature']);
            expect(ALLOWED_CHILD_TYPES.feature).toEqual(['pbi']);
            expect(ALLOWED_CHILD_TYPES.pbi).toContain('work-item');
            expect(ALLOWED_CHILD_TYPES.pbi).toContain('bug');
            expect(ALLOWED_CHILD_TYPES.pbi).toContain('goal');
            expect(ALLOWED_CHILD_TYPES['work-item']).toEqual([]);
            expect(ALLOWED_CHILD_TYPES.bug).toEqual([]);
            expect(ALLOWED_CHILD_TYPES.goal).toEqual([]);
        });
    });

    describe('getEffectiveType', () => {
        it('returns work-item for undefined (existing data compat)', () => {
            expect(getEffectiveType(undefined)).toBe('work-item');
        });

        it('returns the type when provided', () => {
            const types: WorkItemType[] = ['work-item', 'bug', 'goal', 'epic', 'feature', 'pbi'];
            for (const t of types) {
                expect(getEffectiveType(t)).toBe(t);
            }
        });
    });

    describe('isContainerType', () => {
        it('returns true for container types', () => {
            expect(isContainerType('epic')).toBe(true);
            expect(isContainerType('feature')).toBe(true);
            expect(isContainerType('pbi')).toBe(true);
        });

        it('returns false for leaf types', () => {
            expect(isContainerType('work-item')).toBe(false);
            expect(isContainerType('bug')).toBe(false);
            expect(isContainerType('goal')).toBe(false);
        });
    });

    describe('isLeafType', () => {
        it('returns true for leaf types', () => {
            expect(isLeafType('work-item')).toBe(true);
            expect(isLeafType('bug')).toBe(true);
            expect(isLeafType('goal')).toBe(true);
        });

        it('returns false for container types', () => {
            expect(isLeafType('epic')).toBe(false);
            expect(isLeafType('feature')).toBe(false);
            expect(isLeafType('pbi')).toBe(false);
        });
    });

    describe('isValidParentChildTypes', () => {
        it('allows feature under epic', () => {
            expect(isValidParentChildTypes('feature', 'epic')).toBe(true);
        });

        it('allows pbi under feature', () => {
            expect(isValidParentChildTypes('pbi', 'feature')).toBe(true);
        });

        it('allows work-item under pbi', () => {
            expect(isValidParentChildTypes('work-item', 'pbi')).toBe(true);
        });

        it('allows bug under pbi', () => {
            expect(isValidParentChildTypes('bug', 'pbi')).toBe(true);
        });

        it('allows goal under pbi', () => {
            expect(isValidParentChildTypes('goal', 'pbi')).toBe(true);
        });

        it('rejects goal under epic (skip levels)', () => {
            expect(isValidParentChildTypes('goal', 'epic')).toBe(false);
        });

        it('rejects skipped levels (work-item under epic)', () => {
            expect(isValidParentChildTypes('work-item', 'epic')).toBe(false);
        });

        it('rejects skipped levels (bug under feature)', () => {
            expect(isValidParentChildTypes('bug', 'feature')).toBe(false);
        });

        it('rejects pbi under epic (skip feature)', () => {
            expect(isValidParentChildTypes('pbi', 'epic')).toBe(false);
        });

        it('rejects epic having any parent', () => {
            const types: WorkItemType[] = ['work-item', 'bug', 'goal', 'epic', 'feature', 'pbi'];
            for (const t of types) {
                expect(isValidParentChildTypes('epic', t)).toBe(false);
            }
        });

        it('rejects leaf items as parents', () => {
            expect(isValidParentChildTypes('work-item', 'bug')).toBe(false);
            expect(isValidParentChildTypes('bug', 'work-item')).toBe(false);
        });
    });
});
