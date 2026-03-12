/**
 * Tests for CommitDetail — collapsible commit info header behaviour.
 *
 * Covers:
 *   - Header is expanded by default
 *   - Collapse button (▼) manually collapses the header
 *   - Summary bar appears when collapsed; contains subject + short hash
 *   - Clicking summary bar re-expands the header
 *   - Auto-collapse on scroll (scrollTop > 24)
 *   - Auto-expand when scrolled back to top (scrollTop <= 24)
 *   - Selecting a new commit resets the header to expanded
 *   - Per-file view is unaffected (no collapse logic)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// --- Module mocks ---

vi.mock('../../../../src/server/spa/client/react/hooks/useDiffComments', () => ({
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
        resolving: false,
        resolvingCommentId: null,
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

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../src/server/spa/client/react/repos/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-diff-viewer'}>diff content</div>
    ),
    HunkNavButtons: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    formatRelativeTime: (d: string) => d,
}));

import { CommitDetail } from '../../../../src/server/spa/client/react/repos/CommitDetail';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/repos/CommitList';

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

    it('header is expanded by default', async () => {
        await renderDetail({ commit: makeCommit() });
        expect(screen.getByTestId('commit-info-header')).toBeTruthy();
        expect(screen.queryByTestId('commit-info-summary')).toBeNull();
    });

    it('collapse button collapses the header', async () => {
        await renderDetail({ commit: makeCommit() });
        const collapseBtn = screen.getByTestId('commit-info-collapse-btn');
        await act(async () => { fireEvent.click(collapseBtn); });
        expect(screen.getByTestId('commit-info-summary')).toBeTruthy();
    });

    it('summary bar shows subject and short hash when collapsed', async () => {
        const commit = makeCommit({ subject: 'fix: a bug', hash: 'deadbeef1234567890abcdef1234567890abcdef' });
        await renderDetail({ commit });
        await act(async () => { fireEvent.click(screen.getByTestId('commit-info-collapse-btn')); });
        const summary = screen.getByTestId('commit-info-summary');
        expect(summary.textContent).toContain('fix: a bug');
        expect(summary.textContent).toContain('deadbee');
    });

    it('clicking summary bar re-expands the header', async () => {
        await renderDetail({ commit: makeCommit() });
        await act(async () => { fireEvent.click(screen.getByTestId('commit-info-collapse-btn')); });
        expect(screen.getByTestId('commit-info-summary')).toBeTruthy();
        await act(async () => { fireEvent.click(screen.getByTestId('commit-info-summary')); });
        expect(screen.queryByTestId('commit-info-summary')).toBeNull();
        expect(screen.getByTestId('commit-info-header')).toBeTruthy();
    });

    it('auto-collapses when diff container is scrolled past threshold', async () => {
        await renderDetail({ commit: makeCommit() });
        const diffSection = screen.getByTestId('diff-section');
        // simulate scroll past threshold
        Object.defineProperty(diffSection, 'scrollTop', { value: 30, configurable: true });
        await act(async () => { fireEvent.scroll(diffSection); });
        expect(screen.getByTestId('commit-info-summary')).toBeTruthy();
    });

    it('auto-expands when scrolled back to top', async () => {
        await renderDetail({ commit: makeCommit() });
        const diffSection = screen.getByTestId('diff-section');

        // First collapse via scroll
        Object.defineProperty(diffSection, 'scrollTop', { value: 30, configurable: true });
        await act(async () => { fireEvent.scroll(diffSection); });
        expect(screen.getByTestId('commit-info-summary')).toBeTruthy();

        // Scroll back to top
        Object.defineProperty(diffSection, 'scrollTop', { value: 0, configurable: true });
        await act(async () => { fireEvent.scroll(diffSection); });
        expect(screen.queryByTestId('commit-info-summary')).toBeNull();
        expect(screen.getByTestId('commit-info-header')).toBeTruthy();
    });

    it('selecting a new commit resets collapsed state to expanded', async () => {
        const commit1 = makeCommit({ hash: 'aaa111bbbccc', subject: 'first commit' });
        const { rerender } = await renderDetail({ commit: commit1 });

        // Collapse manually
        await act(async () => { fireEvent.click(screen.getByTestId('commit-info-collapse-btn')); });
        expect(screen.getByTestId('commit-info-summary')).toBeTruthy();

        // Change to a new commit
        const commit2 = makeCommit({ hash: 'ddd444eeefff', subject: 'second commit' });
        await act(async () => {
            rerender(<CommitDetail workspaceId="ws1" hash="ddd444eeefff" commit={commit2 as any} />);
        });
        expect(screen.queryByTestId('commit-info-summary')).toBeNull();
        expect(screen.getByTestId('commit-info-header')).toBeTruthy();
    });

    it('per-file view does not render collapse controls', async () => {
        await renderDetail({ commit: makeCommit(), filePath: 'src/index.ts' });
        expect(screen.queryByTestId('commit-info-header')).toBeNull();
        expect(screen.queryByTestId('commit-info-summary')).toBeNull();
        expect(screen.queryByTestId('commit-info-collapse-btn')).toBeNull();
    });
});
