/**
 * Create Bug Tool Tests
 *
 * Unit tests for the createBugTool factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// Mock FileWorkItemStore before importing the tool
const mockAddWorkItem = vi.fn();
const mockSavePlanVersion = vi.fn();
vi.mock('../../src/server/work-items/work-item-store', function () { return ({
    FileWorkItemStore: vi.fn().mockImplementation(function () { return ({
        addWorkItem: mockAddWorkItem,
        savePlanVersion: mockSavePlanVersion,
    }); }),
}); });

import { createBugTool, type CreateBugArgs } from '../../src/server/llm-tools/create-bug-tool';

describe('createBugTool', () => {
    const dataDir = path.join(os.tmpdir(), 'coc-test-bug-tool');
    const repoId = 'test-repo-123';

    beforeEach(() => {
        mockAddWorkItem.mockReset();
        mockAddWorkItem.mockResolvedValue(undefined);
        mockSavePlanVersion.mockReset();
        mockSavePlanVersion.mockResolvedValue(undefined);
    });

    it('returns an object with a tool property', () => {
        const result = createBugTool(dataDir, repoId);
        expect(result).toHaveProperty('tool');
        expect(result.tool).toBeDefined();
    });

    it('tool has name "create_bug"', () => {
        const { tool } = createBugTool(dataDir, repoId);
        expect(tool.name).toBe('create_bug');
    });

    it('has description, parameters, and handler properties', () => {
        const { tool } = createBugTool(dataDir, repoId);
        expect(typeof tool.description).toBe('string');
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.handler).toBe('function');
    });

    it('parameters require title and allow optional fields', () => {
        const { tool } = createBugTool(dataDir, repoId);
        const params = tool.parameters as Record<string, any>;
        expect(params.required).toContain('title');
        expect(params.properties.title.type).toBe('string');
        expect(params.properties.description).toBeDefined();
        expect(params.properties.priority.enum).toEqual(['high', 'normal', 'low']);
        expect(params.properties.tags.type).toBe('array');
        expect(params.properties.plan).toBeDefined();
        expect(params.required).toContain('plan');
    });

    it('handler calls addWorkItem with type "bug"', async () => {
        const { tool } = createBugTool(dataDir, repoId);

        const result = await tool.handler({ title: 'Crash on empty input' });

        expect(mockAddWorkItem).toHaveBeenCalledOnce();
        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.title).toBe('Crash on empty input');
        expect(callArg.repoId).toBe(repoId);
        expect(callArg.type).toBe('bug');
        expect(callArg.source).toBe('chat');
        expect(callArg.priority).toBe('normal');
        expect(callArg.description).toBe('');
        expect(typeof callArg.id).toBe('string');
        expect(typeof callArg.createdAt).toBe('string');

        expect(result).toMatchObject({ created: true, title: 'Crash on empty input' });
        expect(typeof (result as any).id).toBe('string');
    });

    it('handler creates item with status "created" when no plan is provided', async () => {
        const { tool } = createBugTool(dataDir, repoId);
        await tool.handler({ title: 'Bug without plan' });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.status).toBe('created');
        expect(callArg.type).toBe('bug');
        expect(callArg.plan).toBeUndefined();
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
    });

    it('handler creates item with status "planning" when plan is provided', async () => {
        const { tool } = createBugTool(dataDir, repoId);
        await tool.handler({ title: 'Bug with plan', plan: '## Objective\n\nFix the crash.' });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.status).toBe('planning');
        expect(callArg.type).toBe('bug');
        expect(callArg.plan).toBeDefined();
        expect(callArg.plan.version).toBe(1);
        expect(callArg.plan.content).toBe('## Objective\n\nFix the crash.');
        expect(callArg.plan.resolvedBy).toBe('ai');
    });

    it('handler calls savePlanVersion when plan is provided', async () => {
        const { tool } = createBugTool(dataDir, repoId);
        await tool.handler({ title: 'Bug with plan', plan: '## Objective\n\nFix the crash.' });

        expect(mockSavePlanVersion).toHaveBeenCalledOnce();
        const pvArg = mockSavePlanVersion.mock.calls[0][1];
        expect(pvArg.version).toBe(1);
        expect(pvArg.content).toBe('## Objective\n\nFix the crash.');
        expect(pvArg.resolvedBy).toBe('ai');
        expect(pvArg.summary).toBe('Initial plan from chat');
    });

    it('handler passes through description, priority, and tags', async () => {
        const { tool } = createBugTool(dataDir, repoId);

        await tool.handler({
            title: 'UI regression',
            description: 'Button no longer responds to clicks',
            priority: 'high',
            tags: ['regression', 'ui'],
        });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.description).toBe('Button no longer responds to clicks');
        expect(callArg.priority).toBe('high');
        expect(callArg.tags).toEqual(['regression', 'ui']);
        expect(callArg.type).toBe('bug');
    });

    it('handler calls broadcastFn when provided', async () => {
        const broadcast = vi.fn();
        const { tool } = createBugTool(dataDir, repoId, broadcast);

        await tool.handler({ title: 'Broadcasted bug' });

        expect(broadcast).toHaveBeenCalledOnce();
        const broadcastArg = broadcast.mock.calls[0][0];
        expect(broadcastArg.type).toBe('work-item-added');
        expect(broadcastArg.workspaceId).toBe(repoId);
        expect(broadcastArg.item).toBeDefined();
        expect((broadcastArg.item as any).title).toBe('Broadcasted bug');
        expect((broadcastArg.item as any).type).toBe('bug');
    });

    it('handler generates a unique id for each bug', async () => {
        const { tool } = createBugTool(dataDir, repoId);
        await tool.handler({ title: 'Bug 1' });
        await tool.handler({ title: 'Bug 2' });

        const id1 = mockAddWorkItem.mock.calls[0][0].id;
        const id2 = mockAddWorkItem.mock.calls[1][0].id;
        expect(id1).not.toBe(id2);
    });

    it('handler propagates errors from addWorkItem', async () => {
        mockAddWorkItem.mockRejectedValue(new Error('Disk full'));
        const { tool } = createBugTool(dataDir, repoId);

        await expect(tool.handler({ title: 'Failing bug' })).rejects.toThrow('Disk full');
    });

    it('tool description mentions bug reporting', () => {
        const { tool } = createBugTool(dataDir, repoId);
        expect(tool.description).toContain('bug');
    });

    it('normalizes plan from description when plan is absent', async () => {
        const { tool } = createBugTool(dataDir, repoId);
        await tool.handler({
            title: 'Auto-detected plan bug',
            description: '## Objective\n\nFix the issue\n\n## Steps\n\n- [ ] Investigate',
        });

        const callArg = mockAddWorkItem.mock.calls[0][0];
        expect(callArg.plan).toBeDefined();
        expect(callArg.plan.content).toContain('## Objective');
        expect(callArg.description).toBe('');
        expect(callArg.type).toBe('bug');
    });
});
