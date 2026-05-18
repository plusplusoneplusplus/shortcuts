/**
 * Tests for PullRequestsTab component.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// Mock getApiBase so fetch URLs are predictable.
vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
}));

// Mock AppContext to avoid full context setup.
const mockDispatch = vi.fn();
let mockSelectedPrId: number | string | null = null;
vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { selectedPrId: mockSelectedPrId }, dispatch: mockDispatch }),
}));

// Default to desktop layout.
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

function mockFetchError(status: number, body: object) {
    global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.resolve(body),
    } as any);
}

function mockFetchNetworkError() {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));
}

async function renderTab(props: Partial<any> = {}) {
    const { PullRequestsTab } = await import(
        '../../../../../src/server/spa/client/react/features/pull-requests/PullRequestsTab'
    );
    return render(
        <PullRequestsTab repoId="repo-1" workspaceId="ws-1" {...props} />
    );
}

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockDispatch.mockReset();
    mockSelectedPrId = null;
});

// ── Loading state ──────────────────────────────────────────────────────────────

describe('loading state', () => {
    it('shows loading spinner while fetch is pending', async () => {
        global.fetch = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });
});

// ── Successful fetch ───────────────────────────────────────────────────────────

describe('successful fetch', () => {
    it('renders PR rows after fetch resolves', async () => {
        mockFetchOk([makePr({ id: 1, title: 'PR One' }), makePr({ id: 2, title: 'PR Two' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(2));
        expect(screen.getByText('PR One')).toBeInTheDocument();
        expect(screen.getByText('PR Two')).toBeInTheDocument();
    });

    it('renders the PR queue header with title and collapse toggle', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        const header = screen.getByTestId('pr-queue-header');
        expect(header).toBeInTheDocument();
        expect(header.textContent).toContain('PR queue');
        expect(screen.getByTestId('pr-queue-toggle')).toBeInTheDocument();
    });

    it('renders the search input, refresh, and select controls', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('search-input')).toBeInTheDocument();
        expect(screen.getByTestId('refresh-button')).toBeInTheDocument();
        expect(screen.getByTestId('select-mode-button')).toBeInTheDocument();
    });

    it('renders the four queue filter pills', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('pr-queue-filter-all')).toBeInTheDocument();
        expect(screen.getByTestId('pr-queue-filter-mine')).toBeInTheDocument();
        expect(screen.getByTestId('pr-queue-filter-blocked')).toBeInTheDocument();
        expect(screen.getByTestId('pr-queue-filter-ready')).toBeInTheDocument();
    });

    it('does not render queue footer (removed)', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        expect(screen.queryByTestId('pr-queue-footer')).not.toBeInTheDocument();
    });

    it('shows empty state when no PRs returned', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
    });

    it('hides load-more when last page has fewer than PAGE_SIZE items', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.queryByTestId('load-more')).not.toBeInTheDocument());
    });
});

// ── Client-side filtering ──────────────────────────────────────────────────────

describe('client-side filtering', () => {
    it('filters PRs by search text without re-fetching', async () => {
        mockFetchOk([
            makePr({ id: 1, title: 'Fix login bug' }),
            makePr({ id: 2, title: 'Update readme' }),
        ]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(2));

        const callsBefore = (global.fetch as any).mock.calls.length;
        fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'login' } });
        expect(screen.getAllByTestId('pr-row')).toHaveLength(1);
        expect(screen.getByText('Fix login bug')).toBeInTheDocument();
        // No additional fetch
        expect((global.fetch as any).mock.calls.length).toBe(callsBefore);
    });

    it('shows no-results message when filters eliminate all items', async () => {
        mockFetchOk([makePr({ id: 1, title: 'Something' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(1));

        fireEvent.change(screen.getByTestId('search-input'), { target: { value: 'nonexistent' } });
        expect(screen.getByTestId('no-results')).toBeInTheDocument();
    });
});

// ── Queue filter pills ─────────────────────────────────────────────────────────

describe('queue filter pills', () => {
    it('defaults to the "Mine" pill', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(1));
        expect(screen.getByTestId('pr-queue-filter-mine').getAttribute('data-active')).toBe('true');
    });

    it('selecting the "All" pill triggers a re-fetch with scope=all', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(1));

        const secondFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ pullRequests: [makePr({ id: 2, title: 'All PR' })] }),
        } as any);
        global.fetch = secondFetch;

        await act(async () => {
            fireEvent.click(screen.getByTestId('pr-queue-filter-all'));
        });
        await waitFor(() => expect(secondFetch).toHaveBeenCalled());
        const fetchUrl = secondFetch.mock.calls[0][0] as string;
        expect(fetchUrl).toContain('scope=all');
        expect(screen.getByTestId('pr-queue-filter-all').getAttribute('data-active')).toBe('true');
    });

    it('"Mine" stays on scope=mine and does not refetch when re-clicked', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(1));

        const callsBefore = (global.fetch as any).mock.calls.length;
        fireEvent.click(screen.getByTestId('pr-queue-filter-mine'));
        expect((global.fetch as any).mock.calls.length).toBe(callsBefore);
    });

    it('"Blocked" filters the list to PRs flagged as blocked', async () => {
        mockFetchOk([
            makePr({ id: 1, title: 'Ready', reviewers: [{ identity: { displayName: 'R' }, vote: 'approved' }] }),
            makePr({ id: 2, title: 'Blocked one', reviewers: [{ identity: { displayName: 'R' }, vote: 'waitingForAuthor' }] }),
        ]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(2));

        fireEvent.click(screen.getByTestId('pr-queue-filter-blocked'));
        const remaining = screen.getAllByTestId('pr-row');
        expect(remaining).toHaveLength(1);
        expect(remaining[0].textContent).toContain('Blocked one');
    });

    it('"Ready" filters the list to PRs ready after checks', async () => {
        mockFetchOk([
            makePr({ id: 1, title: 'Ready one', reviewers: [{ identity: { displayName: 'R' }, vote: 'approved' }] }),
            makePr({ id: 2, title: 'Blocked', reviewers: [{ identity: { displayName: 'R' }, vote: 'waitingForAuthor' }] }),
        ]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(2));

        fireEvent.click(screen.getByTestId('pr-queue-filter-ready'));
        const remaining = screen.getAllByTestId('pr-row');
        expect(remaining).toHaveLength(1);
        expect(remaining[0].textContent).toContain('Ready one');
    });

    it('renders pill counts derived from the fetched list', async () => {
        mockFetchOk([
            makePr({ id: 1, title: 'A', reviewers: [{ identity: { displayName: 'R' }, vote: 'approved' }] }),
            makePr({ id: 2, title: 'B', reviewers: [{ identity: { displayName: 'R' }, vote: 'waitingForAuthor' }] }),
            makePr({ id: 3, title: 'C', reviewers: [{ identity: { displayName: 'R' }, vote: 'approved' }] }),
        ]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(3));

        expect(screen.getByTestId('pr-queue-filter-all').textContent).toContain('3');
        expect(screen.getByTestId('pr-queue-filter-mine').textContent).toContain('3');
        expect(screen.getByTestId('pr-queue-filter-blocked').textContent).toContain('1');
        expect(screen.getByTestId('pr-queue-filter-ready').textContent).toContain('2');
    });
});

// ── Queue grouping ─────────────────────────────────────────────────────────────

describe('queue grouping', () => {
    it('groups PRs into Needs review and Ready after checks sections', async () => {
        mockFetchOk([
            makePr({ id: 1, title: 'A', reviewers: [{ identity: { displayName: 'R' }, vote: 'waitingForAuthor' }] }),
            makePr({ id: 2, title: 'B', reviewers: [{ identity: { displayName: 'R' }, vote: 'approved' }] }),
        ]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(2));

        const sections = screen.getAllByTestId('pr-queue-group');
        expect(sections.map(s => s.getAttribute('data-queue-section'))).toEqual([
            'needs-review',
            'ready',
        ]);
    });
});

// ── Load more ──────────────────────────────────────────────────────────────────

describe('load more', () => {
    it('shows load-more button when last page returned PAGE_SIZE (25) items', async () => {
        const prs = Array.from({ length: 25 }, (_, i) => makePr({ id: i + 1, title: `PR ${i + 1}` }));
        mockFetchOk(prs);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('load-more')).toBeInTheDocument());
    });

    it('appends additional PRs when load-more is clicked', async () => {
        const firstPage = Array.from({ length: 25 }, (_, i) => makePr({ id: i + 1, title: `PR ${i + 1}` }));
        const secondPage = [makePr({ id: 26, title: 'PR 26' })];
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ pullRequests: firstPage }) } as any)
            .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ pullRequests: secondPage }) } as any);

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(25));

        await act(async () => { fireEvent.click(screen.getByTestId('load-more')); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(26));
        expect(screen.getByText('PR 26')).toBeInTheDocument();
    });
});

// ── Unconfigured state (401) ───────────────────────────────────────────────────

describe('unconfigured state', () => {
    it('renders ProviderConfigPanel on 401 with unconfigured error', async () => {
        mockFetchError(401, { error: 'unconfigured', detected: 'github', remoteUrl: 'https://github.com/org/repo' });
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('provider-config-panel')).toBeInTheDocument());
        expect(screen.getAllByText(/github/i).length).toBeGreaterThan(0);
    });
});

// ── Error state ────────────────────────────────────────────────────────────────

describe('error state', () => {
    it('renders error message on non-401 fetch failure', async () => {
        mockFetchError(500, { message: 'Internal server error' });
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('error-message')).toBeInTheDocument());
        expect(screen.getByText('Internal server error')).toBeInTheDocument();
    });

    it('renders fallback error message on network failure', async () => {
        mockFetchNetworkError();
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('error-message')).toBeInTheDocument());
        expect(screen.getByText('Network failure')).toBeInTheDocument();
    });
});

// ── Row click ──────────────────────────────────────────────────────────────────

describe('row click', () => {
    it('dispatches SET_SELECTED_PR with pr.number and updates hash when a row is clicked', async () => {
        // number (42) is the sequential PR number; id (3395712046) is the GitHub DB id.
        mockFetchOk([makePr({ id: 3395712046, number: 42, title: 'My PR' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('pr-row'));
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_PR', prId: 42 });
        expect(window.location.hash).toContain('pull-requests/42');
    });

    it('does NOT use the GitHub internal DB id in the hash (regression: pr detail 404)', async () => {
        // Regression guard: using pr.id (large DB id) as pull_number returns 404 from GitHub API.
        mockFetchOk([makePr({ id: 3395712046, number: 7, title: 'Regression PR' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('pr-row'));
        // Must use the sequential number, never the large DB id.
        expect(window.location.hash).not.toContain('3395712046');
        expect(window.location.hash).toContain('pull-requests/7');
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_PR', prId: 7 });
    });

    it('falls back to pr.id when pr.number is absent', async () => {
        // ADO PRs or legacy data may omit number; id should be used as fallback.
        const prWithoutNumber = makePr({ id: 99, title: 'ADO PR' });
        delete prWithoutNumber.number;
        mockFetchOk([prWithoutNumber]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('pr-row'));
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_PR', prId: 99 });
        expect(window.location.hash).toContain('pull-requests/99');
    });
});

// ── Split-panel layout ─────────────────────────────────────────────────────────

describe('split-panel layout', () => {
    it('renders pr-split-panel container', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('pr-split-panel')).toBeInTheDocument();
    });

    it('renders pr-list-panel and pr-detail-panel on desktop', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('pr-list-panel')).toBeInTheDocument();
        expect(screen.getByTestId('pr-detail-panel')).toBeInTheDocument();
    });

    it('renders pr-resize-handle on desktop', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('pr-resize-handle')).toBeInTheDocument();
    });

    it('shows pr-empty-state in right panel when no PR is selected', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-empty-state')).toBeInTheDocument());
        expect(screen.getByTestId('pr-empty-state').textContent).toContain('Select a pull request');
    });

    it('list panel remains in DOM after PR row click (no hidden toggle)', async () => {
        mockFetchOk([makePr({ id: 1, title: 'Test PR' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('pr-row'));

        // List panel must still be in the DOM
        expect(screen.getByTestId('pr-list-panel')).toBeInTheDocument();
        expect(screen.getByTestId('pr-list')).toBeInTheDocument();
    });
});

// ── Queue collapse toggle ─────────────────────────────────────────────────────

describe('queue collapse toggle', () => {
    beforeEach(() => {
        try { localStorage.removeItem('pr-queue-collapsed'); } catch { /* ignore */ }
    });

    it('starts expanded by default', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        const header = screen.getByTestId('pr-queue-header');
        expect(header.getAttribute('data-collapsed')).toBe('false');
        expect(screen.getByTestId('pr-queue-toggle').getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('pr-queue-toggle').textContent).toContain('<');
    });

    it('collapses queue when toggle is clicked, hiding toolbar and filters', async () => {
        mockFetchOk([makePr({ id: 1, title: 'Hidden Title' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        await act(async () => { fireEvent.click(screen.getByTestId('pr-queue-toggle')); });

        const header = screen.getByTestId('pr-queue-header');
        expect(header.getAttribute('data-collapsed')).toBe('true');
        expect(screen.getByTestId('pr-queue-toggle').textContent).toContain('>');
        expect(screen.queryByTestId('search-input')).not.toBeInTheDocument();
        expect(screen.queryByTestId('refresh-button')).not.toBeInTheDocument();
        expect(screen.queryByTestId('select-mode-button')).not.toBeInTheDocument();
        expect(screen.queryByTestId('pr-queue-filter-all')).not.toBeInTheDocument();
        expect(screen.queryByTestId('pr-queue-footer')).not.toBeInTheDocument();
        expect(screen.queryByText('Hidden Title')).not.toBeInTheDocument();
    });

    it('renders compact PR rows that show only the state dot when collapsed', async () => {
        mockFetchOk([makePr({ id: 1, title: 'Compact PR' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        await act(async () => { fireEvent.click(screen.getByTestId('pr-queue-toggle')); });

        const row = screen.getByTestId('pr-row');
        expect(row.getAttribute('data-compact')).toBe('true');
        expect(screen.getByTestId('pr-state-dot')).toBeInTheDocument();
        expect(screen.queryByText('Compact PR')).not.toBeInTheDocument();
        expect(screen.queryByTestId('pr-risk-pill')).not.toBeInTheDocument();
    });

    it('hides the resize handle when collapsed', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('pr-resize-handle')).toBeInTheDocument();

        await act(async () => { fireEvent.click(screen.getByTestId('pr-queue-toggle')); });
        expect(screen.queryByTestId('pr-resize-handle')).not.toBeInTheDocument();
    });

    it('persists collapsed state across remounts via localStorage', async () => {
        mockFetchOk([]);
        const { unmount } = await renderTab();
        await act(async () => { fireEvent.click(screen.getByTestId('pr-queue-toggle')); });
        expect(screen.getByTestId('pr-queue-header').getAttribute('data-collapsed')).toBe('true');
        unmount();

        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('pr-queue-header').getAttribute('data-collapsed')).toBe('true');
    });

    it('restores expanded state when toggle is clicked again', async () => {
        mockFetchOk([makePr({ id: 1, title: 'Toggle PR' })]);
        await act(async () => { await renderTab(); });
        await act(async () => { fireEvent.click(screen.getByTestId('pr-queue-toggle')); });
        expect(screen.getByTestId('pr-queue-header').getAttribute('data-collapsed')).toBe('true');

        await act(async () => { fireEvent.click(screen.getByTestId('pr-queue-toggle')); });
        expect(screen.getByTestId('pr-queue-header').getAttribute('data-collapsed')).toBe('false');
        expect(screen.getByTestId('search-input')).toBeInTheDocument();
        expect(screen.getByTestId('pr-queue-filter-all')).toBeInTheDocument();
        expect(screen.getByText('Toggle PR')).toBeInTheDocument();
    });
});

// ── Batch mode toggle (Select button) ─────────────────────────────────────────

describe('batch mode toggle', () => {
    it('shows "Select" button in toolbar', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('select-mode-button')).toBeInTheDocument();
        expect(screen.getByTestId('select-mode-button').textContent).toBe('Select');
    });

    it('reveals row checkboxes when Select is clicked in flat mode', async () => {
        mockFetchOk([makePr({ id: 1, title: 'Solo PR' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        expect(screen.queryByTestId('pr-row-checkbox')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('select-mode-button'));
        expect(screen.getByTestId('pr-row-checkbox')).toBeInTheDocument();
    });

    it('changes button label to "Cancel" when batch mode is active', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        fireEvent.click(screen.getByTestId('select-mode-button'));
        expect(screen.getByTestId('select-mode-button').textContent).toBe('Cancel');
    });

    it('clicking Cancel clears selection and hides checkboxes', async () => {
        mockFetchOk([makePr({ id: 1, title: 'Solo PR' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        // Activate batch mode and select the PR
        fireEvent.click(screen.getByTestId('select-mode-button'));
        fireEvent.click(screen.getByTestId('pr-row-checkbox'));
        await waitFor(() => expect(screen.getByTestId('selection-count-bar')).toBeInTheDocument());

        // Cancel batch mode
        fireEvent.click(screen.getByTestId('select-mode-button'));

        await waitFor(() => expect(screen.queryByTestId('pr-row-checkbox')).not.toBeInTheDocument());
        expect(screen.queryByTestId('selection-count-bar')).not.toBeInTheDocument();
        expect(screen.getByTestId('select-mode-button').textContent).toBe('Select');
    });

    it('selection-count-bar only shows in batch mode', async () => {
        mockFetchOk([makePr({ id: 1, title: 'Solo PR' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        // Before batch mode: no count bar
        expect(screen.queryByTestId('selection-count-bar')).not.toBeInTheDocument();

        // Enable batch mode and select
        fireEvent.click(screen.getByTestId('select-mode-button'));
        fireEvent.click(screen.getByTestId('pr-row-checkbox'));
        await waitFor(() => expect(screen.getByTestId('selection-count-bar')).toHaveTextContent('1 PR selected'));
    });
});

// ── Active PR row highlight ────────────────────────────────────────────────────

describe('active PR row highlight', () => {
    it('marks the matching row isSelected when selectedPrId is a number (click-nav)', async () => {
        mockSelectedPrId = 42;
        mockFetchOk([makePr({ id: 1, number: 42, title: 'Active PR' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        const row = screen.getByTestId('pr-row');
        expect(row.className).toContain('bg-gray-100');
        expect(row.className).toContain('border-l-gray-500');
    });

    it('marks the matching row isSelected when selectedPrId is a string (URL deep-link)', async () => {
        // Router stores the PR id from the hash as a string via decodeURIComponent.
        mockSelectedPrId = '42';
        mockFetchOk([makePr({ id: 1, number: 42, title: 'Active PR' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        const row = screen.getByTestId('pr-row');
        expect(row.className).toContain('bg-gray-100');
        expect(row.className).toContain('border-l-gray-500');
    });

    it('does not mark a row selected when the id does not match', async () => {
        mockSelectedPrId = 99;
        mockFetchOk([makePr({ id: 1, number: 42, title: 'Other PR' })]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        const row = screen.getByTestId('pr-row');
        expect(row.className).not.toContain('bg-gray-100');
        expect(row.className).toContain('border-l-transparent');
    });
});

