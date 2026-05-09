/**
 * Context menu tests for FileTree copy-path feature.
 *
 * Validates:
 * - Right-click on file rows in FlatFileList and FileTreeView shows a context menu
 * - "Copy Relative Path" and "Copy Absolute Path" items are present
 * - Clicking items copies the correct value to the clipboard
 * - Absolute path uses OS-native separators based on repoRoot
 * - buildAbsolutePath helper works correctly for Windows and Unix paths
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import {
    FlatFileList,
    FileTreeView,
    buildFileTree,
    compactFolders,
    buildAbsolutePath,
} from '../../../../src/server/spa/client/react/features/git/diff/FileTree';
import type { FileChange } from '../../../../src/server/spa/client/react/features/git/diff/FileTree';

// Mock TruncatedPath
vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    TruncatedPath: ({ path, className }: { path: string; className?: string }) => (
        <span className={className}>{path}</span>
    ),
}));

// Mock copyToClipboard
const mockCopyToClipboard = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: (...args: any[]) => mockCopyToClipboard(...args),
}));

// Mock ContextMenu to render items in a testable way
vi.mock('../../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: ({ items, onClose }: { position: { x: number; y: number }; items: { label: string; disabled?: boolean; onClick: () => void }[]; onClose: () => void }) => (
        <div data-testid="context-menu">
            {items.map((item, i) => (
                <button
                    key={i}
                    data-testid={`context-menu-item-${i}`}
                    disabled={item.disabled}
                    onClick={() => { item.onClick(); onClose(); }}
                >
                    {item.label}
                </button>
            ))}
        </div>
    ),
}));

// Mock useBreakpoint (transitive dep of ContextMenu, but mocked above anyway)
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

const FILES: FileChange[] = [
    { status: 'M', path: 'src/foo/bar.ts', additions: 5, deletions: 2 },
    { status: 'A', path: 'src/baz.ts', additions: 10 },
    { status: 'R', path: 'src/new-name.ts', oldPath: 'src/old-name.ts' },
];

beforeEach(() => {
    mockCopyToClipboard.mockClear();
});

// ── buildAbsolutePath unit tests ──────────────────────────────────────

describe('buildAbsolutePath', () => {
    it('joins a Windows repo root with forward-slash relative path', () => {
        expect(buildAbsolutePath('D:\\projects\\shortcuts', 'src/foo/bar.ts'))
            .toBe('D:\\projects\\shortcuts\\src\\foo\\bar.ts');
    });

    it('joins a Unix repo root with relative path', () => {
        expect(buildAbsolutePath('/home/user/repo', 'src/foo/bar.ts'))
            .toBe('/home/user/repo/src/foo/bar.ts');
    });

    it('strips trailing separator from Windows root', () => {
        expect(buildAbsolutePath('D:\\projects\\', 'src/bar.ts'))
            .toBe('D:\\projects\\src\\bar.ts');
    });

    it('strips trailing separator from Unix root', () => {
        expect(buildAbsolutePath('/home/user/repo/', 'src/bar.ts'))
            .toBe('/home/user/repo/src/bar.ts');
    });

    it('handles deeply nested relative path on Windows', () => {
        expect(buildAbsolutePath('C:\\code', 'a/b/c/d.ts'))
            .toBe('C:\\code\\a\\b\\c\\d.ts');
    });
});

// ── FlatFileList context menu ─────────────────────────────────────────

describe('FlatFileList — context menu', () => {
    it('shows context menu on right-click', async () => {
        render(
            <FlatFileList
                files={FILES}
                onFileSelect={vi.fn()}
                repoRoot={'D:\\projects\\shortcuts'}
            />,
        );

        const row = screen.getByTestId('flat-file-row-src/foo/bar.ts');
        fireEvent.contextMenu(row);

        expect(screen.getByTestId('context-menu')).toBeTruthy();
        expect(screen.getByText('Copy Relative Path')).toBeTruthy();
        expect(screen.getByText('Copy Absolute Path')).toBeTruthy();
    });

    it('copies relative path to clipboard', () => {
        render(
            <FlatFileList
                files={FILES}
                onFileSelect={vi.fn()}
                repoRoot="/home/user/repo"
            />,
        );

        const row = screen.getByTestId('flat-file-row-src/foo/bar.ts');
        fireEvent.contextMenu(row);

        const copyRelative = screen.getByText('Copy Relative Path');
        fireEvent.click(copyRelative);

        expect(mockCopyToClipboard).toHaveBeenCalledWith('src/foo/bar.ts');
    });

    it('copies absolute path to clipboard (Windows root)', () => {
        render(
            <FlatFileList
                files={FILES}
                onFileSelect={vi.fn()}
                repoRoot={'D:\\projects\\shortcuts'}
            />,
        );

        const row = screen.getByTestId('flat-file-row-src/foo/bar.ts');
        fireEvent.contextMenu(row);

        const copyAbsolute = screen.getByText('Copy Absolute Path');
        fireEvent.click(copyAbsolute);

        expect(mockCopyToClipboard).toHaveBeenCalledWith('D:\\projects\\shortcuts\\src\\foo\\bar.ts');
    });

    it('copies absolute path to clipboard (Unix root)', () => {
        render(
            <FlatFileList
                files={FILES}
                onFileSelect={vi.fn()}
                repoRoot="/home/user/repo"
            />,
        );

        const row = screen.getByTestId('flat-file-row-src/baz.ts');
        fireEvent.contextMenu(row);

        const copyAbsolute = screen.getByText('Copy Absolute Path');
        fireEvent.click(copyAbsolute);

        expect(mockCopyToClipboard).toHaveBeenCalledWith('/home/user/repo/src/baz.ts');
    });

    it('uses new path for renamed files', () => {
        render(
            <FlatFileList
                files={FILES}
                onFileSelect={vi.fn()}
                repoRoot="/repo"
            />,
        );

        const row = screen.getByTestId('flat-file-row-src/new-name.ts');
        fireEvent.contextMenu(row);

        const copyRelative = screen.getByText('Copy Relative Path');
        fireEvent.click(copyRelative);

        expect(mockCopyToClipboard).toHaveBeenCalledWith('src/new-name.ts');
    });

    it('disables "Copy Absolute Path" when repoRoot is not provided', () => {
        render(
            <FlatFileList
                files={FILES}
                onFileSelect={vi.fn()}
            />,
        );

        const row = screen.getByTestId('flat-file-row-src/foo/bar.ts');
        fireEvent.contextMenu(row);

        const copyAbsolute = screen.getByText('Copy Absolute Path');
        expect(copyAbsolute.closest('button')!.disabled).toBe(true);
    });
});

// ── FileTreeView context menu ─────────────────────────────────────────

describe('FileTreeView — context menu', () => {
    const nodes = compactFolders(buildFileTree(FILES));

    it('shows context menu on right-click on a file entry', () => {
        render(
            <FileTreeView
                nodes={nodes}
                fileCommentMap={new Map()}
                repoRoot={'D:\\projects\\shortcuts'}
            />,
        );

        const fileBtn = screen.getByTestId('commit-file-src/foo/bar.ts');
        fireEvent.contextMenu(fileBtn);

        expect(screen.getByTestId('context-menu')).toBeTruthy();
        expect(screen.getByText('Copy Relative Path')).toBeTruthy();
        expect(screen.getByText('Copy Absolute Path')).toBeTruthy();
    });

    it('copies relative path from tree view', () => {
        render(
            <FileTreeView
                nodes={nodes}
                fileCommentMap={new Map()}
                repoRoot="/repo"
            />,
        );

        const fileBtn = screen.getByTestId('commit-file-src/baz.ts');
        fireEvent.contextMenu(fileBtn);

        const copyRelative = screen.getByText('Copy Relative Path');
        fireEvent.click(copyRelative);

        expect(mockCopyToClipboard).toHaveBeenCalledWith('src/baz.ts');
    });

    it('copies absolute path from tree view (Windows)', () => {
        render(
            <FileTreeView
                nodes={nodes}
                fileCommentMap={new Map()}
                repoRoot={'C:\\code\\myapp'}
            />,
        );

        const fileBtn = screen.getByTestId('commit-file-src/foo/bar.ts');
        fireEvent.contextMenu(fileBtn);

        const copyAbsolute = screen.getByText('Copy Absolute Path');
        fireEvent.click(copyAbsolute);

        expect(mockCopyToClipboard).toHaveBeenCalledWith('C:\\code\\myapp\\src\\foo\\bar.ts');
    });

    it('does not show context menu for directory entries', () => {
        render(
            <FileTreeView
                nodes={nodes}
                fileCommentMap={new Map()}
                repoRoot="/repo"
            />,
        );

        // Click on directory entry — should not produce a context menu
        const dirBtn = screen.getByTestId('file-tree-dir-src');
        fireEvent.contextMenu(dirBtn);

        // Context menu should not appear since dirs don't have the handler
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });
});


