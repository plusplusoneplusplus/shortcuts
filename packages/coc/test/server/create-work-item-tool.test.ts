/**
 * Create Work Item Tool Tests
 *
 * Unit tests for the createWorkItemTool factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

// Mock FileWorkItemStore before importing the tool
const mockAddWorkItem = vi.fn();
const mockSavePlanVersion = vi.fn();
vi.mock('../../src/server/work-items/work-item-store', function () { return ({
    FileWorkItemStore: vi.fn().mockImplementation(function () { return ({
        addWorkItem: mockAddWorkItem,
        savePlanVersion: mockSavePlanVersion,
    }); }),
}); });

import { createWorkItemTool, type CreateWorkItemArgs } from '../../src/server/llm-tools/create-work-item-tool';

describe('createWorkItemTool', () => {
    const dataDir = path.join(os.tmpdir(), 'coc-test-work-item-tool');
    const repoId = 'test-repo-123';

    beforeEach(() => {
        mockAddWorkItem.mockReset();
        mockAddWorkItem.mockResolvedValue(undefined);
        mockSavePlanVersion.mockReset();
        mockSavePlanVersion.mockResolvedValue(undefined);
    });

    it('returns an object with a tool property', () => {
        const result = createWorkItemTool(dataDir, repoId);
        expect(result).toHaveProperty('tool');
        expect(result.tool).toBeDefined();
    });

    it('tool has name "create_work_item"', () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        expect(tool.name).toBe('create_work_item');
    });

    it('has description, parameters, and handler properties', () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        expect(typeof tool.description).toBe('string');
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.handler).toBe('function');
    });

    it('parameters require title and allow optional fields', () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        const params = tool.parameters as Record<string, any>;
        expect(params.required).toContain('title');
        expect(params.properties.title.type).toBe('string');
        expect(params.properties.description).toBeDefined();
        expect(params.properties.priority.enum).toEqual(['high', 'normal', 'low']);
        expect(params.properties.tags.type).toBe('array');
    });

    it('handler calls addWorkItem with correct minimal args', async () => {
        const { tool } = createWorkItemTool(dataDir, repoId);

        const result = await tool.handler({ title: 'Fix login bug' });

        expect(mockAddWorkItem).toHaveBeenCalledOnce();
        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.title).toBe('Fix login bug');
        expect(callArg.repoId).toBe(repoId);
        expect(callArg.status).toBe('created');
        expect(callArg.source).toBe('chat');
        expect(callArg.priority).toBe('normal');
        expect(callArg.description).toBe('');
        expect(typeof callArg.id).toBe('string');
        expect(typeof callArg.createdAt).toBe('string');

        expect(result).toMatchObject({ created: true, title: 'Fix login bug' });
        expect(typeof (result as any).id).toBe('string');
    });

    it('handler passes through description, priority, and tags', async () => {
        const { tool } = createWorkItemTool(dataDir, repoId);

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

    it('handler defaults priority to "normal" when not provided', async () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        await tool.handler({ title: 'Test item' });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.priority).toBe('normal');
    });

    it('handler calls broadcastFn when provided', async () => {
        const broadcast = vi.fn();
        const { tool } = createWorkItemTool(dataDir, repoId, broadcast);

        await tool.handler({ title: 'Broadcasted item' });

        expect(broadcast).toHaveBeenCalledOnce();
        const broadcastArg = broadcast.mock.calls[0][0];
        expect(broadcastArg.type).toBe('work-item-added');
        expect(broadcastArg.workspaceId).toBe(repoId);
        expect(broadcastArg.item).toBeDefined();
        expect((broadcastArg.item as any).title).toBe('Broadcasted item');
    });

    it('handler does NOT call broadcastFn when not provided', async () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        // Should not throw even without broadcastFn
        await expect(tool.handler({ title: 'No broadcast' })).resolves.not.toThrow();
    });

    it('handler generates a unique id for each work item', async () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        await tool.handler({ title: 'Item 1' });
        await tool.handler({ title: 'Item 2' });

        const id1 = mockAddWorkItem.mock.calls[0][0].id;
        const id2 = mockAddWorkItem.mock.calls[1][0].id;
        expect(id1).not.toBe(id2);
    });

    it('handler propagates errors from addWorkItem', async () => {
        mockAddWorkItem.mockRejectedValue(new Error('Disk full'));
        const { tool } = createWorkItemTool(dataDir, repoId);

        await expect(tool.handler({ title: 'Failing item' })).rejects.toThrow('Disk full');
    });

    it('separate invocations produce independent tool objects', () => {
        const t1 = createWorkItemTool(dataDir, repoId);
        const t2 = createWorkItemTool(dataDir, repoId);
        expect(t1.tool).not.toBe(t2.tool);
        expect(t1.tool.name).toBe(t2.tool.name);
    });

    // ── Plan parameter tests ──────────────────────────────────────────────────

    it('parameters include required plan field', () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        const params = tool.parameters as Record<string, any>;
        expect(params.properties.plan).toBeDefined();
        expect(params.properties.plan.type).toBe('string');
        // plan is required to ensure work items always have an actionable plan
        expect(params.required).toContain('plan');
    });

    it('handler creates item with status "created" when no plan is provided', async () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        await tool.handler({ title: 'No plan item' });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.status).toBe('created');
        expect(callArg.plan).toBeUndefined();
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
    });

    it('handler creates item with status "planning" when plan is provided', async () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        await tool.handler({ title: 'Planned item', plan: '## Objective\n\nBuild the feature.' });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.status).toBe('planning');
        expect(callArg.plan).toBeDefined();
        expect(callArg.plan.version).toBe(1);
        expect(callArg.plan.content).toBe('## Objective\n\nBuild the feature.');
        expect(callArg.plan.resolvedBy).toBe('ai');
    });

    it('handler calls savePlanVersion when plan is provided', async () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        await tool.handler({ title: 'Planned item', plan: '## Objective\n\nBuild the feature.' });

        expect(mockSavePlanVersion).toHaveBeenCalledOnce();
        const pvArg = mockSavePlanVersion.mock.calls[0][1];
        expect(pvArg.version).toBe(1);
        expect(pvArg.content).toBe('## Objective\n\nBuild the feature.');
        expect(pvArg.resolvedBy).toBe('ai');
        expect(pvArg.summary).toBe('Initial plan from chat');
    });

    it('handler does NOT call savePlanVersion when plan is absent', async () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        await tool.handler({ title: 'No plan' });
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
    });

    it('handler trims whitespace-only plan as no plan', async () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        await tool.handler({ title: 'Whitespace plan', plan: '   ' });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.status).toBe('created');
        expect(callArg.plan).toBeUndefined();
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
    });

    it('tool description mentions the plan template', () => {
        const { tool } = createWorkItemTool(dataDir, repoId);
        expect(tool.description).toContain('## Objective');
    });
});
