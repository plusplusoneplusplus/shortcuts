import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdoWorkItemsService, AdoWorkItemError } from '../../src/ado/workitems-service';
import type { WebApi } from 'azure-devops-node-api';

const mockClient = {
    getWorkItem: vi.fn(),
    getWorkItems: vi.fn(),
    createWorkItem: vi.fn(),
    updateWorkItem: vi.fn(),
    queryByWiql: vi.fn(),
    getComments: vi.fn(),
    addComment: vi.fn(),
};

const mockConnection = {
    getWorkItemTrackingApi: vi.fn().mockResolvedValue(mockClient),
} as unknown as WebApi;

let service: AdoWorkItemsService;

beforeEach(() => {
    vi.clearAllMocks();
    service = new AdoWorkItemsService(mockConnection);
});

// ── getWorkItem ──────────────────────────────────────────────

describe('getWorkItem', () => {
    it('returns the work item on success', async () => {
        const item = { id: 42, fields: { 'System.Title': 'Hello' } };
        mockClient.getWorkItem.mockResolvedValue(item);

        const result = await service.getWorkItem(42, 'MyProject');

        expect(result).toBe(item);
        expect(mockClient.getWorkItem).toHaveBeenCalledWith(42, undefined, undefined, undefined, 'MyProject');
    });

    it('wraps client errors as AdoWorkItemError', async () => {
        mockClient.getWorkItem.mockRejectedValue(new Error('not found'));

        await expect(service.getWorkItem(99)).rejects.toThrow(AdoWorkItemError);
        await expect(service.getWorkItem(99)).rejects.toThrow('Failed to get work item 99');
    });
});

// ── getWorkItems ─────────────────────────────────────────────

describe('getWorkItems', () => {
    it('returns multiple work items on success', async () => {
        const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
        mockClient.getWorkItems.mockResolvedValue(items);

        const result = await service.getWorkItems([1, 2, 3], 'Proj');

        expect(result).toHaveLength(3);
        expect(result.map((w: { id: number }) => w.id)).toEqual([1, 2, 3]);
    });

    it('throws AdoWorkItemError when ids exceed 200', async () => {
        const ids = Array.from({ length: 201 }, (_, i) => i + 1);

        await expect(service.getWorkItems(ids)).rejects.toThrow(AdoWorkItemError);
        await expect(service.getWorkItems(ids)).rejects.toThrow('Cannot fetch more than 200');
        expect(mockClient.getWorkItems).not.toHaveBeenCalled();
    });
});

// ── createWorkItem ───────────────────────────────────────────

describe('createWorkItem', () => {
    it('builds the correct JsonPatchDocument and returns the work item', async () => {
        const created = { id: 100, fields: { 'System.Title': 'Fix bug' } };
        mockClient.createWorkItem.mockResolvedValue(created);

        const result = await service.createWorkItem('MyProject', 'Bug', {
            'System.Title': 'Fix bug',
            'Microsoft.VSTS.Common.Priority': 1,
        });

        expect(result).toBe(created);

        const [customHeaders, document, project, type] = mockClient.createWorkItem.mock.calls[0];
        expect(customHeaders).toEqual({});
        expect(project).toBe('MyProject');
        expect(type).toBe('Bug');
        expect(document).toEqual([
            { op: 'add', path: '/fields/System.Title', value: 'Fix bug' },
            { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 1 },
        ]);
    });

    it('wraps client errors as AdoWorkItemError', async () => {
        mockClient.createWorkItem.mockRejectedValue(new Error('403'));

        await expect(
            service.createWorkItem('P', 'Task', { 'System.Title': 'x' }),
        ).rejects.toThrow(AdoWorkItemError);
    });
});

// ── updateWorkItem ───────────────────────────────────────────

