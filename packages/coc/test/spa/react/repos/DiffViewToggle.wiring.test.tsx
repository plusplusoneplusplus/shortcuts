/**
 * Tests for diff view toggle wiring across the git diff container components.
 * Verifies that DiffViewToggle is rendered, switching to "Split" renders
 * SideBySideDiffViewer, and switching back to "Unified" renders UnifiedDiffViewer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

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
        copyAllCommentsAsPrompt: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve({ diff: '@@ -1,2 +1,2 @@\n-old\n+new' }),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        git: {
            commitDiffPath: (workspaceId: string, hash: string) =>
                `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/diff`,
            getWorkingTreeFileDiff: () => Promise.resolve({ diff: '@@ -1,2 +1,2 @@\n-old\n+new' }),
        },
        explorer: {
            readBlob: () => Promise.resolve({ content: '', encoding: 'base64', mimeType: 'application/octet-stream' }),
        },
        preferences: {
            getRepo: vi.fn().mockResolvedValue({}),
            patchRepo: vi.fn().mockResolvedValue({}),
        },
        agentProviders: {
            getReasoningEfforts: vi.fn().mockResolvedValue({ reasoningEfforts: {} }),
            getEffortTiers: vi.fn().mockResolvedValue({ effortTiers: {}, defaults: {} }),
        },
    }),
    requestSpaApi: vi.fn().mockResolvedValue(null),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-unified-viewer'} data-viewer="unified">unified</div>
    ),
    HunkNavButtons: ({ onPrev, onNext }: any) => (
        <div data-testid="hunk-nav-buttons">
            <button data-testid="hunk-prev" onClick={onPrev}>Prev</button>
            <button data-testid="hunk-next" onClick={onNext}>Next</button>
        </div>
    ),
    parseDiffFileList: () => [],
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/SideBySideDiffViewer', () => ({
    SideBySideDiffViewer: ({ 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-sbs-viewer'} data-viewer="split">side-by-side</div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/DiffMiniMap', () => ({
    DiffMiniMap: () => <div data-testid="diff-minimap" />,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: vi.fn() }),
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

import { CommitDetail } from '../../../../src/server/spa/client/react/features/git/commits/CommitDetail';
import { FileDiffPanel } from '../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel';
import { WorkingTreeFileDiff } from '../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';

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

const branchSource = {
    label: 'Branch diff',
    fileDiffUrl: (fp: string) => `/workspaces/ws1/git/branch-range/files/${encodeURIComponent(fp)}/diff`,
    fullDiffUrl: () => null,
    commentContext: (fp: string) => ({ repositoryId: 'ws1', filePath: fp, oldRef: 'branch-base', newRef: 'branch-head' }),
    files: [],
    chat: null,
    supportsTruncation: true,
    cacheKey: 'branch-range',
};

// ─── CommitDetail ────────────────────────────────────────────────────────────

describe('CommitDetail — diff view toggle wiring', () => {
    it('shows DiffViewToggle in commit toolbar', async () => {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" />);
        });
        expect(screen.getByTestId('diff-view-toggle')).toBeTruthy();
    });

    it('clicking Split renders SideBySideDiffViewer', async () => {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" />);
        });
        await waitFor(() => expect(screen.getByTestId('diff-content')).toBeTruthy());

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(screen.getByTestId('diff-content').getAttribute('data-viewer')).toBe('split');
    });

    it('switching back to Unified re-renders UnifiedDiffViewer', async () => {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" />);
        });
        await waitFor(() => expect(screen.getByTestId('diff-content')).toBeTruthy());

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(screen.getByTestId('diff-content').getAttribute('data-viewer')).toBe('split');

        fireEvent.click(screen.getByTestId('diff-view-toggle-unified'));
        expect(screen.getByTestId('diff-content').getAttribute('data-viewer')).toBe('unified');
    });
});

// ─── FileDiffPanel (branch-range source) ─────────────────────────────────────

describe('FileDiffPanel — diff view toggle wiring', () => {
    it('shows DiffViewToggle in toolbar', async () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/app.ts" source={branchSource} />);
        await waitFor(() => expect(screen.getByTestId('diff-view-toggle')).toBeTruthy());
    });

    it('clicking Split renders SideBySideDiffViewer', async () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/app.ts" source={branchSource} />);
        await waitFor(() => expect(screen.getByTestId('file-diff-content')).toBeTruthy());
        expect(screen.getByTestId('file-diff-content').getAttribute('data-viewer')).toBe('unified');

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(screen.getByTestId('file-diff-content').getAttribute('data-viewer')).toBe('split');
    });

    it('switching back to Unified re-renders UnifiedDiffViewer', async () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/app.ts" source={branchSource} />);
        await waitFor(() => expect(screen.getByTestId('file-diff-content')).toBeTruthy());

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        fireEvent.click(screen.getByTestId('diff-view-toggle-unified'));
        expect(screen.getByTestId('file-diff-content').getAttribute('data-viewer')).toBe('unified');
    });

    it('comments button is still present at end of toolbar', async () => {
        render(<FileDiffPanel workspaceId="ws1" filePath="src/app.ts" source={branchSource} />);
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
        render(<FileDiffPanel workspaceId="ws1" filePath="src/app.ts" source={branchSource} />);
        await waitFor(() => expect(screen.getByTestId('diff-view-toggle')).toBeTruthy());

        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(localStorage.getItem('coc-diff-view-mode')).toBe('split');
    });

    it('reads persisted mode from localStorage on mount', async () => {
        localStorage.setItem('coc-diff-view-mode', 'split');
        render(<FileDiffPanel workspaceId="ws1" filePath="src/app.ts" source={branchSource} />);
        await waitFor(() => expect(screen.getByTestId('file-diff-content')).toBeTruthy());
        expect(screen.getByTestId('file-diff-content').getAttribute('data-viewer')).toBe('split');
    });
});
