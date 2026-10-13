/**
 * Tests for repo-relative display paths in the working-tree file list.
 *
 * The server keeps `filePath` absolute (needed for git actions), but the tree /
 * flat list must show a repo-relative path. `relDisplayPath` computes that
 * display path, and the changeLookup map is re-keyed to it so row clicks and
 * per-row stage/discard actions keep resolving to the underlying change (whose
 * absolute `filePath` is what the git calls receive).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

const h = vi.hoisted(() => {
    const getWorkingTreeChanges = vi.fn();
    const listDiffComments = vi.fn();
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
    return { getWorkingTreeChanges, listDiffComments, client, mode: 'flat' as 'flat' | 'tree' };
});

vi.mock('../../../src/server/spa/client/react/repos/cloneRouting', () => ({
    useCocClient: () => h.client,
}));

// Force flat mode so rows render without touching preferences APIs.
vi.mock('../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode', () => ({
    useFilesViewMode: () => ({ mode: h.mode, setMode: vi.fn() }),
}));

import {
    WorkingTree,
    relDisplayPath,
    hasMultipleRepos,
    type WorkingTreeChange,
} from '../../../src/server/spa/client/react/features/git/working-tree/WorkingTree';

function change(partial: Partial<WorkingTreeChange> & { filePath: string }): WorkingTreeChange {
    return {
        status: 'M',
        stage: 'unstaged',
        repositoryRoot: '/repo',
        repositoryName: 'repo',
        ...partial,
    };
}

describe('relDisplayPath', () => {
    it('strips the repo root from an absolute path under the root', () => {
        expect(relDisplayPath(change({ filePath: '/repo/src/app.ts', repositoryRoot: '/repo' })))
            .toBe('src/app.ts');
    });

    it('handles a trailing-slash repo root', () => {
        expect(relDisplayPath(change({ filePath: '/repo/src/app.ts', repositoryRoot: '/repo/' })))
            .toBe('src/app.ts');
    });

    it('leaves an already-relative path unchanged', () => {
        expect(relDisplayPath(change({ filePath: 'src/app.ts', repositoryRoot: '/repo' })))
            .toBe('src/app.ts');
    });

    it('leaves a path outside the root unchanged (normalized)', () => {
        expect(relDisplayPath(change({ filePath: '/other/x.ts', repositoryRoot: '/repo' })))
            .toBe('/other/x.ts');
    });

    it('normalizes Windows backslashes in both root and path', () => {
        expect(relDisplayPath(change({ filePath: 'C:\\repo\\src\\app.ts', repositoryRoot: 'C:\\repo' })))
            .toBe('src/app.ts');
    });

    it('handles a Windows trailing-backslash root', () => {
        expect(relDisplayPath(change({ filePath: 'C:\\repo\\src\\app.ts', repositoryRoot: 'C:\\repo\\' })))
            .toBe('src/app.ts');
    });

    it('prefixes with the repo name when the change set is multi-repo', () => {
        expect(relDisplayPath(change({ filePath: '/repo/src/app.ts', repositoryRoot: '/repo', repositoryName: 'repo' }), true))
            .toBe('repo/src/app.ts');
    });
});

describe('hasMultipleRepos', () => {
    it('is false for a single repo root', () => {
        expect(hasMultipleRepos([
            change({ filePath: '/repo/a.ts', repositoryRoot: '/repo' }),
            change({ filePath: '/repo/b.ts', repositoryRoot: '/repo' }),
        ])).toBe(false);
    });

    it('is true when more than one distinct repo root is present', () => {
        expect(hasMultipleRepos([
            change({ filePath: '/repoA/a.ts', repositoryRoot: '/repoA' }),
            change({ filePath: '/repoB/a.ts', repositoryRoot: '/repoB' }),
        ])).toBe(true);
    });
});

describe('WorkingTree relative-path rows', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.mode = 'flat';
        h.listDiffComments.mockResolvedValue({ comments: [] });
    });

    it('renders rows with repo-relative names (no absolute prefix) and keeps actions working', async () => {
        h.getWorkingTreeChanges.mockResolvedValue({
            changes: [
                change({ filePath: '/repo/src/app.ts', repositoryRoot: '/repo', repositoryName: 'repo', status: 'M', stage: 'unstaged' }),
            ],
            repoState: {},
        });

        const onFileSelect = vi.fn();
        render(<WorkingTree workspaceId="ws-1" onFileSelect={onFileSelect} />);

        // Row is keyed by the relative display path, not the absolute one.
        const row = await screen.findByTestId('working-tree-file-row-src/app.ts');
        expect(screen.queryByTestId('working-tree-file-row-/repo/src/app.ts')).toBeNull();

        // Per-row stage action resolves via the re-keyed lookup (testid uses the
        // absolute filePath), proving the lookup still hits after re-keying.
        expect(screen.getByTestId('stage-btn-/repo/src/app.ts')).toBeTruthy();

        // Clicking the row calls onFileSelect with the ABSOLUTE filePath.
        fireEvent.click(row);
        expect(onFileSelect).toHaveBeenCalledWith('/repo/src/app.ts', 'unstaged');
    });

    it('keeps same-named files from different repos distinct (multi-repo prefix)', async () => {
        h.getWorkingTreeChanges.mockResolvedValue({
            changes: [
                change({ filePath: '/repoA/README.md', repositoryRoot: '/repoA', repositoryName: 'repoA', status: 'M', stage: 'unstaged' }),
                change({ filePath: '/repoB/README.md', repositoryRoot: '/repoB', repositoryName: 'repoB', status: 'M', stage: 'unstaged' }),
            ],
            repoState: {},
        });

        render(<WorkingTree workspaceId="ws-1" onFileSelect={vi.fn()} />);

        // Both rows render as distinct nodes using the repoName/rel prefix.
        expect(await screen.findByTestId('working-tree-file-row-repoA/README.md')).toBeTruthy();
        expect(screen.getByTestId('working-tree-file-row-repoB/README.md')).toBeTruthy();

        // Both resolve in the lookup (each has its own absolute-keyed stage button).
        expect(screen.getByTestId('stage-btn-/repoA/README.md')).toBeTruthy();
        expect(screen.getByTestId('stage-btn-/repoB/README.md')).toBeTruthy();
    });
    it.each(['flat', 'tree'] as const)('keeps partially staged counts, navigation and actions section-correct in %s mode', async (mode) => {
        h.mode = mode;
        h.getWorkingTreeChanges.mockResolvedValue({ changes: [
            change({ filePath: '/repo/partial.ts', stage: 'staged', additions: 3, deletions: 1 }),
            change({ filePath: '/repo/partial.ts', stage: 'unstaged', additions: 8, deletions: 2 }),
        ], repoState: {} });
        h.client.git.unstageFile.mockResolvedValue({ success: true });
        h.client.git.stageFile.mockResolvedValue({ success: true });
        const onFileSelect = vi.fn();
        render(<WorkingTree workspaceId="remote-member" onFileSelect={onFileSelect} compact />);
        const rows = await screen.findAllByTestId('working-tree-file-row-partial.ts');
        expect(within(rows[0]).getByRole('img', { name: 'staged: 3 lines added, 1 lines deleted' })).toBeTruthy();
        expect(within(rows[1]).getByRole('img', { name: 'unstaged: 8 lines added, 2 lines deleted' })).toBeTruthy();
        fireEvent.click(rows[0]);
        fireEvent.click(rows[1]);
        expect(onFileSelect.mock.calls).toEqual([['/repo/partial.ts', 'staged'], ['/repo/partial.ts', 'unstaged']]);
        await act(async () => { fireEvent.click(within(rows[0]).getByTestId('unstage-btn-/repo/partial.ts')); });
        expect(h.client.git.unstageFile).toHaveBeenCalledWith('remote-member', '/repo/partial.ts');
        expect(onFileSelect).toHaveBeenCalledTimes(2);
        await act(async () => { fireEvent.click(within(rows[1]).getByTestId('stage-btn-/repo/partial.ts')); });
        expect(h.client.git.stageFile).toHaveBeenCalledWith('remote-member', '/repo/partial.ts');
    });

    it('shows binary and unavailable markers without invented zero counts, and refreshes counts', async () => {
        const changes = [
            change({ filePath: '/repo/binary', isBinary: true }),
            change({ filePath: '/repo/new', stage: 'untracked' }),
            change({ filePath: '/repo/missing' }),
            change({ filePath: '/repo/empty', additions: 0, deletions: 0 }),
        ];
        h.getWorkingTreeChanges.mockResolvedValue({ changes, repoState: {} });
        const { rerender } = render(<WorkingTree workspaceId="ws-1" refreshKey={0} />);
        expect(await screen.findByRole('img', { name: 'Binary file; line counts unavailable' })).toBeTruthy();
        expect(await screen.findByRole('img', { name: 'untracked: line counts unavailable' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'unstaged: 0 lines added, 0 lines deleted' })).toBeTruthy();
        expect(within(screen.getByTestId('working-tree-file-row-missing')).queryByText('+0')).toBeNull();
        h.getWorkingTreeChanges.mockResolvedValue({ changes: [change({ filePath: '/repo/empty', additions: 5, deletions: 1 })], repoState: {} });
        rerender(<WorkingTree workspaceId="ws-1" refreshKey={1} />);
        expect(await screen.findByRole('img', { name: 'unstaged: 5 lines added, 1 lines deleted' })).toBeTruthy();
    });

});
