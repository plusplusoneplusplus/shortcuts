/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    tree: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            tree: mocks.tree,
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) =>
        error instanceof Error ? error.message : fallback,
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isSessionContextAttachmentsEnabled: () => false,
    isWorkItemsSyncEnabled: () => false,
}));

import { WorkItemProvider, useWorkItems, type WorkItemSummary } from '../../../../../src/server/spa/client/react/contexts/WorkItemContext';
import { WorkItemHierarchyTree } from '../../../../../src/server/spa/client/react/features/work-items/WorkItemHierarchyTree';

let dispatchWorkItemAction: ReturnType<typeof useWorkItems>['dispatch'] | undefined;

function makeItem(id: string, title: string): WorkItemSummary {
    return {
        id,
        title,
        status: 'created',
        type: 'work-item',
        createdAt: '2026-06-12T00:00:00.000Z',
        updatedAt: '2026-06-12T00:00:00.000Z',
    };
}

function makeTreeResponse(title: string) {
    return {
        roots: [
            {
                item: makeItem(`item-${title}`, title),
                children: [],
            },
        ],
        total: 1,
    };
}

function DispatchCapture() {
    const { dispatch } = useWorkItems();
    dispatchWorkItemAction = dispatch;
    return null;
}

function renderTree(workspaceId = 'ws-1') {
    return render(
        <WorkItemProvider>
            <DispatchCapture />
            <WorkItemHierarchyTree
                workspaceId={workspaceId}
                selectedWorkItemId={null}
                onSelectWorkItem={vi.fn()}
                onCreated={vi.fn()}
                onCreateItem={vi.fn()}
                onImportFromGitHub={vi.fn()}
            />
        </WorkItemProvider>,
    );
}

describe('WorkItemHierarchyTree refresh behavior', () => {
    beforeEach(() => {
        dispatchWorkItemAction = undefined;
        mocks.tree.mockReset();
        mocks.tree.mockResolvedValue(makeTreeResponse('Initial item'));
    });

    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('refreshes the tree when a work item event arrives for the same workspace', async () => {
        renderTree('ws-1');

        await waitFor(() => expect(mocks.tree).toHaveBeenCalledTimes(1));

        mocks.tree.mockResolvedValue(makeTreeResponse('Created by tool'));
        act(() => {
            dispatchWorkItemAction?.({ type: 'WORK_ITEM_ADDED', repoId: 'ws-2', item: makeItem('other', 'Other workspace') });
        });
        await new Promise(resolve => setTimeout(resolve, 350));
        expect(mocks.tree).toHaveBeenCalledTimes(1);

        act(() => {
            dispatchWorkItemAction?.({ type: 'WORK_ITEM_ADDED', repoId: 'ws-1', item: makeItem('tool-created', 'Created by tool') });
        });

        await waitFor(() => expect(mocks.tree).toHaveBeenCalledTimes(2));
        expect(mocks.tree.mock.calls[1][0]).toBe('ws-1');
        expect(await screen.findByText('Created by tool')).toBeInTheDocument();
    });

    it('uses the toolbar refresh button to reload the tree endpoint', async () => {
        renderTree('ws-1');

        await waitFor(() => expect(mocks.tree).toHaveBeenCalledTimes(1));
        const refreshButton = screen.getByRole('button', { name: 'Refresh hierarchy tree' });
        expect(refreshButton).toHaveTextContent('Refresh');
        expect(refreshButton).not.toBeDisabled();

        mocks.tree.mockResolvedValue(makeTreeResponse('Manual refresh item'));
        fireEvent.click(refreshButton);

        await waitFor(() => expect(mocks.tree).toHaveBeenCalledTimes(2));
        expect(mocks.tree.mock.calls[1][0]).toBe('ws-1');
        expect(await screen.findByText('Manual refresh item')).toBeInTheDocument();
    });
});
