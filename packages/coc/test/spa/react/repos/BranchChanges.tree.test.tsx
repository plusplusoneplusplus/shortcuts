/**
 * Tests for BranchChanges — tree view mode.
 *
 * Validates:
 * - Flat/tree toggle renders and defaults to tree.
 * - Tree mode renders FileTreeView with folder grouping.
 * - +/- counts appear in tree mode.
 * - Inline diff expansion works in tree mode.
 * - Renamed files show tooltip in tree mode.
 * - Switching between flat and tree modes.
 * - View mode persistence via server preferences (useFilesViewMode).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockViewport } from '../../../spa/helpers/viewport-mock';
import { buildFileTree, normalizeStatus } from '../../../../src/server/spa/client/react/features/git/diff/FileTree';

// --- Module mocks ---

vi.mock('../../../../src/server/spa/client/comments/diff-comment-utils', () => ({
    computeDiffCommentKey: async (_repo: string, _old: string, _new: string, filePath: string) =>
        `key-${filePath}`,
}));

const mockUseFileCommentCounts = vi.fn<[], Map<string, number>>();
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => ({
    useFileCommentCounts: () => mockUseFileCommentCounts(),
}));

const mockSetFilesViewMode = vi.fn();
let mockFilesViewModeInitial: 'flat' | 'tree' = 'tree';

// Use a stateful mock that triggers React re-renders
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode', () => {
    const { useState, useCallback } = require('react');
    return {
        useFilesViewMode: () => {
            const [mode, setModeState] = useState<'flat' | 'tree'>(mockFilesViewModeInitial);
            const setMode = useCallback((m: 'flat' | 'tree') => {
                mockSetFilesViewMode(m);
                setModeState(m);
            }, []);
            return { mode, setMode };
        },
    };
});

const mockFetchApi = vi.fn();
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../../src/server/spa/client/react/shared', () => ({
    Spinner: () => <span>loading</span>,
    TruncatedPath: ({ path }: { path: string }) => <span>{path}</span>,
}));

import { BranchChanges } from '../../../../src/server/spa/client/react/features/git/branches/BranchChanges';
import type { BranchRangeInfo } from '../../../../src/server/spa/client/react/features/git/branches/BranchChanges';

const RANGE_INFO: BranchRangeInfo = {
    baseRef: 'origin/main',
    headRef: 'feature',
    commitCount: 3,
    additions: 50,
    deletions: 10,
    mergeBase: 'abc123',
    fileCount: 4,
};

const FILES = [
    { path: 'packages/coc/src/a.ts', status: 'modified', additions: 20, deletions: 5 },
    { path: 'packages/coc/src/b.ts', status: 'added', additions: 15, deletions: 0 },
    { path: 'packages/forge/old.ts', status: 'deleted', additions: 0, deletions: 10 },
    { path: 'README.md', status: 'modified', additions: 5, deletions: 2 },
];

const RENAMED_FILES = [
    { path: 'src/new-name.ts', status: 'renamed', additions: 5, deletions: 2, oldPath: 'src/old-name.ts' },
];

let restoreViewport: () => void;

beforeEach(() => {
    vi.clearAllMocks();
    restoreViewport = mockViewport(1280);
    localStorage.clear();
    mockFilesViewModeInitial = 'tree';
    mockUseFileCommentCounts.mockReturnValue(new Map());
});

afterEach(() => {
    restoreViewport();
});

async function expandFiles() {
    const user = userEvent.setup();
    await user.click(screen.getByTestId('branch-changes-header'));
}

// ── normalizeStatus unit tests ────────────────────────────────────────

describe('normalizeStatus', () => {
    it('converts word statuses to single chars', () => {
        expect(normalizeStatus('added')).toBe('A');
        expect(normalizeStatus('modified')).toBe('M');
        expect(normalizeStatus('deleted')).toBe('D');
        expect(normalizeStatus('renamed')).toBe('R');
        expect(normalizeStatus('copied')).toBe('C');
    });

    it('passes through already-single-char statuses', () => {
        expect(normalizeStatus('A')).toBe('A');
        expect(normalizeStatus('M')).toBe('M');
        expect(normalizeStatus('D')).toBe('D');
    });

    it('passes through unknown statuses', () => {
        expect(normalizeStatus('unknown')).toBe('unknown');
    });
});

// ── buildFileTree with branch-change data ─────────────────────────────

describe('buildFileTree — branch-change data', () => {
    it('preserves additions and deletions on file nodes', () => {
        const tree = buildFileTree([
            { status: 'modified', path: 'src/foo.ts', additions: 10, deletions: 3 },
        ]);
        const src = tree[0];
        if (src.type === 'dir') {
            const file = src.children[0];
            if (file.type === 'file') {
                expect(file.additions).toBe(10);
                expect(file.deletions).toBe(3);
            }
        }
    });

    it('preserves oldPath on renamed file nodes', () => {
        const tree = buildFileTree([
            { status: 'renamed', path: 'src/new.ts', oldPath: 'src/old.ts' },
        ]);
        const src = tree[0];
        if (src.type === 'dir') {
            const file = src.children[0];
            if (file.type === 'file') {
                expect(file.oldPath).toBe('src/old.ts');
            }
        }
    });

    it('does not set additions/deletions when not provided', () => {
        const tree = buildFileTree([{ status: 'M', path: 'src/foo.ts' }]);
        const src = tree[0];
        if (src.type === 'dir') {
            const file = src.children[0];
            if (file.type === 'file') {
                expect(file.additions).toBeUndefined();
                expect(file.deletions).toBeUndefined();
                expect(file.oldPath).toBeUndefined();
            }
        }
    });
});

// ── View mode driven by preferences ───────────────────────────────────

describe('BranchChanges — view mode from preferences', () => {
    it('defaults to tree mode (renders FileTreeView)', async () => {
        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );
        await expandFiles();
        await waitFor(() => {
            expect(screen.getByTestId('branch-changes-files')).toBeTruthy();
            // Tree mode renders folder nodes
            expect(screen.getByTestId('file-tree-dir-packages/coc/src')).toBeTruthy();
        });
    });

    it('renders flat file list when preference is flat', async () => {
        mockFilesViewModeInitial = 'flat';
        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );
        await expandFiles();
        await waitFor(() => {
            // Flat mode renders full paths without folder grouping
            expect(screen.getByTestId('branch-file-row-packages/coc/src/a.ts')).toBeTruthy();
        });
    });
});

// ── Tree mode rendering ───────────────────────────────────────────────

describe('BranchChanges — tree mode rendering', () => {
    it('renders folder nodes for grouped files', async () => {
        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );
        await expandFiles();
        await waitFor(() => {
            // After compactFolders, packages/coc/src should be a compacted dir
            expect(screen.getByTestId('file-tree-dir-packages/coc/src')).toBeTruthy();
        });
    });

    it('renders file entries with branch-file-row prefix', async () => {
        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );
        await expandFiles();
        await waitFor(() => {
            expect(screen.getByTestId('branch-file-row-packages/coc/src/a.ts')).toBeTruthy();
            expect(screen.getByTestId('branch-file-row-README.md')).toBeTruthy();
        });
    });

    it('shows +/- counts on tree file entries', async () => {
        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );
        await expandFiles();
        await waitFor(() => {
            const fileRow = screen.getByTestId('branch-file-row-packages/coc/src/a.ts');
            expect(fileRow.textContent).toContain('+20');
            expect(fileRow.textContent).toContain('−5');
        });
    });

    it('shows normalized status chars in tree mode', async () => {
        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );
        await expandFiles();
        await waitFor(() => {
            const fileRow = screen.getByTestId('branch-file-row-packages/coc/src/a.ts');
            expect(fileRow.textContent).toContain('M');
        });
        const addedRow = screen.getByTestId('branch-file-row-packages/coc/src/b.ts');
        expect(addedRow.textContent).toContain('A');
    });

    it('renders root-level files without a folder wrapper', async () => {
        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );
        await expandFiles();
        await waitFor(() => {
            expect(screen.getByTestId('branch-file-row-README.md')).toBeTruthy();
        });
    });
});

// ── Tree mode — inline diff ──────────────────────────────────────────

describe('BranchChanges — tree mode inline diff', () => {
    it('expands inline diff when a file is clicked in tree mode (no onFileSelect)', async () => {
        mockFetchApi.mockResolvedValueOnce({ diff: '+added line' });
        const user = userEvent.setup();

        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );
        await expandFiles();
        await waitFor(() => screen.getByTestId('branch-file-row-packages/coc/src/a.ts'));

        await act(async () => {
            await user.click(screen.getByTestId('branch-file-row-packages/coc/src/a.ts'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('branch-file-diff-packages/coc/src/a.ts')).toBeTruthy();
        });
    });

    it('calls onFileSelect instead of showing diff when onFileSelect is provided', async () => {
        const onFileSelect = vi.fn();
        const user = userEvent.setup();

        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
                onFileSelect={onFileSelect}
            />
        );
        await expandFiles();
        await waitFor(() => screen.getByTestId('branch-file-row-packages/coc/src/a.ts'));

        await act(async () => {
            await user.click(screen.getByTestId('branch-file-row-packages/coc/src/a.ts'));
        });

        expect(onFileSelect).toHaveBeenCalledWith('packages/coc/src/a.ts');
    });
});

// ── Tree mode — renamed files ─────────────────────────────────────────

describe('BranchChanges — tree mode renamed files', () => {
    it('shows oldPath → newPath in tooltip for renamed files', async () => {
        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={{ ...RANGE_INFO, fileCount: 1 }}
                initialFiles={RENAMED_FILES}
            />
        );
        await expandFiles();
        await waitFor(() => {
            const fileRow = screen.getByTestId('branch-file-row-src/new-name.ts');
            // The file name span should have a title with old → new path
            const nameSpan = fileRow.querySelector('[title="src/old-name.ts → src/new-name.ts"]');
            expect(nameSpan).toBeTruthy();
        });
    });
});

// ── Tree mode — comment badges ────────────────────────────────────────

describe('BranchChanges — tree mode comment badges', () => {
    it('renders comment badges on tree file entries', async () => {
        mockUseFileCommentCounts.mockReturnValue(new Map([['key-packages/coc/src/a.ts', 3]]));

        render(
            <BranchChanges
                workspaceId="ws-test"
                branchRangeData={RANGE_INFO}
                initialFiles={FILES}
            />
        );
        await expandFiles();

        await waitFor(() => {
            const badge = screen.getByTestId('branch-file-comment-badge-packages/coc/src/a.ts');
            expect(badge.textContent).toContain('💬3');
        });
    });
});
