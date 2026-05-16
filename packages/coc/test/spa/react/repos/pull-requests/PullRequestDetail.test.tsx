/**
 * Tests for PullRequestDetail component.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
}));

const mockDispatch = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: {}, dispatch: mockDispatch }),
}));

// Stub marked so tests don't need a full DOM
vi.mock('marked', () => ({
    Marked: class {
        parse(md: string) { return `<p>${md}</p>`; }
    },
}));

const makePr = (overrides: Partial<any> = {}) => ({
    id: 142,
    number: 142,
    title: 'Add retry logic for transient failures',
    description: 'Fix flaky network calls.',
    sourceBranch: 'feature/retry-logic',
    targetBranch: 'main',
    status: 'open',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    url: 'https://example.com/pr/142',
    createdBy: { displayName: 'Alice' },
    reviewers: [],
    labels: [],
    ...overrides,
});

const makeThreads = (overrides: Partial<any>[] = []) =>
    overrides.map((o, i) => ({
        id: i + 1,
        comments: [{ id: 1, author: { displayName: 'Bob' }, body: 'LGTM', createdAt: new Date().toISOString() }],
        ...o,
    }));

/** JSON response shape that satisfies both the SPA's CocApiClient and the
 *  fallback `await response.json()` path. */
function jsonResponse(payload: unknown, ok = true, status = 200) {
    return {
        ok,
        status,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(payload),
        text: () => Promise.resolve(JSON.stringify(payload)),
    } as unknown as Response;
}

/** text/plain response used by the diff endpoint. */
function textResponse(body: string) {
    return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/plain' },
        text: () => Promise.resolve(body),
    } as unknown as Response;
}

/** Mock the full PR detail fetch trio (pr, threads, diff). */
function mockFetchDetail(pr: any, threads: any[] = [], diffText = '') {
    global.fetch = vi.fn()
        .mockResolvedValueOnce(jsonResponse(pr))
        .mockResolvedValueOnce(jsonResponse({ threads }))
        .mockResolvedValueOnce(textResponse(diffText));
}

function mockFetchPrError(status = 500, message = 'Server error') {
    global.fetch = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ message }, false, status))
        .mockResolvedValueOnce(jsonResponse({ threads: [] }))
        .mockResolvedValueOnce(textResponse(''));
}

const SAMPLE_DIFF = [
    'diff --git a/src/foo.ts b/src/foo.ts',
    '--- a/src/foo.ts',
    '+++ b/src/foo.ts',
    '@@ -1,1 +1,3 @@',
    ' keep',
    '+added one',
    '+added two',
    'diff --git a/src/bar.ts b/src/bar.ts',
    '--- a/src/bar.ts',
    '+++ b/src/bar.ts',
    '@@ -1,2 +1,1 @@',
    ' keep',
    '-removed one',
    '',
].join('\n');

async function renderDetail(props: Partial<any> = {}) {
    const { PullRequestDetail } = await import(
        '../../../../../src/server/spa/client/react/features/pull-requests/PullRequestDetail'
    );
    const onBack = props.onBack ?? vi.fn();
    return render(
        <PullRequestDetail repoId="repo-1" prId={142} onBack={onBack} {...props} />
    );
}

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mockDispatch.mockReset();
    Object.defineProperty(window, 'location', {
        writable: true,
        value: { hash: '' },
    });
});

// ── Loading state ──────────────────────────────────────────────────────────────

describe('loading state', () => {
    it('shows loading spinner while fetch is pending', async () => {
        global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
        await act(async () => { await renderDetail(); });
        expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });
});

// ── Successful render ──────────────────────────────────────────────────────────

