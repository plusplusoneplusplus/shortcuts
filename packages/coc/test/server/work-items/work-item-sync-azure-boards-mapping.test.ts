import { describe, expect, it } from 'vitest';
import {
    formatAzureBoardsTags,
    mapAzureBoardsPriorityToWorkItemPriority,
    mapAzureBoardsStateToWorkItemStatus,
    mapAzureBoardsTypeToCocWorkItemType,
    mapCocWorkItemTypeToAzureBoardsType,
    mapWorkItemPriorityToAzureBoardsPriority,
    mapWorkItemStatusToAzureBoardsState,
    parseAzureBoardsTags,
} from '../../../src/server/work-items/work-item-sync-azure-boards-mapping';
import type { WorkItemType } from '../../../src/server/work-items/types';

describe('Azure Boards work item field mapping', () => {
    it('maps every CoC work item type to the default Azure Boards type', () => {
        const cases: Array<[WorkItemType, string, string[]]> = [
            ['epic', 'Epic', []],
            ['feature', 'Feature', []],
            ['pbi', 'Product Backlog Item', []],
            ['work-item', 'Task', []],
            ['bug', 'Bug', []],
            ['goal', 'Task', ['coc:type:goal']],
        ];

        for (const [type, workItemType, tags] of cases) {
            expect(mapCocWorkItemTypeToAzureBoardsType({ type })).toEqual({
                workItemType,
                tags,
            });
        }
    });

    it('uses User Story for PBI when Product Backlog Item is unavailable', () => {
        expect(mapCocWorkItemTypeToAzureBoardsType({
            type: 'pbi',
            availableTypes: ['Epic', 'Feature', 'User Story', 'Task', 'Bug'],
        })).toEqual({
            workItemType: 'User Story',
            tags: [],
        });
    });

    it('stores only CoC-owned goal metadata in Azure tags and removes stale type markers', () => {
        expect(mapCocWorkItemTypeToAzureBoardsType({
            type: 'goal',
            tags: ['customer-visible', 'coc:type:bug', 'Customer-Visible'],
        })).toEqual({
            workItemType: 'Task',
            tags: ['customer-visible', 'coc:type:goal'],
        });
    });

    it('maps native Azure Boards types and goal metadata back to CoC types', () => {
        expect(mapAzureBoardsTypeToCocWorkItemType('Epic')).toEqual({ type: 'epic', tags: [] });
        expect(mapAzureBoardsTypeToCocWorkItemType('Feature')).toEqual({ type: 'feature', tags: [] });
        expect(mapAzureBoardsTypeToCocWorkItemType('Product Backlog Item')).toEqual({ type: 'pbi', tags: [] });
        expect(mapAzureBoardsTypeToCocWorkItemType('User Story')).toEqual({ type: 'pbi', tags: [] });
        expect(mapAzureBoardsTypeToCocWorkItemType('Bug')).toEqual({ type: 'bug', tags: [] });
        expect(mapAzureBoardsTypeToCocWorkItemType('Task', 'customer; coc:type:goal')).toEqual({
            type: 'goal',
            tags: ['customer'],
        });
    });

    it('preserves unknown Azure Boards types as local tags', () => {
        expect(mapAzureBoardsTypeToCocWorkItemType('Risk', 'customer')).toEqual({
            type: 'work-item',
            tags: ['customer', 'azure:type:Risk'],
        });
    });

    it('maps common Azure Boards states and preserves unknown remote states exactly', () => {
        expect(mapAzureBoardsStateToWorkItemStatus('New')).toBe('created');
        expect(mapAzureBoardsStateToWorkItemStatus('Committed')).toBe('readyToExecute');
        expect(mapAzureBoardsStateToWorkItemStatus('Active')).toBe('executing');
        expect(mapAzureBoardsStateToWorkItemStatus('Resolved')).toBe('aiDone');
        expect(mapAzureBoardsStateToWorkItemStatus('Closed')).toBe('done');
        expect(mapAzureBoardsStateToWorkItemStatus('Removed')).toBe('failed');
        expect(mapAzureBoardsStateToWorkItemStatus('Blocked by dependency')).toBe('Blocked by dependency');
        expect(mapAzureBoardsStateToWorkItemStatus('   ')).toBe('created');
    });

    it('maps CoC statuses to Azure Boards states and leaves unknown local statuses intact', () => {
        expect(mapWorkItemStatusToAzureBoardsState('created')).toBe('New');
        expect(mapWorkItemStatusToAzureBoardsState('drafting')).toBe('New');
        expect(mapWorkItemStatusToAzureBoardsState('planning')).toBe('New');
        expect(mapWorkItemStatusToAzureBoardsState('readyToExecute')).toBe('Active');
        expect(mapWorkItemStatusToAzureBoardsState('executing')).toBe('Active');
        expect(mapWorkItemStatusToAzureBoardsState('aiDone')).toBe('Resolved');
        expect(mapWorkItemStatusToAzureBoardsState('aiFailed')).toBe('Active');
        expect(mapWorkItemStatusToAzureBoardsState('done')).toBe('Closed');
        expect(mapWorkItemStatusToAzureBoardsState('failed')).toBe('Removed');
        expect(mapWorkItemStatusToAzureBoardsState('Blocked by dependency')).toBe('Blocked by dependency');
        expect(mapWorkItemStatusToAzureBoardsState(undefined)).toBe('New');
    });

    it('maps priority values both ways and preserves unknown Azure values as metadata tags', () => {
        expect(mapWorkItemPriorityToAzureBoardsPriority('high')).toBe(1);
        expect(mapWorkItemPriorityToAzureBoardsPriority('normal')).toBe(2);
        expect(mapWorkItemPriorityToAzureBoardsPriority('low')).toBe(3);
        expect(mapWorkItemPriorityToAzureBoardsPriority(undefined)).toBe(2);

        expect(mapAzureBoardsPriorityToWorkItemPriority(1)).toEqual({ priority: 'high', tags: [] });
        expect(mapAzureBoardsPriorityToWorkItemPriority('2')).toEqual({ priority: 'normal', tags: [] });
        expect(mapAzureBoardsPriorityToWorkItemPriority('Low')).toEqual({ priority: 'low', tags: [] });
        expect(mapAzureBoardsPriorityToWorkItemPriority('Critical Path')).toEqual({
            tags: ['azure:priority:Critical Path'],
        });
    });

    it('parses, de-duplicates, and formats Azure Boards semicolon tags deterministically', () => {
        expect(parseAzureBoardsTags(' customer ; Backend; customer ; ; backend ')).toEqual([
            'customer',
            'Backend',
        ]);
        expect(formatAzureBoardsTags(['customer', 'Backend', 'customer'])).toBe('customer; Backend');
        expect(formatAzureBoardsTags([])).toBeUndefined();
    });
});
