/**
 * FileTree — collapsible folder tree for commit file lists.
 *
 * `buildFileTree` converts a flat array of FileChange objects into a nested
 * tree of DirNode / FileNode entries. `FileTreeView` renders that tree with
 * collapsible directories and depth-based indentation.
 */

import React, { useState } from 'react';

// ----- Types -----

interface FileChange {
    status: string;
    path: string;
    additions?: number;
    deletions?: number;
    oldPath?: string;
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
    additions?: number;
    deletions?: number;
    oldPath?: string;
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
            ...(file.additions !== undefined && { additions: file.additions }),
            ...(file.deletions !== undefined && { deletions: file.deletions }),
            ...(file.oldPath && { oldPath: file.oldPath }),
        });
    }

    return root;
}

// ----- Status helpers -----

const WORD_TO_CHAR: Record<string, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
};

/** Normalize a word status (e.g. "added") to a single char ("A"). Already-single-char values pass through. */
export function normalizeStatus(status: string): string {
    return WORD_TO_CHAR[status] ?? status;
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
    commitHash?: string;
    selectedFile?: { hash: string; filePath: string } | null;
    onFileSelect?: (hash: string, filePath: string) => void;
    /** Simple file select callback for branch-change mode (no commit hash). */
    onFileSelectSimple?: (filePath: string) => void;
    /** Currently selected file path (branch-change mode). */
    selectedFilePath?: string | null;
    fileCommentMap: Map<string, number>;
    /** Prefix for comment badge data-testid (default: "commit-file-comment-badge"). */
    commentBadgeTestIdPrefix?: string;
    /** Prefix for file button data-testid (default: "commit-file"). */
    fileTestIdPrefix?: string;
    /** Render extra content below a file entry (e.g. inline diff). */
    renderFileExtra?: (node: FileNode) => React.ReactNode;
}

export function FileTreeView({
    nodes,
    depth = 0,
    commitHash,
    selectedFile,
    onFileSelect,
    onFileSelectSimple,
    selectedFilePath,
    fileCommentMap,
    commentBadgeTestIdPrefix = 'commit-file-comment-badge',
    fileTestIdPrefix = 'commit-file',
    renderFileExtra,
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
                        onFileSelectSimple={onFileSelectSimple}
                        selectedFilePath={selectedFilePath}
                        fileCommentMap={fileCommentMap}
                        commentBadgeTestIdPrefix={commentBadgeTestIdPrefix}
                        fileTestIdPrefix={fileTestIdPrefix}
                        renderFileExtra={renderFileExtra}
                    />
                ) : (
                    <FileEntry
                        key={`file-${node.path}`}
                        node={node}
                        depth={depth}
                        commitHash={commitHash}
                        selectedFile={selectedFile}
                        onFileSelect={onFileSelect}
                        onFileSelectSimple={onFileSelectSimple}
                        selectedFilePath={selectedFilePath}
                        fileCommentMap={fileCommentMap}
                        commentBadgeTestIdPrefix={commentBadgeTestIdPrefix}
                        fileTestIdPrefix={fileTestIdPrefix}
                        renderFileExtra={renderFileExtra}
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
    onFileSelectSimple,
    selectedFilePath,
    fileCommentMap,
    commentBadgeTestIdPrefix,
    fileTestIdPrefix,
    renderFileExtra,
}: {
    node: DirNode;
    depth: number;
    commitHash?: string;
    selectedFile?: { hash: string; filePath: string } | null;
    onFileSelect?: (hash: string, filePath: string) => void;
    onFileSelectSimple?: (filePath: string) => void;
    selectedFilePath?: string | null;
    fileCommentMap: Map<string, number>;
    commentBadgeTestIdPrefix?: string;
    fileTestIdPrefix?: string;
    renderFileExtra?: (node: FileNode) => React.ReactNode;
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
                    onFileSelectSimple={onFileSelectSimple}
                    selectedFilePath={selectedFilePath}
                    fileCommentMap={fileCommentMap}
                    commentBadgeTestIdPrefix={commentBadgeTestIdPrefix}
                    fileTestIdPrefix={fileTestIdPrefix}
                    renderFileExtra={renderFileExtra}
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
    onFileSelectSimple,
    selectedFilePath,
    fileCommentMap,
    commentBadgeTestIdPrefix = 'commit-file-comment-badge',
    fileTestIdPrefix = 'commit-file',
    renderFileExtra,
}: {
    node: FileNode;
    depth: number;
    commitHash?: string;
    selectedFile?: { hash: string; filePath: string } | null;
    onFileSelect?: (hash: string, filePath: string) => void;
    onFileSelectSimple?: (filePath: string) => void;
    selectedFilePath?: string | null;
    fileCommentMap: Map<string, number>;
    commentBadgeTestIdPrefix?: string;
    fileTestIdPrefix?: string;
    renderFileExtra?: (node: FileNode) => React.ReactNode;
}) {
    const isActiveFile = onFileSelectSimple
        ? selectedFilePath === node.path
        : (selectedFile?.hash === commitHash && selectedFile?.filePath === node.path);
    const count = fileCommentMap.get(node.path) ?? 0;
    const displayStatus = normalizeStatus(node.status);

    return (
        <div>
            <button
                className={`flex items-center gap-2 text-[11px] py-0.5 px-1 rounded text-left w-full transition-colors ${
                    isActiveFile
                        ? 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10'
                        : 'hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]'
                }`}
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
                onClick={(e) => {
                    e.stopPropagation();
                    if (onFileSelectSimple) {
                        onFileSelectSimple(node.path);
                    } else if (onFileSelect && commitHash) {
                        onFileSelect(commitHash, node.path);
                    }
                }}
                data-testid={`${fileTestIdPrefix}-${node.path}`}
            >
                {count > 0 && (
                    <span
                        className="text-xs text-[#848484] flex-shrink-0"
                        title={`${count} active comment${count > 1 ? 's' : ''}`}
                        data-testid={`${commentBadgeTestIdPrefix}-${node.path}`}
                    >
                        💬{count}
                    </span>
                )}
                <span
                    className={`font-mono font-bold w-3 text-center flex-shrink-0 ${STATUS_COLORS[displayStatus] || 'text-[#848484]'}`}
                    title={STATUS_LABELS[displayStatus] || node.status}
                >
                    {displayStatus}
                </span>
                <span className="text-[#1e1e1e] dark:text-[#ccc] flex-1 min-w-0 truncate" title={node.oldPath ? `${node.oldPath} → ${node.path}` : undefined}>
                    {node.name}
                </span>
                {node.additions !== undefined && (
                    <span className="text-[#16825d] text-xs flex-shrink-0">+{node.additions}</span>
                )}
                {node.deletions !== undefined && (
                    <span className="text-[#d32f2f] text-xs flex-shrink-0">−{node.deletions}</span>
                )}
            </button>
            {renderFileExtra?.(node)}
        </div>
    );
}
