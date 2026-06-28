/**
 * File-tree helper for the PR "Files changed" panel.
 *
 * Builds a folder tree from a flat list of `FileChange`s, then
 * collapses single-child folder chains the way common source browsers do
 * (e.g. `packages/coc/src/server` shown as one row) so reviewers can
 * see meaningful structure without scrolling past redundant prefixes.
 *
 * The output is intentionally serialisable / pure-data so it is easy
 * to unit test independently of the React rendering layer.
 */

import type { FileChange } from '../git/diff/FileTree';

export type FileTreeNode = FileTreeFolder | FileTreeFile;

export interface FileTreeFolder {
    kind: 'folder';
    /** Display label, may include intermediate single-child segments
     *  joined by `/` after collapsing (e.g. `packages/coc/src`). */
    name: string;
    /** Folder path key relative to the tree root (always ends without
     *  a trailing slash). Stable for `expanded` state tracking. */
    path: string;
    children: FileTreeNode[];
    /** Aggregated metadata across descendants. */
    fileCount: number;
    additions: number;
    deletions: number;
}

export interface FileTreeFile {
    kind: 'file';
    /** Just the basename (last segment of the file path). */
    name: string;
    /** Full path from the diff (used as the React key and selection id). */
    path: string;
    file: FileChange;
}

/** Build a collapsed folder tree from a flat file list. */
export function buildFileTree(files: FileChange[]): FileTreeNode[] {
    const root = makeFolder('', '');
    for (const file of files) {
        insertFile(root, file);
    }
    aggregate(root);
    collapseSingleChildFolders(root);
    return root.children;
}

/** Recursively collect every folder path in the tree (post-collapse). */
export function collectFolderPaths(nodes: FileTreeNode[]): string[] {
    const out: string[] = [];
    function walk(node: FileTreeNode) {
        if (node.kind === 'folder') {
            out.push(node.path);
            for (const child of node.children) walk(child);
        }
    }
    for (const n of nodes) walk(n);
    return out;
}

/** Split a path into `{ dirname, basename }` (POSIX-style). The
 *  dirname does NOT include a trailing slash; basename is never empty
 *  unless the path itself was empty. */
export function splitPath(path: string): { dirname: string; basename: string } {
    const idx = path.lastIndexOf('/');
    if (idx === -1) return { dirname: '', basename: path };
    return { dirname: path.slice(0, idx), basename: path.slice(idx + 1) };
}

// ── internals ────────────────────────────────────────────────────────

interface MutableFolder {
    kind: 'folder';
    name: string;
    path: string;
    childMap: Map<string, MutableFolder | FileTreeFile>;
    children: FileTreeNode[];
    fileCount: number;
    additions: number;
    deletions: number;
}

function makeFolder(name: string, path: string): MutableFolder {
    return {
        kind: 'folder',
        name,
        path,
        childMap: new Map(),
        children: [],
        fileCount: 0,
        additions: 0,
        deletions: 0,
    };
}

function insertFile(root: MutableFolder, file: FileChange): void {
    const segments = file.path.split('/').filter(Boolean);
    if (segments.length === 0) return;
    const basename = segments[segments.length - 1];
    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
        const seg = segments[i];
        let child = cursor.childMap.get(seg);
        if (!child || child.kind !== 'folder') {
            const folder = makeFolder(seg, cursor.path ? `${cursor.path}/${seg}` : seg);
            cursor.childMap.set(seg, folder);
            child = folder;
        }
        cursor = child;
    }
    const leaf: FileTreeFile = { kind: 'file', name: basename, path: file.path, file };
    cursor.childMap.set(basename, leaf);
}

function aggregate(folder: MutableFolder): void {
    folder.children = [];
    folder.fileCount = 0;
    folder.additions = 0;
    folder.deletions = 0;
    // Folders first, then files, each alphabetical.
    const folders: MutableFolder[] = [];
    const files: FileTreeFile[] = [];
    for (const child of folder.childMap.values()) {
        if (child.kind === 'folder') folders.push(child);
        else files.push(child);
    }
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    for (const f of folders) {
        aggregate(f);
        folder.fileCount += f.fileCount;
        folder.additions += f.additions;
        folder.deletions += f.deletions;
        folder.children.push(toReadOnly(f));
    }
    for (const f of files) {
        folder.fileCount += 1;
        folder.additions += f.file.additions;
        folder.deletions += f.file.deletions;
        folder.children.push(f);
    }
}

function toReadOnly(folder: MutableFolder): FileTreeFolder {
    return {
        kind: 'folder',
        name: folder.name,
        path: folder.path,
        children: folder.children,
        fileCount: folder.fileCount,
        additions: folder.additions,
        deletions: folder.deletions,
    };
}

/** Merge any folder that has exactly one folder child into that
 *  child, joining their names with `/`. Stops merging once the folder
 *  contains a file or more than one entry. */
function collapseSingleChildFolders(root: MutableFolder): void {
    function collapse(nodes: FileTreeNode[]): FileTreeNode[] {
        return nodes.map(node => {
            if (node.kind !== 'folder') return node;
            let current = node;
            while (current.children.length === 1 && current.children[0].kind === 'folder') {
                const only = current.children[0];
                current = {
                    kind: 'folder',
                    name: `${current.name}/${only.name}`,
                    path: only.path,
                    children: only.children,
                    fileCount: only.fileCount,
                    additions: only.additions,
                    deletions: only.deletions,
                };
            }
            current = { ...current, children: collapse(current.children) };
            return current;
        });
    }
    root.children = collapse(root.children);
}