describe('updateWorkItem', () => {
    it('builds the correct JsonPatchDocument and returns the updated item', async () => {
        const updated = { id: 42, fields: { 'System.State': 'Active' } };
        mockClient.updateWorkItem.mockResolvedValue(updated);

        const result = await service.updateWorkItem(42, {
            'System.State': 'Active',
            'System.AssignedTo': 'user@example.com',
        }, 'MyProject');

        expect(result).toBe(updated);

        const [customHeaders, document, id, project] = mockClient.updateWorkItem.mock.calls[0];
        expect(customHeaders).toEqual({});
        expect(id).toBe(42);
        expect(project).toBe('MyProject');
        expect(document).toEqual([
            { op: 'add', path: '/fields/System.State', value: 'Active' },
            { op: 'add', path: '/fields/System.AssignedTo', value: 'user@example.com' },
        ]);
    });

    it('wraps client errors as AdoWorkItemError', async () => {
        mockClient.updateWorkItem.mockRejectedValue(new Error('conflict'));

        await expect(service.updateWorkItem(42, { 'System.State': 'Closed' })).rejects.toThrow(AdoWorkItemError);
    });
});

// ── queryByWiql ──────────────────────────────────────────────

describe('queryByWiql', () => {
    it('passes teamContext as { project } when project is provided', async () => {
        const qr = { workItems: [{ id: 1 }] };
        mockClient.queryByWiql.mockResolvedValue(qr);

        const result = await service.queryByWiql('SELECT [System.Id] FROM WorkItems', 'Proj', 10);

        expect(result).toBe(qr);
        expect(mockClient.queryByWiql).toHaveBeenCalledWith(
            { query: 'SELECT [System.Id] FROM WorkItems' },
            { project: 'Proj' },
            undefined,
            10,
        );
    });

    it('passes teamContext as undefined when project is omitted', async () => {
        mockClient.queryByWiql.mockResolvedValue({ workItems: [] });

        await service.queryByWiql('SELECT [System.Id] FROM WorkItems');

        expect(mockClient.queryByWiql).toHaveBeenCalledWith(
            { query: 'SELECT [System.Id] FROM WorkItems' },
            undefined,
            undefined,
            undefined,
        );
    });

    it('wraps client errors as AdoWorkItemError', async () => {
        mockClient.queryByWiql.mockRejectedValue(new Error('syntax error'));

        await expect(service.queryByWiql('BAD QUERY')).rejects.toThrow(AdoWorkItemError);
    });
});

// ── getComments ──────────────────────────────────────────────

describe('getComments', () => {
    it('returns the comment list on success', async () => {
        const comments = { totalCount: 1, comments: [{ id: 1, text: 'hi' }] };
        mockClient.getComments.mockResolvedValue(comments);

        const result = await service.getComments('Proj', 42);

        expect(result).toBe(comments);
        expect(mockClient.getComments).toHaveBeenCalledWith('Proj', 42);
    });

    it('wraps client errors as AdoWorkItemError', async () => {
        mockClient.getComments.mockRejectedValue(new Error('denied'));

        await expect(service.getComments('Proj', 42)).rejects.toThrow(AdoWorkItemError);
    });
});

// ── addComment ───────────────────────────────────────────────

describe('addComment', () => {
    it('sends { text } and returns the comment', async () => {
        const comment = { id: 5, text: 'Nice fix!' };
        mockClient.addComment.mockResolvedValue(comment);

        const result = await service.addComment('Proj', 42, 'Nice fix!');

        expect(result).toBe(comment);
        expect(mockClient.addComment).toHaveBeenCalledWith({ text: 'Nice fix!' }, 'Proj', 42);
    });

    it('wraps client errors as AdoWorkItemError', async () => {
        mockClient.addComment.mockRejectedValue(new Error('rate limited'));

        await expect(service.addComment('Proj', 42, 'text')).rejects.toThrow(AdoWorkItemError);
    });
});

// ── getClient error ──────────────────────────────────────────

describe('getClient error handling', () => {
    it('wraps getWorkItemTrackingApi failure as AdoWorkItemError', async () => {
        const failConnection = {
            getWorkItemTrackingApi: vi.fn().mockRejectedValue(new Error('connection refused')),
        } as unknown as WebApi;
        const failService = new AdoWorkItemsService(failConnection);

        await expect(failService.getWorkItem(1)).rejects.toThrow(AdoWorkItemError);
        await expect(failService.getWorkItem(1)).rejects.toThrow('Failed to get WorkItemTracking API client');
    });
});
