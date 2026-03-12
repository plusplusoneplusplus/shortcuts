import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdoWorkItemsAdapter } from '../../src/ado/ado-work-items-adapter';
import type { AdoWorkItemsService } from '../../src/ado/workitems-service';
import type { WorkItem, Comment } from '../../src/providers/types';

// ── fixtures ─────────────────────────────────────────────────

const mockAdoWorkItem = {
    id: 100,
    fields: {
        'System.Title': 'Fix memory leak',
        'System.WorkItemType': 'Bug',
        'System.State': 'Active',
        'System.CreatedBy': { id: 'user-1', displayName: 'Alice', uniqueName: 'alice@example.com' },
        'System.AssignedTo': { id: 'user-2', displayName: 'Bob', uniqueName: 'bob@example.com' },
        'System.Description': '<p>Memory leak description</p>',
        'Microsoft.VSTS.Common.Priority': 1,
        'System.CreatedDate': '2024-01-01T00:00:00Z',
        'System.ChangedDate': '2024-01-02T00:00:00Z',
        'System.TeamProject': 'MyProject',
    },
    _links: { html: { href: 'https://dev.azure.com/org/proj/_workitems/100' } },
};

const mockAdoCommentList = {
    totalCount: 1,
    comments: [
        {
            id: 5,
            createdBy: { id: 'user-1', displayName: 'Alice', uniqueName: 'alice@example.com' },
            text: 'This is a comment',
            createdDate: '2024-01-01T10:00:00Z',
            modifiedDate: '2024-01-01T11:00:00Z',
            url: 'https://comment.url',
        },
    ],
};

function makeMockService(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): AdoWorkItemsService {
    return {
        getWorkItem: vi.fn().mockResolvedValue(mockAdoWorkItem),
        getWorkItems: vi.fn().mockResolvedValue([mockAdoWorkItem]),
        createWorkItem: vi.fn().mockResolvedValue(mockAdoWorkItem),
        updateWorkItem: vi.fn().mockResolvedValue(mockAdoWorkItem),
        queryByWiql: vi.fn().mockResolvedValue({ workItems: [] }),
        getComments: vi.fn().mockResolvedValue(mockAdoCommentList),
        addComment: vi.fn().mockResolvedValue(mockAdoCommentList.comments[0]),
        ...overrides,
    } as unknown as AdoWorkItemsService;
}

// ── tests ─────────────────────────────────────────────────────

