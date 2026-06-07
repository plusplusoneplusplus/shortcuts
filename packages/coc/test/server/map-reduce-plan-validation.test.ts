import { describe, expect, it } from 'vitest';
import {
    assertMapReduceDraftStatuses,
    createPendingMapReduceReduceStep,
    normalizeMapReduceMaxParallel,
    normalizeMapReducePlan,
    normalizeMapReducePlanItems,
    normalizeMapReduceReduceInstructions,
    normalizeMapReduceReduceStep,
    validateMapReduceDraftPlan,
} from '../../src/server/map-reduce/map-reduce-plan-validation';
import { DEFAULT_MAP_REDUCE_MAX_PARALLEL } from '../../src/server/map-reduce/types';
import type { MapReduceItem } from '../../src/server/map-reduce/types';

function item(overrides: Partial<MapReduceItem> = {}): MapReduceItem {
    return {
        id: 'item-1',
        title: 'Map item',
        prompt: 'Do the map work.',
        status: 'pending',
        ...overrides,
    };
}

describe('map-reduce plan validation', () => {
    it('normalizes draft plans with maxParallel and reduceInstructions', () => {
        const plan = normalizeMapReducePlan({
            maxParallel: 4,
            reduceInstructions: '  Summarize every map result.  ',
            items: [
                {
                    id: ' item-1 ',
                    title: ' First item ',
                    prompt: ' Do first work. ',
                    status: 'pending',
                    metadata: { area: 'server' },
                    childTaskId: ' task-old ',
                },
                {
                    id: 'item-2',
                    title: 'Second item',
                    prompt: 'Do second work.',
                    dependsOn: [' item-1 '],
                    status: 'pending',
                },
            ],
        });

        expect(plan.maxParallel).toBe(4);
        expect(plan.reduceInstructions).toBe('Summarize every map result.');
        expect(plan.items).toEqual([
            {
                id: 'item-1',
                title: 'First item',
                prompt: 'Do first work.',
                status: 'pending',
                metadata: { area: 'server' },
                childTaskId: 'task-old',
            },
            {
                id: 'item-2',
                title: 'Second item',
                prompt: 'Do second work.',
                dependsOn: ['item-1'],
                status: 'pending',
            },
        ]);
    });

    it('defaults maxParallel to the Map Reduce concurrency default', () => {
        expect(normalizeMapReduceMaxParallel(undefined)).toBe(DEFAULT_MAP_REDUCE_MAX_PARALLEL);
    });

    it('rejects invalid maxParallel values', () => {
        expect(() => normalizeMapReduceMaxParallel(0)).toThrow(/positive integer/i);
        expect(() => normalizeMapReduceMaxParallel(1.5)).toThrow(/positive integer/i);
        expect(() => normalizeMapReduceMaxParallel('3')).toThrow(/positive integer/i);
    });

    it('requires non-empty reduceInstructions', () => {
        expect(normalizeMapReduceReduceInstructions(' Combine the results. ')).toBe('Combine the results.');
        expect(() => normalizeMapReduceReduceInstructions('   ')).toThrow(/reduceInstructions is required/i);
        expect(() => normalizeMapReduceReduceInstructions(undefined)).toThrow(/reduceInstructions is required/i);
    });

    it('normalizes and validates reduce step state', () => {
        expect(createPendingMapReduceReduceStep()).toEqual({ status: 'pending' });
        expect(normalizeMapReduceReduceStep(undefined)).toEqual({ status: 'pending' });
        expect(normalizeMapReduceReduceStep({
            status: 'running',
            childTaskId: ' task-1 ',
            childProcessId: ' queue_task-1 ',
            startedAt: ' now ',
            error: '',
        })).toEqual({
            status: 'running',
            childTaskId: 'task-1',
            childProcessId: 'queue_task-1',
            startedAt: 'now',
        });
        expect(() => normalizeMapReduceReduceStep({ status: 'skipped' })).toThrow(/reduceStep.status/i);
    });

    it('requires draft item statuses and a pending reduce step', () => {
        expect(() => assertMapReduceDraftStatuses([item({ status: 'running' })])).toThrow(/initial status 'pending'/i);
        expect(() => assertMapReduceDraftStatuses([item()], { status: 'failed' })).toThrow(/reduce step must have initial status 'pending'/i);
    });

    it('rejects malformed item plans', () => {
        expect(() => normalizeMapReducePlanItems([])).toThrow(/non-empty items array/i);
        expect(() => normalizeMapReducePlanItems([item({ id: 'bad/id' })])).toThrow(/may only contain/i);
        expect(() => normalizeMapReducePlanItems([item(), item({ id: 'item-1' })])).toThrow(/duplicate map reduce item id/i);
        expect(() => normalizeMapReducePlanItems([item({ dependsOn: ['missing'] })])).toThrow(/unknown item/i);
        expect(() => normalizeMapReducePlanItems([item({ dependsOn: ['item-1'] })])).toThrow(/cannot depend on itself/i);
        expect(() => normalizeMapReducePlanItems([
            item({ id: 'item-1', dependsOn: ['item-2'] }),
            item({ id: 'item-2', dependsOn: ['item-1'] }),
        ])).toThrow(/dependency cycle/i);
    });

    it('returns validation errors without throwing from validateMapReduceDraftPlan', () => {
        expect(validateMapReduceDraftPlan({
            reduceInstructions: 'Combine results.',
            items: [item()],
        })).toMatchObject({
            plan: {
                maxParallel: DEFAULT_MAP_REDUCE_MAX_PARALLEL,
                reduceInstructions: 'Combine results.',
            },
            error: null,
        });

        const invalid = validateMapReduceDraftPlan({
            reduceInstructions: '',
            items: [item()],
        });
        expect(invalid.plan).toBeNull();
        expect(invalid.error).toMatch(/reduceInstructions is required/i);
    });
});
