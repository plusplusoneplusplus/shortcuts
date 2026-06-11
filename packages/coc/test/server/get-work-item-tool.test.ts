/**
 * Get Work Item Tool Tests
 *
 * Unit tests for the read-only createGetWorkItemTool factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// Mock FileWorkItemStore before importing the tool. The mock simulates
// workspace-scoped reads: lookups only succeed when called with the owning repoId.
const mockGetWorkItem = vi.fn();
const mockListWorkItems = vi.fn();
const mockUpdateWorkItem = vi.fn();
const mockAddWorkItem = vi.fn();
const mockSavePlanVersion = vi.fn();
const mockAddChange = vi.fn();
vi.mock('../../src/server/work-items/work-item-store', function () { return ({
    FileWorkItemStore: vi.fn().mockImplementation(function () { return ({
        getWorkItem: mockGetWorkItem,
        listWorkItems: mockListWorkItems,
        updateWorkItem: mockUpdateWorkItem,
        addWorkItem: mockAddWorkItem,
        savePlanVersion: mockSavePlanVersion,
        addChange: mockAddChange,
    }); }),
}); });

import { createGetWorkItemTool } from '../../src/server/llm-tools/get-work-item-tool';

const REPO_ID = 'test-repo-123';
const OTHER_REPO = 'other-repo-999';

const EXISTING_ITEM = {
    id: 'item-uuid-1',
    workItemNumber: 20,
    repoId: REPO_ID,
    title: 'Existing work item',
    description: 'A description',
    status: 'readyToExecute' as const,
    source: 'manual' as const,
    priority: 'normal' as const,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    plan: { version: 1, content: 'Plan content', updatedAt: '2024-01-01T00:00:00.000Z' },
};

describe('createGetWorkItemTool', () => {
    const dataDir = path.join(os.tmpdir(), 'coc-test-get-work-item-tool');

    beforeEach(() => {
        // getWorkItem only returns the item when scoped to its owning workspace.
        mockGetWorkItem.mockReset();
        mockGetWorkItem.mockImplementation(async (id: string, repoId?: string) => {
            if (repoId === REPO_ID && id === EXISTING_ITEM.id) {
                return { ...EXISTING_ITEM };
            }
            return undefined;
        });
        // listWorkItems is workspace-scoped: only the owning repo lists the item.
        mockListWorkItems.mockReset();
        mockListWorkItems.mockImplementation(async (filter: { repoId?: string } = {}) => {
            if (filter.repoId === REPO_ID) {
                return {
                    items: [{ id: EXISTING_ITEM.id, workItemNumber: EXISTING_ITEM.workItemNumber, repoId: REPO_ID }],
                    total: 1,
                };
            }
            return { items: [], total: 0 };
        });
        mockUpdateWorkItem.mockReset();
        mockAddWorkItem.mockReset();
        mockSavePlanVersion.mockReset();
        mockAddChange.mockReset();
    });

    it('returns an object with a tool property', () => {
        const result = createGetWorkItemTool(dataDir, REPO_ID);
        expect(result).toHaveProperty('tool');
        expect(result.tool).toBeDefined();
    });

    it('tool has name "get_work_item"', () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);
        expect(tool.name).toBe('get_work_item');
    });

    it('has description, parameters, and handler properties', () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);
        expect(typeof tool.description).toBe('string');
        expect(tool.parameters).toBeDefined();
        expect(typeof tool.handler).toBe('function');
    });

    it('exposes workItemId, target, and workItemNumber parameters with no required fields', () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);
        const params = tool.parameters as Record<string, any>;
        expect(params.required).toEqual([]);
        expect(params.properties.workItemId.type).toBe('string');
        expect(params.properties.target.type).toBe('string');
        expect(params.properties.workItemNumber).toBeDefined();
    });

    it('resolves a UUID lookup to the item in the same workspace', async () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);

        const result = await tool.handler({ workItemId: EXISTING_ITEM.id });

        expect(mockGetWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, REPO_ID);
        expect(mockListWorkItems).not.toHaveBeenCalled();
        expect(result).toMatchObject({ found: true });
        expect((result as any).item.id).toBe(EXISTING_ITEM.id);
        expect((result as any).item.title).toBe(EXISTING_ITEM.title);
    });

    it('resolves a UUID supplied via the target field', async () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);

        const result = await tool.handler({ target: EXISTING_ITEM.id });

        expect(mockGetWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, REPO_ID);
        expect(result).toMatchObject({ found: true });
        expect((result as any).item.id).toBe(EXISTING_ITEM.id);
    });

    it('resolves a WI-N lookup through the workspace list', async () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);

        const result = await tool.handler({ workItemNumber: 'WI-20' });

        expect(mockListWorkItems).toHaveBeenCalledWith({ repoId: REPO_ID });
        expect(mockGetWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, REPO_ID);
        expect(result).toMatchObject({ found: true });
        expect((result as any).item.workItemNumber).toBe(20);
    });

    it('resolves a numeric workItemNumber through the workspace list', async () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);

        const result = await tool.handler({ workItemNumber: 20 });

        expect(mockListWorkItems).toHaveBeenCalledWith({ repoId: REPO_ID });
        expect(result).toMatchObject({ found: true });
        expect((result as any).item.id).toBe(EXISTING_ITEM.id);
    });

    it('resolves a WI-N supplied via the target field through the workspace list', async () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);

        const result = await tool.handler({ target: 'WI-20' });

        expect(mockListWorkItems).toHaveBeenCalledWith({ repoId: REPO_ID });
        expect(result).toMatchObject({ found: true });
        expect((result as any).item.id).toBe(EXISTING_ITEM.id);
    });

    it('returns { found: false } for a missing UUID rather than throwing', async () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);

        const result = await tool.handler({ workItemId: 'does-not-exist' });

        expect(result).toMatchObject({ found: false });
        expect((result as any).error).toContain('does-not-exist');
    });

    it('returns { found: false } for a missing WI-N rather than throwing', async () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);

        const result = await tool.handler({ workItemNumber: 'WI-999' });

        expect(result).toMatchObject({ found: false });
        expect(mockGetWorkItem).not.toHaveBeenCalled();
    });

    it('returns { found: false } when no target is provided', async () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);

        const result = await tool.handler({});

        expect(result).toMatchObject({ found: false });
        expect((result as any).error).toMatch(/workItemId|target|workItemNumber/);
        expect(mockGetWorkItem).not.toHaveBeenCalled();
        expect(mockListWorkItems).not.toHaveBeenCalled();
    });

    it('does not read a work item that belongs to another workspace', async () => {
        const { tool } = createGetWorkItemTool(dataDir, OTHER_REPO);

        const result = await tool.handler({ workItemId: EXISTING_ITEM.id });

        // Lookup is scoped to OTHER_REPO, so the item owned by REPO_ID is invisible.
        expect(mockGetWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, OTHER_REPO);
        expect(result).toMatchObject({ found: false });
    });

    it('does not invoke any mutation path on a successful read', async () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);

        await tool.handler({ workItemId: EXISTING_ITEM.id });

        expect(mockUpdateWorkItem).not.toHaveBeenCalled();
        expect(mockAddWorkItem).not.toHaveBeenCalled();
        expect(mockSavePlanVersion).not.toHaveBeenCalled();
        expect(mockAddChange).not.toHaveBeenCalled();
    });

    it('uses an injected workItemStore instead of FileWorkItemStore', async () => {
        const injectedGetWorkItem = vi.fn(async () => ({ ...EXISTING_ITEM }));
        const injectedStore = {
            getWorkItem: injectedGetWorkItem,
            listWorkItems: vi.fn(),
        } as any;

        const { tool } = createGetWorkItemTool(dataDir, REPO_ID, { workItemStore: injectedStore });
        const result = await tool.handler({ workItemId: EXISTING_ITEM.id });

        expect(injectedGetWorkItem).toHaveBeenCalledWith(EXISTING_ITEM.id, REPO_ID);
        expect(mockGetWorkItem).not.toHaveBeenCalled();
        expect(result).toMatchObject({ found: true });
    });
});