describe('successful render', () => {
    it('renders PR title and status badge after fetch', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-title')).toBeInTheDocument());
        expect(screen.getByTestId('pr-title').textContent).toContain('Add retry logic for transient failures');
        expect(screen.getByTestId('pr-status-badge').textContent).toMatch(/Open/i);
    });

    it('renders branch info', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-branches')).toBeInTheDocument());
        const branches = screen.getByTestId('pr-branches').textContent ?? '';
        expect(branches).toContain('main');
        expect(branches).toContain('feature/retry-logic');
    });

    it('renders description as markdown', async () => {
        mockFetchDetail(makePr({ description: 'Fix flaky network calls.' }));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-description')).toBeInTheDocument());
    });

    it('shows actionable empty-description card when description is absent', async () => {
        mockFetchDetail(makePr({ description: undefined, url: 'https://example.com/pr/142' }));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-description-empty')).toBeInTheDocument());
        expect(screen.getByTestId('pr-description-empty').textContent).toContain('No description');
        const openLink = screen.getByTestId('pr-description-open-link');
        expect(openLink).toBeInTheDocument();
        expect(openLink).toHaveAttribute('href', 'https://example.com/pr/142');
    });

    it('does not render open-link in empty-description card when no url', async () => {
        mockFetchDetail(makePr({ description: undefined, url: undefined }));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-description-empty')).toBeInTheDocument());
        expect(screen.queryByTestId('pr-description-open-link')).not.toBeInTheDocument();
    });

    it('renders reviewer list with correct vote icons', async () => {
        const pr = makePr({
            reviewers: [
                { identity: { displayName: 'Bob' }, vote: 'approved' },
                { identity: { displayName: 'Carol' }, vote: 'rejected' },
            ],
        });
        mockFetchDetail(pr);
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getAllByTestId('reviewer-badge')).toHaveLength(2));
        const badges = screen.getAllByTestId('reviewer-badge').map(el => el.textContent ?? '');
        expect(badges[0]).toContain('Approved');
        expect(badges[1]).toContain('Rejected');
    });

    it('renders label chips', async () => {
        mockFetchDetail(makePr({ labels: ['bug', 'high-priority'] }));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getAllByTestId('label-chip')).toHaveLength(2));
    });

    it('renders "Open in browser" text in the header link', async () => {
        mockFetchDetail(makePr({ url: 'https://example.com/pr/1' }));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('header-external-link')).toBeInTheDocument());
        expect(screen.getByTestId('header-external-link')).toHaveAttribute('href', 'https://example.com/pr/1');
        expect(screen.getByTestId('header-external-link')).toHaveAttribute('target', '_blank');
        expect(screen.getByTestId('header-external-link').textContent).toContain('Open in browser');
    });
});

// ── Hero / AI badges ───────────────────────────────────────────────────────────

describe('hero metadata', () => {
    it('renders the AI risk pill on the hero row', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-risk-pill')).toBeInTheDocument());
        expect(screen.getByTestId('pr-risk-pill').textContent).toMatch(/AI risk:/);
    });

    it('renders the additions/deletions delta and file count from the real diff', async () => {
        mockFetchDetail(makePr(), [], SAMPLE_DIFF);
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-delta')).toBeInTheDocument());
        // SAMPLE_DIFF: +2 additions, -1 deletion across 2 files.
        expect(screen.getByTestId('pr-delta').textContent).toBe('+2 / -1');
        expect(screen.getByTestId('pr-file-count').textContent).toBe('2 files');
    });

    it('hides the delta and file-count metadata when the diff is empty', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-title')).toBeInTheDocument());
        expect(screen.queryByTestId('pr-delta')).not.toBeInTheDocument();
        expect(screen.queryByTestId('pr-file-count')).not.toBeInTheDocument();
    });

    it('renders the merge / AI / copy hero actions', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-merge-when-ready')).toBeInTheDocument());
        expect(screen.getByTestId('pr-run-ai-pass')).toBeInTheDocument();
        expect(screen.getByTestId('pr-copy-summary')).toBeInTheDocument();
        expect(screen.getByTestId('pr-open-ai-assistant')).toBeInTheDocument();
    });
});

// ── Back button ────────────────────────────────────────────────────────────────

