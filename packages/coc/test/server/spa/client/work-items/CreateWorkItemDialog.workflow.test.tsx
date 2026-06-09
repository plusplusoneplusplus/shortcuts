/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    create: vi.fn(),
    workflowEnabled: true,
    hierarchyEnabled: false,
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isWorkItemsWorkflowEnabled: () => mocks.workflowEnabled,
    isWorkItemsHierarchyEnabled: () => mocks.hierarchyEnabled,
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            create: mocks.create,
        },
    }),
}));

import { CreateWorkItemDialog } from '../../../../../src/server/spa/client/react/features/work-items/CreateWorkItemDialog';

describe('CreateWorkItemDialog workflow mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.workflowEnabled = true;
        mocks.hierarchyEnabled = false;
        mocks.create.mockResolvedValue({
            id: 'wi-1',
            title: 'Draft local goal',
            description: '',
            status: 'created',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('shows a Work Item vs Goal type selector for workflow shell creation', async () => {
        const onCreated = vi.fn();
        render(
            <CreateWorkItemDialog
                open={true}
                onClose={vi.fn()}
                workspaceId="ws-1"
                onCreated={onCreated}
                itemType="work-item"
            />,
        );

        const typeSelect = screen.getByTestId('create-work-item-type') as HTMLSelectElement;
        expect([...typeSelect.options].map(option => option.value)).toEqual(['work-item', 'goal']);

        fireEvent.change(screen.getByTestId('create-work-item-title'), { target: { value: 'Draft local goal' } });
        fireEvent.change(typeSelect, { target: { value: 'goal' } });
        fireEvent.click(screen.getByText('Create'));

        await waitFor(() => expect(mocks.create).toHaveBeenCalled());
        expect(mocks.create.mock.calls[0][1]).toMatchObject({
            title: 'Draft local goal',
            type: 'goal',
            source: 'manual',
        });
    });

    it('keeps existing bug creation out of the workflow selector', async () => {
        render(
            <CreateWorkItemDialog
                open={true}
                onClose={vi.fn()}
                workspaceId="ws-1"
                itemType="bug"
            />,
        );

        expect(screen.queryByTestId('create-work-item-type')).toBeNull();
        fireEvent.change(screen.getByTestId('create-work-item-title'), { target: { value: 'Fix crash' } });
        fireEvent.click(screen.getByText('Create'));

        await waitFor(() => expect(mocks.create).toHaveBeenCalled());
        expect(mocks.create.mock.calls[0][1]).toMatchObject({
            title: 'Fix crash',
            type: 'bug',
            source: 'manual',
        });
    });
});
