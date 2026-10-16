/**
 * Tests for CommitDetail — collapsible commit info header behaviour.
 *
 * Covers:
 *   - Header is expanded by default
 *   - Collapse button (▼) manually collapses the header
 *   - Summary bar appears when collapsed; contains subject + short hash
 *   - Clicking summary bar re-expands the header
 *   - Auto-collapse on scroll (scrollTop > 24)
 *   - No auto-expand when scrolled back to top (scrollTop <= 24)
 *   - Selecting a new commit resets the header to expanded
 *   - Per-file view is unaffected (no collapse logic)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// --- Module mocks ---

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: () => ({
        comments: [],
        loading: false,
        error: null,
        isEphemeral: false,
        addComment: vi.fn(),
        updateComment: vi.fn(),
        deleteComment: vi.fn(),
        resolveComment: vi.fn(),
        unresolveComment: vi.fn(),
        askAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),

        refresh: vi.fn(),
        runRelocation: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve({ diff: '+added line\n context' }),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-diff-viewer'}>diff content</div>
    ),
    HunkNavButtons: () => null,
    parseDiffFileList: () => [],
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/useClassification', () => ({
    useClassification: () => ({
        state: { status: 'idle', activeFilters: new Set(), error: undefined, result: undefined },
        classify: vi.fn(),
        toggleFilter: vi.fn(),
        setFilters: vi.fn(),
        isFileDimmed: () => false,
        getFileBadge: () => undefined,
        getHunkClassification: () => null,
        provider: 'copilot',
        setProvider: vi.fn(),
        model: undefined,
        setModel: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useAgentProviders', () => ({
    useAgentProviders: () => ({
        providers: [{ id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true }],
        loading: false,
        error: null,
        reload: vi.fn(),
        copilot: { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
        codex: undefined,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({
    CommitChatPanel: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/GitFileReview', async () => {
    // Render the real single-row toolbar so header slots stay observable.
    const { GitReviewToolbar } = await vi.importActual<typeof import('../../../../src/server/spa/client/react/features/git/diff/GitReviewToolbar')>('../../../../src/server/spa/client/react/features/git/diff/GitReviewToolbar');
    return { GitFileReview: (props: any) => <div data-testid="git-file-review"><GitReviewToolbar header={props.header} /></div> };
});
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useCommitReviewFiles', () => ({ useCommitReviewFiles: () => ({ files: [], loading: false }) }));

import { CommitDetail } from '../../../../src/server/spa/client/react/features/git/commits/CommitDetail';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';

const makeCommit = (overrides: Partial<GitCommitItem> = {}): GitCommitItem => ({
    hash: 'abc123def456abc123def456abc123def456abc1',
    shortHash: 'abc123d',
    subject: 'feat: add collapsible header',
    author: 'Test Author',
    authorEmail: 'test@example.com',
    date: '2026-03-07T12:00:00Z',
    parentHashes: ['parent1abcdef1234567890abcdef1234567890ab'],
    body: 'Commit body text.',
    ...overrides,
});

describe('CommitDetail — collapsible header', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    async function renderDetail(props: Record<string, unknown> = {}) {
        let utils: ReturnType<typeof render>;
        await act(async () => {
            utils = render(<CommitDetail workspaceId="ws1" hash="abc123" {...(props as any)} />);
        });
        return utils!;
    }

    it('starts with a compact summary and hidden metadata', async () => {
        await renderDetail({ commit: makeCommit() });
        expect(screen.getByTestId('commit-info-summary')).toBeTruthy();
        expect(screen.getByTestId('commit-info-header').parentElement!.hidden).toBe(true);
    });
    it('expands explicitly and collapses with an accessible control', async () => {
        await renderDetail({ commit: makeCommit() });
        fireEvent.click(screen.getByTestId('commit-info-summary'));
        expect(screen.getByTestId('commit-info-header').parentElement!.hidden).toBe(false);
        fireEvent.click(screen.getByTestId('commit-info-collapse-btn'));
        expect(screen.getByTestId('commit-info-header').parentElement!.hidden).toBe(true);
    });
    it('keeps subject and short hash available while collapsed', async () => {
        await renderDetail({ commit: makeCommit({ subject: 'fix: a bug', hash: 'deadbeef123456' }) });
        expect(screen.getByTestId('commit-info-summary').textContent).toContain('fix: a bug');
        expect(screen.getByTestId('commit-summary-copy-hash').textContent).toContain('deadbeef');
        expect(screen.getByTestId('commit-info-summary').getAttribute('title')).toContain('fix: a bug');
    });
    it('ellipsizes long titles in the toolbar and reveals the full title accessibly', async () => {
        const subject = `feat: ${'x'.repeat(300)} end`;
        await renderDetail({ commit: makeCommit({ subject }) });
        const summary = screen.getByTestId('commit-info-summary');
        expect(summary.className).toContain('git-review-title');
        expect(summary.closest('.git-review-identity')).toBeTruthy();
        expect(screen.getByRole('button', { name: subject })).toBe(summary);
        expect(summary.getAttribute('title')).toContain(subject);
        expect(summary.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(summary);
        expect(summary.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('commit-info-subject').textContent).toBe(subject);
    });
    it.each(['commit', 'workspace'])('resets expanded disclosure on %s change', async change => {
        const { rerender } = await renderDetail({ commit: makeCommit() });
        fireEvent.click(screen.getByTestId('commit-info-summary'));
        rerender(<CommitDetail workspaceId={change === 'workspace' ? 'ws2' : 'ws1'} hash={change === 'commit' ? 'def456' : 'abc123'} commit={makeCommit()} />);
        expect(screen.getByTestId('commit-info-summary')).toBeTruthy();
        expect(screen.getByTestId('commit-info-header').parentElement!.hidden).toBe(true);
    });
});
