/**
 * @vitest-environment jsdom
 *
 * Tests for WorktreeList — the repo-scoped list of CoC-created Git worktrees
 * with a per-record Cleanup action (AC-06 frontend).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { WorktreeMetadata } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => {
    const git = {
        listWorktrees: vi.fn(),
        cleanupWorktree: vi.fn(),
    };
    // Stable client object — the real useCocClient memoizes, so returning a
    // fresh object per render would spin the fetch effect into an infinite loop.
    const cocClient = { git };
    return {
        git,
        cocClient,
        useCocClient: vi.fn(() => cocClient),
        featureEnabled: vi.fn(() => true),
    };
});

vi.mock('../../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: mocks.useCocClient,
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClientErrorMessage: (_error: unknown, fallback: string) =>
        _error instanceof Error ? _error.message : fallback,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isGitWorktreeExecutionEnabled: () => mocks.featureEnabled(),
}));

import { WorktreeList } from '../../../../src/server/spa/client/react/features/git/working-tree/WorktreeList';

function makeWorktree(overrides: Partial<WorktreeMetadata> = {}): WorktreeMetadata {
    return {
        id: 'wt-1',
        workspaceId: 'ws-1',
        path: '/home/user/.coc/repos/ws-1/git-worktrees/wt-1',
        branch: 'coc/refactor-ab12cd34',
        baseSha: 'deadbeefcafebabe0123456789abcdef01234567',
        createdAt: '2026-07-08T12:00:00Z',
        sourceDirty: false,
        status: 'active',
        ...overrides,
    };
}

beforeEach(() => {
    mocks.git.listWorktrees.mockReset();
    mocks.git.cleanupWorktree.mockReset();
    mocks.useCocClient.mockClear();
    mocks.featureEnabled.mockReturnValue(true);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('WorktreeList', () => {
    it('renders nothing and never fetches when the feature flag is off', async () => {
        mocks.featureEnabled.mockReturnValue(false);
        const { container } = render(<WorktreeList workspaceId="ws-1" />);
        await waitFor(() => expect(mocks.git.listWorktrees).not.toHaveBeenCalled());
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing when the workspace has no worktrees', async () => {
        mocks.git.listWorktrees.mockResolvedValue({ worktrees: [] });
        const { container } = render(<WorktreeList workspaceId="ws-1" />);
        await waitFor(() => expect(mocks.git.listWorktrees).toHaveBeenCalled());
        await waitFor(() => expect(container.querySelector('[data-testid="worktree-list"]')).toBeNull());
    });

    it('is workspace-scoped: fetches only the given workspace and renders its records', async () => {
        mocks.git.listWorktrees.mockResolvedValue({ worktrees: [makeWorktree()] });
        render(<WorktreeList workspaceId="ws-42" />);
        await waitFor(() => expect(screen.getByTestId('worktree-list')).toBeDefined());
        expect(mocks.git.listWorktrees).toHaveBeenCalledWith('ws-42');
        // Expand to reveal the rows.
        fireEvent.click(screen.getByTestId('worktree-list-header'));
        expect(screen.getByTestId('worktree-list-chip-0-branch').textContent).toBe('coc/refactor-ab12cd34');
    });

    it('cleans up a worktree and flips the record to cleaned on success', async () => {
        mocks.git.listWorktrees.mockResolvedValue({ worktrees: [makeWorktree()] });
        mocks.git.cleanupWorktree.mockResolvedValue({
            worktree: makeWorktree({ status: 'cleaned', cleanedAt: '2026-07-08T13:00:00Z' }),
            alreadyCleaned: false,
        });
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(<WorktreeList workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('worktree-list')).toBeDefined());
        fireEvent.click(screen.getByTestId('worktree-list-header'));

        fireEvent.click(screen.getByTestId('worktree-list-chip-0-cleanup'));
        await waitFor(() => expect(mocks.git.cleanupWorktree).toHaveBeenCalledWith('ws-1', 'wt-1'));
        // Status flips to cleaned and the cleanup button disappears.
        await waitFor(() => expect(screen.getByTestId('worktree-list-chip-0-status').textContent).toBe('cleaned'));
        expect(screen.queryByTestId('worktree-list-chip-0-cleanup')).toBeNull();
    });

    it('surfaces a 409 error inline and keeps the record active on refused cleanup', async () => {
        mocks.git.listWorktrees.mockResolvedValue({ worktrees: [makeWorktree()] });
        mocks.git.cleanupWorktree.mockRejectedValue(
            new Error("fatal: '...' contains modified or untracked files, use --force to delete it"),
        );
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        render(<WorktreeList workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('worktree-list')).toBeDefined());
        fireEvent.click(screen.getByTestId('worktree-list-header'));

        fireEvent.click(screen.getByTestId('worktree-list-chip-0-cleanup'));
        await waitFor(() =>
            expect(screen.getByTestId('worktree-list-chip-0-cleanup-error').textContent).toContain('untracked files'),
        );
        // Record stays active — no destructive local mutation.
        expect(screen.getByTestId('worktree-list-chip-0-status').textContent).toBe('active');
    });

    it('shows the linked Ralph session for a worktree', async () => {
        mocks.git.listWorktrees.mockResolvedValue({
            worktrees: [makeWorktree({ ralphSessionId: 'sess-9' })],
        });
        render(<WorktreeList workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('worktree-list')).toBeDefined());
        fireEvent.click(screen.getByTestId('worktree-list-header'));
        expect(screen.getByTestId('worktree-list-linked-0').textContent).toContain('sess-9');
    });
});
