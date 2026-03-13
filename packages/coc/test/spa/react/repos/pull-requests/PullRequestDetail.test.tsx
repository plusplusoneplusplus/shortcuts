/**
 * Tests for PullRequestDetail component.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

const mockDispatch = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/context/AppContext', () => ({
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
        comments: [{ id: 1, author: { displayName: 'Bob' }, content: 'LGTM', publishedDate: new Date().toISOString() }],
        ...o,
    }));

function mockFetchBoth(pr: any, threads: any[] = []) {
    global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(pr) } as any)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ threads }) } as any);
}

function mockFetchPrError(status = 500, message = 'Server error') {
    global.fetch = vi.fn()
        .mockResolvedValueOnce({ ok: false, status, json: () => Promise.resolve({ message }) } as any)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ threads: [] }) } as any);
}

async function renderDetail(props: Partial<any> = {}) {
    const { PullRequestDetail } = await import(
        '../../../../../src/server/spa/client/react/repos/pull-requests/PullRequestDetail'
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
        mockFetchBoth(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-title')).toBeInTheDocument());
        expect(screen.getByTestId('pr-title').textContent).toContain('Add retry logic for transient failures');
        expect(screen.getByTestId('pr-status-badge').textContent).toMatch(/Open/i);
    });

    it('renders branch info', async () => {
        mockFetchBoth(makePr());
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-branches')).toBeInTheDocument());
        const branches = screen.getByTestId('pr-branches').textContent ?? '';
        expect(branches).toContain('main');
        expect(branches).toContain('feature/retry-logic');
    });

    it('renders description as markdown', async () => {
        mockFetchBoth(makePr({ description: 'Fix flaky network calls.' }));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('pr-description')).toBeInTheDocument());
    });

    it('renders reviewer list with correct vote icons', async () => {
        const pr = makePr({
            reviewers: [
                { identity: { displayName: 'Bob' }, vote: 'approved' },
                { identity: { displayName: 'Carol' }, vote: 'rejected' },
            ],
        });
        mockFetchBoth(pr);
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getAllByTestId('reviewer-badge')).toHaveLength(2));
        const badges = screen.getAllByTestId('reviewer-badge').map(el => el.textContent ?? '');
        expect(badges[0]).toContain('Approved');
        expect(badges[1]).toContain('Rejected');
    });

    it('renders label chips', async () => {
        mockFetchBoth(makePr({ labels: ['bug', 'high-priority'] }));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getAllByTestId('label-chip')).toHaveLength(2));
    });

    it('renders external link', async () => {
        mockFetchBoth(makePr({ url: 'https://example.com/pr/1' }));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('overview-external-link')).toBeInTheDocument());
        expect(screen.getByTestId('overview-external-link')).toHaveAttribute('href', 'https://example.com/pr/1');
        expect(screen.getByTestId('overview-external-link')).toHaveAttribute('target', '_blank');
    });
});

// ── Back button ────────────────────────────────────────────────────────────────

describe('back button', () => {
    it('dispatches CLEAR_SELECTED_PR and calls onBack when back is clicked', async () => {
        mockFetchBoth(makePr());
        const onBack = vi.fn();
        await act(async () => { await renderDetail({ onBack }); });
        await waitFor(() => expect(screen.getByTestId('back-button')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('back-button'));
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'CLEAR_SELECTED_PR' });
        expect(window.location.hash).toContain('pull-requests');
        expect(onBack).toHaveBeenCalled();
    });
});

// ── Threads tab ────────────────────────────────────────────────────────────────

describe('threads tab', () => {
    it('shows thread count in tab label and renders ThreadList when switched', async () => {
        mockFetchBoth(makePr(), makeThreads([{}, {}]));
        await act(async () => { await renderDetail(); });
        await waitFor(() => expect(screen.getByTestId('tab-threads')).toBeInTheDocument());
        expect(screen.getByTestId('tab-threads').textContent).toContain('2');

        fireEvent.click(screen.getByTestId('tab-threads'));
        expect(screen.getByTestId('threads-tab')).toBeInTheDocument();
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
