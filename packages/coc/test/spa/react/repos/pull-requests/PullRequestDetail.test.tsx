/**
 * Tests for PullRequestDetail component.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    getActiveProvider: () => 'copilot',
    getDefaultProvider: () => 'copilot',
    isEffortLevelsEnabled: () => false,
}));

const prefsMocks = vi.hoisted(() => ({
    getWorkspacePreferences: vi.fn().mockResolvedValue({}),
    patchWorkspacePreferences: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../../src/server/spa/client/react/hooks/preferences/preferencesApi', () => ({
    getWorkspacePreferences: prefsMocks.getWorkspacePreferences,
    patchWorkspacePreferences: prefsMocks.patchWorkspacePreferences,
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
    marked: Object.assign(
        (md: string) => `<p>${md}</p>`,
        {
            parse: (md: string) => `<p>${md}</p>`,
            setOptions: () => {},
            use: () => {},
        },
    ),
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

const makeCommits = (overrides: Partial<any>[] = [{}]) =>
    overrides.map((o, i) => ({
        sha: `abcdef${i}1234567890`,
        shortSha: `abcdef${i}`,
        title: i === 0 ? 'Add retry logic' : `Commit ${i + 1}`,
        message: i === 0 ? 'Add retry logic\n\nDetailed body' : `Commit ${i + 1}`,
        author: { displayName: 'Alice', email: 'alice@example.com' },
        authoredAt: '2024-01-01T00:00:00Z',
        committedAt: '2024-01-01T01:00:00Z',
        url: 'https://example.com/commit/abcdef',
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

/** Mock the full PR detail fetch quintet (pr, threads, diff, commits, checks). */
function mockFetchDetail(
    pr: any,
    threads: any[] = [],
    diffText = '',
    commits: any[] = [],
    checks: any[] = [],
) {
    global.fetch = vi.fn()
        .mockResolvedValueOnce(jsonResponse(pr))
        .mockResolvedValueOnce(jsonResponse({ threads }))
        .mockResolvedValueOnce(textResponse(diffText))
        .mockResolvedValueOnce(jsonResponse({ commits }))
        .mockResolvedValueOnce(jsonResponse({ checks }));
}