describe('AdoWorkItemsAdapter', () => {
    let service: AdoWorkItemsService;
    let adapter: AdoWorkItemsAdapter;

    beforeEach(() => {
        service = makeMockService();
        adapter = new AdoWorkItemsAdapter(service);
    });

    // ── getWorkItem ──────────────────────────────────────────

    describe('getWorkItem', () => {
        it('maps ADO work item to canonical WorkItem', async () => {
            const wi: WorkItem = await adapter.getWorkItem(100, 'MyProject');
            expect(wi.id).toBe(100);
            expect(wi.title).toBe('Fix memory leak');
            expect(wi.type).toBe('Bug');
            expect(wi.state).toBe('Active');
            expect(wi.author.id).toBe('user-1');
            expect(wi.author.email).toBe('alice@example.com');
            expect(wi.assignees).toHaveLength(1);
            expect(wi.assignees[0].id).toBe('user-2');
            expect(wi.description).toBe('<p>Memory leak description</p>');
            expect(wi.priority).toBe(1);
            expect(wi.projectId).toBe('MyProject');
            expect(wi.url).toBe('https://dev.azure.com/org/proj/_workitems/100');
            expect(wi.raw).toBe(mockAdoWorkItem);
        });

        it('calls service.getWorkItem with correct args', async () => {
            await adapter.getWorkItem(100, 'MyProject');
            expect(service.getWorkItem).toHaveBeenCalledWith(100, 'MyProject');
        });
    });

    // ── getWorkItems ─────────────────────────────────────────

    describe('getWorkItems', () => {
        it('maps multiple work items', async () => {
            (service.getWorkItems as ReturnType<typeof vi.fn>).mockResolvedValue([mockAdoWorkItem, mockAdoWorkItem]);
            const items = await adapter.getWorkItems([100, 101]);
            expect(items).toHaveLength(2);
            expect(items[0].title).toBe('Fix memory leak');
        });

        it('calls service.getWorkItems with numeric IDs', async () => {
            await adapter.getWorkItems([100, '101']);
            expect(service.getWorkItems).toHaveBeenCalledWith([100, 101], undefined);
        });
    });

    // ── createWorkItem ───────────────────────────────────────

    describe('createWorkItem', () => {
        it('maps input fields and calls service.createWorkItem', async () => {
            await adapter.createWorkItem('MyProject', 'Bug', {
                title: 'New Bug',
                description: 'desc',
                priority: 2,
            });
            expect(service.createWorkItem).toHaveBeenCalledWith('MyProject', 'Bug', {
                'System.Title': 'New Bug',
                'System.Description': 'desc',
                'Microsoft.VSTS.Common.Priority': 2,
            });
        });

        it('returns mapped canonical WorkItem', async () => {
            const wi = await adapter.createWorkItem('MyProject', 'Bug', { title: 'x' });
            expect(wi.id).toBe(100);
        });
    });

    // ── updateWorkItem ───────────────────────────────────────

    describe('updateWorkItem', () => {
        it('maps update fields and calls service.updateWorkItem', async () => {
            await adapter.updateWorkItem(100, {
                title: 'Updated',
                state: 'Resolved',
                priority: 3,
            }, 'MyProject');
            expect(service.updateWorkItem).toHaveBeenCalledWith(100, {
                'System.Title': 'Updated',
                'System.State': 'Resolved',
                'Microsoft.VSTS.Common.Priority': 3,
            }, 'MyProject');
        });
    });

    // ── searchWorkItems ──────────────────────────────────────

    describe('searchWorkItems', () => {
        it('returns empty array when WIQL returns no work items', async () => {
            const items = await adapter.searchWorkItems('SELECT * FROM WorkItems');
            expect(items).toHaveLength(0);
        });

        it('fetches work items by IDs returned from WIQL', async () => {
            (service.queryByWiql as ReturnType<typeof vi.fn>).mockResolvedValue({
                workItems: [{ id: 100 }, { id: 101 }],
            });
            (service.getWorkItems as ReturnType<typeof vi.fn>).mockResolvedValue([mockAdoWorkItem, mockAdoWorkItem]);

            const items = await adapter.searchWorkItems('SELECT * FROM WorkItems', 'MyProject', 10);

            expect(service.queryByWiql).toHaveBeenCalledWith('SELECT * FROM WorkItems', 'MyProject', 10);
            expect(service.getWorkItems).toHaveBeenCalledWith([100, 101], 'MyProject');
            expect(items).toHaveLength(2);
        });

        it('chunks IDs into groups of 200', async () => {
            const ids = Array.from({ length: 250 }, (_, i) => ({ id: i + 1 }));
            (service.queryByWiql as ReturnType<typeof vi.fn>).mockResolvedValue({ workItems: ids });
            (service.getWorkItems as ReturnType<typeof vi.fn>).mockResolvedValue([]);

            await adapter.searchWorkItems('SELECT * FROM WorkItems');

            expect(service.getWorkItems).toHaveBeenCalledTimes(2);
            const firstCall = (service.getWorkItems as ReturnType<typeof vi.fn>).mock.calls[0][0];
            expect(firstCall).toHaveLength(200);
        });
    });

    // ── getComments ──────────────────────────────────────────

    describe('getComments', () => {
        it('maps ADO comments to canonical Comment', async () => {
            const comments: Comment[] = await adapter.getComments(100, 'MyProject');
            expect(comments).toHaveLength(1);
            const comment = comments[0];
            expect(comment.id).toBe(5);
            expect(comment.body).toBe('This is a comment');
            expect(comment.author.email).toBe('alice@example.com');
            expect(comment.url).toBe('https://comment.url');
        });
    });

    // ── addComment ───────────────────────────────────────────

    describe('addComment', () => {
        it('calls service.addComment with correct args', async () => {
            await adapter.addComment(100, 'New comment', 'MyProject');
            expect(service.addComment).toHaveBeenCalledWith('MyProject', 100, 'New comment');
        });

        it('returns mapped canonical Comment', async () => {
            const comment = await adapter.addComment(100, 'Hello');
            expect(comment.id).toBe(5);
            expect(comment.body).toBe('This is a comment');
        });
    });
});
