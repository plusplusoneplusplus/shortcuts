/**
 * Create/Update Work Item Tool Tests
 *
 * Unit tests for the createCreateUpdateWorkItemTool factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// Mock FileWorkItemStore before importing the tool
const mockAddWorkItem = vi.fn();
const mockGetWorkItem = vi.fn();
const mockListWorkItems = vi.fn();
const mockUpdateWorkItem = vi.fn();
const mockSavePlanVersion = vi.fn();
const mockAddChange = vi.fn();
vi.mock('../../src/server/work-items/work-item-store', function () { return ({
    FileWorkItemStore: vi.fn().mockImplementation(function () { return ({
        addWorkItem: mockAddWorkItem,
        getWorkItem: mockGetWorkItem,
        listWorkItems: mockListWorkItems,
        updateWorkItem: mockUpdateWorkItem,
        savePlanVersion: mockSavePlanVersion,
        addChange: mockAddChange,
    }); }),
    createWorkItemStore: vi.fn(() => ({
        addWorkItem: mockAddWorkItem,
        getWorkItem: mockGetWorkItem,
        listWorkItems: mockListWorkItems,
        updateWorkItem: mockUpdateWorkItem,
        savePlanVersion: mockSavePlanVersion,
        addChange: mockAddChange,
    })),
}); });

import { createCreateUpdateWorkItemTool } from '../../src/server/llm-tools/create-update-work-item-tool';

const EXISTING_ITEM = {
    id: 'item-uuid-1',
    workItemNumber: 7,
    repoId: 'test-repo-123',
    title: 'Existing work item',
    description: 'Old description',
    status: 'readyToExecute' as const,
    source: 'manual' as const,
    priority: 'normal' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    plan: { version: 1, content: 'Old plan', updatedAt: '2024-01-01T00:00:00.000Z' },
};

describe('createCreateUpdateWorkItemTool', () => {
    const dataDir = path.join(os.tmpdir(), 'coc-test-create-update-work-item-tool');
    const repoId = 'test-repo-123';

    beforeEach(() => {
        mockAddWorkItem.mockReset();
        mockAddWorkItem.mockResolvedValue(undefined);
        mockGetWorkItem.mockReset();
        mockGetWorkItem.mockResolvedValue({ ...EXISTING_ITEM });
        mockListWorkItems.mockReset();
        mockListWorkItems.mockResolvedValue({
            items: [{ id: EXISTING_ITEM.id, workItemNumber: EXISTING_ITEM.workItemNumber, repoId }],
            total: 1,
        });
        mockUpdateWorkItem.mockReset();
        mockUpdateWorkItem.mockResolvedValue({
            ...EXISTING_ITEM,
            status: 'planning',
            plan: { version: 2, content: '## Objective\n\nNew plan.', updatedAt: new Date().toISOString() },
        });
        mockSavePlanVersion.mockReset();
        mockSavePlanVersion.mockResolvedValue(undefined);
        mockAddChange.mockReset();
        mockAddChange.mockResolvedValue(undefined);
    });

    it('returns an object with a tool property', () => {
        const result = createCreateUpdateWorkItemTool(dataDir, repoId);
        expect(result).toHaveProperty('tool');
        expect(result.tool).toBeDefined();
    });

    it('tool has name "create_update_work_item"', () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);
        expect(tool.name).toBe('create_update_work_item');
    });

    it('does not expose the legacy create_work_item tool name', () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);
        expect(tool.name).not.toBe('create_work_item');
    });

    it('has description, parameters, and handler properties', () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);
        expect(typeof tool.description).toBe('string');
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.handler).toBe('function');
    });

    it('parameters support create fields and existing work item targets', () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);
        const params = tool.parameters as Record<string, any>;
        expect(params.required).toEqual([]);
        expect(params.properties.title.type).toBe('string');
        expect(params.properties.description).toBeDefined();
        expect(params.properties.priority.enum).toEqual(['high', 'normal', 'low']);
        expect(params.properties.tags.type).toBe('array');
        expect(params.properties.plan.type).toBe('string');
        expect(params.properties.type.enum).toEqual(['work-item', 'bug', 'goal', 'epic', 'feature', 'pbi']);
        expect(params.properties.workItemId.type).toBe('string');
        expect(params.properties.target.type).toBe('string');
        expect(params.properties.workItemNumber).toBeDefined();
    });

    it('create mode creates a work item with correct minimal args when no target is supplied', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ title: 'Fix login bug' });

        expect(mockAddWorkItem).toHaveBeenCalledOnce();
        expect(mockGetWorkItem).not.toHaveBeenCalled();
        expect(mockUpdateWorkItem).not.toHaveBeenCalled();
        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.title).toBe('Fix login bug');
        expect(callArg.repoId).toBe(repoId);
        expect(callArg.status).toBe('created');
        expect(callArg.type).toBe('work-item');
        expect(callArg.source).toBe('chat');
        expect(callArg.priority).toBe('normal');
        expect(callArg.description).toBe('');
        expect(typeof callArg.id).toBe('string');
        expect(typeof callArg.createdAt).toBe('string');

        expect(result).toMatchObject({ created: true, title: 'Fix login bug' });
        expect(typeof (result as any).id).toBe('string');
    });

    it('create mode passes through description, priority, and tags', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        await tool.handler({
            title: 'New feature',
            description: 'Add dark mode support',
            priority: 'high',
            tags: ['ui', 'accessibility'],
        });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.description).toBe('Add dark mode support');
        expect(callArg.priority).toBe('high');
        expect(callArg.tags).toEqual(['ui', 'accessibility']);
    });

    it('create mode returns an error when title is missing', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({});

        expect(result).toMatchObject({ created: false });
        expect((result as any).error).toContain('title');
        expect(mockAddWorkItem).not.toHaveBeenCalled();
    });

    it('create mode creates item with status "planning" and initial plan version when plan is provided', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);
        await tool.handler({ title: 'Planned item', plan: '## Objective\n\nBuild the feature.' });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.status).toBe('planning');
        expect(callArg.plan).toBeDefined();
        expect(callArg.plan.version).toBe(1);
        expect(callArg.plan.content).toBe('## Objective\n\nBuild the feature.');
        expect(callArg.plan.resolvedBy).toBe('ai');

        expect(mockSavePlanVersion).toHaveBeenCalledOnce();
        const pvArg = mockSavePlanVersion.mock.calls[0][1];
        expect(pvArg.version).toBe(1);
        expect(pvArg.content).toBe('## Objective\n\nBuild the feature.');
        expect(pvArg.resolvedBy).toBe('ai');
        expect(pvArg.summary).toBe('Initial plan from chat');
    });

    it('create mode treats a whitespace-only plan as absent', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);
        await tool.handler({ title: 'Whitespace plan', plan: '   ' });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.status).toBe('created');
        expect(callArg.plan).toBeUndefined();
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
    });

    it('create mode accepts every supported work item type', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);
        const types = ['work-item', 'bug', 'goal', 'epic', 'feature', 'pbi'] as const;

        for (const type of types) {
            await tool.handler({ title: `Create ${type}`, type });
        }

        expect(mockAddWorkItem).toHaveBeenCalledTimes(types.length);
        expect(mockAddWorkItem.mock.calls.map(call => call[0].type)).toEqual(types);
    });

    it('create mode rejects unsupported work item types', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ title: 'Unsupported type', type: 'incident' } as any);

        expect(result).toMatchObject({ created: false });
        expect((result as any).error).toContain('Unsupported work item type');
        expect(mockAddWorkItem).not.toHaveBeenCalled();
    });

    it('create mode creates a bug without a plan as a created chat work item', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        await tool.handler({
            title: 'Crash on empty input',
            type: 'bug',
            description: 'The input handler crashes when the field is empty.',
            tags: ['regression'],
        });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.type).toBe('bug');
        expect(callArg.status).toBe('created');
        expect(callArg.source).toBe('chat');
        expect(callArg.priority).toBe('normal');
        expect(callArg.description).toBe('The input handler crashes when the field is empty.');
        expect(callArg.tags).toEqual(['regression']);
        expect(callArg.plan).toBeUndefined();
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
    });

    it('create mode creates a bug with a plan as planning and saves plan version 1', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        await tool.handler({
            title: 'Crash with plan',
            type: 'bug',
            plan: '## Objective\n\nFix the crash.',
        });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.type).toBe('bug');
        expect(callArg.status).toBe('planning');
        expect(callArg.plan.version).toBe(1);
        expect(callArg.plan.content).toBe('## Objective\n\nFix the crash.');
        expect(mockSavePlanVersion).toHaveBeenCalledOnce();
        expect(mockSavePlanVersion.mock.calls[0][1]).toMatchObject({
            version: 1,
            content: '## Objective\n\nFix the crash.',
            summary: 'Initial plan from chat',
        });
    });

    it('create mode broadcasts work-item-added when broadcastFn is provided', async () => {
        const broadcast = vi.fn();
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId, broadcast);

        await tool.handler({ title: 'Broadcasted item' });

        expect(broadcast).toHaveBeenCalledOnce();
        const broadcastArg = broadcast.mock.calls[0][0];
        expect(broadcastArg.type).toBe('work-item-added');
        expect(broadcastArg.workspaceId).toBe(repoId);
        expect((broadcastArg.item as any).title).toBe('Broadcasted item');
    });

    it('update-plan mode resolves an existing item by UUID and saves the next plan version', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        await tool.handler({ workItemId: EXISTING_ITEM.id, plan: '## Objective\n\nNew plan.' });

        expect(mockGetWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, repoId);
        expect(mockSavePlanVersion).toHaveBeenCalledOnce();
        expect(mockUpdateWorkItem).toHaveBeenCalledOnce();
        expect(mockAddChange).toHaveBeenCalledOnce();

        const pvArg = mockSavePlanVersion.mock.calls[0][1];
        expect(pvArg.version).toBe(2);
        expect(pvArg.content).toBe('## Objective\n\nNew plan.');
        expect(pvArg.resolvedBy).toBe('ai');
        expect(pvArg.summary).toBe('Plan updated from chat (v2)');

        const patch = mockUpdateWorkItem.mock.calls[0][1];
        expect(patch.status).toBe('planning');
        expect(patch.plan.version).toBe(2);
        expect(patch.plan.content).toBe('## Objective\n\nNew plan.');
        expect(patch.plan.resolvedBy).toBe('ai');

        const changeArg = mockAddChange.mock.calls[0][1];
        expect(changeArg.planVersion).toBe(2);
        expect(changeArg.status).toBe('open');
        expect(changeArg.commits).toEqual([]);

        expect(mockSavePlanVersion.mock.invocationCallOrder[0]).toBeLessThan(mockUpdateWorkItem.mock.invocationCallOrder[0]);
        expect(mockUpdateWorkItem.mock.invocationCallOrder[0]).toBeLessThan(mockAddChange.mock.invocationCallOrder[0]);
    });

    it('update-plan mode resolves an existing item by WI-N target', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        await tool.handler({ target: 'WI-7', plan: '## Objective\n\nNew plan.' });

        expect(mockListWorkItems).toHaveBeenCalledWith({ repoId });
        expect(mockGetWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, repoId);
        expect(mockUpdateWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, expect.any(Object), repoId);
    });

    it('update-plan mode resolves an existing item by workItemNumber', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        await tool.handler({ workItemNumber: 7, plan: '## Objective\n\nNew plan.' });

        expect(mockListWorkItems).toHaveBeenCalledWith({ repoId });
        expect(mockGetWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, repoId);
        expect(mockUpdateWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, expect.any(Object), repoId);
    });

    it('update-plan mode returns an error when the target is not found', async () => {
        mockGetWorkItem.mockResolvedValue(undefined);
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ workItemId: 'missing-id', plan: '## Objective\n\nNew plan.' });

        expect(result).toMatchObject({ updated: false });
        expect((result as any).error).toContain('missing-id');
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
        expect(mockUpdateWorkItem).not.toHaveBeenCalled();
    });

    it('update mode rejects a no-op when no patch fields or plan are supplied', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ workItemId: EXISTING_ITEM.id });

        expect(result).toMatchObject({ updated: false, id: EXISTING_ITEM.id });
        expect((result as any).error).toContain('No update requested');
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
        expect(mockUpdateWorkItem).not.toHaveBeenCalled();
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it('update-plan mode rejects a blank plan', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ workItemId: EXISTING_ITEM.id, plan: '   ' });

        expect(result).toMatchObject({ updated: false, id: EXISTING_ITEM.id });
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
        expect(mockUpdateWorkItem).not.toHaveBeenCalled();
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it('field-only update patches common fields while preserving status and plan history', async () => {
        mockUpdateWorkItem.mockImplementation(async (_id, patch) => ({ ...EXISTING_ITEM, ...patch }));
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({
            workItemId: EXISTING_ITEM.id,
            title: 'Renamed work item',
            description: '',
            priority: 'high',
            tags: ['triaged', 'chat'],
        });

        expect(mockUpdateWorkItem).toHaveBeenCalledOnce();
        expect(mockUpdateWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, {
            title: 'Renamed work item',
            description: '',
            priority: 'high',
            tags: ['triaged', 'chat'],
        }, repoId);
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
        expect(mockAddChange).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            updated: true,
            id: EXISTING_ITEM.id,
            title: 'Renamed work item',
            status: 'readyToExecute',
            planVersion: 1,
        });
    });

    it('field-only update patches an existing bug', async () => {
        const existingBug = { ...EXISTING_ITEM, type: 'bug' as const, title: 'Existing bug' };
        mockGetWorkItem.mockResolvedValue(existingBug);
        mockUpdateWorkItem.mockImplementation(async (_id, patch) => ({ ...existingBug, ...patch }));
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        await tool.handler({
            workItemId: EXISTING_ITEM.id,
            type: 'bug',
            description: 'Updated bug details',
            priority: 'low',
        });

        expect(mockUpdateWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, {
            description: 'Updated bug details',
            priority: 'low',
        }, repoId);
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it('field-only update broadcasts work-item-updated without creating a change record', async () => {
        mockUpdateWorkItem.mockImplementation(async (_id, patch) => ({ ...EXISTING_ITEM, ...patch }));
        const broadcast = vi.fn();
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId, broadcast);

        await tool.handler({ workItemId: EXISTING_ITEM.id, priority: 'high' });

        expect(mockAddChange).not.toHaveBeenCalled();
        expect(broadcast).toHaveBeenCalledOnce();
        expect(broadcast.mock.calls[0][0]).toMatchObject({
            type: 'work-item-updated',
            workspaceId: repoId,
        });
    });

    it('update mode rejects type mismatch without changing the item', async () => {
        mockGetWorkItem.mockResolvedValue({ ...EXISTING_ITEM, type: 'bug' });
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({
            workItemId: EXISTING_ITEM.id,
            type: 'work-item',
            priority: 'high',
        });

        expect(result).toMatchObject({ updated: false, id: EXISTING_ITEM.id });
        expect((result as any).error).toContain('Cannot change work item type');
        expect(mockUpdateWorkItem).not.toHaveBeenCalled();
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it('update mode rejects unsupported validation type values', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({
            workItemId: EXISTING_ITEM.id,
            type: 'incident',
            priority: 'high',
        } as any);

        expect(result).toMatchObject({ updated: false, id: EXISTING_ITEM.id });
        expect((result as any).error).toContain('Unsupported work item type');
        expect(mockUpdateWorkItem).not.toHaveBeenCalled();
    });

    it('update-plan mode broadcasts work-item-updated when broadcastFn is provided', async () => {
        const broadcast = vi.fn();
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId, broadcast);

        await tool.handler({ workItemId: EXISTING_ITEM.id, plan: '## Objective\n\nNew plan.' });

        expect(broadcast).toHaveBeenCalledOnce();
        const eventArg = broadcast.mock.calls[0][0];
        expect(eventArg.type).toBe('work-item-updated');
        expect(eventArg.workspaceId).toBe(repoId);
        expect(eventArg.item).toBeDefined();
    });

    it('normalizes plan-template content from description in update-plan mode', async () => {
        const descWithPlan = '## Objective\n\nBuild X.\n\n## Steps\n\n- [ ] Do it';
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        await tool.handler({ workItemId: EXISTING_ITEM.id, description: descWithPlan });

        const patch = mockUpdateWorkItem.mock.calls[0][1];
        expect(patch.plan.content).toBe(descWithPlan);
    });

    it('parameters expose hierarchy link fields', () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);
        const params = tool.parameters as Record<string, any>;
        expect(params.properties.parentId).toBeDefined();
        expect(params.properties.parentTarget.type).toBe('string');
        expect(params.properties.parentWorkItemNumber).toBeDefined();
    });

    it('tool description mentions hierarchy linking, moving, and unlinking', () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);
        expect(tool.description).toContain('parentId');
        expect(tool.description).toContain('parentTarget');
        expect(tool.description).toContain('unlink');
        expect(tool.description).toContain('parentId: null');
    });

    it('create mode stores parentId when a valid parent is supplied', async () => {
        const pbi = { ...EXISTING_ITEM, id: 'pbi-uuid', type: 'pbi' as const, title: 'Parent PBI' };
        mockGetWorkItem.mockImplementation(async (id: string) => (id === 'pbi-uuid' ? pbi : undefined));
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ title: 'Child item', parentId: 'pbi-uuid' });

        expect(result).toMatchObject({
            created: true,
            parentId: 'pbi-uuid',
            parentTitle: 'Parent PBI',
        });
        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.parentId).toBe('pbi-uuid');
        expect(callArg.source).toBe('chat');
    });

    it('create mode rejects a missing parent without writing the item', async () => {
        mockGetWorkItem.mockResolvedValue(undefined);
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ title: 'Child item', parentId: 'missing-parent' });

        expect(result).toMatchObject({ created: false });
        expect((result as any).error).toContain('Parent work item not found');
        expect(mockAddWorkItem).not.toHaveBeenCalled();
    });

    it('update mode unlinks the parent with parentId: null', async () => {
        const linked = { ...EXISTING_ITEM, parentId: 'pbi-uuid' };
        mockGetWorkItem.mockResolvedValue(linked);
        mockUpdateWorkItem.mockImplementation(async (_id, patch) => ({ ...linked, ...patch }));
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ workItemId: EXISTING_ITEM.id, parentId: null });

        expect(result).toMatchObject({ updated: true, id: EXISTING_ITEM.id, parentId: null });
        expect(mockUpdateWorkItem).toHaveBeenCalledOnce();
        const patch = mockUpdateWorkItem.mock.calls[0][1];
        expect('parentId' in patch).toBe(true);
        expect(patch.parentId).toBeUndefined();
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it('update mode rejects an invalid parentId value type', async () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ workItemId: EXISTING_ITEM.id, parentId: 42 } as any);

        expect(result).toMatchObject({ updated: false, id: EXISTING_ITEM.id });
        expect((result as any).error).toContain('Invalid parentId');
        expect(mockUpdateWorkItem).not.toHaveBeenCalled();
    });

    it('tool description mentions full revised plan content and planning reset', () => {
        const { tool } = createCreateUpdateWorkItemTool(dataDir, repoId);
        expect(tool.description).toContain('complete revised Markdown plan');
        expect(tool.description).toContain('planning');
        expect(tool.description).toContain('## Objective');
    });

    it('separate invocations produce independent tool objects', () => {
        const t1 = createCreateUpdateWorkItemTool(dataDir, repoId);
        const t2 = createCreateUpdateWorkItemTool(dataDir, repoId);
        expect(t1.tool).not.toBe(t2.tool);
        expect(t1.tool.name).toBe(t2.tool.name);
    });
});
