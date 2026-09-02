/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────

// Mock the useNotesGit hook
const mockInitialize = vi.fn();
const mockCommit = vi.fn();
const mockResetFromOrigin = vi.fn();
const mockSync = vi.fn();
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
    resetFromOrigin: mockResetFromOrigin,
    sync: mockSync,
    getDiff: mockGetDiff,
    refresh: mockRefresh,
};

let hookReturn = { ...defaultHookReturn };

vi.mock('../../../../../src/server/spa/client/react/features/notes/hooks/useNotesGit', () => ({
    useNotesGit: () => hookReturn,
}));

// Origin config drives whether the "Reset from origin" button renders.
const mockGetWorkspacePreferences = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/hooks/preferences/preferencesApi', () => ({
    getWorkspacePreferences: (...args: any[]) => mockGetWorkspacePreferences(...args),
}));

const mockAddToast = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: mockAddToast }),
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

// The docked status/action cluster is app-shell chrome (gated to the
// remote-first desktop shell inside a ThemeProvider); stub it so we can assert
// it is placed inside the tab's own sidebar when `dockStatusFooter` is set.
vi.mock('../../../../../src/server/spa/client/react/layout/DockedStatusFooter', () => ({
    DockedStatusFooter: () => <div data-testid="docked-status-footer" />,
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
        mockResetFromOrigin.mockReset();
        mockSync.mockReset();
        mockGetDiff.mockReset();
        mockRefresh.mockReset();
        mockGetWorkspacePreferences.mockReset();
        mockAddToast.mockReset();
        // Default: no origin configured → reset button hidden.
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: {} });
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

    // ── Sync status indicator (ahead/behind) ────────────────────────
    //
    // The ahead/behind readout is gated on the *configured* `notesGit.remoteUrl`,
    // the same gate as the Sync / Reset buttons, so these tests must configure a
    // remote. Preferences load asynchronously, so assert with `findBy*`.

    it('shows "N commits not pushed" when the local branch is ahead of origin', async () => {
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: { remoteUrl: 'git@example.com:me/notes.git' } });
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ hasUpstream: true, ahead: 2, behind: 0 }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(await screen.findByTestId('notes-git-sync-status')).toBeDefined();
        expect(screen.getByText(/2 commits not pushed/)).toBeDefined();
    });

    it('singularizes "1 commit not pushed"', async () => {
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: { remoteUrl: 'git@example.com:me/notes.git' } });
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ hasUpstream: true, ahead: 1, behind: 0 }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(await screen.findByText(/1 commit not pushed/)).toBeDefined();
    });

    it('shows "Synced with origin" when ahead and behind are both zero', async () => {
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: { remoteUrl: 'git@example.com:me/notes.git' } });
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ hasUpstream: true, ahead: 0, behind: 0 }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(await screen.findByTestId('notes-git-sync-status')).toBeDefined();
        expect(screen.getByText(/Synced with origin/)).toBeDefined();
    });

    it('shows "N behind" when origin is ahead of the local branch', async () => {
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: { remoteUrl: 'git@example.com:me/notes.git' } });
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ hasUpstream: true, ahead: 0, behind: 3 }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(await screen.findByText(/3 behind/)).toBeDefined();
    });

    it('renders no sync line when there is no upstream tracking ref', async () => {
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: { remoteUrl: 'git@example.com:me/notes.git' } });
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ hasUpstream: false, ahead: null, behind: null }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        // Wait for the prefs load to land so this is a real assertion about the
        // upstream gate, not just about the pre-load render.
        await screen.findByTestId('notes-git-sync-btn');
        expect(screen.queryByTestId('notes-git-sync-status')).toBeNull();
    });

    it('still shows the unpushed line when the working tree is clean (early-return regression)', async () => {
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: { remoteUrl: 'git@example.com:me/notes.git' } });
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ clean: true, hasUpstream: true, ahead: 2, behind: 0 }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        // Working tree still reads Clean...
        expect(screen.getByText(/Clean/)).toBeDefined();
        // ...but the unpushed commits are surfaced alongside it.
        expect(await screen.findByText(/2 commits not pushed/)).toBeDefined();
    });

    // ── Status / action gating agree on one condition ───────────────

    it('hides the ahead/behind line and both remote actions when no remoteUrl is configured, even with a stale local origin ref', async () => {
        // Real user state: the notes repo still has an `origin/<branch>` ref
        // left over from an earlier config or a past reset-from-origin, so the
        // server reports hasUpstream/ahead — but the remote URL has been cleared.
        // Nothing can push, so nothing should nag about unpushed commits.
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: {} });
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ clean: true, hasUpstream: true, ahead: 37, behind: 0 }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);

        // Let the preferences load settle before asserting absence.
        await waitFor(() => expect(mockGetWorkspacePreferences).toHaveBeenCalled());
        await screen.findByTestId('notes-git-commit-btn');

        expect(screen.queryByTestId('notes-git-sync-status')).toBeNull();
        expect(screen.queryByText(/37 commits not pushed/)).toBeNull();
        expect(screen.queryByText(/Synced with origin/)).toBeNull();
        expect(screen.queryByTestId('notes-git-sync-btn')).toBeNull();
        expect(screen.queryByTestId('notes-git-reset-btn')).toBeNull();
        // Local-history-only is a healthy state: the tree still reads clean.
        expect(screen.getByText(/Clean/)).toBeDefined();
    });

    it('shows both the unpushed line and the Sync button when a remoteUrl is configured and ahead > 0', async () => {
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: { remoteUrl: 'git@example.com:me/notes.git' } });
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ clean: true, hasUpstream: true, ahead: 37, behind: 0 }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);

        // The warning and the action that resolves it appear together.
        expect(await screen.findByTestId('notes-git-sync-status')).toBeDefined();
        expect(screen.getByText(/37 commits not pushed/)).toBeDefined();
        expect(screen.getByTestId('notes-git-sync-btn')).toBeDefined();
        expect(screen.getByTestId('notes-git-reset-btn')).toBeDefined();
    });

    it('treats a whitespace-only remoteUrl as no remote for both status and actions', async () => {
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: { remoteUrl: '   ' } });
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus({ hasUpstream: true, ahead: 5, behind: 0 }),
            log: [],
        };
        render(<NotesGitTab workspaceId="ws-1" />);

        await waitFor(() => expect(mockGetWorkspacePreferences).toHaveBeenCalled());
        await screen.findByTestId('notes-git-commit-btn');

        expect(screen.queryByTestId('notes-git-sync-status')).toBeNull();
        expect(screen.queryByTestId('notes-git-sync-btn')).toBeNull();
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

        expect(screen.getByTestId('notes-git-diff-viewer')).toBeDefined();
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

    // ── Sync ────────────────────────────────────────────────────────

    it('hides "Sync" button when no remoteUrl is configured', async () => {
        hookReturn = { ...defaultHookReturn, initialized: true, status: makeStatus(), log: [] };
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: { enabled: true } });

        await act(async () => {
            render(<NotesGitTab workspaceId="ws-1" />);
        });

        expect(screen.queryByTestId('notes-git-sync-btn')).toBeNull();
    });

    it('shows "Sync" button when remoteUrl is configured', async () => {
        hookReturn = { ...defaultHookReturn, initialized: true, status: makeStatus(), log: [] };
        mockGetWorkspacePreferences.mockResolvedValue({
            notesGit: { enabled: true, remoteUrl: 'https://github.com/owner/repo.git', branch: 'main' },
        });

        await act(async () => {
            render(<NotesGitTab workspaceId="ws-1" />);
        });

        await waitFor(() => {
            expect(screen.getByTestId('notes-git-sync-btn')).toBeDefined();
        });
    });

    it('clicking "Sync" calls sync and toasts a summary', async () => {
        hookReturn = { ...defaultHookReturn, initialized: true, status: makeStatus(), log: [] };
        mockGetWorkspacePreferences.mockResolvedValue({
            notesGit: { enabled: true, remoteUrl: 'https://github.com/owner/repo.git', branch: 'dev' },
        });
        mockSync.mockResolvedValue({ synced: true, branch: 'dev', committed: true, pulled: true, pushed: true });

        await act(async () => {
            render(<NotesGitTab workspaceId="ws-1" />);
        });

        await waitFor(() => expect(screen.getByTestId('notes-git-sync-btn')).toBeDefined());

        await act(async () => {
            fireEvent.click(screen.getByTestId('notes-git-sync-btn'));
        });

        expect(mockSync).toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('dev'), 'success');
    });

    it('surfaces a sync failure as an error toast', async () => {
        hookReturn = { ...defaultHookReturn, initialized: true, status: makeStatus(), log: [] };
        mockGetWorkspacePreferences.mockResolvedValue({
            notesGit: { enabled: true, remoteUrl: 'https://github.com/owner/repo.git', branch: 'main' },
        });
        mockSync.mockRejectedValue(new Error('conflict during rebase'));

        await act(async () => {
            render(<NotesGitTab workspaceId="ws-1" />);
        });

        await waitFor(() => expect(screen.getByTestId('notes-git-sync-btn')).toBeDefined());

        await act(async () => {
            fireEvent.click(screen.getByTestId('notes-git-sync-btn'));
        });

        expect(mockAddToast).toHaveBeenCalledWith('conflict during rebase', 'error');
    });

    // ── Reset from origin (AC-03) ───────────────────────────────────

    it('hides "Reset from origin" button when no remoteUrl is configured', async () => {
        hookReturn = { ...defaultHookReturn, initialized: true, status: makeStatus(), log: [] };
        mockGetWorkspacePreferences.mockResolvedValue({ notesGit: { enabled: true } });

        await act(async () => {
            render(<NotesGitTab workspaceId="ws-1" />);
        });

        expect(screen.queryByTestId('notes-git-reset-btn')).toBeNull();
    });

    it('shows "Reset from origin" button when remoteUrl is configured', async () => {
        hookReturn = { ...defaultHookReturn, initialized: true, status: makeStatus(), log: [] };
        mockGetWorkspacePreferences.mockResolvedValue({
            notesGit: { enabled: true, remoteUrl: 'https://github.com/owner/repo.git', branch: 'main' },
        });

        await act(async () => {
            render(<NotesGitTab workspaceId="ws-1" />);
        });

        await waitFor(() => {
            expect(screen.getByTestId('notes-git-reset-btn')).toBeDefined();
        });
    });

    it('clicking "Reset from origin" opens a confirmation dialog (no immediate reset)', async () => {
        hookReturn = { ...defaultHookReturn, initialized: true, status: makeStatus(), log: [] };
        mockGetWorkspacePreferences.mockResolvedValue({
            notesGit: { enabled: true, remoteUrl: 'https://github.com/owner/repo.git', branch: 'dev' },
        });

        await act(async () => {
            render(<NotesGitTab workspaceId="ws-1" />);
        });

        await waitFor(() => expect(screen.getByTestId('notes-git-reset-btn')).toBeDefined());
        fireEvent.click(screen.getByTestId('notes-git-reset-btn'));

        expect(screen.getByTestId('notes-git-reset-confirm')).toBeDefined();
        expect(mockResetFromOrigin).not.toHaveBeenCalled();
    });

    it('confirming reset calls resetFromOrigin and toasts success', async () => {
        hookReturn = { ...defaultHookReturn, initialized: true, status: makeStatus(), log: [] };
        mockGetWorkspacePreferences.mockResolvedValue({
            notesGit: { enabled: true, remoteUrl: 'https://github.com/owner/repo.git', branch: 'main' },
        });
        mockResetFromOrigin.mockResolvedValue({ reset: true, branch: 'main' });

        await act(async () => {
            render(<NotesGitTab workspaceId="ws-1" />);
        });

        await waitFor(() => expect(screen.getByTestId('notes-git-reset-btn')).toBeDefined());
        fireEvent.click(screen.getByTestId('notes-git-reset-btn'));

        await act(async () => {
            fireEvent.click(screen.getByTestId('notes-git-reset-confirm-btn'));
        });

        expect(mockResetFromOrigin).toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith(expect.stringContaining('main'), 'success');
        // Dialog closes on success.
        await waitFor(() => expect(screen.queryByTestId('notes-git-reset-confirm')).toBeNull());
    });

    it('cancelling reset closes the dialog without resetting', async () => {
        hookReturn = { ...defaultHookReturn, initialized: true, status: makeStatus(), log: [] };
        mockGetWorkspacePreferences.mockResolvedValue({
            notesGit: { enabled: true, remoteUrl: 'https://github.com/owner/repo.git', branch: 'main' },
        });

        await act(async () => {
            render(<NotesGitTab workspaceId="ws-1" />);
        });

        await waitFor(() => expect(screen.getByTestId('notes-git-reset-btn')).toBeDefined());
        fireEvent.click(screen.getByTestId('notes-git-reset-btn'));
        fireEvent.click(screen.getByTestId('notes-git-reset-cancel-btn'));

        expect(screen.queryByTestId('notes-git-reset-confirm')).toBeNull();
        expect(mockResetFromOrigin).not.toHaveBeenCalled();
    });

    it('surfaces an error toast when reset fails', async () => {
        hookReturn = { ...defaultHookReturn, initialized: true, status: makeStatus(), log: [] };
        mockGetWorkspacePreferences.mockResolvedValue({
            notesGit: { enabled: true, remoteUrl: 'https://github.com/owner/repo.git', branch: 'main' },
        });
        mockResetFromOrigin.mockRejectedValue(new Error('clone failed'));

        await act(async () => {
            render(<NotesGitTab workspaceId="ws-1" />);
        });

        await waitFor(() => expect(screen.getByTestId('notes-git-reset-btn')).toBeDefined());
        fireEvent.click(screen.getByTestId('notes-git-reset-btn'));

        await act(async () => {
            fireEvent.click(screen.getByTestId('notes-git-reset-confirm-btn'));
        });

        expect(mockAddToast).toHaveBeenCalledWith('clone failed', 'error');
    });

    // ── Docked status footer ────────────────────────────────────────

    it('docks the status cluster inside its own sidebar when dockStatusFooter is set', () => {
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus(),
            log: [makeLogEntry()],
        };
        render(<NotesGitTab workspaceId="ws-1" dockStatusFooter />);

        const footer = screen.getByTestId('docked-status-footer');
        expect(footer).toBeDefined();
        // It must live inside the tab's own commit-history sidebar, not floating
        // elsewhere — that is what keeps the diff pane full height.
        const sidebar = screen.getByTestId('notes-git-sidebar');
        expect(sidebar.contains(footer)).toBe(true);
    });

    it('does not dock the status cluster when dockStatusFooter is unset', () => {
        hookReturn = {
            ...defaultHookReturn,
            initialized: true,
            status: makeStatus(),
            log: [makeLogEntry()],
        };
        render(<NotesGitTab workspaceId="ws-1" />);
        expect(screen.queryByTestId('docked-status-footer')).toBeNull();
    });

    // matchCommitsByIdentity is in RepoGitTab, not NotesGitTab — no re-export needed
});
