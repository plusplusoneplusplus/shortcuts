/**
 * @vitest-environment jsdom
 *
 * Component tests for the notes-git NotesGitTab.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────

// Mock the useNotesGit hook
const mockInitialize = vi.fn();
const mockCommit = vi.fn();
const mockGetDiff = vi.fn();
const mockRefresh = vi.fn();

const defaultHookReturn = {
    status: null,
    log: [],
    loading: false,
    error: null,
    initialized: false,
    initialize: mockInitialize,
    commit: mockCommit,
    getDiff: mockGetDiff,
    refresh: mockRefresh,
};

let hookReturn = { ...defaultHookReturn };

vi.mock('../../../../../src/server/spa/client/react/features/notes/hooks/useNotesGit', () => ({
    useNotesGit: () => hookReturn,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 320,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        resetWidth: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Button: ({ onClick, loading, disabled, children, ...rest }: any) => (
        <button
            onClick={onClick}
            disabled={loading || disabled}
            data-testid={rest['data-testid']}
            data-loading={loading ? 'true' : undefined}
        >
            {loading ? 'Loading...' : children}
        </button>
    ),
    Spinner: ({ size }: any) => <div data-testid="spinner" data-size={size} />,
    SectionHeader: ({ title, onRefresh, refreshing, actions, className }: any) => (
        <div data-testid="section-header" className={className}>
            <span>{title}</span>
            {onRefresh && (
                <button onClick={onRefresh} data-testid="refresh-btn" disabled={refreshing}>
                    Refresh
                </button>
            )}
            {actions}
        </div>
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ diff, enableComments, ...rest }: any) => (
        <div data-testid={rest['data-testid'] ?? 'unified-diff-viewer'} data-enable-comments={enableComments}>
            {diff}
        </div>
    ),
}));

import { NotesGitTab } from '../../../../../src/server/spa/client/react/features/notes/NotesGitTab';

// ── Helpers ──────────────────────────────────────────────────────────

function makeStatus(overrides: Record<string, any> = {}) {
    return {
        initialized: true,
        branch: 'main',
        clean: true,
        staged: [],
        unstaged: [],
        untracked: [],
        totalChanges: 0,
        ...overrides,
    };
}

function makeLogEntry(overrides: Record<string, any> = {}) {
    return {
        hash: 'abc1234567890',
        shortHash: 'abc1234',
        message: 'Initial commit',
        date: '2025-01-01T00:00:00Z',
        filesChanged: 1,
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('NotesGitTab (notes-git)', () => {
    beforeEach(() => {
        hookReturn = { ...defaultHookReturn };
        mockInitialize.mockReset();
        mockCommit.mockReset();
        mockGetDiff.mockReset();
        mockRefresh.mockReset();
    });

    afterEach(() => {
        cleanup();
    });

    // ── Loading state ───────────────────────────────────────────────

    it('shows spinner when loading', () => {
        hookReturn = { ...defaultHookReturn, loading: true };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(screen.getByTestId('notes-git-loading')).toBeDefined();
        expect(screen.getByTestId('spinner')).toBeDefined();
    });

    // ── Error state ─────────────────────────────────────────────────

    it('shows error message with retry button', () => {
        hookReturn = { ...defaultHookReturn, error: 'Something went wrong' };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(screen.getByTestId('notes-git-error')).toBeDefined();
        expect(screen.getByText('Something went wrong')).toBeDefined();

        fireEvent.click(screen.getByTestId('notes-git-retry-btn'));
        expect(mockRefresh).toHaveBeenCalled();
    });

    // ── Init prompt ─────────────────────────────────────────────────

    it('renders init prompt when not initialized', () => {
        hookReturn = { ...defaultHookReturn, initialized: false };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(screen.getByTestId('notes-git-init-prompt')).toBeDefined();
        expect(screen.getByText('Enable version tracking for your notes')).toBeDefined();
    });

    it('clicking Initialize calls init API', async () => {
        hookReturn = { ...defaultHookReturn, initialized: false };
        mockInitialize.mockResolvedValue(undefined);

        render(<NotesGitTab workspaceId="ws-1" />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('notes-git-init-btn'));
        });

        expect(mockInitialize).toHaveBeenCalled();
    });

    // ── Initialized view: Status section ────────────────────────────

    it('renders "Clean ✓" when no pending changes', () => {
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ clean: true }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(screen.getByTestId('notes-git-status')).toBeDefined();
        expect(screen.getByText(/Clean/)).toBeDefined();
    });

    it('renders status with modified/new/deleted counts', () => {
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({
                clean: false,
                unstaged: ['file1.md', 'file2.md'],
                untracked: ['new-file.md'],
                staged: ['deleted.md'],
                totalChanges: 4,
            }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(screen.getByText('2 modified')).toBeDefined();
        expect(screen.getByText('1 new')).toBeDefined();
    });

    // ── Initialized view: History list ──────────────────────────────

    it('renders commit history list', () => {
        const entries = [
            makeLogEntry({ hash: 'hash1', shortHash: 'hash1', message: 'First commit' }),
            makeLogEntry({ hash: 'hash2', shortHash: 'hash2', message: 'Second commit' }),
        ];
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus(),
            log: entries,
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(screen.getByTestId('notes-git-history')).toBeDefined();
        expect(screen.getByText('First commit')).toBeDefined();
        expect(screen.getByText('Second commit')).toBeDefined();
    });

    it('shows "No commits yet" for empty history', () => {
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus(),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(screen.getByText('No commits yet')).toBeDefined();
    });

    // ── Clicking a history entry loads diff ─────────────────────────

    it('clicking a commit loads and displays the diff', async () => {
        const entry = makeLogEntry({ hash: 'abc123', shortHash: 'abc1', message: 'Test commit' });
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus(),
            log: [entry],
        };

        const diffData = {
            files: [{ path: 'note.md', status: 'M', diff: '+added line' }],
        };
        mockGetDiff.mockResolvedValue(diffData);

        render(<NotesGitTab workspaceId="ws-1" />);

        await act(async () => {
            fireEvent.click(screen.getByText('Test commit'));
        });

        expect(mockGetDiff).toHaveBeenCalledWith('abc123');

        await waitFor(() => {
            expect(screen.getByTestId('notes-git-commit-meta')).toBeDefined();
        });

        // Verify diff viewer is rendered
        expect(screen.getByTestId('notes-git-diff-viewer')).toBeDefined();
        // Verify file badges
        expect(screen.getByTestId('notes-git-changed-files')).toBeDefined();
    });

    // ── Commit Now button ───────────────────────────────────────────

    it('"Commit Now" button calls commit API and refreshes', async () => {
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ clean: false, totalChanges: 1 }),
            log: [],
        };
        mockCommit.mockResolvedValue(undefined);

        render(<NotesGitTab workspaceId="ws-1" />);

        const commitBtn = screen.getByTestId('notes-git-commit-btn');
        expect(commitBtn).toBeDefined();

        await act(async () => {
            fireEvent.click(commitBtn);
        });

        expect(mockCommit).toHaveBeenCalledWith(undefined);
    });

    it('commit button is disabled when status is clean', () => {
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ clean: true }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);

        const commitBtn = screen.getByTestId('notes-git-commit-btn');
        expect(commitBtn.hasAttribute('disabled')).toBe(true);
    });

    // ── Custom commit message ───────────────────────────────────────

    it('custom commit message is passed to commit API', async () => {
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ clean: false }),
            log: [],
        };
        mockCommit.mockResolvedValue(undefined);

        render(<NotesGitTab workspaceId="ws-1" />);

        // Toggle message input
        fireEvent.click(screen.getByTestId('notes-git-toggle-msg-btn'));

        const input = screen.getByTestId('notes-git-commit-msg-input');
        fireEvent.change(input, { target: { value: 'My custom message' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('notes-git-commit-btn'));
        });

        expect(mockCommit).toHaveBeenCalledWith('My custom message');
    });

    // ── Empty detail pane ───────────────────────────────────────────

    it('shows "Select a commit" when no commit is selected', () => {
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus(),
            log: [makeLogEntry()],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(screen.getByTestId('notes-git-detail-empty')).toBeDefined();
        expect(screen.getByText('Select a commit to view details')).toBeDefined();
    });

    // ── Section header ──────────────────────────────────────────────

    it('renders section header with "Notes Git" title', () => {
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus(),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(screen.getByText('Notes Git')).toBeDefined();
    });

    it('refresh button in header calls refresh', () => {
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus(),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);

        fireEvent.click(screen.getByTestId('refresh-btn'));
        expect(mockRefresh).toHaveBeenCalled();
    });

    // ── Diff with no changes ────────────────────────────────────────

    it('shows "No changes" when diff patch is empty', async () => {
        const entry = makeLogEntry();
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus(),
            log: [entry],
        };
        mockGetDiff.mockResolvedValue({ files: [] });

        render(<NotesGitTab workspaceId="ws-1" />);

        await act(async () => {
            fireEvent.click(screen.getByText('Initial commit'));
        });

        await waitFor(() => {
            expect(screen.getByText('No changes in this commit.')).toBeDefined();
        });
    });

    // matchCommitsByIdentity is in RepoGitTab, not NotesGitTab — no re-export needed
});
