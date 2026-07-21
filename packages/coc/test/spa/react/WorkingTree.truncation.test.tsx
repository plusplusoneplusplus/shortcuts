/**
 * Render tests for the WorkingTree "Untracked" truncation footer.
 *
 * When the server caps a large untracked list it returns `untrackedTruncated`
 * and `untrackedTotal`. The Untracked section must then render a footer stating
 * how many files were omitted; when not truncated, no footer is shown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Hoisted so the mock factory (hoisted above imports) can reference these.
const h = vi.hoisted(() => {
    const getWorkingTreeChanges = vi.fn();
    const listDiffComments = vi.fn();
    // A stable client object: `useCocClient` must return a referentially stable
    // value so WorkingTree's `[workspaceId, fetchChanges]` effect does not re-run
    // on every render (an unstable client causes an infinite fetch/loading loop).
    const client = {
        git: {
            getWorkingTreeChanges,
            listDiffComments,
            stageFiles: vi.fn(),
            unstageFiles: vi.fn(),
            discardAllChanges: vi.fn(),
            stageFile: vi.fn(),
            unstageFile: vi.fn(),
            discardChanges: vi.fn(),
            deleteUntrackedFile: vi.fn(),
        },
    };
    return { getWorkingTreeChanges, listDiffComments, client };
});

vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => h.client,
}));

// Force flat mode so the file list renders without touching preferences APIs.
vi.mock('../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode', () => ({
    useFilesViewMode: () => ({ mode: 'flat', setMode: vi.fn() }),
}));

import { WorkingTree } from '../../../src/server/spa/client/react/features/git/working-tree/WorkingTree';

function untracked(name: string) {
    return {
        filePath: `/repo/Plans/${name}`,
        status: '?',
        stage: 'untracked' as const,
        repositoryRoot: '/repo',
        repositoryName: 'repo',
    };
}

describe('WorkingTree untracked truncation footer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.listDiffComments.mockResolvedValue({ comments: [] });
    });

    it('shows the "+N more" footer when the untracked list is truncated', async () => {
        h.getWorkingTreeChanges.mockResolvedValue({
            changes: [untracked('a.md'), untracked('b.md')],
            repoState: {},
            untrackedTotal: 700,
            untrackedTruncated: true,
        });

        render(<WorkingTree workspaceId="ws-1" />);

        const footer = await screen.findByTestId('working-tree-untracked-truncated');
        // 700 total - 2 shown = 698 omitted.
        expect(footer.textContent).toContain('698 more untracked files (not shown)');
    });

    it('does not show the footer when the untracked list is not truncated', async () => {
        h.getWorkingTreeChanges.mockResolvedValue({
            changes: [untracked('a.md'), untracked('b.md')],
            repoState: {},
        });

        render(<WorkingTree workspaceId="ws-1" />);

        // Section renders once the parent group auto-expands after data loads.
        await screen.findByTestId('working-tree-untracked');
        await waitFor(() => {
            expect(screen.queryByTestId('working-tree-untracked-truncated')).toBeNull();
        });
    });
});
