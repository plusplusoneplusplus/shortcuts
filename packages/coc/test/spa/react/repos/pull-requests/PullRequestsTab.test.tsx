/**
 * Tests for PullRequestsTab component.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

// Mock getApiBase so fetch URLs are predictable.
vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

// Mock AppContext to avoid full context setup.
const mockDispatch = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({ state: { selectedPrId: null }, dispatch: mockDispatch }),
}));

// Default to desktop layout.
vi.mock('../../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useResizablePanel', () => ({
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

    it('renders toolbar controls', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('search-input')).toBeInTheDocument();
        expect(screen.getByTestId('status-filter')).toBeInTheDocument();
        expect(screen.getByTestId('scope-dropdown-trigger')).toBeInTheDocument();
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

// ── Scope dropdown ─────────────────────────────────────────────────────────────

describe('scope dropdown', () => {
    it('defaults to "Mine" scope with correct label', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        const trigger = screen.getByTestId('scope-dropdown-trigger');
        expect(trigger.textContent).toContain('Mine');
    });

    it('opens dropdown menu on click and shows options', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(1));

        fireEvent.click(screen.getByTestId('scope-dropdown-trigger'));
        expect(screen.getByTestId('scope-dropdown-menu')).toBeInTheDocument();
        expect(screen.getByTestId('scope-option-mine')).toBeInTheDocument();
        expect(screen.getByTestId('scope-option-all')).toBeInTheDocument();
        expect(screen.getByTestId('scope-option-author')).toBeInTheDocument();
    });

    it('selecting "All" triggers re-fetch with scope=all', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(1));

        const secondFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ pullRequests: [makePr({ id: 2, title: 'All PR' })] }),
        } as any);

        // Open dropdown and select "All"
        fireEvent.click(screen.getByTestId('scope-dropdown-trigger'));
        global.fetch = secondFetch;
        await act(async () => {
            fireEvent.click(screen.getByTestId('scope-option-all'));
        });
        await waitFor(() => expect(secondFetch).toHaveBeenCalled());
        const fetchUrl = secondFetch.mock.calls[0][0] as string;
        expect(fetchUrl).toContain('scope=all');
    });

    it('selecting "Author…" shows author input field', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(1));

        fireEvent.click(screen.getByTestId('scope-dropdown-trigger'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('scope-option-author'));
        });
        expect(screen.getByTestId('author-input')).toBeInTheDocument();
        expect(screen.getByTestId('clear-author')).toBeInTheDocument();
    });

    it('clear author button reverts to "Mine" scope', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(1));

        // Enter author mode
        fireEvent.click(screen.getByTestId('scope-dropdown-trigger'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('scope-option-author'));
        });
        expect(screen.getByTestId('author-input')).toBeInTheDocument();

        // Clear author
        await act(async () => {
            fireEvent.click(screen.getByTestId('clear-author'));
        });
        expect(screen.getByTestId('scope-dropdown-trigger')).toBeInTheDocument();
        expect(screen.getByTestId('scope-dropdown-trigger').textContent).toContain('Mine');
    });
});

// ── Summary line ───────────────────────────────────────────────────────────────

describe('summary line', () => {
    it('shows summary line after PRs load', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('summary-line')).toBeInTheDocument());
        expect(screen.getByTestId('summary-line').textContent).toContain('your');
        expect(screen.getByTestId('summary-line').textContent).toContain('open');
    });

    it('shows "No pull requests found" in summary when list is empty', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('summary-line')).toBeInTheDocument());
        expect(screen.getByTestId('summary-line').textContent).toContain('No pull requests found');
    });
});

// ── Status filter ──────────────────────────────────────────────────────────────

describe('status filter', () => {
    it('triggers re-fetch when status filter changes', async () => {
        mockFetchOk([makePr()]);
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(1));

        // Replace fetch with a new spy that returns a different PR list.
        const secondFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ pullRequests: [makePr({ id: 2, title: 'Closed PR', status: 'closed' })] }),
        } as any);
        global.fetch = secondFetch;

        await act(async () => {
            fireEvent.change(screen.getByTestId('status-filter'), { target: { value: 'closed' } });
        });
        await waitFor(() => expect(secondFetch).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByText('Closed PR')).toBeInTheDocument());
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
