import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkItemSection } from '../../../../src/server/spa/client/react/features/work-items/WorkItemSection';
import { WorkItemHierarchyTree } from '../../../../src/server/spa/client/react/features/work-items/WorkItemHierarchyTree';

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    tree: vi.fn(),
    grouped: vi.fn(),
    syncStatus: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/WorkItemContext', () => ({
    useWorkItems: () => ({
        state: {
            workItemsByRepo: {
                'ws-test': [{
                    id: 'wi-imported',
                    title: 'Imported issue',
                    status: 'created',
                    type: 'bug',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                }],
            },
            paginationByRepo: {
                'ws-test': {
                    created: { total: 1, hasMore: false, offset: 1 },
                },
            },
            loading: {},
        },
        dispatch: mocks.dispatch,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            tree: mocks.tree,
            grouped: mocks.grouped,
            syncStatus: mocks.syncStatus,
        },
    }),
    getSpaCocClientErrorMessage: (_error: unknown, fallback: string) => fallback,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isWorkItemsSyncEnabled: () => false,
}));

const importedItem = {
    id: 'wi-imported',
    title: 'Imported issue',
    status: 'created',
    type: 'bug',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Import from remote work item placement', () => {
    let scrollIntoView: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        scrollIntoView = vi.fn();
        HTMLElement.prototype.scrollIntoView = scrollIntoView;
        mocks.grouped.mockResolvedValue({
            groups: {
                created: { items: [importedItem], total: 1, hasMore: false },
            },
        });
        mocks.tree.mockResolvedValue({
            disabled: false,
            total: 1,
            roots: [{
                item: importedItem,
                children: [],
                rollup: {
                    descendantCount: 0,
                    byStatus: {},
                },
            }],
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('scrolls the highlighted imported item into view in the non-hierarchy list', async () => {
        render(
            <WorkItemSection
                workspaceId="ws-test"
                onSelectWorkItem={vi.fn()}
                selectedWorkItemId={null}
                highlightedWorkItemId="wi-imported"
            />,
        );

        await waitFor(() => {
            expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
        });
        expect(screen.getByTestId('work-item-card-wi-imported').className).toContain('animate-pulse');
    });

    it('renders the Remote hierarchy import action and scrolls the highlighted imported tree row into view', async () => {
        const onImportFromRemote = vi.fn();
        render(
            <WorkItemHierarchyTree
                workspaceId="ws-test"
                trackerViewKind="remote"
                trackerKinds={['github-backed']}
                selectedWorkItemId={null}
                onSelectWorkItem={vi.fn()}
                onCreated={vi.fn()}
                onCreateItem={vi.fn()}
                onImportFromRemote={onImportFromRemote}
                highlightedWorkItemId="wi-imported"
            />,
        );

        const importButton = await screen.findByRole('button', { name: 'Import remote' });
        fireEvent.click(importButton);

        expect(onImportFromRemote).toHaveBeenCalledTimes(1);
        await waitFor(() => {
            expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
        });
        expect(screen.getByTestId('hierarchy-node-row-wi-imported').className).toContain('animate-pulse');
    });
});
