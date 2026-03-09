/**
 * Tests for CommitDetail — commit info header rendering.
 *
 * Validates that the commit metadata header displays subject, author, date,
 * hash (with copy button), parents, and body when a commit prop is provided,
 * and is hidden when commit prop is absent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

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

const mockCopyToClipboard = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: (...args: any[]) => mockCopyToClipboard(...args),
    formatRelativeTime: (d: string) => d,
}));

import { CommitDetail } from '../../../../src/server/spa/client/react/repos/CommitDetail';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/repos/CommitList';

const makeCommit = (overrides: Partial<GitCommitItem> = {}): GitCommitItem => ({
    hash: 'abc123def456abc123def456abc123def456abc1',
    shortHash: 'abc123d',
    subject: 'feat: add commit info header',
    author: 'Test Author',
    authorEmail: 'test@example.com',
    date: '2026-03-07T12:00:00Z',
    parentHashes: ['parent1abcdef1234567890abcdef1234567890ab'],
    body: 'This is the commit body\nwith multiple lines.',
    ...overrides,
});

describe('CommitDetail — commit info header', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    async function renderDetail(props: Record<string, unknown> = {}) {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" {...(props as any)} />);
        });
    }

    it('does not render header when commit prop is absent', async () => {
        await renderDetail();
        expect(screen.queryByTestId('commit-info-header')).toBeNull();
    });

    it('renders header when commit prop is provided (full-commit view)', async () => {
        await renderDetail({ commit: makeCommit() });
        expect(screen.getByTestId('commit-info-header')).toBeTruthy();
    });

    it('does not render header when filePath is provided (per-file view)', async () => {
        await renderDetail({ commit: makeCommit(), filePath: 'src/index.ts' });
        expect(screen.queryByTestId('commit-info-header')).toBeNull();
    });

    it('displays commit subject', async () => {
        await renderDetail({ commit: makeCommit({ subject: 'my fancy subject' }) });
        expect(screen.getByTestId('commit-info-subject').textContent).toBe('my fancy subject');
    });

    it('displays author name', async () => {
        await renderDetail({ commit: makeCommit({ author: 'Jane Doe' }) });
        const authorEl = screen.getByTestId('commit-info-author');
        expect(authorEl.textContent).toContain('Jane Doe');
    });

    it('displays author email when present', async () => {
        await renderDetail({ commit: makeCommit({ author: 'Jane', authorEmail: 'jane@test.com' }) });
        const authorEl = screen.getByTestId('commit-info-author');
        expect(authorEl.textContent).toContain('<jane@test.com>');
    });

    it('hides author email when absent', async () => {
        await renderDetail({ commit: makeCommit({ authorEmail: undefined }) });
        const authorEl = screen.getByTestId('commit-info-author');
        expect(authorEl.textContent).not.toContain('<');
    });

    it('displays formatted date', async () => {
        await renderDetail({ commit: makeCommit({ date: '2026-03-07T12:00:00Z' }) });
        const dateEl = screen.getByTestId('commit-info-date');
        expect(dateEl.textContent).toBeTruthy();
        expect(dateEl.textContent!.length).toBeGreaterThan(0);
    });

    it('displays short hash', async () => {
        await renderDetail({ commit: makeCommit({ hash: 'abc123def456789012345678901234567890abcd' }) });
        const hashEl = screen.getByTestId('commit-info-hash');
        expect(hashEl.textContent).toContain('abc123de');
    });

    it('copy button calls copyToClipboard with full hash', async () => {
        const commit = makeCommit({ hash: 'fullhash1234567890abcdef1234567890abcdef' });
        await renderDetail({ commit });
        const copyBtn = screen.getByTestId('commit-info-copy-hash');
        await act(async () => { fireEvent.click(copyBtn); });
        expect(mockCopyToClipboard).toHaveBeenCalledWith(commit.hash);
    });

    it('displays parent hashes', async () => {
        await renderDetail({ commit: makeCommit({ parentHashes: ['aaa1111222233334444555566667777888899990', 'bbb1111222233334444555566667777888899990'] }) });
        const parentsEl = screen.getByTestId('commit-info-parents');
        expect(parentsEl.textContent).toContain('aaa1111');
        expect(parentsEl.textContent).toContain('bbb1111');
    });

    it('hides parents section when parentHashes is empty', async () => {
        await renderDetail({ commit: makeCommit({ parentHashes: [] }) });
        expect(screen.queryByTestId('commit-info-parents')).toBeNull();
    });

    it('displays commit body when present', async () => {
        await renderDetail({ commit: makeCommit({ body: 'Detailed description here' }) });
        const bodyEl = screen.getByTestId('commit-info-body');
        expect(bodyEl.textContent).toContain('Detailed description here');
    });

    it('hides body section when body is absent', async () => {
        await renderDetail({ commit: makeCommit({ body: undefined }) });
        expect(screen.queryByTestId('commit-info-body')).toBeNull();
    });

    it('still renders diff below the header', async () => {
        await renderDetail({ commit: makeCommit() });
        expect(screen.getByTestId('commit-info-header')).toBeTruthy();
        expect(screen.getByTestId('diff-section')).toBeTruthy();
    });
});
