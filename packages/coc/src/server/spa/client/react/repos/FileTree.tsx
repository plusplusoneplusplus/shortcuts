/**
 * FileTree — collapsible folder tree for commit file lists.
 *
 * `buildFileTree` converts a flat array of FileChange objects into a nested
 * tree of DirNode / FileNode entries. `FileTreeView` renders that tree with
 * collapsible directories and depth-based indentation.
 */

import { useState } from 'react';

// ----- Types -----

interface FileChange {
    status: string;
    path: string;
}

interface DirNode {
    type: 'dir';
    name: string;
    path: string;
    children: TreeNode[];
}

interface FileNode {
    type: 'file';
    name: string;
    path: string;
    status: string;
}

type TreeNode = DirNode | FileNode;

// ----- Tree builder -----

/**
 * Collapses single-child directory chains into one node whose name is the
 * combined path (e.g. `packages/coc/src`).  Directories with more than one
 * child, or whose only child is a file, are left untouched.
 */
export function compactFolders(nodes: TreeNode[]): TreeNode[] {
    return nodes.map((node) => {
        if (node.type !== 'dir') return node;
        const compacted = compactFolders(node.children);
        if (compacted.length === 1 && compacted[0].type === 'dir') {
            const child = compacted[0] as DirNode;
            return {
                type: 'dir' as const,
                name: `${node.name}/${child.name}`,
                path: child.path,
                children: child.children,
            };
        }
        return { ...node, children: compacted };
    });
}

export function buildFileTree(files: FileChange[]): TreeNode[] {
    const root: TreeNode[] = [];

    for (const file of files) {
        const segments = file.path.split('/');
        let children = root;

        // Walk/create intermediate directories
        for (let i = 0; i < segments.length - 1; i++) {
            const dirName = segments[i];
            const dirPath = segments.slice(0, i + 1).join('/');
            let dir = children.find(
                (n): n is DirNode => n.type === 'dir' && n.name === dirName,
            );
            if (!dir) {
                dir = { type: 'dir', name: dirName, path: dirPath, children: [] };
                children.push(dir);
            }
            children = dir.children;
        }

        // Push leaf file node
        children.push({
            type: 'file',
            name: segments[segments.length - 1],
            path: file.path,
            status: file.status,
        });
    }

    return root;
}

// ----- Status styling (mirrors CommitList) -----

const STATUS_COLORS: Record<string, string> = {
    A: 'text-[#16825d]',
    M: 'text-[#0078d4]',
    D: 'text-[#d32f2f]',
};

const STATUS_LABELS: Record<string, string> = {
    A: 'Added',
    M: 'Modified',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    T: 'Type changed',
};

// ----- Components -----

interface FileTreeViewProps {
    nodes: TreeNode[];
    depth?: number;
    commitHash: string;
    selectedFile?: { hash: string; filePath: string } | null;
    onFileSelect?: (hash: string, filePath: string) => void;
    fileCommentMap: Map<string, number>;
}

export function FileTreeView({
    nodes,
    depth = 0,
    commitHash,
    selectedFile,
    onFileSelect,
    fileCommentMap,
}: FileTreeViewProps) {
    return (
        <div className="flex flex-col gap-0.5" data-testid={depth === 0 ? 'commit-file-list' : undefined}>
            {nodes.map((node, i) =>
                node.type === 'dir' ? (
                    <DirEntry
                        key={`dir-${node.path}`}
                        node={node}
                        depth={depth}
                        commitHash={commitHash}
                        selectedFile={selectedFile}
                        onFileSelect={onFileSelect}
                        fileCommentMap={fileCommentMap}
                    />
                ) : (
                    <FileEntry
                        key={`file-${node.path}`}
                        node={node}
                        depth={depth}
                        commitHash={commitHash}
                        selectedFile={selectedFile}
                        onFileSelect={onFileSelect}
                        fileCommentMap={fileCommentMap}
                    />
                ),
            )}
        </div>
    );
}

function DirEntry({
    node,
    depth,
    commitHash,
    selectedFile,
    onFileSelect,
    fileCommentMap,
}: {
    node: DirNode;
    depth: number;
    commitHash: string;
    selectedFile?: { hash: string; filePath: string } | null;
    onFileSelect?: (hash: string, filePath: string) => void;
    fileCommentMap: Map<string, number>;
}) {
    const [open, setOpen] = useState(true);

    return (
        <div>
            <button
                className="flex items-center gap-1 text-[11px] text-[#616161] dark:text-[#999] py-0.5 w-full text-left hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] rounded"
                style={{ paddingLeft: `${depth * 12}px` }}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((o) => !o);
                }}
                data-testid={`file-tree-dir-${node.path}`}
            >
                <span className="text-[10px] flex-shrink-0">{open ? '▼' : '▶'}</span>
                <span>📁</span>
                <span>{node.name}/</span>
            </button>
            {open && (
                <FileTreeView
                    nodes={node.children}
                    depth={depth + 1}
                    commitHash={commitHash}
                    selectedFile={selectedFile}
                    onFileSelect={onFileSelect}
                    fileCommentMap={fileCommentMap}
                />
            )}
        </div>
    );
}

function FileEntry({
    node,
    depth,
    commitHash,
    selectedFile,
    onFileSelect,
    fileCommentMap,
}: {
    node: FileNode;
    depth: number;
    commitHash: string;
    selectedFile?: { hash: string; filePath: string } | null;
    onFileSelect?: (hash: string, filePath: string) => void;
    fileCommentMap: Map<string, number>;
}) {
    const isActiveFile = selectedFile?.hash === commitHash && selectedFile?.filePath === node.path;
    const count = fileCommentMap.get(node.path) ?? 0;

    return (
        <button
            className={`flex items-center gap-2 text-[11px] py-0.5 px-1 rounded text-left w-full transition-colors ${
                isActiveFile
                    ? 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10'
                    : 'hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]'
            }`}
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            onClick={(e) => {
                e.stopPropagation();
                onFileSelect?.(commitHash, node.path);
            }}
            data-testid={`commit-file-${node.path}`}
        >
            {count > 0 && (
                <span
                    className="text-xs text-[#848484] flex-shrink-0"
                    title={`${count} active comment${count > 1 ? 's' : ''}`}
                    data-testid={`commit-file-comment-badge-${node.path}`}
                >
                    💬{count}
                </span>
            )}
            <span
                className={`font-mono font-bold w-3 text-center flex-shrink-0 ${STATUS_COLORS[node.status] || 'text-[#848484]'}`}
                title={STATUS_LABELS[node.status] || node.status}
            >
                {node.status}
            </span>
            <span className="text-[#1e1e1e] dark:text-[#ccc]">{node.name}</span>
        </button>
    );
}
