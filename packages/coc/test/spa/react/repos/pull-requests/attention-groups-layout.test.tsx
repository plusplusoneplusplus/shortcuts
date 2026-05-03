import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const makePr = (overrides: Partial<any> = {}) => ({
    id: 1,
    number: 1,
    title: 'Fix bug',
    sourceBranch: 'feature/fix',
    targetBranch: 'main',
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: { displayName: 'Alice' },
    reviewers: [],
    ...overrides,
});

function mockFetchOk(pullRequests: any[]) {
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ pullRequests }),
    } as any);
}

async function renderTab() {
    const { PullRequestsTab } = await import(
        '../../../../../src/server/spa/client/react/features/pull-requests/PullRequestsTab'
    );
    return render(<PullRequestsTab repoId="repo-1" workspaceId="ws-1" />);
}

function groupedPrs() {
    const stale = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    return [
        makePr({ id: 1, number: 1, title: 'Rerun flaky checks', labels: ['ci-failed'] }),
        makePr({ id: 2, number: 2, title: 'Needs changes', reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'waitingForAuthor' }] }),
        makePr({ id: 3, number: 3, title: 'Waiting on review', updatedAt: stale, reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'noVote' }] }),
        makePr({ id: 4, number: 4, title: 'Ready to merge', reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'approved' }] }),
        makePr({ id: 95, number: 95, title: 'Rerun extra', labels: ['ci-failed'] }),
        makePr({ id: 96, number: 96, title: 'Ready to merge extra', reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'approved' }] }),
    ];
}

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockDispatch.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
});

describe('attention groups layout', () => {
    it('renders attention group sections only for non-empty groups, in config order', async () => {
        mockFetchOk(groupedPrs());

        await act(async () => { await renderTab(); });

        await waitFor(() => expect(screen.getAllByTestId('attention-group-section')).toHaveLength(4));
        expect(screen.getAllByTestId('attention-group-section').map(section => section.getAttribute('data-group-id'))).toEqual([
            AttentionGroup.RerunNeeded,
            AttentionGroup.ManualUpdateNeeded,
            AttentionGroup.ReviewerNudge,
            AttentionGroup.MergeValidation,
        ]);
    });

    it('shows accurate summary chip counts (zero-count groups hidden)', async () => {
        mockFetchOk([
            ...groupedPrs(),
            makePr({ id: 7, number: 7, title: 'Another rerun', description: 'Build failure in CI' }),
        ]);

        await act(async () => { await renderTab(); });

        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(7));
        // groupedPrs() has: 2 rerun + 1 manual + 1 nudge + 2 merge; plus 1 extra rerun = 3 rerun total
        expect(screen.getByTestId(`attention-summary-chip-${AttentionGroup.RerunNeeded}`)).toHaveTextContent('3');
        expect(screen.getByTestId(`attention-summary-chip-${AttentionGroup.ManualUpdateNeeded}`)).toHaveTextContent('1');
        expect(screen.getByTestId(`attention-summary-chip-${AttentionGroup.ReviewerNudge}`)).toHaveTextContent('1');
        expect(screen.getByTestId(`attention-summary-chip-${AttentionGroup.MergeValidation}`)).toHaveTextContent('2');
    });

    it('scrolls to the matching group when a summary chip is clicked', async () => {
        mockFetchOk(groupedPrs());

        await act(async () => { await renderTab(); });

        await waitFor(() => expect(screen.getAllByTestId('attention-group-section')).toHaveLength(4));
        const target = document.querySelector(`[data-group-id="${AttentionGroup.ManualUpdateNeeded}"]`) as HTMLElement;
        const scrollIntoView = vi.fn();
        target.scrollIntoView = scrollIntoView;

        fireEvent.click(screen.getByTestId(`attention-summary-chip-${AttentionGroup.ManualUpdateNeeded}`));

        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });

    it('collapses and expands group rows from the section header', async () => {
        mockFetchOk(groupedPrs());

        await act(async () => { await renderTab(); });

        await waitFor(() => expect(screen.getByText('Needs changes')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId(`attention-group-toggle-${AttentionGroup.ManualUpdateNeeded}`));
        expect(screen.queryByText('Needs changes')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId(`attention-group-toggle-${AttentionGroup.ManualUpdateNeeded}`));
        expect(screen.getByText('Needs changes')).toBeInTheDocument();
    });

    it('hides attention summary bar and switches to flat list when search narrows to few PRs', async () => {
        mockFetchOk(groupedPrs());

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(6));

        // Filter to a single result — flat list mode kicks in, no attention bar
        fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'Waiting on review' } });

        expect(screen.getAllByTestId('pr-row')).toHaveLength(1);
        expect(screen.queryByTestId('attention-summary-bar')).toBeNull();
        expect(screen.queryByTestId('attention-group-section')).toBeNull();
    });
});
