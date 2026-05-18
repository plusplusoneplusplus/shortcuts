/**
 * FileTree — shared file-list components for commit, branch, and working-tree views.
 *
 * Exports:
 * - `buildFileTree` / `compactFolders` — tree builder utilities
 * - `FileTreeView` — collapsible folder tree (with optional renderActions slot)
 * - `FlatFileList` — flat file list (with optional renderActions slot)
 * - `FilesViewToggle` — flat/tree toggle button group
 * - Status helpers: `normalizeStatus`, `STATUS_COLORS`, `STATUS_LABELS`
 */

import React, { useState, useCallback } from 'react';
import { TruncatedPath } from '../../../ui';
import { ContextMenu } from '../../../tasks/comments/ContextMenu';
import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import { copyToClipboard } from '../../../utils/format';

// ----- Types -----

export interface FileChange {
    status: string;
    path: string;
    additions?: number;
    deletions?: number;
    oldPath?: string;
}

export interface DirNode {
    type: 'dir';
    name: string;
    path: string;
    children: TreeNode[];
}

export interface FileNode {
    type: 'file';
    name: string;
    path: string;
    status: string;
    additions?: number;
    deletions?: number;
    oldPath?: string;
}

export type TreeNode = DirNode | FileNode;

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

// ----- Status helpers (single source of truth) -----

const WORD_TO_CHAR: Record<string, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    conflict: 'U',
    untracked: '?',
};

/** Normalize a word status (e.g. "added") to a single char ("A"). Already-single-char values pass through. */
export function normalizeStatus(status: string): string {
    return WORD_TO_CHAR[status] ?? status;
}

export const STATUS_COLORS: Record<string, string> = {
    A: 'text-[#16825d]',
    M: 'text-[#0078d4]',
    D: 'text-[#d32f2f]',
    R: 'text-[#9c27b0]',
    C: 'text-[#848484]',
    U: 'text-[#d32f2f]',
    '?': 'text-[#848484]',
};

export const STATUS_LABELS: Record<string, string> = {
    A: 'Added',
    M: 'Modified',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Copied',
    T: 'Type changed',
    U: 'Conflict',
    '?': 'Untracked',
};

// ----- FilesViewToggle -----

export type FilesViewMode = 'flat' | 'tree';

export interface FilesViewToggleProps {
    mode: FilesViewMode;
    onChange: (mode: FilesViewMode) => void;
    testIdPrefix?: string;
}

