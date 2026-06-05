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
import type { HunkCategory } from '../../pull-requests/classification-types';
import { CATEGORY_LABELS } from '../../pull-requests/classification-types';

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

/** Per-file classification badge info for rail display. */
export interface FileBadgeInfo {
    category: HunkCategory;
    intensity: 'high' | 'low';
    hasCritical?: boolean;
}

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
    /** When provided, renders a small classification badge before the filename. */
    getFileBadge?: (filePath: string) => FileBadgeInfo | undefined;
    /** Reviewed files (explicit "mark reviewed" state). Renders a ✓ indicator. */
    reviewedFiles?: ReadonlySet<string>;
    /** Visited files (opened but not yet reviewed). Renders a subtle • indicator. */
    visitedFiles?: ReadonlySet<string>;
}

const CATEGORY_BADGE_STYLE: Record<FileBadgeInfo['category'], { label: string; cls: string }> = {
    logic:      { label: 'L', cls: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200' },
    test:       { label: 'T', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200' },
    mechanical: { label: 'M', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
    simple:     { label: 'S', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' },
    generated:  { label: 'G', cls: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
};

function CategoryBadge({ badge, testId }: { badge: FileBadgeInfo; testId?: string }) {
    const style = CATEGORY_BADGE_STYLE[badge.category];
    const ring = badge.intensity === 'high' ? ' ring-1 ring-current/30 font-bold' : '';
    return (
        <span
            className={`inline-flex items-center justify-center w-4 h-3.5 text-[9px] leading-none rounded flex-shrink-0 ${style.cls}${ring}`}
            title={`${CATEGORY_LABELS[badge.category]} (${badge.intensity})`}
            data-testid={testId}
        >
            {style.label}
        </span>
    );
}

function CriticalMarker({ testId }: { testId?: string }) {
    return (
        <span
            className="inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-100 px-1 text-[9px] font-bold leading-none text-red-700 ring-1 ring-red-300 dark:bg-red-900/40 dark:text-red-200 dark:ring-red-500/60"
            title="Critical existing-function change"
            data-testid={testId}
        >
            !
        </span>
    );
}

function ReviewStateIndicator({
    isReviewed,
    isVisited,
    testIdReviewed,
    testIdVisited,
}: {
    isReviewed?: boolean;
    isVisited?: boolean;
    testIdReviewed?: string;
    testIdVisited?: string;
}) {
    if (isReviewed) {
        return (
            <span
                className="text-emerald-600 dark:text-emerald-400 text-[11px] flex-shrink-0"
                title="Marked reviewed"
                data-testid={testIdReviewed}
            >
                ✓
            </span>
        );
    }
    if (isVisited) {
        return (
            <span
                className="text-[#848484] text-[11px] flex-shrink-0"
                title="Visited (not reviewed)"
                data-testid={testIdVisited}
            >
                •
            </span>
        );
    }
    return null;
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
    getFileBadge,
    reviewedFiles,
    visitedFiles,
}: FlatFileListProps) {
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; filePath: string } | null>(null);

    return (
        <div className="flex flex-col gap-0.5" data-testid="flat-file-list">
            {files.map((file, i) => {
                const displayStatus = normalizeStatus(file.status);
                const count = fileCommentMap.get(file.path) ?? 0;
                const dimmed = isFileDimmed?.(file.path) ?? false;
                const badge = getFileBadge?.(file.path);
                const isReviewed = reviewedFiles?.has(file.path) ?? false;
                const isVisited = !isReviewed && (visitedFiles?.has(file.path) ?? false);
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
                            {badge && (
                                <CategoryBadge
                                    badge={badge}
                                    testId={`flat-file-category-badge-${file.path}`}
                                />
                            )}
                            {badge?.hasCritical && (
                                <CriticalMarker testId={`flat-file-critical-marker-${file.path}`} />
                            )}
                            <ReviewStateIndicator
                                isReviewed={isReviewed}
                                isVisited={isVisited}
                                testIdReviewed={`flat-file-reviewed-${file.path}`}
                                testIdVisited={`flat-file-visited-${file.path}`}
                            />
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
    /** When provided, renders a small classification badge before the filename. */
    getFileBadge?: (filePath: string) => FileBadgeInfo | undefined;
    /** Reviewed files (explicit "mark reviewed" state). */
    reviewedFiles?: ReadonlySet<string>;
    /** Visited files (opened but not yet reviewed). */
    visitedFiles?: ReadonlySet<string>;
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
    isFileDimmed,
    getFileBadge,
    reviewedFiles,
    visitedFiles,
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
                        isFileDimmed={isFileDimmed}
                        getFileBadge={getFileBadge}
                        reviewedFiles={reviewedFiles}
                        visitedFiles={visitedFiles}
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
                        isFileDimmed={isFileDimmed}
                        getFileBadge={getFileBadge}
                        reviewedFiles={reviewedFiles}
                        visitedFiles={visitedFiles}
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
    isFileDimmed,
    getFileBadge,
    reviewedFiles,
    visitedFiles,
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
    isFileDimmed?: (filePath: string) => boolean;
    getFileBadge?: (filePath: string) => FileBadgeInfo | undefined;
    reviewedFiles?: ReadonlySet<string>;
    visitedFiles?: ReadonlySet<string>;
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
                    isFileDimmed={isFileDimmed}
                    getFileBadge={getFileBadge}
                    reviewedFiles={reviewedFiles}
                    visitedFiles={visitedFiles}
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
    isFileDimmed,
    getFileBadge,
    reviewedFiles,
    visitedFiles,
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
    isFileDimmed?: (filePath: string) => boolean;
    getFileBadge?: (filePath: string) => FileBadgeInfo | undefined;
    reviewedFiles?: ReadonlySet<string>;
    visitedFiles?: ReadonlySet<string>;
}) {
    const isActiveFile = onFileSelectSimple
        ? selectedFilePath === node.path
        : (selectedFile?.hash === commitHash && selectedFile?.filePath === node.path);
    const count = fileCommentMap.get(node.path) ?? 0;
    const displayStatus = normalizeStatus(node.status);
    const dimmed = isFileDimmed?.(node.path) ?? false;
    const badge = getFileBadge?.(node.path);
    const isReviewed = reviewedFiles?.has(node.path) ?? false;
    const isVisited = !isReviewed && (visitedFiles?.has(node.path) ?? false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    return (
        <div>
            <button
                className={`group flex items-center gap-2 text-[11px] py-0.5 px-1 rounded text-left w-full transition-colors ${
                    isActiveFile
                        ? 'bg-[#0078d4]/10 dark:bg-[#3794ff]/10'
                        : 'hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]'
                }`}
                style={{ paddingLeft: `${depth * 12 + 4}px`, opacity: dimmed ? 0.4 : 1 }}
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
                {badge && (
                    <CategoryBadge
                        badge={badge}
                        testId={`tree-file-category-badge-${node.path}`}
                    />
                )}
                {badge?.hasCritical && (
                    <CriticalMarker testId={`tree-file-critical-marker-${node.path}`} />
                )}
                <ReviewStateIndicator
                    isReviewed={isReviewed}
                    isVisited={isVisited}
                    testIdReviewed={`tree-file-reviewed-${node.path}`}
                    testIdVisited={`tree-file-visited-${node.path}`}
                />
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
