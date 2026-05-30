import { describe, it, expect } from 'vitest';
import { ALLOWED_PARENT_TYPES, ALLOWED_CHILD_TYPES } from '../../src/contracts/work-items';

const ALL_TYPES = ['epic', 'feature', 'pbi', 'work-item', 'bug', 'goal'] as const;

describe('work item hierarchy constants', () => {
    describe('ALLOWED_PARENT_TYPES', () => {
        it('covers all work item types', () => {
            for (const type of ALL_TYPES) {
                expect(ALLOWED_PARENT_TYPES).toHaveProperty(type);
            }
        });

        it('epics have no parent', () => {
            expect(ALLOWED_PARENT_TYPES['epic']).toEqual([]);
        });

        it('features can only be parented under epics', () => {
            expect(ALLOWED_PARENT_TYPES['feature']).toEqual(['epic']);
        });

        it('pbis can only be parented under features', () => {
            expect(ALLOWED_PARENT_TYPES['pbi']).toEqual(['feature']);
        });

        it('work-items can only be parented under pbis', () => {
            expect(ALLOWED_PARENT_TYPES['work-item']).toEqual(['pbi']);
        });

        it('bugs can only be parented under pbis', () => {
            expect(ALLOWED_PARENT_TYPES['bug']).toEqual(['pbi']);
        });

        it('goals can only be parented under pbis', () => {
            expect(ALLOWED_PARENT_TYPES['goal']).toEqual(['pbi']);
        });

        it('all values are readonly arrays', () => {
            for (const type of ALL_TYPES) {
                expect(Array.isArray(ALLOWED_PARENT_TYPES[type])).toBe(true);
            }
        });
    });

    describe('ALLOWED_CHILD_TYPES', () => {
        it('covers all work item types', () => {
            for (const type of ALL_TYPES) {
                expect(ALLOWED_CHILD_TYPES).toHaveProperty(type);
            }
        });

        it('epics contain features as children', () => {
            expect(ALLOWED_CHILD_TYPES['epic']).toEqual(['feature']);
        });

        it('features contain pbis as children', () => {
            expect(ALLOWED_CHILD_TYPES['feature']).toEqual(['pbi']);
        });

        it('pbis contain work-items, bugs, and goals as children', () => {
            expect(ALLOWED_CHILD_TYPES['pbi']).toEqual(['work-item', 'bug', 'goal']);
        });

        it('work-items have no children', () => {
            expect(ALLOWED_CHILD_TYPES['work-item']).toEqual([]);
        });

        it('bugs have no children', () => {
            expect(ALLOWED_CHILD_TYPES['bug']).toEqual([]);
        });

        it('goals have no children', () => {
            expect(ALLOWED_CHILD_TYPES['goal']).toEqual([]);
        });

        it('all values are readonly arrays', () => {
            for (const type of ALL_TYPES) {
                expect(Array.isArray(ALLOWED_CHILD_TYPES[type])).toBe(true);
            }
        });
    });

    describe('parent/child consistency', () => {
        it('parent and child relationships are inverses of each other', () => {
            for (const parentType of ALL_TYPES) {
                const children = ALLOWED_CHILD_TYPES[parentType];
                for (const childType of children) {
                    expect(ALLOWED_PARENT_TYPES[childType]).toContain(parentType);
                }
            }
        });
    });
});