export function FilesViewToggle({ mode, onChange, testIdPrefix = 'files-view-toggle' }: FilesViewToggleProps) {
    const BUTTONS: { value: FilesViewMode; label: string }[] = [
        { value: 'flat', label: '☰ Flat' },
        { value: 'tree', label: '🌲 Tree' },
    ];
    return (
        <div
            className="inline-flex rounded border border-[#d0d7de] dark:border-[#30363d] overflow-hidden text-xs"
            role="group"
            aria-label="File list view mode"
            data-testid={testIdPrefix}
        >
            {BUTTONS.map(({ value, label }, i) => (
                <button
                    key={value}
                    onClick={(e) => { e.stopPropagation(); onChange(value); }}
                    aria-pressed={mode === value}
                    data-testid={`${testIdPrefix}-${value}`}
                    className={[
                        'px-2 py-0.5 transition-colors',
                        i > 0 ? 'border-l border-[#d0d7de] dark:border-[#30363d]' : '',
                        mode === value
                            ? 'bg-[#0550ae] dark:bg-[#79c0ff] text-white dark:text-black font-medium'
                            : 'bg-white dark:bg-[#161b22] text-[#6e7681] hover:bg-[#f3f4f6] dark:hover:bg-[#21262d]',
                    ].join(' ')}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

// ----- Path helpers -----

/** Join repo root and relative file path using the OS separator detected from repoRoot. */
export function buildAbsolutePath(repoRoot: string, relativePath: string): string {
    const isWindows = repoRoot.includes('\\');
    const sep = isWindows ? '\\' : '/';
    const normalizedRelative = isWindows ? relativePath.replace(/\//g, '\\') : relativePath;
    const root = repoRoot.endsWith(sep) ? repoRoot.slice(0, -1) : repoRoot;
    return `${root}${sep}${normalizedRelative}`;
}

function buildCopyPathMenuItems(filePath: string, repoRoot?: string): ContextMenuItem[] {
    return [
        {
            label: 'Copy Relative Path',
            onClick: () => { copyToClipboard(filePath); },
        },
        {
            label: 'Copy Absolute Path',
            disabled: !repoRoot,
            onClick: () => {
                if (repoRoot) copyToClipboard(buildAbsolutePath(repoRoot, filePath));
            },
        },
    ];
}

// ----- FlatFileList -----

export interface FlatFileListProps {
    files: FileChange[];
    onFileSelect: (filePath: string) => void;
    selectedFilePath?: string | null;
    fileCommentMap?: Map<string, number>;
    commentBadgeTestIdPrefix?: string;
    fileTestIdPrefix?: string;
    /** Render extra content below a file entry (e.g. inline diff). */
    renderFileExtra?: (file: FileChange) => React.ReactNode;
    /** Trailing content per row — used by WorkingTree for action buttons. */
    renderActions?: (file: FileChange) => React.ReactNode;
    /** Repo root path for "Copy Absolute Path" context menu action. */
    repoRoot?: string;
    /** When provided, files returning true are visually dimmed (e.g. filtered by classification). */
    isFileDimmed?: (filePath: string) => boolean;
}

export function FlatFileList({
    files,
    onFileSelect,
    selectedFilePath,
    fileCommentMap = new Map(),
    commentBadgeTestIdPrefix = 'flat-file-comment-badge',
    fileTestIdPrefix = 'flat-file-row',
    renderFileExtra,
    renderActions,
    repoRoot,
    isFileDimmed,
}: FlatFileListProps) {
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; filePath: string } | null>(null);

    return (
        <div className="flex flex-col gap-0.5" data-testid="flat-file-list">
            {files.map((file, i) => {
                const displayStatus = normalizeStatus(file.status);
                const count = fileCommentMap.get(file.path) ?? 0;
                const dimmed = isFileDimmed?.(file.path) ?? false;
                return (
                    <div key={i} style={dimmed ? { opacity: 0.4 } : undefined}>
                        <button
                            className={`group w-full flex items-center gap-2 text-xs py-1 px-1 rounded hover:bg-[#f0f0f0] dark:hover:bg-[#2a2d2e] transition-colors text-left ${
                                selectedFilePath === file.path ? 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10' : ''
                            }`}
                            onClick={() => onFileSelect(file.path)}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setContextMenu({ x: e.clientX, y: e.clientY, filePath: file.path });
                            }}
                            data-testid={`${fileTestIdPrefix}-${file.path}`}
                        >
                            {count > 0 && (
                                <span
                                    className="text-xs text-[#848484] mr-0.5 flex-shrink-0"
                                    title={`${count} active comment${count > 1 ? 's' : ''}`}
                                    data-testid={`${commentBadgeTestIdPrefix}-${file.path}`}
                                >
                                    💬{count}
                                </span>
                            )}
                            <span
                                className={`font-mono font-bold w-4 text-center flex-shrink-0 ${STATUS_COLORS[displayStatus] || 'text-[#848484]'}`}
                                title={STATUS_LABELS[displayStatus] || file.status}
                            >
                                {displayStatus}
                            </span>
                            {file.oldPath ? (
                                <span className="font-mono text-[#1e1e1e] dark:text-[#ccc] flex-1 min-w-0 flex items-center gap-0" title={`${file.oldPath} → ${file.path}`}>
                                    <TruncatedPath path={file.oldPath} className="text-[#1e1e1e] dark:text-[#ccc]" />
                                    <span className="flex-shrink-0 mx-0.5"> → </span>
                                    <TruncatedPath path={file.path} className="text-[#1e1e1e] dark:text-[#ccc]" />
                                </span>
                            ) : (
                                <TruncatedPath path={file.path} className="text-[#1e1e1e] dark:text-[#ccc] flex-1" />
                            )}
                            {file.additions !== undefined && (
                                <span className="text-[#16825d] text-xs flex-shrink-0">+{file.additions}</span>
                            )}
                            {file.deletions !== undefined && (
                                <span className="text-[#d32f2f] text-xs flex-shrink-0">−{file.deletions}</span>
                            )}
                            {renderActions?.(file)}
                        </button>
                        {renderFileExtra?.(file)}
                    </div>
                );
            })}
            {contextMenu && (
                <ContextMenu
                    position={{ x: contextMenu.x, y: contextMenu.y }}
                    items={buildCopyPathMenuItems(contextMenu.filePath, repoRoot)}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}

// ----- FileTreeView -----

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
    /** Trailing content per row — used by WorkingTree for action buttons. */
    renderActions?: (node: FileNode) => React.ReactNode;
    /** Repo root path for "Copy Absolute Path" context menu action. */
    repoRoot?: string;
    /** When provided, files returning true are visually dimmed (e.g. filtered by classification). */
    isFileDimmed?: (filePath: string) => boolean;
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
    renderActions,
    repoRoot,
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
                        renderActions={renderActions}
                        repoRoot={repoRoot}
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
                        renderActions={renderActions}
                        repoRoot={repoRoot}
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
    renderActions,
    repoRoot,
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
    renderActions?: (node: FileNode) => React.ReactNode;
    repoRoot?: string;
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
                    renderActions={renderActions}
                    repoRoot={repoRoot}
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
    renderActions,
    repoRoot,
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
    renderActions?: (node: FileNode) => React.ReactNode;
    repoRoot?: string;
}) {
    const isActiveFile = onFileSelectSimple
        ? selectedFilePath === node.path
        : (selectedFile?.hash === commitHash && selectedFile?.filePath === node.path);
    const count = fileCommentMap.get(node.path) ?? 0;
    const displayStatus = normalizeStatus(node.status);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    return (
        <div>
            <button
                className={`group flex items-center gap-2 text-[11px] py-0.5 px-1 rounded text-left w-full transition-colors ${
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
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: e.clientY });
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
                {node.oldPath ? (
                    <span className="font-mono text-[#1e1e1e] dark:text-[#ccc] flex-1 min-w-0 flex items-center gap-0" title={`${node.oldPath} → ${node.path}`}>
                        <TruncatedPath path={node.oldPath} className="text-[#1e1e1e] dark:text-[#ccc]" />
                        <span className="flex-shrink-0 mx-0.5"> → </span>
                        <TruncatedPath path={node.path} className="text-[#1e1e1e] dark:text-[#ccc]" />
                    </span>
                ) : (
                    <TruncatedPath path={node.name} className="text-[#1e1e1e] dark:text-[#ccc] flex-1" />
                )}
                {node.additions !== undefined && (
                    <span className="text-[#16825d] text-xs flex-shrink-0">+{node.additions}</span>
                )}
                {node.deletions !== undefined && (
                    <span className="text-[#d32f2f] text-xs flex-shrink-0">−{node.deletions}</span>
                )}
                {renderActions?.(node)}
            </button>
            {renderFileExtra?.(node)}
            {contextMenu && (
                <ContextMenu
                    position={contextMenu}
                    items={buildCopyPathMenuItems(node.path, repoRoot)}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </div>
    );
}
