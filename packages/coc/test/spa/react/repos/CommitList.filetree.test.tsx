/**
 * Tests for the commit file tree view:
 * - `buildFileTree` pure function (tree construction logic)
 * - Integrated rendering via CommitList (folder toggle, file selection, badges)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockViewport } from '../../../spa/helpers/viewport-mock';
import { buildFileTree, compactFolders } from '../../../../src/server/spa/client/react/features/git/diff/FileTree';

// --- Module mocks (same pattern as CommitList.comment.test.tsx) ---

vi.mock('../../../../src/server/spa/client/comments/diff-comment-utils', () => ({
    computeDiffCommentKey: async (_repo: string, _old: string, _new: string, filePath: string) =>
        `key-${filePath}`,
}));

const mockUseFileCommentCounts = vi.fn<[string, string | null, string | null], Map<string, number>>();
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => ({
    useFileCommentCounts: (...args: any[]) => mockUseFileCommentCounts(...args),
}));

const mockFetchApi = vi.fn();
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitTooltip', () => ({
    CommitTooltip: () => null,
}));

import { CommitList } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';

const COMMIT_A: GitCommitItem = {
    hash: 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111',
    shortHash: 'aaaa111',
    subject: 'Add feature',
    author: 'Alice',
    date: '2024-01-01T00:00:00Z',
    parentHashes: [],
};

let restoreViewport: () => void;

beforeEach(() => {
    vi.clearAllMocks();
    restoreViewport = mockViewport(1280);
    Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
    restoreViewport();
});

// ── compactFolders unit tests ─────────────────────────────────────────

describe('compactFolders', () => {
    it('collapses a single-child directory chain into one node', () => {
        const tree = buildFileTree([{ status: 'M', path: 'packages/coc/src/index.ts' }]);
        const compacted = compactFolders(tree);
        expect(compacted).toHaveLength(1);
        const node = compacted[0];
        expect(node).toMatchObject({ type: 'dir', name: 'packages/coc/src', path: 'packages/coc/src' });
        if (node.type === 'dir') {
            expect(node.children).toHaveLength(1);
            expect(node.children[0]).toMatchObject({ type: 'file', name: 'index.ts' });
        }
    });

    it('does not collapse a directory with multiple children', () => {
        const tree = buildFileTree([
            { status: 'M', path: 'src/foo.ts' },
            { status: 'A', path: 'src/bar.ts' },
        ]);
        const compacted = compactFolders(tree);
        expect(compacted).toHaveLength(1);
        expect(compacted[0]).toMatchObject({ type: 'dir', name: 'src' });
        if (compacted[0].type === 'dir') {
            expect(compacted[0].children).toHaveLength(2);
        }
    });

    it('does not collapse a single-child directory whose child is a file', () => {
        const tree = buildFileTree([{ status: 'A', path: 'src/index.ts' }]);
        const compacted = compactFolders(tree);
        expect(compacted).toHaveLength(1);
        // "src" has one file child — not collapsed (child is not a dir)
        expect(compacted[0]).toMatchObject({ type: 'dir', name: 'src' });
        if (compacted[0].type === 'dir') {
            expect(compacted[0].children[0]).toMatchObject({ type: 'file', name: 'index.ts' });
        }
    });

    it('partially collapses: stops at branch points', () => {
        // packages/coc has two children (src and test), so it should NOT be collapsed
        const tree = buildFileTree([
            { status: 'M', path: 'packages/coc/src/index.ts' },
            { status: 'A', path: 'packages/coc/test/foo.test.ts' },
        ]);
        const compacted = compactFolders(tree);
        // "packages" has one child "coc", but "coc" has 2 children → packages/coc compacted
        expect(compacted).toHaveLength(1);
        expect(compacted[0]).toMatchObject({ type: 'dir', name: 'packages/coc', path: 'packages/coc' });
        if (compacted[0].type === 'dir') {
            // "src" and "test" are both single-child dirs that each contain a file, no further compaction
            expect(compacted[0].children).toHaveLength(2);
        }
    });

    it('leaves root-level files unchanged', () => {
        const tree = buildFileTree([
            { status: 'M', path: 'README.md' },
            { status: 'A', path: 'LICENSE' },
        ]);
        const compacted = compactFolders(tree);
        expect(compacted).toHaveLength(2);
        expect(compacted[0]).toMatchObject({ type: 'file', name: 'README.md' });
        expect(compacted[1]).toMatchObject({ type: 'file', name: 'LICENSE' });
    });

    it('returns empty array for empty input', () => {
        expect(compactFolders([])).toEqual([]);
    });
});

// ── buildFileTree unit tests ──────────────────────────────────────────

describe('buildFileTree', () => {
    it('groups files with a common directory prefix under one DirNode', () => {
        const tree = buildFileTree([
            { status: 'M', path: 'src/foo.ts' },
            { status: 'A', path: 'src/bar.ts' },
        ]);
        expect(tree).toHaveLength(1);
        expect(tree[0].type).toBe('dir');
        expect(tree[0].name).toBe('src');
        if (tree[0].type === 'dir') {
            expect(tree[0].children).toHaveLength(2);
            expect(tree[0].children[0]).toMatchObject({ type: 'file', name: 'foo.ts', path: 'src/foo.ts' });
            expect(tree[0].children[1]).toMatchObject({ type: 'file', name: 'bar.ts', path: 'src/bar.ts' });
        }
    });

    it('places root-level files directly in the root array', () => {
        const tree = buildFileTree([
            { status: 'M', path: 'README.md' },
            { status: 'A', path: 'LICENSE' },
        ]);
        expect(tree).toHaveLength(2);
        expect(tree[0]).toMatchObject({ type: 'file', name: 'README.md', path: 'README.md' });
        expect(tree[1]).toMatchObject({ type: 'file', name: 'LICENSE', path: 'LICENSE' });
    });

    it('produces nested DirNodes for deeply-nested paths', () => {
        const tree = buildFileTree([
            { status: 'M', path: 'packages/coc/src/index.ts' },
        ]);
        expect(tree).toHaveLength(1);
        const packages = tree[0];
        expect(packages).toMatchObject({ type: 'dir', name: 'packages' });
        if (packages.type === 'dir') {
            const coc = packages.children[0];
            expect(coc).toMatchObject({ type: 'dir', name: 'coc' });
            if (coc.type === 'dir') {
                const src = coc.children[0];
                expect(src).toMatchObject({ type: 'dir', name: 'src' });
                if (src.type === 'dir') {
                    expect(src.children[0]).toMatchObject({ type: 'file', name: 'index.ts', path: 'packages/coc/src/index.ts' });
                }
            }
        }
    });

    it('creates sibling DirNodes for files in different directories', () => {
        const tree = buildFileTree([
            { status: 'M', path: 'src/foo.ts' },
            { status: 'A', path: 'lib/bar.ts' },
        ]);
        expect(tree).toHaveLength(2);
        expect(tree[0]).toMatchObject({ type: 'dir', name: 'src' });
        expect(tree[1]).toMatchObject({ type: 'dir', name: 'lib' });
    });

    it('mixes root-level files and directories', () => {
        const tree = buildFileTree([
            { status: 'M', path: 'src/index.ts' },
            { status: 'A', path: 'README.md' },
        ]);
        expect(tree).toHaveLength(2);
        expect(tree[0]).toMatchObject({ type: 'dir', name: 'src' });
        expect(tree[1]).toMatchObject({ type: 'file', name: 'README.md' });
    });

    it('returns empty array for empty input', () => {
        expect(buildFileTree([])).toEqual([]);
    });
});

// ── Integrated rendering tests ────────────────────────────────────────

describe('CommitList — file tree rendering', () => {
    const MOCK_FILES = [
        { status: 'M', path: 'src/foo.ts' },
        { status: 'A', path: 'src/bar.ts' },
        { status: 'M', path: 'README.md' },
    ];

    beforeEach(() => {
        mockFetchApi.mockResolvedValue({ files: MOCK_FILES });
        mockUseFileCommentCounts.mockReturnValue(new Map());
    });

    it('shows a folder header for grouped files', async () => {
        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                workspaceId="ws-test"
                initialExpandedHash={COMMIT_A.hash}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeTruthy();
        });

        await waitFor(() => {
            expect(screen.getByTestId('file-tree-dir-src')).toBeTruthy();
        });
        expect(screen.getByTestId('file-tree-dir-src').textContent).toContain('src/');
    });

    it('shows only the basename for file entries, not the full path', async () => {
        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                workspaceId="ws-test"
                initialExpandedHash={COMMIT_A.hash}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId('commit-file-src/foo.ts')).toBeTruthy();
        });

        const fileBtn = screen.getByTestId('commit-file-src/foo.ts');
        expect(fileBtn.textContent).toContain('foo.ts');
        // Should not contain the directory prefix as separate visible text
        expect(fileBtn.textContent).not.toMatch(/src\/foo\.ts/);
    });

    it('calls onFileSelect with the full path when a file is clicked', async () => {
        const onFileSelect = vi.fn();
        const user = userEvent.setup();

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                workspaceId="ws-test"
                initialExpandedHash={COMMIT_A.hash}
                onFileSelect={onFileSelect}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId('commit-file-src/foo.ts')).toBeTruthy();
        });

        await act(async () => {
            await user.click(screen.getByTestId('commit-file-src/foo.ts'));
        });

        expect(onFileSelect).toHaveBeenCalledWith(COMMIT_A.hash, 'src/foo.ts');
    });

    it('collapses a folder when its header is clicked', async () => {
        const user = userEvent.setup();

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                workspaceId="ws-test"
                initialExpandedHash={COMMIT_A.hash}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId('file-tree-dir-src')).toBeTruthy();
        });

        // Files should be visible initially (default expanded)
        expect(screen.getByTestId('commit-file-src/foo.ts')).toBeTruthy();

        // Click folder header to collapse
        await act(async () => {
            await user.click(screen.getByTestId('file-tree-dir-src'));
        });

        expect(screen.queryByTestId('commit-file-src/foo.ts')).toBeNull();
        expect(screen.queryByTestId('commit-file-src/bar.ts')).toBeNull();
    });

    it('re-expands a collapsed folder when header is clicked again', async () => {
        const user = userEvent.setup();

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                workspaceId="ws-test"
                initialExpandedHash={COMMIT_A.hash}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId('file-tree-dir-src')).toBeTruthy();
        });

        // Collapse
        await act(async () => {
            await user.click(screen.getByTestId('file-tree-dir-src'));
        });
        expect(screen.queryByTestId('commit-file-src/foo.ts')).toBeNull();

        // Re-expand
        await act(async () => {
            await user.click(screen.getByTestId('file-tree-dir-src'));
        });
        expect(screen.getByTestId('commit-file-src/foo.ts')).toBeTruthy();
        expect(screen.getByTestId('commit-file-src/bar.ts')).toBeTruthy();
    });

    it('renders comment badge on a tree file node', async () => {
        mockUseFileCommentCounts.mockReturnValue(new Map([['key-src/foo.ts', 3]]));

        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                workspaceId="ws-test"
                initialExpandedHash={COMMIT_A.hash}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId(`commit-files-${COMMIT_A.shortHash}`)).toBeTruthy();
        });

        await waitFor(() => {
            const badge = screen.getByTestId('commit-file-comment-badge-src/foo.ts');
            expect(badge.textContent).toContain('💬3');
        });
    });

    it('renders root-level files without a folder wrapper', async () => {
        render(
            <CommitList
                title="History"
                commits={[COMMIT_A]}
                workspaceId="ws-test"
                initialExpandedHash={COMMIT_A.hash}
            />
        );

        await waitFor(() => {
            expect(screen.getByTestId('commit-file-README.md')).toBeTruthy();
        });

        // README.md should be rendered directly (no folder wrapper for it)
        const readmeBtn = screen.getByTestId('commit-file-README.md');
        expect(readmeBtn.textContent).toContain('README.md');
    });
});