function mockFetchPrError(status = 500, message = 'Server error') {
    global.fetch = vi.fn()
        .mockResolvedValueOnce(jsonResponse({ message }, false, status))
        .mockResolvedValueOnce(jsonResponse({ threads: [] }))
        .mockResolvedValueOnce(textResponse(''))
        .mockResolvedValueOnce(jsonResponse({ commits: [] }))
        .mockResolvedValueOnce(jsonResponse({ checks: [] }));
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
    prefsMocks.getWorkspacePreferences.mockResolvedValue({});
    prefsMocks.patchWorkspacePreferences.mockResolvedValue(undefined);
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

    it('renders an "Open" external link in the compact hero', async () => {
        mockFetchDetail(makePr({ url: 'https://example.com/pr/1' }));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('header-external-link')).toBeInTheDocument());
        expect(screen.getByTestId('header-external-link')).toHaveAttribute('href', 'https://example.com/pr/1');
        expect(screen.getByTestId('header-external-link')).toHaveAttribute('target', '_blank');
        expect(screen.getByTestId('header-external-link').textContent).toContain('Open');
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
        expect(screen.queryByText(/AI annotation/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/AI focus file/i)).not.toBeInTheDocument();
        expect(screen.getByTestId('tab-files').textContent).toContain('2');
    });

    it('renders the minimal file list without inline diff in the Files tab', async () => {
        mockFetchDetail(makePr(), makeThreads([{
            id: 'thread-actual',
            threadContext: { filePath: '/src/foo.ts', line: 2, side: 'right' },
            comments: [{
                id: 'comment-actual',
                author: { displayName: 'Bob' },
                body: 'This should come from the provider thread.',
                createdAt: new Date('2024-01-03T00:00:00Z').toISOString(),
            }],
        }]), SAMPLE_DIFF);

        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-files')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tab-files'));

        // Minimal file list renders file rows but no inline diff
        expect(screen.getAllByTestId('pr-file-row').length).toBeGreaterThan(0);
        expect(screen.queryByTestId('pr-file-inline-comments')).not.toBeInTheDocument();
        expect(screen.queryByTestId('pr-file-diff-card')).not.toBeInTheDocument();
    });

    it('switches to the Commits tab and renders real commits from the /commits endpoint', async () => {
        const commits = [
            {
                id: 'abc1234deadbeef0000000000000000000000000',
                shortId: 'abc1234',
                message: 'feat: stream JSONL parser',
                subject: 'feat: stream JSONL parser',
                author: { displayName: 'Alice' },
                authoredAt: new Date('2024-01-04T12:34:56Z').toISOString(),
            },
            {
                id: 'def5678deadbeef0000000000000000000000000',
                shortId: 'def5678',
                message: 'fix: handle abort',
                subject: 'fix: handle abort',
                author: { displayName: 'Bob' },
                authoredAt: new Date('2024-01-05T12:34:56Z').toISOString(),
            },
        ];
        mockFetchDetail(makePr(), [], '', commits);
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-commits')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tab-commits'));
        expect(screen.getByTestId('commits-tab')).toBeInTheDocument();
        expect(screen.getByTestId('pr-commit-table')).toBeInTheDocument();
        const rows = screen.getAllByTestId('pr-commit-row');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('feat: stream JSONL parser');
        expect(rows[0].textContent).toContain('abc1234');
        expect(rows[1].textContent).toContain('fix: handle abort');
        expect(rows[1].textContent).toContain('def5678');
        // Commit list is no longer mocked — preview notice must not appear here.
        expect(screen.queryByTestId('pr-tab-preview-notice')).not.toBeInTheDocument();
        expect(screen.getByTestId('tab-commits').textContent).toContain('2');
    });

    it('renders an empty-state message when the /commits endpoint returns no commits', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-commits')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tab-commits'));
        expect(screen.getByTestId('pr-commits-empty')).toBeInTheDocument();
        expect(screen.queryByTestId('pr-commit-table')).not.toBeInTheDocument();
    });

    it('surfaces an error banner when the /commits endpoint fails', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce(jsonResponse(makePr()))
            .mockResolvedValueOnce(jsonResponse({ threads: [] }))
            .mockResolvedValueOnce(textResponse(''))
            .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, false, 500))
            .mockResolvedValueOnce(jsonResponse({ checks: [] }));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-commits')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tab-commits'));
        expect(screen.getByTestId('pr-commits-error').textContent).toMatch(/Failed to load commits/);
        expect(screen.queryByTestId('pr-commit-table')).not.toBeInTheDocument();
    });

    it('renders an empty-state in the Checks tab when /checks returns no checks', async () => {
        mockFetchDetail(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-checks')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tab-checks'));
        expect(screen.getByTestId('checks-tab')).toBeInTheDocument();
        expect(screen.getByTestId('pr-checks-table')).toBeInTheDocument();
        expect(screen.getByTestId('pr-merge-readiness')).toBeInTheDocument();
        expect(screen.getByTestId('pr-checks-empty').textContent).toMatch(/No CI checks reported/i);
        // Preview notice is gone now that checks come from real data.
        expect(screen.queryByTestId('pr-tab-preview-notice')).not.toBeInTheDocument();
    });

    it('renders real check rows + derived merge readiness when /checks returns data', async () => {
        const checks = [
            {
                id: 'check-1',
                name: 'build',
                status: 'success',
                source: 'check',
                durationMs: 198000,
                detailsUrl: 'https://example.com/runs/1',
            },
            {
                id: 'check-2',
                name: 'lint',
                status: 'failure',
                source: 'check',
                description: 'eslint failed',
                durationMs: 45000,
            },
        ];
        mockFetchDetail(makePr(), [], '', [], checks);
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-checks')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tab-checks'));

        const rows = screen.getAllByTestId('pr-check-row');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('build');
        expect(rows[0].textContent).toContain('Passed');
        expect(rows[1].textContent).toContain('lint');
        expect(rows[1].textContent).toContain('Failed');
        expect(rows[1].textContent).toContain('eslint failed');

        // External link rendered for checks with detailsUrl.
        const checkLink = screen.getAllByTestId('pr-check-link');
        expect(checkLink[0]).toHaveAttribute('href', 'https://example.com/runs/1');

        // Merge readiness reflects the failing check.
        const readiness = screen.getAllByTestId('pr-merge-readiness-item');
        const blocking = readiness.find(el => /1 check failing/i.test(el.textContent ?? ''));
        expect(blocking).toBeDefined();

        // Tab badge shows passing/total.
        expect(screen.getByTestId('tab-checks').textContent).toContain('1/2');
    });

    it('surfaces an error banner when the /checks endpoint fails', async () => {
        global.fetch = vi.fn()
            .mockResolvedValueOnce(jsonResponse(makePr()))
            .mockResolvedValueOnce(jsonResponse({ threads: [] }))
            .mockResolvedValueOnce(textResponse(''))
            .mockResolvedValueOnce(jsonResponse({ commits: [] }))
            .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, false, 500));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-checks')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tab-checks'));
        expect(screen.getByTestId('pr-checks-error').textContent).toMatch(/Failed to load checks/);
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
