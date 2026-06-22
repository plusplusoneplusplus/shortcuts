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
    createWorkItemStore: vi.fn(() => ({
        getWorkItem: mockGetWorkItem,
        listWorkItems: mockListWorkItems,
        updateWorkItem: mockUpdateWorkItem,
        addWorkItem: mockAddWorkItem,
        savePlanVersion: mockSavePlanVersion,
        addChange: mockAddChange,
    })),
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
        // A UUID lookup resolves directly via getWorkItem, but the index is still read
        // once to build the always-present ancestors/children hierarchy context.
        expect(mockListWorkItems).toHaveBeenCalledWith({ repoId: REPO_ID });
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
        // A store whose listWorkItems returns nothing usable degrades to empty hierarchy
        // context rather than throwing.
        expect((result as any).item.children).toEqual([]);
        expect((result as any).ancestors).toEqual([]);
    });

    it('documents the ancestors/children result fields in the tool description', () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);
        expect(tool.description).toContain('ancestors');
        expect(tool.description).toContain('item.children');
    });

    it('input schema has no mode parameter', () => {
        const { tool } = createGetWorkItemTool(dataDir, REPO_ID);
        const params = tool.parameters as Record<string, any>;
        expect(params.properties.mode).toBeUndefined();
        expect(Object.keys(params.properties).sort()).toEqual(['target', 'workItemId', 'workItemNumber']);
    });
});

// ============================================================================
// Hierarchy context (ancestors + recursive descendants on every success)
// ============================================================================

const HIER_REPO = 'hier-repo-abc';
const T0 = '2024-01-01T00:00:00.000Z';

/** Full work items: epic → feature → pbi → leaf, each carrying description + plan. */
const HIER_FULL = {
    'epic-1': {
        id: 'epic-1', workItemNumber: 10, repoId: HIER_REPO, title: 'Epic title', type: 'epic' as const,
        status: 'executing' as const, description: 'epic desc', source: 'manual' as const, priority: 'normal' as const,
        createdAt: T0, updatedAt: T0, plan: { version: 1, content: 'epic plan', updatedAt: T0 },
    },
    'feat-1': {
        id: 'feat-1', workItemNumber: 20, repoId: HIER_REPO, title: 'Feature title', type: 'feature' as const,
        status: 'executing' as const, parentId: 'epic-1', description: 'feature desc', source: 'manual' as const,
        priority: 'normal' as const, createdAt: T0, updatedAt: T0, plan: { version: 1, content: 'feature plan', updatedAt: T0 },
    },
    'pbi-1': {
        id: 'pbi-1', workItemNumber: 30, repoId: HIER_REPO, title: 'PBI title', type: 'pbi' as const,
        status: 'planning' as const, parentId: 'feat-1', description: 'pbi desc', source: 'manual' as const,
        priority: 'normal' as const, createdAt: T0, updatedAt: T0, plan: { version: 1, content: 'pbi plan', updatedAt: T0 },
    },
    'leaf-1': {
        id: 'leaf-1', workItemNumber: 40, repoId: HIER_REPO, title: 'Leaf title', type: 'work-item' as const,
        status: 'done' as const, parentId: 'pbi-1', description: 'leaf desc', source: 'manual' as const,
        priority: 'normal' as const, createdAt: T0, updatedAt: T0, plan: { version: 1, content: 'leaf plan', updatedAt: T0 },
    },
} as Record<string, any>;

/** Lightweight index entry derived from a full item (mirrors toIndexEntry's relevant fields). */
function toEntry(item: any) {
    return {
        id: item.id, workItemNumber: item.workItemNumber, repoId: item.repoId, title: item.title,
        type: item.type, status: item.status, parentId: item.parentId, source: item.source,
        createdAt: item.createdAt, updatedAt: item.updatedAt,
    };
}

