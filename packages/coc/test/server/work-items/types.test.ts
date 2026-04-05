import { describe, it, expect } from 'vitest';
import {
    WORK_ITEM_STATUSES,
    TERMINAL_WORK_ITEM_STATUSES,
    VALID_TRANSITIONS,
    isTerminalStatus,
    isValidTransition,
    toIndexEntry,
} from '../../../src/server/work-items/types';
import type {
    WorkItem,
    WorkItemStatus,
    WorkItemIndexEntry,
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
                'created', 'planning', 'readyToExecute', 'executing', 'aiDone', 'aiFailed', 'done', 'failed',
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
    });

    describe('isValidTransition', () => {
        it('allows created → planning', () => {
            expect(isValidTransition('created', 'planning')).toBe(true);
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

            expect(entry).toEqual<WorkItemIndexEntry>({
                id: 'wi-001',
                repoId: 'repo-1',
                title: 'Test work item',
                status: 'created',
                source: 'manual',
                priority: 'high',
                planVersion: 3,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                completedAt: undefined,
                tags: ['backend', 'auth'],
            });
        });

        it('handles work item without optional fields', () => {
            const item = makeWorkItem();
            const entry = toIndexEntry(item);

            expect(entry.planVersion).toBeUndefined();
            expect(entry.priority).toBeUndefined();
            expect(entry.tags).toBeUndefined();
            expect(entry.completedAt).toBeUndefined();
        });

        it('does not include full description or execution history', () => {
            const item = makeWorkItem({
                description: 'A very long description...',
                executionHistory: [{ taskId: 't-1', startedAt: '2026-01-01T00:00:00.000Z', status: 'completed' }],
            });

            const entry = toIndexEntry(item);
            expect(entry).not.toHaveProperty('description');
            expect(entry).not.toHaveProperty('executionHistory');
        });
    });
});
