/**
 * Tests for PullRequestsTab component.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';

const configMock = vi.hoisted(() => ({
    pullRequestsSuggestionsEnabled: false,
}));

const prefsMocks = vi.hoisted(() => ({
    getWorkspacePreferences: vi.fn().mockResolvedValue({}),
    patchWorkspacePreferences: vi.fn().mockResolvedValue(undefined),
}));

// Mock getApiBase so fetch URLs are predictable.
vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isPullRequestsSuggestionsEnabled: () => configMock.pullRequestsSuggestionsEnabled,
    getActiveProvider: () => 'copilot',
}));

// Mock AppContext to avoid full context setup.
const mockDispatch = vi.fn();
let mockSelectedPrId: number | string | null = null;
let mockWorkspaces: Array<{ id: string; remoteUrl?: string }> = [];
vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { selectedPrId: mockSelectedPrId, workspaces: mockWorkspaces }, dispatch: mockDispatch }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/preferences/preferencesApi', () => ({
    getWorkspacePreferences: prefsMocks.getWorkspacePreferences,
    patchWorkspacePreferences: prefsMocks.patchWorkspacePreferences,
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

const makeRecentEntry = (overrides: Partial<any> = {}) => ({
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 1,
    title: 'Fix bug',
    openedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

const makeCoworkerEntry = (overrides: Partial<any> = {}) => ({
    id: 'coworker-1',
    displayName: 'Coworker One',
    addedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
    return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        statusText: init.statusText ?? '',
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
    } as any;
}

function mockFetchOk(pullRequests: any[], extra: Record<string, unknown> = {}) {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ pullRequests, entries: [], ...extra }));
}

function mockFetchError(status: number, body: object) {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(body, { ok: false, status }));
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
    prefsMocks.getWorkspacePreferences.mockResolvedValue({});
    prefsMocks.patchWorkspacePreferences.mockResolvedValue(undefined);
    configMock.pullRequestsSuggestionsEnabled = false;
    mockDispatch.mockReset();
    mockSelectedPrId = null;
    mockWorkspaces = [];
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

    it('renders the queue filter pills', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        expect(screen.getByTestId('pr-queue-filter-all')).toBeInTheDocument();
        expect(screen.getByTestId('pr-queue-filter-mine')).toBeInTheDocument();
        expect(screen.getByTestId('pr-queue-filter-team')).toBeInTheDocument();
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
        await waitFor(() => expect((global.fetch as any).mock.calls.some((call: any[]) =>
            String(call[0]).includes('/coworker-roster'),
        )).toBe(true));

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

    it('selecting the "Team" pill fetches scope=all and filters to roster authors', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({
                pullRequests: [makePr({ id: 1, number: 1, title: 'Mine PR', author: { id: 'me', displayName: 'Me' } })],
            }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({
                entries: [
                    makeCoworkerEntry({ id: 'github-123', displayName: 'Bob' }),
                    makeCoworkerEntry({ id: '', displayName: 'Cara' }),
                ],
            }))
            .mockResolvedValueOnce(jsonResponse({
                pullRequests: [
                    makePr({ id: 2, number: 2, title: 'Bob PR', author: { id: 'github-123', displayName: 'Robert' } }),
                    makePr({ id: 3, number: 3, title: 'Cara PR', author: { displayName: 'cara' } }),
                    makePr({ id: 4, number: 4, title: 'Stranger PR', author: { id: 'stranger', displayName: 'Stranger' } }),
                ],
            }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-queue-filter-team')).toBeInTheDocument());
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

        await act(async () => {
            fireEvent.click(screen.getByTestId('pr-queue-filter-team'));
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        expect(String(fetchMock.mock.calls[3][0])).toContain('scope=all');
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(2));
        expect(screen.getByText('Bob PR')).toBeInTheDocument();
        expect(screen.getByText('Cara PR')).toBeInTheDocument();
        expect(screen.queryByText('Stranger PR')).not.toBeInTheDocument();
        expect(screen.getByTestId('pr-queue-filter-team')).toHaveTextContent('2');
    });

    it('manages the Team roster inline with add, toggle, and remove controls', async () => {
        let roster = [
            makeCoworkerEntry({ id: 'github-123', displayName: 'Bob Dev' }),
        ];
        const allPrs = [
            makePr({ id: 2, number: 2, title: 'Bob PR', author: { id: 'github-123', displayName: 'Bob Dev' } }),
            makePr({ id: 3, number: 3, title: 'Bob Follow-up PR', author: { id: 'github-123', displayName: 'Robert Dev' } }),
            makePr({ id: 4, number: 4, title: 'Cara PR', author: { displayName: 'Cara Dev' } }),
            makePr({ id: 5, number: 5, title: 'Stranger PR', author: { id: 'stranger', displayName: 'Stranger Dev' } }),
        ];
        const entryKey = (entry: { id?: string; displayName: string }) => (entry.id || entry.displayName).trim().toLowerCase();
        const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = init?.method ?? 'GET';

            if (url.includes('/coworker-roster')) {
                if (method === 'POST') {
                    const body = JSON.parse(init?.body as string) as { id?: string; displayName: string; email?: string; avatarUrl?: string };
                    const nextEntry = makeCoworkerEntry({
                        id: body.id ?? '',
                        displayName: body.displayName,
                        ...(body.email ? { email: body.email } : {}),
                        ...(body.avatarUrl ? { avatarUrl: body.avatarUrl } : {}),
                    });
                    roster = [...roster.filter(entry => entryKey(entry) !== entryKey(nextEntry)), nextEntry];
                    return Promise.resolve(jsonResponse({ entries: roster }));
                }
                if (method === 'DELETE') {
                    const rawKey = decodeURIComponent(url.split('/coworker-roster/')[1].split('?')[0]).toLowerCase();
                    roster = roster.filter(entry => entryKey(entry) !== rawKey);
                    return Promise.resolve(jsonResponse({ entries: roster }));
                }
                return Promise.resolve(jsonResponse({ entries: roster }));
            }

            if (url.includes('/recent-opened')) {
                return Promise.resolve(jsonResponse({ entries: [] }));
            }

            if (url.includes('scope=all')) {
                return Promise.resolve(jsonResponse({ pullRequests: allPrs }));
            }

            return Promise.resolve(jsonResponse({
                pullRequests: [makePr({ id: 1, number: 1, title: 'Mine PR', author: { id: 'me', displayName: 'Me' } })],
            }));
        });
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/coworker-roster'))).toBe(true));

        await act(async () => {
            fireEvent.click(screen.getByTestId('pr-queue-filter-team'));
        });

        await waitFor(() => expect(screen.getByTestId('team-roster-toolbar')).toBeInTheDocument());
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(2));
        expect(screen.getByText('Bob PR')).toBeInTheDocument();
        expect(screen.getByText('Bob Follow-up PR')).toBeInTheDocument();

        const picker = screen.getByTestId('team-coworker-picker') as HTMLSelectElement;
        expect(within(picker).getAllByRole('option').map(option => option.textContent)).toEqual([
            'Add coworker...',
            'Cara Dev',
            'Stranger Dev',
        ]);

        fireEvent.change(picker, { target: { value: 'cara dev' } });
        await act(async () => {
            fireEvent.click(screen.getByTestId('team-coworker-add'));
        });

        await waitFor(() => expect(screen.getAllByTestId('team-coworker-chip')).toHaveLength(2));
        expect(fetchMock.mock.calls.some(call =>
            String(call[0]).includes('/coworker-roster') &&
            call[1]?.method === 'POST' &&
            JSON.parse(call[1]?.body as string).displayName === 'Cara Dev' &&
            JSON.parse(call[1]?.body as string).id === ''
        )).toBe(true);
        await waitFor(() => expect(screen.getAllByTestId('pr-row')).toHaveLength(3));
        expect(screen.getByText('Cara PR')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Hide Bob Dev in Team filter' }));
        await waitFor(() => expect(screen.queryByText('Bob PR')).not.toBeInTheDocument());
        expect(screen.getByText('Cara PR')).toBeInTheDocument();
        expect(screen.getByTestId('pr-queue-filter-team')).toHaveTextContent('1');

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Remove Cara Dev from Team roster' }));
        });

        await waitFor(() => expect(screen.getAllByTestId('team-coworker-chip')).toHaveLength(1));
        expect(fetchMock.mock.calls.some(call =>
            String(call[0]).includes('/coworker-roster/cara%20dev') &&
            call[1]?.method === 'DELETE'
        )).toBe(true);
        await waitFor(() => expect(screen.getByTestId('no-results')).toHaveTextContent('Choose at least one Team coworker chip'));
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

// ── PR review suggestions ─────────────────────────────────────────────────────

describe('PR review suggestions', () => {
    it('generates suggestions by refreshing review history before ranking', async () => {
        configMock.pullRequestsSuggestionsEnabled = true;
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [makePr({ id: 1, number: 1, title: 'Suggested PR' })] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ suggestions: [], rankedAt: null }))
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [makePr({ id: 1, number: 1, title: 'Suggested PR' })] }))
            .mockResolvedValueOnce(jsonResponse({
                reviews: [{
                    number: 10,
                    title: 'Reviewed PR',
                    author: { id: 'u1', displayName: 'Reviewer' },
                    filesChanged: ['src/file.ts'],
                    labels: [],
                    reviewedAt: '2026-01-01T00:00:00.000Z',
                    targetBranch: 'main',
                    url: 'https://example.invalid/pr/10',
                }],
                fetchedAt: '2026-01-01T00:00:00.000Z',
            }))
            .mockResolvedValueOnce(jsonResponse({ suggestions: [{ prNumber: 1, score: 95 }], rankedAt: '2026-01-01T00:01:00.000Z' }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-queue-filter-foryou')).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByTestId('pr-queue-filter-foryou'));
        });
        await waitFor(() => expect(screen.getByTestId('suggestions-empty-state')).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByTestId('generate-suggestions-empty-button'));
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
        expect(String(fetchMock.mock.calls[5][0])).toContain('/repos/repo-1/pull-requests/review-history/refresh');
        expect(fetchMock.mock.calls[5][1]?.method).toBe('POST');
        expect(String(fetchMock.mock.calls[6][0])).toContain('/repos/repo-1/pull-requests/suggestions/refresh');
        expect(fetchMock.mock.calls[6][1]?.method).toBe('POST');
        await waitFor(() => expect(screen.getByText('Suggested PR')).toBeInTheDocument());
    });

    it('shows an informational empty-state message when no review history exists', async () => {
        configMock.pullRequestsSuggestionsEnabled = true;
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [makePr({ id: 1, number: 1, title: 'Open PR' })] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ suggestions: [], rankedAt: null }))
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [makePr({ id: 1, number: 1, title: 'Open PR' })] }))
            .mockResolvedValueOnce(jsonResponse({ reviews: [], fetchedAt: '2026-01-01T00:00:00.000Z' }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-queue-filter-foryou')).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByTestId('pr-queue-filter-foryou'));
        });
        await act(async () => {
            fireEvent.click(screen.getByTestId('generate-suggestions-empty-button'));
        });

        await waitFor(() => expect(screen.getByTestId('suggestions-info')).toHaveTextContent('No past reviewed PRs found yet'));
        expect(screen.queryByTestId('suggestions-error')).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(6);
        expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/suggestions/refresh'))).toBe(false);
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
            .mockResolvedValueOnce(jsonResponse({ pullRequests: firstPage }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ pullRequests: secondPage }));

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

// ── Last sync time in header ──────────────────────────────────────────────────

describe('last sync time in header', () => {
    it('shows "Updated just now" inside the header when fetchedAt is recent', async () => {
        mockFetchOk([makePr()], { fetchedAt: Date.now() });
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        const header = screen.getByTestId('pr-queue-header');
        const badge = screen.getByTestId('fetched-at');
        expect(header.contains(badge)).toBe(true);
        expect(badge.textContent).toContain('Updated just now');
    });

    it('shows "Updated X min ago" when fetchedAt is older', async () => {
        mockFetchOk([makePr()], { fetchedAt: Date.now() - 5 * 60_000 });
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());

        expect(screen.getByTestId('fetched-at').textContent).toContain('5 min ago');
    });

    it('hides the sync time when queue is collapsed', async () => {
        mockFetchOk([makePr()], { fetchedAt: Date.now() });
        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByTestId('pr-row')).toBeInTheDocument());
        expect(screen.getByTestId('fetched-at')).toBeInTheDocument();

        await act(async () => { fireEvent.click(screen.getByTestId('pr-queue-toggle')); });
        expect(screen.queryByTestId('fetched-at')).not.toBeInTheDocument();
    });

    it('hides the sync time when fetchedAt is null (before first fetch)', async () => {
        mockFetchOk([], {});
        await act(async () => { await renderTab(); });
        expect(screen.queryByTestId('fetched-at')).not.toBeInTheDocument();
    });
});

// ── Open PR by number or URL ──────────────────────────────────────────────────

describe('open PR by number or URL', () => {
    beforeEach(() => {
        try { localStorage.removeItem('pr-queue-collapsed'); } catch { /* ignore */ }
    });

    it('renders the Open PR input row with placeholder and a disabled Open button when empty', async () => {
        mockFetchOk([]);
        await act(async () => { await renderTab(); });
        const input = screen.getByTestId('open-pr-input') as HTMLInputElement;
        const button = screen.getByTestId('open-pr-button') as HTMLButtonElement;
        expect(input.placeholder).toMatch(/PR/i);
        expect(button).toBeDisabled();
        expect(screen.queryByTestId('recent-opened-prs')).not.toBeInTheDocument();
    });

    it('renders populated recent entries below the Open PR input', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({
                entries: [makeRecentEntry({ number: 42, title: 'Recently reopened PR' })],
            }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });

        await waitFor(() => expect(screen.getByTestId('recent-opened-prs')).toBeInTheDocument());
        expect(screen.getByText('Recently reopened PR')).toBeInTheDocument();
        expect(screen.getByText('#42')).toBeInTheDocument();
    });

    it('clicking a recent entry validates and opens that PR overview', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({
                entries: [makeRecentEntry({ number: 8, title: 'Recent click target' })],
            }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ id: 8, number: 8, title: 'Recent click target' }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('Recent click target')).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByTestId('recent-opened-pr-entry'));
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        expect(String(fetchMock.mock.calls[3][0])).toContain('/repos/repo-1/pull-requests/8');
        expect(window.location.hash).toContain('#repos/repo-1/pull-requests/8/overview');
    });

    it('hides recent entries when the queue rail is collapsed', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({
                entries: [makeRecentEntry({ number: 24, title: 'Collapsed recent PR' })],
            }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('Collapsed recent PR')).toBeInTheDocument());

        await act(async () => { fireEvent.click(screen.getByTestId('pr-queue-toggle')); });

        expect(screen.queryByTestId('recent-opened-prs')).not.toBeInTheDocument();
    });

    it('opens a PR by bare number on Enter, validating via /pull-requests/:n first', async () => {
        const fetchMock = vi.fn()
            // initial list fetch
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            // recent-opened fetch
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            // coworker-roster fetch
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            // open-pr validation fetch
            .mockResolvedValueOnce(jsonResponse({
                id: 7,
                number: 7,
                title: 'Validated PR',
                url: 'https://github.com/acme/web/pull/7?notification=1',
            }))
            // recent-opened record fetch
            .mockResolvedValueOnce(jsonResponse({
                entries: [makeRecentEntry({ number: 7, title: 'Validated PR', webUrl: 'https://github.com/acme/web/pull/7' })],
            }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        const input = screen.getByTestId('open-pr-input');
        fireEvent.change(input, { target: { value: '7' } });

        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
        expect(String(fetchMock.mock.calls[3][0])).toContain('/repos/repo-1/pull-requests/7');
        expect(String(fetchMock.mock.calls[4][0])).toContain('/repos/repo-1/pull-requests/recent-opened');
        expect(fetchMock.mock.calls[4][1]?.method).toBe('POST');
        expect(JSON.parse(fetchMock.mock.calls[4][1]?.body as string)).toMatchObject({
            workspaceId: 'ws-1',
            number: 7,
            title: 'Validated PR',
            webUrl: 'https://github.com/acme/web/pull/7?notification=1',
        });
        await waitFor(() =>
            expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_PR', prId: 7 }),
        );
        expect(window.location.hash).toContain('#repos/repo-1/pull-requests/7/overview');
        await waitFor(() => expect(screen.getByText('Validated PR')).toBeInTheDocument());
    });

    it('opens a PR by bare number when the Open button is clicked', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ id: 12, number: 12, title: 'Button PR' }))
            .mockResolvedValueOnce(jsonResponse({
                entries: [makeRecentEntry({ number: 12, title: 'Button PR' })],
            }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        fireEvent.change(screen.getByTestId('open-pr-input'), { target: { value: '12' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('open-pr-button'));
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
        expect(String(fetchMock.mock.calls[3][0])).toContain('/repos/repo-1/pull-requests/12');
        expect(window.location.hash).toContain('pull-requests/12/overview');
    });

    it('opens a PR from a full GitHub URL matched to another registered workspace', async () => {
        mockWorkspaces = [
            { id: 'ws-1', remoteUrl: 'https://github.com/acme/web.git' },
            { id: 'ws-2', remoteUrl: 'git@github.com:acme/api.git' },
        ];
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ id: 99, number: 99, title: 'API workspace PR' }))
            .mockResolvedValueOnce(jsonResponse({
                entries: [makeRecentEntry({ workspaceId: 'ws-2', repoId: 'ws-2', number: 99, title: 'API workspace PR' })],
            }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        fireEvent.change(screen.getByTestId('open-pr-input'), {
            target: { value: 'https://github.com/acme/api/pull/99' },
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('open-pr-button'));
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
        expect(String(fetchMock.mock.calls[3][0])).toContain('/repos/ws-2/pull-requests/99');
        expect(String(fetchMock.mock.calls[4][0])).toContain('/repos/ws-2/pull-requests/recent-opened');
        expect(JSON.parse(fetchMock.mock.calls[4][1]?.body as string)).toMatchObject({
            workspaceId: 'ws-2',
            number: 99,
            title: 'API workspace PR',
        });
        await waitFor(() =>
            expect(window.location.hash).toContain('#repos/ws-2/pull-requests/99/overview'),
        );
    });

    it('opens closed/merged or non-listed PRs (validation succeeds even if missing from list)', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ id: 50, number: 50, status: 'merged', title: 'Merged PR' }))
            .mockResolvedValueOnce(jsonResponse({
                entries: [makeRecentEntry({ number: 50, title: 'Merged PR' })],
            }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        fireEvent.change(screen.getByTestId('open-pr-input'), { target: { value: '50' } });
        await act(async () => { fireEvent.click(screen.getByTestId('open-pr-button')); });

        await waitFor(() => expect(window.location.hash).toContain('pull-requests/50/overview'));
        expect(screen.queryByTestId('open-pr-error')).not.toBeInTheDocument();
    });

    it('shows an inline error and does not navigate when validation returns 404', async () => {
        const originalHash = window.location.hash;
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ error: 'not found' }, { ok: false, status: 404 }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        fireEvent.change(screen.getByTestId('open-pr-input'), { target: { value: '404' } });
        await act(async () => { fireEvent.click(screen.getByTestId('open-pr-button')); });

        await waitFor(() => expect(screen.getByTestId('open-pr-error')).toBeInTheDocument());
        expect(screen.getByTestId('open-pr-error').textContent).toMatch(/404/);
        expect(mockDispatch).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'SET_SELECTED_PR' }),
        );
        expect(window.location.hash).toBe(originalHash);
        expect(fetchMock.mock.calls.some(call =>
            String(call[0]).includes('/recent-opened') && call[1]?.method === 'POST',
        )).toBe(false);
    });

    it('removes a stale recent entry after a confirmed 404 on click', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({
                entries: [makeRecentEntry({ number: 77, title: 'Stale recent PR' })],
            }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ error: 'not found' }, { ok: false, status: 404 }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('Stale recent PR')).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByTestId('recent-opened-pr-entry'));
        });

        await waitFor(() => expect(screen.getByTestId('open-pr-error')).toHaveTextContent('Pull request #77 not found.'));
        await waitFor(() => expect(screen.queryByTestId('recent-opened-prs')).not.toBeInTheDocument());
        expect(String(fetchMock.mock.calls[4][0])).toContain('/repos/repo-1/pull-requests/recent-opened/77');
        expect(fetchMock.mock.calls[4][1]?.method).toBe('DELETE');
    });

    it('keeps a recent entry when click validation fails without a confirmed 404', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({
                entries: [makeRecentEntry({ number: 88, title: 'Temporarily unavailable PR' })],
            }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ error: 'provider failed' }, { ok: false, status: 500 }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        await waitFor(() => expect(screen.getByText('Temporarily unavailable PR')).toBeInTheDocument());

        await act(async () => {
            fireEvent.click(screen.getByTestId('recent-opened-pr-entry'));
        });

        await waitFor(() => expect(screen.getByTestId('open-pr-error')).toBeInTheDocument());
        expect(screen.getByTestId('recent-opened-prs')).toBeInTheDocument();
        expect(fetchMock.mock.calls.some(call =>
            String(call[0]).includes('/recent-opened/') && call[1]?.method === 'DELETE',
        )).toBe(false);
    });

    it('shows an inline error for invalid input and does not call the API', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        fireEvent.change(screen.getByTestId('open-pr-input'), { target: { value: 'not a pr' } });
        await act(async () => { fireEvent.click(screen.getByTestId('open-pr-button')); });

        await waitFor(() => expect(screen.getByTestId('open-pr-error')).toBeInTheDocument());
        expect(fetchMock).toHaveBeenCalledTimes(3); // initial list + recent-opened + roster fetches only
        expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/pull-requests/not'))).toBe(false);
    });

    it('shows a "repository not registered" error for a URL with no matching workspace and does not call PR API', async () => {
        mockWorkspaces = [{ id: 'ws-1', remoteUrl: 'https://github.com/acme/web.git' }];
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        fireEvent.change(screen.getByTestId('open-pr-input'), {
            target: { value: 'https://github.com/unknown/repo/pull/1' },
        });
        await act(async () => { fireEvent.click(screen.getByTestId('open-pr-button')); });

        await waitFor(() => expect(screen.getByTestId('open-pr-error')).toBeInTheDocument());
        expect(screen.getByTestId('open-pr-error').textContent).toMatch(/not registered/i);
        // No PR validation request was made.
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('does not record a recent entry when validation fails with an auth/provider error', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ error: 'unauthorized' }, { ok: false, status: 401 }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        fireEvent.change(screen.getByTestId('open-pr-input'), { target: { value: '123' } });
        await act(async () => { fireEvent.click(screen.getByTestId('open-pr-button')); });

        await waitFor(() => expect(screen.getByTestId('open-pr-error')).toBeInTheDocument());
        expect(fetchMock.mock.calls.some(call =>
            String(call[0]).includes('/recent-opened') && call[1]?.method === 'POST',
        )).toBe(false);
    });

    it('clears the error when the user edits the input again', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ pullRequests: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }))
            .mockResolvedValueOnce(jsonResponse({ entries: [] }));
        global.fetch = fetchMock;

        await act(async () => { await renderTab(); });
        fireEvent.change(screen.getByTestId('open-pr-input'), { target: { value: 'bad' } });
        await act(async () => { fireEvent.click(screen.getByTestId('open-pr-button')); });
        await waitFor(() => expect(screen.getByTestId('open-pr-error')).toBeInTheDocument());

        fireEvent.change(screen.getByTestId('open-pr-input'), { target: { value: 'bad2' } });
        expect(screen.queryByTestId('open-pr-error')).not.toBeInTheDocument();
    });
});
