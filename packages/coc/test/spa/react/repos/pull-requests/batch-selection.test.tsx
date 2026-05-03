import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionGroup } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-attention-groups';

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

const mockDispatch = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { selectedPrId: null }, dispatch: mockDispatch }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 288,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        resetWidth: vi.fn(),
    }),
}));

const makePr = (number: number, title: string) => ({
    id: number,
    number,
    title,
    sourceBranch: `feature/pr-${number}`,
    targetBranch: 'main',
    status: 'open',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-16T12:30:00Z',
    author: { displayName: 'Alice' },
    reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'approved' }],
});

function mockFetchOk(pullRequests: unknown[]) {
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ pullRequests }),
    } as Response);
}

async function renderTab() {
    const { PullRequestsTab } = await import(
        '../../../../../src/server/spa/client/react/features/pull-requests/PullRequestsTab'
    );
    return render(<PullRequestsTab repoId="repo-1" workspaceId="ws-1" />);
}

async function renderBatchSelection() {
    mockFetchOk([
        makePr(1, 'First merge-ready PR'),
        makePr(2, 'Second merge-ready PR'),
        makePr(3, 'Third merge-ready PR'),
    ]);

    await act(async () => { await renderTab(); });
    await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(3));

    const section = document.querySelector(`[data-group-id="${AttentionGroup.MergeValidation}"]`) as HTMLElement;
    return {
        section,
        groupCheckbox: within(section).getByTestId('group-select-all') as HTMLInputElement,
        rowCheckboxes: within(section).getAllByTestId('pr-row-checkbox') as HTMLInputElement[],
    };
}

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockDispatch.mockReset();
});

describe('pull request batch selection', () => {
    it('toggles a row checkbox without navigating to PR detail', async () => {
        const { rowCheckboxes } = await renderBatchSelection();

        fireEvent.click(rowCheckboxes[0]);

        await waitFor(() => expect(screen.getByTestId('selection-count-bar')).toHaveTextContent('1 PR selected'));
        expect(rowCheckboxes[0].checked).toBe(true);
        expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('keeps row-body click navigation separate from checkbox selection', async () => {
        await renderBatchSelection();

        fireEvent.click(screen.getAllByTestId('pr-row')[0]);

        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_PR', prId: 1 });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_PR_DETAIL_TAB', tab: 'overview' });
    });

    it('selects and deselects all PRs in a group from the group header checkbox', async () => {
        const { groupCheckbox, rowCheckboxes } = await renderBatchSelection();

        fireEvent.click(groupCheckbox);

        await waitFor(() => expect(screen.getByTestId('selection-count-bar')).toHaveTextContent('3 PRs selected'));
        expect(groupCheckbox.checked).toBe(true);
        expect(rowCheckboxes.every(checkbox => checkbox.checked)).toBe(true);

        fireEvent.click(groupCheckbox);

        await waitFor(() => expect(screen.queryByTestId('selection-count-bar')).toBeNull());
        expect(groupCheckbox.checked).toBe(false);
        expect(rowCheckboxes.every(checkbox => !checkbox.checked)).toBe(true);
    });

    it('shows an indeterminate group header when one selected PR is deselected', async () => {
        const { groupCheckbox, rowCheckboxes } = await renderBatchSelection();

        fireEvent.click(groupCheckbox);
        await waitFor(() => expect(groupCheckbox.checked).toBe(true));

        fireEvent.click(rowCheckboxes[1]);

        await waitFor(() => expect(screen.getByTestId('selection-count-bar')).toHaveTextContent('2 PRs selected'));
        expect(groupCheckbox.checked).toBe(false);
        expect(groupCheckbox.indeterminate).toBe(true);
    });

    it('shift-click selects an inclusive range within the group', async () => {
        const { rowCheckboxes } = await renderBatchSelection();

        fireEvent.click(rowCheckboxes[0]);
        await waitFor(() => expect(screen.getByTestId('selection-count-bar')).toHaveTextContent('1 PR selected'));

        fireEvent.click(rowCheckboxes[2], { shiftKey: true });

        await waitFor(() => expect(screen.getByTestId('selection-count-bar')).toHaveTextContent('3 PRs selected'));
        expect(rowCheckboxes.every(checkbox => checkbox.checked)).toBe(true);
    });

    it('clears selected PRs from the selection count bar', async () => {
        const { rowCheckboxes } = await renderBatchSelection();

        fireEvent.click(rowCheckboxes[0]);
        await waitFor(() => expect(screen.getByTestId('selection-count-bar')).toHaveTextContent('1 PR selected'));

        fireEvent.click(screen.getByTestId('clear-selection'));

        await waitFor(() => expect(screen.queryByTestId('selection-count-bar')).toBeNull());
        expect(rowCheckboxes.every(checkbox => !checkbox.checked)).toBe(true);
    });
});
