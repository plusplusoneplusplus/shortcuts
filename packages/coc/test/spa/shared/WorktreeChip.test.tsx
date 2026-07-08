/**
 * @vitest-environment jsdom
 *
 * Tests for WorktreeChip — the run-visibility chip for CoC-created worktrees.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorktreeChip } from '../../../src/server/spa/client/react/shared/WorktreeChip';
import type { WorktreeMetadata } from '@plusplusoneplusplus/coc-client';

function makeWorktree(overrides: Partial<WorktreeMetadata> = {}): WorktreeMetadata {
    return {
        id: 'wt-1',
        workspaceId: 'ws-1',
        path: '/home/user/.coc/repos/ws-1/git-worktrees/wt-1',
        branch: 'coc/refactor-auth-ab12cd34',
        baseSha: 'deadbeefcafebabe0123456789abcdef01234567',
        createdAt: '2026-07-08T12:00:00Z',
        sourceDirty: false,
        status: 'active',
        ...overrides,
    };
}

describe('WorktreeChip', () => {
    beforeEach(() => {
        Object.assign(navigator, {
            clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
        });
    });

    it('renders branch, base SHA (short), active status, and path', () => {
        render(<WorktreeChip worktree={makeWorktree()} />);
        expect(screen.getByTestId('worktree-chip-branch').textContent).toBe('coc/refactor-auth-ab12cd34');
        expect(screen.getByTestId('worktree-chip-base').textContent).toContain('deadbee');
        expect(screen.getByTestId('worktree-chip-status').textContent).toBe('active');
        expect(screen.getByTestId('worktree-chip-copy-path').textContent).toContain('git-worktrees/wt-1');
    });

    it('prefers the requested baseRef over the resolved SHA', () => {
        render(<WorktreeChip worktree={makeWorktree({ baseRef: 'release/1.2' })} />);
        expect(screen.getByTestId('worktree-chip-base').textContent).toContain('release/1.2');
    });

    it('shows cleaned status for a cleaned worktree', () => {
        render(<WorktreeChip worktree={makeWorktree({ status: 'cleaned', cleanedAt: '2026-07-08T13:00:00Z' })} />);
        expect(screen.getByTestId('worktree-chip-status').textContent).toBe('cleaned');
    });

    it('surfaces the source-dirty marker only when the source had uncommitted changes', () => {
        const { rerender } = render(<WorktreeChip worktree={makeWorktree({ sourceDirty: false })} />);
        expect(screen.queryByTestId('worktree-chip-dirty')).toBeNull();
        rerender(<WorktreeChip worktree={makeWorktree({ sourceDirty: true })} />);
        expect(screen.getByTestId('worktree-chip-dirty')).toBeDefined();
    });

    it('copies the worktree path to the clipboard', async () => {
        render(<WorktreeChip worktree={makeWorktree()} />);
        fireEvent.click(screen.getByTestId('worktree-chip-copy-path'));
        await waitFor(() => {
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
                '/home/user/.coc/repos/ws-1/git-worktrees/wt-1',
            );
        });
    });

    it('honors a custom testId for multiple chips on one page', () => {
        render(<WorktreeChip worktree={makeWorktree()} testId="exec-worktree-chip-0" />);
        expect(screen.getByTestId('exec-worktree-chip-0')).toBeDefined();
        expect(screen.getByTestId('exec-worktree-chip-0-branch')).toBeDefined();
    });
});