describe('back button', () => {
    it('dispatches CLEAR_SELECTED_PR and calls onBack when back is clicked (mobile)', async () => {
        mockFetchDetail(makePr());
        const onBack = vi.fn();
        await act(async () => { await renderDetail({ onBack, isMobile: true }); });
        await waitFor(() => expect(screen.getByTestId('back-button')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('back-button'));
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'CLEAR_SELECTED_PR' });
        expect(window.location.hash).toContain('pull-requests');
        expect(onBack).toHaveBeenCalled();
    });

    it('does not render back button on desktop (isMobile=false)', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail({ isMobile: false }); });
        await waitFor(() => expect(screen.getByTestId('pr-title')).toBeInTheDocument());
        expect(screen.queryByTestId('back-button')).not.toBeInTheDocument();
    });
});

// ── Tabs ───────────────────────────────────────────────────────────────────────

describe('tabs', () => {
    it('renders the four redesigned tabs', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-overview')).toBeInTheDocument());
        expect(screen.getByTestId('tab-files')).toBeInTheDocument();
        expect(screen.getByTestId('tab-commits')).toBeInTheDocument();
        expect(screen.getByTestId('tab-checks')).toBeInTheDocument();
    });

    it('embeds the thread list inside the Overview tab when threads exist', async () => {
        mockFetchDetail(makePr(), makeThreads([{}, {}]));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('overview-tab')).toBeInTheDocument());
        expect(screen.getByTestId('threads-tab')).toBeInTheDocument();
        expect(screen.getByTestId('tab-overview').textContent).toContain('2');
    });

    it('switches to the Files tab and renders rows from the real diff', async () => {
        mockFetchDetail(makePr(), [], SAMPLE_DIFF);
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-files')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tab-files'));
        expect(screen.getByTestId('files-tab')).toBeInTheDocument();
        expect(screen.getByTestId('pr-files-panel')).toBeInTheDocument();
        expect(screen.getAllByTestId('pr-file-row')).toHaveLength(2);
        expect(screen.getByTestId('tab-files').textContent).toContain('2');
    });

    it('switches to the Commits tab and renders the commit intent table behind a preview notice', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-commits')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tab-commits'));
        expect(screen.getByTestId('commits-tab')).toBeInTheDocument();
        expect(screen.getByTestId('pr-commit-table')).toBeInTheDocument();
        expect(screen.getByTestId('pr-tab-preview-notice').textContent).toMatch(/Commit list is AI-mocked/i);
    });

    it('switches to the Checks tab and renders the checks + merge readiness panels with a preview notice', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-checks')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tab-checks'));
        expect(screen.getByTestId('checks-tab')).toBeInTheDocument();
        expect(screen.getByTestId('pr-checks-table')).toBeInTheDocument();
        expect(screen.getByTestId('pr-merge-readiness')).toBeInTheDocument();
        expect(screen.getByTestId('pr-tab-preview-notice').textContent).toMatch(/Checks are AI-mocked/i);
    });
});

// ── AI assistant drawer ────────────────────────────────────────────────────────

describe('AI assistant drawer', () => {
    it('opens when the Ask AI button is clicked', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-open-ai-assistant')).toBeInTheDocument());

        const drawer = screen.getByTestId('pr-ai-assistant');
        expect(drawer.getAttribute('aria-hidden')).toBe('true');

        fireEvent.click(screen.getByTestId('pr-open-ai-assistant'));
        expect(drawer.getAttribute('aria-hidden')).toBe('false');

        fireEvent.click(screen.getByTestId('pr-ai-assistant-close'));
        expect(drawer.getAttribute('aria-hidden')).toBe('true');
    });
});

// ── Error state ────────────────────────────────────────────────────────────────

describe('error state', () => {
    it('renders error message on fetch failure', async () => {
        mockFetchPrError(500, 'Internal server error');
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('error-message')).toBeInTheDocument());
        expect(screen.getByTestId('error-message').textContent).toContain('Internal server error');
    });
});
