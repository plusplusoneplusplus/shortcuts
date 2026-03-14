/**
 * Tests for diff view toggle wiring across all four diff container components.
 * Verifies that DiffViewToggle is rendered, switching to "Split" renders
 * SideBySideDiffViewer, and switching back to "Unified" renders UnifiedDiffViewer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

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
        copyAllCommentsAsPrompt: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve({ diff: '@@ -1,2 +1,2 @@\n-old\n+new' }),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../../src/server/spa/client/react/repos/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-unified-viewer'} data-viewer="unified">unified</div>
    ),
    HunkNavButtons: ({ onPrev, onNext }: any) => (
        <div data-testid="hunk-nav-buttons">
            <button data-testid="hunk-prev" onClick={onPrev}>Prev</button>
            <button data-testid="hunk-next" onClick={onNext}>Next</button>
        </div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/repos/SideBySideDiffViewer', () => ({
    SideBySideDiffViewer: ({ 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-sbs-viewer'} data-viewer="split">side-by-side</div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/repos/DiffMiniMap', () => ({
    DiffMiniMap: () => <div data-testid="diff-minimap" />,
}));

import { CommitDetail } from '../../../../src/server/spa/client/react/repos/CommitDetail';
import { CommitFileContent } from '../../../../src/server/spa/client/react/repos/CommitFileContent';
import { BranchFileDiff } from '../../../../src/server/spa/client/react/repos/BranchFileDiff';
import { WorkingTreeFileDiff } from '../../../../src/server/spa/client/react/repos/WorkingTreeFileDiff';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/repos/CommitList';

// Reset localStorage between tests
beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
});

const makeCommit = (overrides: Partial<GitCommitItem> = {}): GitCommitItem => ({
    hash: 'abc123def456abc123def456abc123def456abc1',
    shortHash: 'abc123d',
    subject: 'feat: test commit',
    author: 'Test Author',
    authorEmail: 'test@example.com',
    date: '2026-03-07T12:00:00Z',
    parentHashes: [],
    body: '',
    ...overrides,
});

// ─── CommitDetail ────────────────────────────────────────────────────────────

describe('CommitDetail — diff view toggle wiring', () => {
    it('shows DiffViewToggle in per-file toolbar (filePath present)', async () => {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" filePath="src/index.ts" />);
        });
        expect(screen.getByTestId('diff-view-toggle')).toBeTruthy();
    });

    it('clicking Split renders SideBySideDiffViewer (filePath present)', async () => {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" filePath="src/index.ts" />);
        });
        await waitFor(() => expect(screen.getByTestId('diff-content')).toBeTruthy());
        expect(screen.getByTestId('diff-content').getAttribute('data-viewer')).toBe('unified');

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(screen.getByTestId('diff-content').getAttribute('data-viewer')).toBe('split');
    });

    it('shows DiffViewToggle in full-commit toolbar (no filePath)', async () => {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" />);
        });
        expect(screen.getByTestId('diff-view-toggle')).toBeTruthy();
    });

    it('clicking Split in full-commit view renders SideBySideDiffViewer', async () => {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" />);
        });
        await waitFor(() => expect(screen.getByTestId('diff-content')).toBeTruthy());

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(screen.getByTestId('diff-content').getAttribute('data-viewer')).toBe('split');
    });

    it('switching back to Unified re-renders UnifiedDiffViewer', async () => {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" filePath="src/index.ts" />);
        });
        await waitFor(() => expect(screen.getByTestId('diff-content')).toBeTruthy());

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(screen.getByTestId('diff-content').getAttribute('data-viewer')).toBe('split');

        fireEvent.click(screen.getByTestId('diff-view-toggle-unified'));
        expect(screen.getByTestId('diff-content').getAttribute('data-viewer')).toBe('unified');
    });
});

// ─── CommitFileContent ───────────────────────────────────────────────────────

describe('CommitFileContent — diff view toggle wiring', () => {
    it('shows DiffViewToggle in toolbar', async () => {
        render(<CommitFileContent workspaceId="ws1" hash="abc123" filePath="src/app.ts" />);
        await waitFor(() => expect(screen.getByTestId('diff-view-toggle')).toBeTruthy());
    });

    it('clicking Split renders SideBySideDiffViewer', async () => {
        render(<CommitFileContent workspaceId="ws1" hash="abc123" filePath="src/app.ts" />);
        await waitFor(() => expect(screen.getByTestId('commit-file-diff-content')).toBeTruthy());
        expect(screen.getByTestId('commit-file-diff-content').getAttribute('data-viewer')).toBe('unified');

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(screen.getByTestId('commit-file-diff-content').getAttribute('data-viewer')).toBe('split');
    });

    it('hunk nav buttons are present alongside the toggle', async () => {
        render(<CommitFileContent workspaceId="ws1" hash="abc123" filePath="src/app.ts" />);
        await waitFor(() => expect(screen.getByTestId('diff-view-toggle')).toBeTruthy());
        expect(screen.getByTestId('hunk-nav-buttons')).toBeTruthy();
    });
});

// ─── BranchFileDiff ──────────────────────────────────────────────────────────

describe('BranchFileDiff — diff view toggle wiring', () => {
    it('shows DiffViewToggle in toolbar', async () => {
        render(<BranchFileDiff workspaceId="ws1" filePath="src/app.ts" />);
        await waitFor(() => expect(screen.getByTestId('diff-view-toggle')).toBeTruthy());
    });

    it('clicking Split renders SideBySideDiffViewer', async () => {
        render(<BranchFileDiff workspaceId="ws1" filePath="src/app.ts" />);
        await waitFor(() => expect(screen.getByTestId('branch-file-diff-content')).toBeTruthy());
        expect(screen.getByTestId('branch-file-diff-content').getAttribute('data-viewer')).toBe('unified');

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(screen.getByTestId('branch-file-diff-content').getAttribute('data-viewer')).toBe('split');
    });

    it('switching back to Unified re-renders UnifiedDiffViewer', async () => {
        render(<BranchFileDiff workspaceId="ws1" filePath="src/app.ts" />);
        await waitFor(() => expect(screen.getByTestId('branch-file-diff-content')).toBeTruthy());

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        fireEvent.click(screen.getByTestId('diff-view-toggle-unified'));
        expect(screen.getByTestId('branch-file-diff-content').getAttribute('data-viewer')).toBe('unified');
    });

    it('comments button is still present at end of toolbar', async () => {
        render(<BranchFileDiff workspaceId="ws1" filePath="src/app.ts" />);
        await waitFor(() => expect(screen.getByTestId('toggle-comments-btn')).toBeTruthy());
    });
});

// ─── WorkingTreeFileDiff ─────────────────────────────────────────────────────

describe('WorkingTreeFileDiff — diff view toggle wiring', () => {
    it('DiffViewToggle is NOT rendered for untracked stage', async () => {
        render(<WorkingTreeFileDiff workspaceId="ws1" filePath="newfile.ts" stage="untracked" />);
        await waitFor(() => expect(screen.getByTestId('working-tree-file-diff-untracked')).toBeTruthy());
        expect(screen.queryByTestId('diff-view-toggle')).toBeNull();
    });

    it('DiffViewToggle IS rendered for staged stage', async () => {
        render(<WorkingTreeFileDiff workspaceId="ws1" filePath="src/app.ts" stage="staged" />);
        await waitFor(() => expect(screen.getByTestId('diff-view-toggle')).toBeTruthy());
    });

    it('DiffViewToggle IS rendered for unstaged stage', async () => {
        render(<WorkingTreeFileDiff workspaceId="ws1" filePath="src/app.ts" stage="unstaged" />);
        await waitFor(() => expect(screen.getByTestId('diff-view-toggle')).toBeTruthy());
    });

    it('clicking Split renders SideBySideDiffViewer for staged', async () => {
        render(<WorkingTreeFileDiff workspaceId="ws1" filePath="src/app.ts" stage="staged" />);
        await waitFor(() => expect(screen.getByTestId('working-tree-file-diff-content')).toBeTruthy());
        expect(screen.getByTestId('working-tree-file-diff-content').getAttribute('data-viewer')).toBe('unified');

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(screen.getByTestId('working-tree-file-diff-content').getAttribute('data-viewer')).toBe('split');
    });
});

// ─── localStorage persistence ────────────────────────────────────────────────

describe('DiffViewMode — localStorage persistence', () => {
    it('persists mode to localStorage key coc-diff-view-mode on toggle', async () => {
        render(<CommitFileContent workspaceId="ws1" hash="abc123" filePath="src/app.ts" />);
        await waitFor(() => expect(screen.getByTestId('diff-view-toggle')).toBeTruthy());

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(localStorage.getItem('coc-diff-view-mode')).toBe('split');
    });

    it('reads persisted mode from localStorage on mount', async () => {
        localStorage.setItem('coc-diff-view-mode', 'split');
        render(<CommitFileContent workspaceId="ws1" hash="abc123" filePath="src/app.ts" />);
        await waitFor(() => expect(screen.getByTestId('commit-file-diff-content')).toBeTruthy());
        expect(screen.getByTestId('commit-file-diff-content').getAttribute('data-viewer')).toBe('split');
    });
});
