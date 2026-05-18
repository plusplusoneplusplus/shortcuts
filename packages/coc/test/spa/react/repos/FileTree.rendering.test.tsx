/**
 * Rendering tests for shared FileTree components (FlatFileList, FilesViewToggle, FileTreeView).
 *
 * Validates actual DOM output via @testing-library/react:
 * - FlatFileList: status badge, additions/deletions, renderActions slot, comment badges, renamed files
 * - FilesViewToggle: aria-pressed, button rendering, click handling
 * - FileTreeView: renderActions slot renders in DOM, folder/file structure, status chars
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import {
    FlatFileList,
    FilesViewToggle,
    FileTreeView,
    buildFileTree,
    compactFolders,
    normalizeStatus,
    STATUS_COLORS,
    STATUS_LABELS,
} from '../../../../src/server/spa/client/react/features/git/diff/FileTree';
import type { FileChange, FilesViewMode } from '../../../../src/server/spa/client/react/features/git/diff/FileTree';

// Mock TruncatedPath to a simple span
vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    TruncatedPath: ({ path, className }: { path: string; className?: string }) => (
        <span className={className}>{path}</span>
    ),
}));

// ── FilesViewToggle ───────────────────────────────────────────────────

describe('FilesViewToggle — rendering', () => {
    it('renders flat and tree buttons', () => {
        const onChange = vi.fn();
        render(<FilesViewToggle mode="flat" onChange={onChange} />);

        expect(screen.getByText('☰ Flat')).toBeTruthy();
        expect(screen.getByText('🌲 Tree')).toBeTruthy();
    });

    it('sets aria-pressed=true on the active mode', () => {
        const onChange = vi.fn();
        render(<FilesViewToggle mode="tree" onChange={onChange} />);

        const treeBtn = screen.getByTestId('files-view-toggle-tree');
        const flatBtn = screen.getByTestId('files-view-toggle-flat');
        expect(treeBtn.getAttribute('aria-pressed')).toBe('true');
        expect(flatBtn.getAttribute('aria-pressed')).toBe('false');
    });

    it('calls onChange with the new mode when button is clicked', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<FilesViewToggle mode="tree" onChange={onChange} />);

        await user.click(screen.getByTestId('files-view-toggle-flat'));
        expect(onChange).toHaveBeenCalledWith('flat');
    });

    it('uses custom testIdPrefix', () => {
        render(<FilesViewToggle mode="flat" onChange={vi.fn()} testIdPrefix="my-toggle" />);
        expect(screen.getByTestId('my-toggle')).toBeTruthy();
        expect(screen.getByTestId('my-toggle-flat')).toBeTruthy();
        expect(screen.getByTestId('my-toggle-tree')).toBeTruthy();
    });
});

// ── FlatFileList ──────────────────────────────────────────────────────

describe('FlatFileList — rendering', () => {
    const FILES: FileChange[] = [
        { path: 'src/a.ts', status: 'M', additions: 10, deletions: 3 },
        { path: 'src/b.ts', status: 'A', additions: 5, deletions: 0 },
        { path: 'src/c.ts', status: 'D' },
    ];

    it('renders a row for each file', () => {
        render(<FlatFileList files={FILES} onFileSelect={vi.fn()} />);

        expect(screen.getByTestId('flat-file-list')).toBeTruthy();
        expect(screen.getByTestId('flat-file-row-src/a.ts')).toBeTruthy();
        expect(screen.getByTestId('flat-file-row-src/b.ts')).toBeTruthy();
        expect(screen.getByTestId('flat-file-row-src/c.ts')).toBeTruthy();
    });

    it('displays single-char status badge', () => {
        render(<FlatFileList files={FILES} onFileSelect={vi.fn()} />);

        const row = screen.getByTestId('flat-file-row-src/a.ts');
        expect(row.textContent).toContain('M');
    });

    it('displays additions and deletions when present', () => {
        render(<FlatFileList files={FILES} onFileSelect={vi.fn()} />);

        const row = screen.getByTestId('flat-file-row-src/a.ts');
        expect(row.textContent).toContain('+10');
        expect(row.textContent).toContain('−3');
    });

    it('omits additions/deletions when not present', () => {
        render(<FlatFileList files={FILES} onFileSelect={vi.fn()} />);

        const row = screen.getByTestId('flat-file-row-src/c.ts');
        expect(row.textContent).not.toContain('+');
        expect(row.textContent).not.toContain('−');
    });

    it('renders renamed files with arrow notation', () => {
        const renamedFiles: FileChange[] = [
            { path: 'src/new.ts', status: 'R', oldPath: 'src/old.ts' },
        ];
        render(<FlatFileList files={renamedFiles} onFileSelect={vi.fn()} />);

        const row = screen.getByTestId('flat-file-row-src/new.ts');
        expect(row.textContent).toContain('src/old.ts');
        expect(row.textContent).toContain('→');
        expect(row.textContent).toContain('src/new.ts');
    });

    it('renders comment badges when fileCommentMap has counts', () => {
        const commentMap = new Map([['src/a.ts', 3]]);
        render(
            <FlatFileList
                files={FILES}
                onFileSelect={vi.fn()}
                fileCommentMap={commentMap}
            />
        );

        expect(screen.getByTestId('flat-file-comment-badge-src/a.ts')).toBeTruthy();
        expect(screen.getByTestId('flat-file-comment-badge-src/a.ts').textContent).toContain('3');
    });

    it('does not render comment badge when count is 0', () => {
        const commentMap = new Map([['src/a.ts', 0]]);
        render(
            <FlatFileList
                files={FILES}
                onFileSelect={vi.fn()}
                fileCommentMap={commentMap}
            />
        );

        expect(screen.queryByTestId('flat-file-comment-badge-src/a.ts')).toBeNull();
    });

    it('renders renderActions slot content', () => {
        render(
            <FlatFileList
                files={FILES}
                onFileSelect={vi.fn()}
                renderActions={(file) => (
                    <span data-testid={`action-${file.path}`}>action-content</span>
                )}
            />
        );

        expect(screen.getByTestId('action-src/a.ts')).toBeTruthy();
        expect(screen.getByTestId('action-src/a.ts').textContent).toBe('action-content');
    });

    it('renders renderFileExtra slot content below the row', () => {
        render(
            <FlatFileList
                files={[{ path: 'src/a.ts', status: 'M' }]}
                onFileSelect={vi.fn()}
                renderFileExtra={(file) => (
                    <div data-testid={`extra-${file.path}`}>inline-diff-here</div>
                )}
            />
        );

        expect(screen.getByTestId('extra-src/a.ts')).toBeTruthy();
        expect(screen.getByTestId('extra-src/a.ts').textContent).toBe('inline-diff-here');
    });

    it('calls onFileSelect when a row is clicked', async () => {
        const user = userEvent.setup();
        const onFileSelect = vi.fn();
        render(<FlatFileList files={FILES} onFileSelect={onFileSelect} />);

        await user.click(screen.getByTestId('flat-file-row-src/b.ts'));
        expect(onFileSelect).toHaveBeenCalledWith('src/b.ts');
    });

    it('highlights the selected file', () => {
        render(
            <FlatFileList
                files={FILES}
                onFileSelect={vi.fn()}
                selectedFilePath="src/a.ts"
            />
        );

        const row = screen.getByTestId('flat-file-row-src/a.ts');
        expect(row.className).toContain('bg-[#0078d4]/10');
    });

    it('normalizes word status to single-char for display', () => {
        const wordStatusFiles: FileChange[] = [
            { path: 'src/x.ts', status: 'modified' },
        ];
        render(<FlatFileList files={wordStatusFiles} onFileSelect={vi.fn()} />);

        const row = screen.getByTestId('flat-file-row-src/x.ts');
        // Should show "M" not "modified"
        expect(row.textContent).toContain('M');
        expect(row.textContent).not.toContain('modified');
    });
});

// ── FileTreeView ──────────────────────────────────────────────────────

describe('FileTreeView — rendering', () => {
    const FILES: FileChange[] = [
        { path: 'src/a.ts', status: 'M', additions: 10, deletions: 3 },
        { path: 'src/b.ts', status: 'A', additions: 5, deletions: 0 },
        { path: 'lib/util.ts', status: 'D' },
    ];

    it('renders folder and file nodes', () => {
        const tree = compactFolders(buildFileTree(FILES));
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                fileCommentMap={new Map()}
            />
        );

        // Top-level data-testid for the tree
        expect(screen.getByTestId('commit-file-list')).toBeTruthy();
        // File entries
        expect(screen.getByTestId('commit-file-src/a.ts')).toBeTruthy();
        expect(screen.getByTestId('commit-file-src/b.ts')).toBeTruthy();
        expect(screen.getByTestId('commit-file-lib/util.ts')).toBeTruthy();
    });

    it('shows +/- counts on file entries', () => {
        const tree = compactFolders(buildFileTree(FILES));
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                fileCommentMap={new Map()}
            />
        );

        const row = screen.getByTestId('commit-file-src/a.ts');
        expect(row.textContent).toContain('+10');
        expect(row.textContent).toContain('−3');
    });

    it('renders normalized status char', () => {
        const wordStatusFiles: FileChange[] = [
            { path: 'src/x.ts', status: 'modified' },
        ];
        const tree = compactFolders(buildFileTree(wordStatusFiles));
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                fileCommentMap={new Map()}
            />
        );

        const row = screen.getByTestId('commit-file-src/x.ts');
        expect(row.textContent).toContain('M');
    });

    it('renders renderActions slot content on file entries', () => {
        const tree = compactFolders(buildFileTree(FILES));
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                fileCommentMap={new Map()}
                renderActions={(node) => (
                    <span data-testid={`tree-action-${node.path}`}>⊕</span>
                )}
            />
        );

        expect(screen.getByTestId('tree-action-src/a.ts')).toBeTruthy();
        expect(screen.getByTestId('tree-action-src/a.ts').textContent).toBe('⊕');
        expect(screen.getByTestId('tree-action-lib/util.ts')).toBeTruthy();
    });

    it('renders renderFileExtra slot content below file entries', () => {
        const tree = compactFolders(buildFileTree([{ path: 'src/a.ts', status: 'M' }]));
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                fileCommentMap={new Map()}
                renderFileExtra={(node) => (
                    <div data-testid={`tree-extra-${node.path}`}>diff-content</div>
                )}
            />
        );

        expect(screen.getByTestId('tree-extra-src/a.ts')).toBeTruthy();
    });

    it('renders comment badges when fileCommentMap has counts', () => {
        const tree = compactFolders(buildFileTree(FILES));
        const commentMap = new Map([['src/a.ts', 2]]);
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                fileCommentMap={commentMap}
            />
        );

        expect(screen.getByTestId('commit-file-comment-badge-src/a.ts')).toBeTruthy();
        expect(screen.getByTestId('commit-file-comment-badge-src/a.ts').textContent).toContain('2');
    });

    it('calls onFileSelectSimple when a file is clicked', async () => {
        const user = userEvent.setup();
        const onFileSelectSimple = vi.fn();
        const tree = compactFolders(buildFileTree(FILES));
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={onFileSelectSimple}
                fileCommentMap={new Map()}
            />
        );

        await user.click(screen.getByTestId('commit-file-src/a.ts'));
        expect(onFileSelectSimple).toHaveBeenCalledWith('src/a.ts');
    });

    it('highlights the selected file', () => {
        const tree = compactFolders(buildFileTree(FILES));
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                selectedFilePath="src/a.ts"
                fileCommentMap={new Map()}
            />
        );

        const row = screen.getByTestId('commit-file-src/a.ts');
        expect(row.className).toContain('bg-[#0078d4]/10');
    });

    it('collapses and expands directory nodes', async () => {
        const user = userEvent.setup();
        const tree = compactFolders(buildFileTree(FILES));
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                fileCommentMap={new Map()}
            />
        );

        // Files should be visible initially (dirs default to open)
        expect(screen.getByTestId('commit-file-src/a.ts')).toBeTruthy();

        // Click the dir to collapse it
        await user.click(screen.getByTestId('file-tree-dir-src'));
        expect(screen.queryByTestId('commit-file-src/a.ts')).toBeNull();

        // Click again to expand
        await user.click(screen.getByTestId('file-tree-dir-src'));
        expect(screen.getByTestId('commit-file-src/a.ts')).toBeTruthy();
    });

    it('shows renamed file tooltip', () => {
        const renamedFiles: FileChange[] = [
            { path: 'src/new.ts', status: 'R', oldPath: 'src/old.ts' },
        ];
        const tree = compactFolders(buildFileTree(renamedFiles));
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                fileCommentMap={new Map()}
            />
        );

        const fileEntry = screen.getByTestId('commit-file-src/new.ts');
        // The file name span has the rename tooltip (oldPath → path)
        // Skip the first span[title] which is the status badge
        const spans = fileEntry.querySelectorAll('span[title]');
        const renameSpan = Array.from(spans).find(s =>
            s.getAttribute('title')?.includes('→')
        );
        expect(renameSpan).toBeTruthy();
        expect(renameSpan!.getAttribute('title')).toContain('src/old.ts');
        expect(renameSpan!.getAttribute('title')).toContain('src/new.ts');
    });
});

// ── isFileDimmed (classification filtering) ───────────────────────────

describe('FlatFileList — isFileDimmed', () => {
    const FILES: FileChange[] = [
        { path: 'src/a.ts', status: 'M', additions: 10, deletions: 3 },
        { path: 'src/b.ts', status: 'A', additions: 5, deletions: 0 },
    ];

    it('applies opacity:0.4 to dimmed files', () => {
        const isFileDimmed = (p: string) => p === 'src/a.ts';
        render(<FlatFileList files={FILES} onFileSelect={vi.fn()} isFileDimmed={isFileDimmed} />);

        const row = screen.getByTestId('flat-file-row-src/a.ts');
        // Opacity is on the wrapping div (parent of the button)
        expect(row.parentElement!.style.opacity).toBe('0.4');
    });

    it('leaves non-dimmed files at full opacity', () => {
        const isFileDimmed = (p: string) => p === 'src/a.ts';
        render(<FlatFileList files={FILES} onFileSelect={vi.fn()} isFileDimmed={isFileDimmed} />);

        const row = screen.getByTestId('flat-file-row-src/b.ts');
        expect(row.parentElement!.style.opacity).toBe('');
    });
});

describe('FileTreeView — isFileDimmed', () => {
    const FILES: FileChange[] = [
        { path: 'src/a.ts', status: 'M', additions: 10, deletions: 3 },
        { path: 'src/b.ts', status: 'A', additions: 5, deletions: 0 },
    ];

    it('applies opacity:0.4 to dimmed files in tree view', () => {
        const tree = compactFolders(buildFileTree(FILES));
        const isFileDimmed = (p: string) => p === 'src/a.ts';
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                fileCommentMap={new Map()}
                isFileDimmed={isFileDimmed}
            />
        );

        const row = screen.getByTestId('commit-file-src/a.ts');
        expect(row.style.opacity).toBe('0.4');
    });

    it('leaves non-dimmed files at full opacity in tree view', () => {
        const tree = compactFolders(buildFileTree(FILES));
        const isFileDimmed = (p: string) => p === 'src/a.ts';
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                fileCommentMap={new Map()}
                isFileDimmed={isFileDimmed}
            />
        );

        const row = screen.getByTestId('commit-file-src/b.ts');
        expect(row.style.opacity).not.toBe('0.4');
    });

    it('works without isFileDimmed prop (no dimming)', () => {
        const tree = compactFolders(buildFileTree(FILES));
        render(
            <FileTreeView
                nodes={tree}
                onFileSelectSimple={vi.fn()}
                fileCommentMap={new Map()}
            />
        );

        const row = screen.getByTestId('commit-file-src/a.ts');
        expect(row.style.opacity).not.toBe('0.4');
    });
});

// ── normalizeStatus + STATUS maps (unit) ──────────────────────────────

describe('normalizeStatus — all word-to-char conversions', () => {
    const EXPECTED_CONVERSIONS: [string, string][] = [
        ['added', 'A'],
        ['modified', 'M'],
        ['deleted', 'D'],
        ['renamed', 'R'],
        ['copied', 'C'],
        ['conflict', 'U'],
        ['untracked', '?'],
    ];

    for (const [word, char] of EXPECTED_CONVERSIONS) {
        it(`normalizes "${word}" → "${char}"`, () => {
            expect(normalizeStatus(word)).toBe(char);
        });
    }

    it('passes through single-char statuses unchanged', () => {
        for (const char of ['A', 'M', 'D', 'R', 'C', 'U', '?', 'T']) {
            expect(normalizeStatus(char)).toBe(char);
        }
    });
});

describe('STATUS_COLORS coverage', () => {
    it('has entries for all standard status chars', () => {
        for (const char of ['A', 'M', 'D', 'R', 'C', 'U', '?']) {
            expect(STATUS_COLORS[char]).toBeDefined();
        }
    });
});

describe('STATUS_LABELS coverage', () => {
    it('has entries for all standard status chars', () => {
        for (const char of ['A', 'M', 'D', 'R', 'C', 'U', '?', 'T']) {
            expect(STATUS_LABELS[char]).toBeDefined();
        }
    });
});
