/**
 * Update Work Item Tool Tests
 *
 * Unit tests for the createUpdateWorkItemTool factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// Mock FileWorkItemStore before importing the tool
const mockGetWorkItem = vi.fn();
const mockUpdateWorkItem = vi.fn();
const mockSavePlanVersion = vi.fn();
vi.mock('../../src/server/work-items/work-item-store', function () { return ({
    FileWorkItemStore: vi.fn().mockImplementation(function () { return ({
        getWorkItem: mockGetWorkItem,
        updateWorkItem: mockUpdateWorkItem,
        savePlanVersion: mockSavePlanVersion,
    }); }),
}); });

import { createUpdateWorkItemTool } from '../../src/server/llm-tools/update-work-item-tool';

const EXISTING_ITEM = {
    id: 'item-uuid-1',
    repoId: 'test-repo-123',
    title: 'Old Title',
    description: 'Old description',
    status: 'created' as const,
    source: 'manual' as const,
    priority: 'normal' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    plan: { version: 1, content: 'Old plan', updatedAt: '2024-01-01T00:00:00.000Z' },
};

describe('createUpdateWorkItemTool', () => {
    const dataDir = path.join(os.tmpdir(), 'coc-test-update-work-item-tool');
    const repoId = 'test-repo-123';

    beforeEach(() => {
        mockGetWorkItem.mockReset();
        mockGetWorkItem.mockResolvedValue({ ...EXISTING_ITEM });
        mockUpdateWorkItem.mockReset();
        mockUpdateWorkItem.mockResolvedValue({
            ...EXISTING_ITEM,
            status: 'planning',
            updatedAt: new Date().toISOString(),
        });
        mockSavePlanVersion.mockReset();
        mockSavePlanVersion.mockResolvedValue(undefined);
    });

    it('returns an object with a tool property', () => {
        const result = createUpdateWorkItemTool(dataDir, repoId);
        expect(result).toHaveProperty('tool');
        expect(result.tool).toBeDefined();
    });

    it('tool has name "update_work_item"', () => {
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        expect(tool.name).toBe('update_work_item');
    });

    it('has description, parameters, and handler properties', () => {
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        expect(typeof tool.description).toBe('string');
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.handler).toBe('function');
    });

    it('parameters require workItemId and all other fields are optional', () => {
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        const params = tool.parameters as Record<string, any>;
        expect(params.required).toContain('workItemId');
        expect(params.required).not.toContain('title');
        expect(params.required).not.toContain('description');
        expect(params.required).not.toContain('priority');
        expect(params.required).not.toContain('tags');
        expect(params.required).not.toContain('plan');
        expect(params.properties.priority.enum).toEqual(['high', 'normal', 'low']);
        expect(params.properties.tags.type).toBe('array');
    });

    it('handler returns error when work item is not found', async () => {
        mockGetWorkItem.mockResolvedValue(undefined);
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ workItemId: 'missing-id' });
        expect((result as any).updated).toBe(false);
        expect((result as any).error).toContain('missing-id');
    });

    it('handler updates title and resets status to planning', async () => {
        const updatedItem = { ...EXISTING_ITEM, title: 'New Title', status: 'planning' as const };
        mockUpdateWorkItem.mockResolvedValue(updatedItem);

        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        const result = await tool.handler({ workItemId: EXISTING_ITEM.id, title: 'New Title' });

        expect(mockUpdateWorkItem).toHaveBeenCalledOnce();
        const patch = mockUpdateWorkItem.mock.calls[0][1];
        expect(patch.title).toBe('New Title');
        expect(patch.status).toBe('planning');
        expect(result).toMatchObject({ updated: true, id: updatedItem.id, status: 'planning' });
    });

    it('handler updates description when provided', async () => {
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        await tool.handler({ workItemId: EXISTING_ITEM.id, description: 'New description' });

        const patch = mockUpdateWorkItem.mock.calls[0][1];
        expect(patch.description).toBe('New description');
    });

    it('handler updates priority when provided', async () => {
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        await tool.handler({ workItemId: EXISTING_ITEM.id, priority: 'high' });

        const patch = mockUpdateWorkItem.mock.calls[0][1];
        expect(patch.priority).toBe('high');
    });

    it('handler updates tags when provided', async () => {
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        await tool.handler({ workItemId: EXISTING_ITEM.id, tags: ['backend', 'api'] });

        const patch = mockUpdateWorkItem.mock.calls[0][1];
        expect(patch.tags).toEqual(['backend', 'api']);
    });

    it('handler does NOT include title in patch when title is not provided', async () => {
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        await tool.handler({ workItemId: EXISTING_ITEM.id });

        const patch = mockUpdateWorkItem.mock.calls[0][1];
        expect('title' in patch).toBe(false);
        expect('description' in patch).toBe(false);
        expect('priority' in patch).toBe(false);
        expect('tags' in patch).toBe(false);
        expect(patch.status).toBe('planning');
    });

    it('handler creates a new plan version when plan is provided', async () => {
        const updatedItem = {
            ...EXISTING_ITEM,
            status: 'planning' as const,
            plan: { version: 2, content: '## Objective\n\nNew plan.', updatedAt: new Date().toISOString() },
        };
        mockUpdateWorkItem.mockResolvedValue(updatedItem);

        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        await tool.handler({ workItemId: EXISTING_ITEM.id, plan: '## Objective\n\nNew plan.' });

        const patch = mockUpdateWorkItem.mock.calls[0][1];
        expect(patch.plan).toBeDefined();
        expect(patch.plan.version).toBe(2); // existing was v1, new is v2
        expect(patch.plan.content).toBe('## Objective\n\nNew plan.');
        expect(patch.plan.resolvedBy).toBe('ai');

        expect(mockSavePlanVersion).toHaveBeenCalledOnce();
        const pvArg = mockSavePlanVersion.mock.calls[0][1];
        expect(pvArg.version).toBe(2);
        expect(pvArg.content).toBe('## Objective\n\nNew plan.');
        expect(pvArg.resolvedBy).toBe('ai');
        expect(pvArg.summary).toBe('Plan updated from chat (v2)');
    });

    it('handler does NOT call savePlanVersion when no plan is provided', async () => {
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        await tool.handler({ workItemId: EXISTING_ITEM.id, title: 'Just a title change' });

        expect(mockSavePlanVersion).not.toHaveBeenCalled();
    });

    it('handler uses version 1 when existing item has no plan', async () => {
        const itemWithNoPlan = { ...EXISTING_ITEM, plan: undefined };
        mockGetWorkItem.mockResolvedValue(itemWithNoPlan);
        const updatedItem = { ...itemWithNoPlan, status: 'planning' as const, plan: { version: 1, content: 'Plan', updatedAt: new Date().toISOString() } };
        mockUpdateWorkItem.mockResolvedValue(updatedItem);

        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        await tool.handler({ workItemId: EXISTING_ITEM.id, plan: 'Plan' });

        const patch = mockUpdateWorkItem.mock.calls[0][1];
        expect(patch.plan.version).toBe(1);

        const pvArg = mockSavePlanVersion.mock.calls[0][1];
        expect(pvArg.version).toBe(1);
    });

    it('handler trims whitespace-only plan as no plan', async () => {
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        await tool.handler({ workItemId: EXISTING_ITEM.id, plan: '   ' });

        const patch = mockUpdateWorkItem.mock.calls[0][1];
        expect('plan' in patch).toBe(false);
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
    });

    it('handler broadcasts work-item-updated event when broadcastFn is provided', async () => {
        const broadcast = vi.fn();
        const { tool } = createUpdateWorkItemTool(dataDir, repoId, broadcast);
        await tool.handler({ workItemId: EXISTING_ITEM.id, title: 'Updated' });

        expect(broadcast).toHaveBeenCalledOnce();
        const eventArg = broadcast.mock.calls[0][0];
        expect(eventArg.type).toBe('work-item-updated');
        expect(eventArg.workspaceId).toBe(repoId);
        expect(eventArg.item).toBeDefined();
    });

    it('handler does NOT call broadcastFn when not provided', async () => {
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        await expect(tool.handler({ workItemId: EXISTING_ITEM.id })).resolves.not.toThrow();
    });

    it('handler returns updated: false when updateWorkItem returns undefined', async () => {
        mockUpdateWorkItem.mockResolvedValue(undefined);
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ workItemId: EXISTING_ITEM.id });
        expect((result as any).updated).toBe(false);
        expect((result as any).error).toContain(EXISTING_ITEM.id);
    });

    it('normalizePlanFromDescription: moves description with plan headings to plan field', async () => {
        const descWithPlan = '## Objective\n\nBuild X.\n\n## Steps\n\n- [ ] Do it';
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        await tool.handler({ workItemId: EXISTING_ITEM.id, description: descWithPlan });

        const patch = mockUpdateWorkItem.mock.calls[0][1];
        // Plan content should have been moved from description to plan
        expect(patch.plan).toBeDefined();
        expect(patch.plan.content).toBe(descWithPlan);
        // description should be cleared
        expect(patch.description).toBe('');
    });

    it('tool description mentions planning reset', () => {
        const { tool } = createUpdateWorkItemTool(dataDir, repoId);
        expect(tool.description).toContain('planning');
    });

    it('separate invocations produce independent tool objects', () => {
        const t1 = createUpdateWorkItemTool(dataDir, repoId);
        const t2 = createUpdateWorkItemTool(dataDir, repoId);
        expect(t1.tool).not.toBe(t2.tool);
        expect(t1.tool.name).toBe(t2.tool.name);
    });
});