describe('createGetWorkItemTool hierarchy context', () => {
    const dataDir = path.join(os.tmpdir(), 'coc-test-get-work-item-tool-hier');

    function wireChain(items: Record<string, any>) {
        mockGetWorkItem.mockReset();
        mockGetWorkItem.mockImplementation(async (id: string, repoId?: string) => {
            if (repoId === HIER_REPO && items[id]) return { ...items[id] };
            return undefined;
        });
        mockListWorkItems.mockReset();
        const entries = Object.values(items).map(toEntry);
        mockListWorkItems.mockImplementation(async (filter: { repoId?: string } = {}) => {
            if (filter.repoId === HIER_REPO) return { items: entries, total: entries.length };
            return { items: [], total: 0 };
        });
    }

    beforeEach(() => {
        wireChain(HIER_FULL);
        mockUpdateWorkItem.mockReset();
        mockAddWorkItem.mockReset();
        mockSavePlanVersion.mockReset();
        mockAddChange.mockReset();
    });

    it('returns ancestors epic→feature→pbi (lightweight, ordered) and empty children for a leaf', async () => {
        const { tool } = createGetWorkItemTool(dataDir, HIER_REPO);

        const result = await tool.handler({ workItemId: 'leaf-1' }) as any;

        expect(result.found).toBe(true);
        expect(result.item.children).toEqual([]);
        expect(result.ancestors.map((a: any) => a.id)).toEqual(['epic-1', 'feat-1', 'pbi-1']);
        // Lightweight fields only: exactly { id, workItemNumber, title, type, status }.
        expect(result.ancestors[0]).toEqual({
            id: 'epic-1', workItemNumber: 10, title: 'Epic title', type: 'epic', status: 'executing',
        });
        for (const node of result.ancestors) {
            expect(node).not.toHaveProperty('description');
            expect(node).not.toHaveProperty('plan');
            expect(node).not.toHaveProperty('children');
        }
    });

    it('returns empty ancestors and a nested descendant tree reaching the leaf for an epic', async () => {
        const { tool } = createGetWorkItemTool(dataDir, HIER_REPO);

        const result = await tool.handler({ workItemNumber: 10 }) as any;

        expect(result.found).toBe(true);
        expect(result.ancestors).toEqual([]);
        // epic → feature → pbi → leaf, nested.
        expect(result.item.children).toHaveLength(1);
        const feature = result.item.children[0];
        expect(feature).toMatchObject({ id: 'feat-1', workItemNumber: 20, title: 'Feature title', type: 'feature', status: 'executing' });
        expect(feature.children).toHaveLength(1);
        const pbi = feature.children[0];
        expect(pbi).toMatchObject({ id: 'pbi-1', type: 'pbi' });
        expect(pbi.children).toHaveLength(1);
        const leaf = pbi.children[0];
        expect(leaf).toMatchObject({ id: 'leaf-1', type: 'work-item', status: 'done' });
        expect(leaf.children).toEqual([]);
    });

    it('preserves full detail on the queried item but not on hierarchy nodes', async () => {
        const { tool } = createGetWorkItemTool(dataDir, HIER_REPO);

        const result = await tool.handler({ workItemId: 'feat-1' }) as any;

        // Queried item keeps full detail.
        expect(result.item.description).toBe('feature desc');
        expect(result.item.plan).toEqual({ version: 1, content: 'feature plan', updatedAt: T0 });
        // Ancestor (epic) and descendant (pbi) nodes are lightweight only.
        const epic = result.ancestors[0];
        expect(epic.description).toBeUndefined();
        expect(epic.plan).toBeUndefined();
        const pbi = result.item.children[0];
        expect(pbi.description).toBeUndefined();
        expect(pbi.plan).toBeUndefined();
    });

    it('returns empty ancestors and children for a standalone item', async () => {
        wireChain({
            solo: {
                id: 'solo', workItemNumber: 99, repoId: HIER_REPO, title: 'Solo', type: 'work-item' as const,
                status: 'created' as const, description: 'lonely', source: 'manual' as const, priority: 'normal' as const,
                createdAt: T0, updatedAt: T0,
            },
        });
        const { tool } = createGetWorkItemTool(dataDir, HIER_REPO);

        const result = await tool.handler({ workItemId: 'solo' }) as any;

        expect(result.found).toBe(true);
        expect(result.ancestors).toEqual([]);
        expect(result.item.children).toEqual([]);
    });

    it('does not hang when parent links form a cycle', async () => {
        // A is parent of B and B is parent of A.
        wireChain({
            'cycle-a': {
                id: 'cycle-a', workItemNumber: 1, repoId: HIER_REPO, title: 'A', type: 'work-item' as const,
                status: 'created' as const, parentId: 'cycle-b', description: 'a', source: 'manual' as const,
                priority: 'normal' as const, createdAt: T0, updatedAt: T0,
            },
            'cycle-b': {
                id: 'cycle-b', workItemNumber: 2, repoId: HIER_REPO, title: 'B', type: 'work-item' as const,
                status: 'created' as const, parentId: 'cycle-a', description: 'b', source: 'manual' as const,
                priority: 'normal' as const, createdAt: T0, updatedAt: T0,
            },
        });
        const { tool } = createGetWorkItemTool(dataDir, HIER_REPO);

        const result = await tool.handler({ workItemId: 'cycle-a' }) as any;

        expect(result.found).toBe(true);
        // Ancestor walk stops at the first repeat: only B is collected.
        expect(result.ancestors.map((a: any) => a.id)).toEqual(['cycle-b']);
        // Descendant build visits B once, then stops (A already visited).
        expect(result.item.children).toHaveLength(1);
        expect(result.item.children[0].id).toBe('cycle-b');
        expect(result.item.children[0].children).toEqual([]);
    });

    it('leaves the not-found path unchanged (no ancestors/children added)', async () => {
        const { tool } = createGetWorkItemTool(dataDir, HIER_REPO);

        const result = await tool.handler({ workItemId: 'missing' }) as any;

        expect(result.found).toBe(false);
        expect(result.error).toContain('missing');
        expect(result).not.toHaveProperty('ancestors');
        expect(result.item).toBeUndefined();
    });
});
