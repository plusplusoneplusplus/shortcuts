/**
 * Unit tests for the file-tree helper used by the PR Files panel.
 */

import { describe, it, expect } from 'vitest';
import {
    buildFileTree,
    collectFolderPaths,
    splitPath,
    type FileTreeFile,
    type FileTreeFolder,
    type FileTreeNode,
} from '../../../../../src/server/spa/client/react/features/pull-requests/file-tree';
import type { FileChange } from '../../../../../src/server/spa/client/react/features/git/diff/FileTree';

function file(path: string, additions = 1, deletions = 0): FileChange {
    return {
        path,
        status: 'M',
        additions,
        deletions,
    };
}

function asFolder(node: FileTreeNode): FileTreeFolder {
    if (node.kind !== 'folder') throw new Error(`expected folder, got ${node.kind}`);
    return node;
}

function asFile(node: FileTreeNode): FileTreeFile {
    if (node.kind !== 'file') throw new Error(`expected file, got ${node.kind}`);
    return node;
}

describe('splitPath', () => {
    it('returns basename and empty dirname for a flat path', () => {
        expect(splitPath('README.md')).toEqual({ dirname: '', basename: 'README.md' });
    });

    it('splits nested paths on the last slash', () => {
        expect(splitPath('src/utils/format.ts')).toEqual({
            dirname: 'src/utils',
            basename: 'format.ts',
        });
    });

    it('handles single-segment dirnames', () => {
        expect(splitPath('docs/intro.md')).toEqual({ dirname: 'docs', basename: 'intro.md' });
    });
});

describe('buildFileTree', () => {
    it('returns an empty array for no files', () => {
        expect(buildFileTree([])).toEqual([]);
    });

    it('places top-level files at the root unwrapped', () => {
        const tree = buildFileTree([file('README.md', 4, 2)]);
        expect(tree).toHaveLength(1);
        const leaf = asFile(tree[0]);
        expect(leaf.name).toBe('README.md');
        expect(leaf.path).toBe('README.md');
        expect(leaf.file.additions).toBe(4);
    });

    it('groups files by their folder and aggregates +/- counts', () => {
        const tree = buildFileTree([
            file('src/foo.ts', 3, 1),
            file('src/bar.ts', 2, 0),
            file('docs/readme.md', 1, 4),
        ]);
        // Folders sort alphabetically (docs, src), files come after — at the
        // root level we only have folders so order is docs, src.
        expect(tree.map(n => n.name)).toEqual(['docs', 'src']);
        const docs = asFolder(tree[0]);
        const src = asFolder(tree[1]);
        expect(docs.fileCount).toBe(1);
        expect(docs.additions).toBe(1);
        expect(docs.deletions).toBe(4);
        expect(src.fileCount).toBe(2);
        expect(src.additions).toBe(5);
        expect(src.deletions).toBe(1);
        // Children of each folder are files (alphabetical).
        expect(src.children.map(n => n.name)).toEqual(['bar.ts', 'foo.ts']);
    });

    it('collapses single-child folder chains like packages/coc/src/server', () => {
        const tree = buildFileTree([
            file('packages/coc/src/server/foo.ts'),
            file('packages/coc/src/server/bar.ts'),
        ]);
        // Both files share the long prefix, which should collapse into one
        // folder row labelled `packages/coc/src/server`.
        expect(tree).toHaveLength(1);
        const collapsed = asFolder(tree[0]);
        expect(collapsed.name).toBe('packages/coc/src/server');
        expect(collapsed.path).toBe('packages/coc/src/server');
        expect(collapsed.fileCount).toBe(2);
        expect(collapsed.children.map(n => n.name)).toEqual(['bar.ts', 'foo.ts']);
    });

    it('stops collapsing as soon as a folder gains a sibling', () => {
        const tree = buildFileTree([
            file('packages/coc/foo.ts'),
            file('packages/forge/bar.ts'),
        ]);
        // The shared prefix `packages` has two child folders, so it does
        // not collapse — coc and forge remain visible siblings.
        expect(tree).toHaveLength(1);
        const packages = asFolder(tree[0]);
        expect(packages.name).toBe('packages');
        expect(packages.children.map(n => n.name)).toEqual(['coc', 'forge']);
        const coc = asFolder(packages.children[0]);
        // Inside coc, only one file remains, so the leaf is unwrapped.
        expect(coc.children.map(n => n.name)).toEqual(['foo.ts']);
    });

    it('sorts folders before files at every level', () => {
        const tree = buildFileTree([
            file('zzz-top-file.ts'),
            file('aaa/sub.ts'),
        ]);
        expect(tree.map(n => n.kind)).toEqual(['folder', 'file']);
        expect(tree.map(n => n.name)).toEqual(['aaa', 'zzz-top-file.ts']);
    });
});

describe('collectFolderPaths', () => {
    it('returns every folder path in the tree, recursively', () => {
        const tree = buildFileTree([
            file('packages/coc/foo.ts'),
            file('packages/forge/bar.ts'),
            file('docs/readme.md'),
        ]);
        const paths = collectFolderPaths(tree);
        // `packages` parent + its two children (coc, forge) + `docs`.
        // Order follows depth-first traversal.
        expect(paths.sort()).toEqual(
            ['docs', 'packages', 'packages/coc', 'packages/forge'].sort(),
        );
    });

    it('returns an empty array when the tree has no folders', () => {
        const tree = buildFileTree([file('README.md')]);
        expect(collectFolderPaths(tree)).toEqual([]);
    });
});
