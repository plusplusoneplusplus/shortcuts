/**
 * Tests for FileTree shared components.
 *
 * Validates exports, status maps, FlatFileList, FilesViewToggle,
 * FileTreeView renderActions slot, and tree builder utilities.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const FILE_TREE_PATH = path.join(
    __dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'diff', 'FileTree.tsx'
);

describe('FileTree shared components', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(FILE_TREE_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports FileChange interface', () => {
            expect(source).toContain('export interface FileChange');
        });

        it('exports FileNode interface', () => {
            expect(source).toContain('export interface FileNode');
        });

        it('exports DirNode interface', () => {
            expect(source).toContain('export interface DirNode');
        });

        it('exports TreeNode type', () => {
            expect(source).toContain('export type TreeNode');
        });

        it('exports FilesViewMode type', () => {
            expect(source).toContain('export type FilesViewMode');
        });

        it('exports buildFileTree function', () => {
            expect(source).toContain('export function buildFileTree');
        });

        it('exports compactFolders function', () => {
            expect(source).toContain('export function compactFolders');
        });

        it('exports normalizeStatus function', () => {
            expect(source).toContain('export function normalizeStatus');
        });

        it('exports FileTreeView component', () => {
            expect(source).toContain('export function FileTreeView');
        });

        it('exports FlatFileList component', () => {
            expect(source).toContain('export function FlatFileList');
        });

        it('exports FilesViewToggle component', () => {
            expect(source).toContain('export function FilesViewToggle');
        });

        it('exports STATUS_COLORS map', () => {
            expect(source).toContain('export const STATUS_COLORS');
        });

        it('exports STATUS_LABELS map', () => {
            expect(source).toContain('export const STATUS_LABELS');
        });
    });

    describe('FileChange interface', () => {
        it('has status field', () => {
            expect(source).toMatch(/interface FileChange[\s\S]*?status: string/);
        });

        it('has path field', () => {
            expect(source).toMatch(/interface FileChange[\s\S]*?path: string/);
        });

        it('has optional additions field', () => {
            expect(source).toMatch(/interface FileChange[\s\S]*?additions\?: number/);
        });

        it('has optional deletions field', () => {
            expect(source).toMatch(/interface FileChange[\s\S]*?deletions\?: number/);
        });

        it('has optional oldPath field', () => {
            expect(source).toMatch(/interface FileChange[\s\S]*?oldPath\?: string/);
        });
    });

    describe('STATUS_COLORS (char-keyed)', () => {
        it('has green for Added (A)', () => {
            expect(source).toContain("A: 'text-[#16825d]'");
        });

        it('has blue for Modified (M)', () => {
            expect(source).toContain("M: 'text-[#0078d4]'");
        });

        it('has red for Deleted (D)', () => {
            expect(source).toContain("D: 'text-[#d32f2f]'");
        });

        it('has purple for Renamed (R)', () => {
            expect(source).toContain("R: 'text-[#9c27b0]'");
        });

        it('has gray for Copied (C)', () => {
            expect(source).toContain("C: 'text-[#848484]'");
        });

        it('has red for Conflict (U)', () => {
            expect(source).toContain("U: 'text-[#d32f2f]'");
        });

        it('has gray for Untracked (?)', () => {
            expect(source).toContain("'?': 'text-[#848484]'");
        });
    });

    describe('STATUS_LABELS (char-keyed)', () => {
        it('has labels for all statuses', () => {
            expect(source).toContain("A: 'Added'");
            expect(source).toContain("M: 'Modified'");
            expect(source).toContain("D: 'Deleted'");
            expect(source).toContain("R: 'Renamed'");
            expect(source).toContain("C: 'Copied'");
            expect(source).toContain("T: 'Type changed'");
            expect(source).toContain("U: 'Conflict'");
            expect(source).toContain("'?': 'Untracked'");
        });
    });

    describe('normalizeStatus', () => {
        it('maps word statuses to chars', () => {
            expect(source).toContain("added: 'A'");
            expect(source).toContain("modified: 'M'");
            expect(source).toContain("deleted: 'D'");
            expect(source).toContain("renamed: 'R'");
            expect(source).toContain("copied: 'C'");
            expect(source).toContain("conflict: 'U'");
            expect(source).toContain("untracked: '?'");
        });

        it('passes through already-char values', () => {
            expect(source).toContain('WORD_TO_CHAR[status] ?? status');
        });
    });

    describe('FilesViewToggle', () => {
        it('accepts mode and onChange props', () => {
            expect(source).toContain('mode: FilesViewMode');
            expect(source).toContain('onChange: (mode: FilesViewMode) => void');
        });

        it('renders flat and tree buttons', () => {
            expect(source).toContain("'☰ Flat'");
            expect(source).toContain("'🌲 Tree'");
        });

        it('uses aria-pressed for accessibility', () => {
            expect(source).toContain('aria-pressed={mode === value}');
        });

        it('has data-testid with configurable prefix', () => {
            expect(source).toContain('testIdPrefix');
            expect(source).toContain('data-testid={`${testIdPrefix}-${value}`}');
        });

        it('stops event propagation on click', () => {
            expect(source).toContain('e.stopPropagation()');
        });
    });

    describe('FlatFileList', () => {
        it('accepts files and onFileSelect props', () => {
            expect(source).toContain('files: FileChange[]');
            expect(source).toContain('onFileSelect: (filePath: string) => void');
        });

        it('accepts optional selectedFilePath', () => {
            expect(source).toContain('selectedFilePath?: string | null');
        });

        it('accepts optional fileCommentMap', () => {
            expect(source).toContain('fileCommentMap?: Map<string, number>');
        });

        it('has renderFileExtra slot for inline content', () => {
            expect(source).toContain('renderFileExtra?: (file: FileChange) => React.ReactNode');
        });

        it('has renderActions slot for action buttons', () => {
            expect(source).toContain('renderActions?: (file: FileChange) => React.ReactNode');
        });

        it('renders additions and deletions when present', () => {
            expect(source).toContain('+{file.additions}');
            expect(source).toContain('−{file.deletions}');
        });

        it('renders renamed files with arrow notation', () => {
            expect(source).toContain('file.oldPath');
            expect(source).toContain('→');
        });

        it('renders comment badges when present', () => {
            expect(source).toContain('💬{count}');
        });

        it('has flat-file-list data-testid', () => {
            expect(source).toContain('data-testid="flat-file-list"');
        });

        it('uses TruncatedPath for non-renamed files', () => {
            expect(source).toContain('<TruncatedPath');
        });

        it('highlights selected file', () => {
            expect(source).toContain('selectedFilePath === file.path');
        });
    });

    describe('FileTreeView renderActions slot', () => {
        it('accepts optional renderActions prop', () => {
            expect(source).toContain('renderActions?: (node: FileNode) => React.ReactNode');
        });

        it('calls renderActions in FileEntry', () => {
            // renderActions is called within the file entry button
            expect(source).toContain('renderActions?.(node)');
        });

        it('passes renderActions through DirEntry to recursive FileTreeView', () => {
            // DirEntry receives and passes renderActions down
            const dirEntryBlock = source.slice(
                source.indexOf('function DirEntry'),
                source.indexOf('function FileEntry')
            );
            expect(dirEntryBlock).toContain('renderActions');
        });
    });

    describe('FileTreeView group class on button', () => {
        it('adds group class to FileEntry button for hover-visible actions', () => {
            expect(source).toContain('group flex items-center');
        });
    });

    describe('consumers import from FileTree', () => {
        it('CommitList imports shared components from FileTree', () => {
            const commitListPath = path.join(
                path.dirname(FILE_TREE_PATH), '..', 'commits', 'CommitList.tsx'
            );
            const commitListSource = fs.readFileSync(commitListPath, 'utf-8');
            expect(commitListSource).toContain("from '../diff/FileTree'");
            expect(commitListSource).toContain('FlatFileList');
        });

        it('BranchChanges imports shared components from FileTree', () => {
            const branchChangesPath = path.join(
                path.dirname(FILE_TREE_PATH), '..', 'branches', 'BranchChanges.tsx'
            );
            const branchChangesSource = fs.readFileSync(branchChangesPath, 'utf-8');
            expect(branchChangesSource).toContain("from '../diff/FileTree'");
            expect(branchChangesSource).toContain('FlatFileList');
        });

        it('WorkingTree imports shared components from FileTree', () => {
            const workingTreePath = path.join(
                path.dirname(FILE_TREE_PATH), '..', 'working-tree', 'WorkingTree.tsx'
            );
            const workingTreeSource = fs.readFileSync(workingTreePath, 'utf-8');
            expect(workingTreeSource).toContain("from '../diff/FileTree'");
            expect(workingTreeSource).toContain('FlatFileList');
            expect(workingTreeSource).toContain('FileTreeView');
            expect(workingTreeSource).toContain('renderActions');
        });

        it('BranchAllFilesDiff imports shared status maps from FileTree', () => {
            const diffPath = path.join(
                path.dirname(FILE_TREE_PATH), '..', 'branches', 'BranchAllFilesDiff.tsx'
            );
            const diffSource = fs.readFileSync(diffPath, 'utf-8');
            expect(diffSource).toContain("from '../diff/FileTree'");
            expect(diffSource).toContain('STATUS_COLORS');
            expect(diffSource).toContain('STATUS_LABELS');
            expect(diffSource).toContain('normalizeStatus');
        });
    });
});
