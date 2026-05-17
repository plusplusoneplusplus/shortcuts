/**
 * Files Changed tab — left rail with file list (tree or flat), right
 * rail with the focused file diff. The two rails scroll
 * independently inside the Files tab so reviewers can browse the
 * file list while the diff stays anchored, and vice versa.
 *
 * Display rules for the file list:
 *  - Tree mode (default): folders are collapsible and single-child
 *    folder chains are collapsed into one row (e.g.
 *    `packages/coc/src/server`) so the basename of each file stays
 *    visible at a stable depth.
 *  - Flat mode: each row shows the basename prominently with the
 *    dirname rendered above it in muted small text.
 *
 * The file list, +/- counts, line numbers and the diff body all come
 * from the real `/api/repos/:repoId/pull-requests/:prId/diff` payload
 * (parsed by `unified-diff-parser`). File-scoped comment threads come
 * from the real `/threads` payload and render inline when the provider
 * exposes file/line context.
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import { cn } from '../../ui';
import type { ParsedDiffFile } from './unified-diff-parser';
import {
    buildFileTree,
    collectFolderPaths,
    splitPath,
    type FileTreeNode,
} from './file-tree';
import { formatTimestamp, type CommentThread, type PrComment } from './pr-utils';

interface PrFilesPanelProps {
    files: ParsedDiffFile[];
    /** Real provider comment threads keyed by repository-relative file path. */
    commentsByPath?: Record<string, CommentThread[] | undefined>;
}

type ViewMode = 'tree' | 'flat';

const STATUS_LABEL: Record<ParsedDiffFile['status'], string> = {
    added:    'Added',
    modified: 'Modified',
    deleted:  'Deleted',
    renamed:  'Renamed',
};

const STATUS_CLASS: Record<ParsedDiffFile['status'], string> = {
    added:    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    modified: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    deleted:  'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    renamed:  'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
};

export function PrFilesPanel({ files, commentsByPath }: PrFilesPanelProps) {
    const [search, setSearch] = useState('');
    const [viewMode, setViewMode] = useState<ViewMode>('tree');
    const [activePath, setActivePath] = useState<string>(files[0]?.path ?? '');

    // If the file list changes (e.g. PR detail reloaded), make sure the
    // active selection still exists.
    useEffect(() => {
        if (files.length === 0) {
            setActivePath('');
        } else if (!files.some(file => file.path === activePath)) {
            setActivePath(files[0].path);
        }
    }, [files, activePath]);

    const visibleFiles = useMemo(() => {
        if (!search.trim()) return files;
        const query = search.trim().toLowerCase();
        return files.filter(file => file.path.toLowerCase().includes(query));
    }, [files, search]);

    const focusedFile = useMemo(
        () => files.find(file => file.path === activePath) ?? null,
        [files, activePath],
    );

    // Tree is computed from the visible (post-filter) files so filter
    // and tree mode compose naturally — typing a query shrinks the
    // tree to the matching subset.
    const tree = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);

    // Default-expand every folder so the user immediately sees all
    // matching files; this set is recomputed whenever the tree shape
    // changes (new files, filter narrowed/cleared, …).
    const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
    useEffect(() => {
        // When the tree shape changes, drop any stale folder paths the
        // user previously collapsed so newly added folders are visible
        // by default.
        setCollapsedFolders(prev => {
            const allPaths = new Set(collectFolderPaths(tree));
            const next = new Set<string>();
            for (const p of prev) if (allPaths.has(p)) next.add(p);
            return next;
        });
    }, [tree]);

    function toggleFolder(path: string) {
        setCollapsedFolders(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }

    const showTree = viewMode === 'tree' && !search.trim();

    return (
        <div
            className="flex h-full min-h-0 flex-col gap-2 md:grid md:grid-cols-[224px_minmax(0,1fr)]"
            data-testid="pr-files-panel"
        >
            <aside
                className="flex min-h-0 flex-col overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
                data-testid="pr-file-list-panel"
            >
                <header className="flex min-h-[30px] shrink-0 items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                    <div className="flex items-center gap-1.5">
                        <h2 className="m-0 text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                            Changed files
                        </h2>
                        <span className="font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                            {files.length}
                        </span>
                    </div>
                    <div className="flex items-center gap-px" role="group" aria-label="File list view">
                        <button
                            type="button"
                            onClick={() => setViewMode('tree')}
                            aria-pressed={viewMode === 'tree'}
                            title="Tree view"
                            data-testid="pr-file-view-tree"
                            className={cn(
                                'inline-flex h-5 items-center justify-center rounded border px-1.5 text-[10px] font-semibold uppercase leading-none',
                                viewMode === 'tree'
                                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/40 dark:text-blue-200'
                                    : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700',
                            )}
                        >
                            Tree
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('flat')}
                            aria-pressed={viewMode === 'flat'}
                            title="Flat list"
                            data-testid="pr-file-view-flat"
                            className={cn(
                                'inline-flex h-5 items-center justify-center rounded border px-1.5 text-[10px] font-semibold uppercase leading-none',
                                viewMode === 'flat'
                                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/40 dark:text-blue-200'
                                    : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700',
                            )}
                        >
                            Flat
                        </button>
                    </div>
                </header>
                <div className="shrink-0 px-2 pt-2">
                    <input
                        type="text"
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        placeholder="Filter files by path"
                        className="min-h-[26px] w-full rounded-[5px] border border-gray-300 bg-white px-[7px] py-[3px] text-[12px] text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        data-testid="pr-file-search"
                    />
                </div>
                <div
                    className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1.5 font-mono text-[12px] leading-[1.4]"
                    data-testid="pr-file-list-scroll"
                >
                    {visibleFiles.length === 0 ? (
                        <p className="m-0 px-1.5 py-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                            {files.length === 0
                                ? 'No file changes in this pull request.'
                                : 'No files match the filter.'}
                        </p>
                    ) : showTree ? (
                        <FileTreeView
                            nodes={tree}
                            activePath={activePath}
                            onSelect={setActivePath}
                            collapsedFolders={collapsedFolders}
                            onToggleFolder={toggleFolder}
                            depth={0}
                        />
                    ) : (
                        <FlatFileList
                            files={visibleFiles}
                            activePath={activePath}
                            onSelect={setActivePath}
                        />
                    )}
                </div>
            </aside>
            <div
                className="min-h-0 flex-1 overflow-y-auto md:h-full"
                data-testid="pr-file-diff-panel"
            >
                {focusedFile && (
                    <FileDiffCard
                        file={focusedFile}
                        threads={getThreadsForFile(commentsByPath, focusedFile)}
                    />
                )}
                {!focusedFile && (
                    <div
                        className="rounded-[5px] border border-dashed border-gray-200 bg-white px-2 py-4 text-center text-[12px] text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400"
                        data-testid="pr-file-diff-empty"
                    >
                        Select a file from the list to see its diff.
                    </div>
                )}
            </div>
        </div>
    );
}

function getThreadsForFile(
    commentsByPath: PrFilesPanelProps['commentsByPath'],
    file: ParsedDiffFile,
): CommentThread[] {
    const byId = new Map<string | number, CommentThread>();
    for (const path of [file.path, file.oldPath]) {
        if (!path) continue;
        for (const thread of commentsByPath?.[path] ?? []) {
            byId.set(thread.id, thread);
        }
    }
    return [...byId.values()];
}

interface FlatFileListProps {
    files: ParsedDiffFile[];
    activePath: string;
    onSelect: (path: string) => void;
}

function FlatFileList({ files, activePath, onSelect }: FlatFileListProps) {
    return (
        <div className="grid gap-px">
            {files.map(file => {
                const { dirname, basename } = splitPath(file.path);
                const isActive = file.path === activePath;
                return (
                    <button
                        key={file.path}
                        type="button"
                        onClick={() => onSelect(file.path)}
                        className={cn(
                            'flex flex-col items-stretch gap-px rounded px-1.5 py-1 text-left',
                            isActive
                                ? 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100'
                                : 'text-gray-800 hover:bg-blue-50 dark:text-gray-200 dark:hover:bg-blue-900/30',
                        )}
                        data-testid="pr-file-row"
                        data-file-path={file.path}
                        title={file.path}
                    >
                        {dirname && (
                            <span className="truncate text-[10px] text-gray-500 dark:text-gray-400">
                                {dirname}/
                            </span>
                        )}
                        <span className="flex items-center justify-between gap-1.5">
                            <span className="truncate" data-testid="pr-file-basename">
                                {basename}
                            </span>
                            <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
                                <span className="text-green-700 dark:text-green-400">+{file.additions}</span>{' '}
                                <span className="text-red-700 dark:text-red-400">-{file.deletions}</span>
                            </span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

interface FileTreeViewProps {
    nodes: FileTreeNode[];
    activePath: string;
    onSelect: (path: string) => void;
    collapsedFolders: Set<string>;
    onToggleFolder: (path: string) => void;
    depth: number;
}

function FileTreeView({
    nodes,
    activePath,
    onSelect,
    collapsedFolders,
    onToggleFolder,
    depth,
}: FileTreeViewProps) {
    return (
        <div className="grid gap-px">
            {nodes.map(node => {
                if (node.kind === 'folder') {
                    const isCollapsed = collapsedFolders.has(node.path);
                    return (
                        <div key={`folder:${node.path}`}>
                            <button
                                type="button"
                                onClick={() => onToggleFolder(node.path)}
                                aria-expanded={!isCollapsed}
                                className="flex w-full items-center justify-between gap-1.5 rounded px-1.5 py-1 text-left text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/60"
                                style={{ paddingLeft: `${6 + depth * 10}px` }}
                                data-testid="pr-file-tree-folder"
                                data-folder-path={node.path}
                                data-collapsed={isCollapsed}
                            >
                                <span className="flex min-w-0 items-center gap-1">
                                    <span
                                        className="shrink-0 text-[9px] text-gray-400 dark:text-gray-500"
                                        aria-hidden="true"
                                    >
                                        {isCollapsed ? '▶' : '▼'}
                                    </span>
                                    <span className="truncate" title={node.path}>
                                        {node.name}
                                    </span>
                                </span>
                                <span className="shrink-0 text-[10px] text-gray-500 dark:text-gray-400">
                                    {node.fileCount}
                                </span>
                            </button>
                            {!isCollapsed && (
                                <FileTreeView
                                    nodes={node.children}
                                    activePath={activePath}
                                    onSelect={onSelect}
                                    collapsedFolders={collapsedFolders}
                                    onToggleFolder={onToggleFolder}
                                    depth={depth + 1}
                                />
                            )}
                        </div>
                    );
                }
                const isActive = node.path === activePath;
                return (
                    <button
                        key={`file:${node.path}`}
                        type="button"
                        onClick={() => onSelect(node.path)}
                        className={cn(
                            'flex items-center justify-between gap-1.5 rounded px-1.5 py-1 text-left',
                            isActive
                                ? 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100'
                                : 'text-gray-800 hover:bg-blue-50 dark:text-gray-200 dark:hover:bg-blue-900/30',
                        )}
                        style={{ paddingLeft: `${6 + depth * 10}px` }}
                        data-testid="pr-file-row"
                        data-file-path={node.path}
                        title={node.path}
                    >
                        <span className="truncate" data-testid="pr-file-basename">
                            {node.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">
                            <span className="text-green-700 dark:text-green-400">+{node.file.additions}</span>{' '}
                            <span className="text-red-700 dark:text-red-400">-{node.file.deletions}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}

interface FileDiffCardProps {
    file: ParsedDiffFile;
    threads: CommentThread[];
}

function FileDiffCard({ file, threads }: FileDiffCardProps) {
    const lineThreads = useMemo(() => groupThreadsByDiffLine(threads), [threads]);
    const fileLevelThreads = useMemo(
        () => threads.filter(thread => !resolveThreadLine(thread)),
        [threads],
    );

    return (
        <article
            className="mb-2 overflow-hidden rounded-[5px] border border-gray-200 bg-white last:mb-0 dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-file-diff-card"
        >
            <header className="flex min-h-[28px] items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-[5px] font-mono text-[12px] leading-[1.4] dark:border-gray-700 dark:bg-gray-800/60">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span
                        className={cn(
                            'inline-flex shrink-0 items-center rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-normal leading-[1.4]',
                            STATUS_CLASS[file.status],
                        )}
                        data-testid="pr-file-status"
                    >
                        {STATUS_LABEL[file.status]}
                    </span>
                    <strong className="truncate text-gray-900 dark:text-gray-100" title={file.path}>
                        {file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path}
                    </strong>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] tabular-nums">
                    {threads.length > 0 && (
                        <span className="text-blue-700 dark:text-blue-300" data-testid="pr-file-comment-count">
                            {threads.length} comment{threads.length === 1 ? '' : 's'}
                        </span>
                    )}
                    <span className="text-green-700 dark:text-green-400">+{file.additions}</span>
                    <span className="text-red-700 dark:text-red-400">-{file.deletions}</span>
                </div>
            </header>
            {fileLevelThreads.length > 0 && (
                <div className="border-b border-gray-100 bg-blue-50/60 px-2 py-1.5 dark:border-gray-700 dark:bg-blue-900/20">
                    {fileLevelThreads.map(thread => (
                        <InlineCommentThread key={thread.id} thread={thread} />
                    ))}
                </div>
            )}
            {file.isBinary ? (
                <div className="px-2 py-3 text-[11px] italic text-gray-500 dark:text-gray-400">
                    Binary file — diff omitted.
                </div>
            ) : file.lines.length === 0 ? (
                <div className="px-2 py-3 text-[11px] italic text-gray-500 dark:text-gray-400">
                    No textual diff content.
                </div>
            ) : (
                <div className="font-mono text-[12px] leading-[1.45]">
                    {file.lines.map((line, idx) => {
                        if (line.kind === 'hunk') {
                            return (
                                <div
                                    key={`hunk-${idx}`}
                                    className="border-y border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400"
                                    data-testid="pr-file-hunk-header"
                                >
                                    {line.text}
                                </div>
                            );
                        }
                        const lineNo = line.kind === 'del' ? line.oldLineNo : line.newLineNo;
                        const comments = getThreadsForDiffLine(lineThreads, line);
                        return (
                            <Fragment key={idx}>
                                <div
                                    className={cn(
                                        'grid min-h-[19px] items-start',
                                        line.kind === 'add' && 'bg-green-50 dark:bg-green-900/30',
                                        line.kind === 'del' && 'bg-red-50 dark:bg-red-900/30',
                                    )}
                                    style={{ gridTemplateColumns: '38px 1fr' }}
                                    data-testid={`pr-file-diff-line-${line.kind}`}
                                >
                                    <span className="border-r border-gray-200 px-1.5 py-px text-right text-gray-400 dark:border-gray-700 dark:text-gray-500">
                                        {lineNo ?? ''}
                                    </span>
                                    <span className="overflow-x-auto whitespace-pre px-[7px] py-px text-gray-800 dark:text-gray-200">
                                        {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                                        {line.text}
                                    </span>
                                </div>
                                {comments.length > 0 && (
                                    <div
                                        className="border-y border-blue-200 bg-blue-50/80 py-1 pl-[46px] pr-2 dark:border-blue-800 dark:bg-blue-900/20"
                                        data-testid="pr-file-inline-comments"
                                    >
                                        {comments.map(thread => (
                                            <InlineCommentThread key={thread.id} thread={thread} />
                                        ))}
                                    </div>
                                )}
                            </Fragment>
                        );
                    })}
                </div>
            )}
        </article>
    );
}

type DiffSide = 'left' | 'right';

function resolveThreadLine(thread: CommentThread): number | undefined {
    const line = thread.threadContext?.line ?? thread.threadContext?.endLine ?? thread.threadContext?.startLine;
    return typeof line === 'number' && Number.isFinite(line) && line > 0 ? line : undefined;
}

function resolveThreadSide(thread: CommentThread): DiffSide | undefined {
    const side = thread.threadContext?.side;
    if (side === 'left' || side === 'right') return side;
    return undefined;
}

function threadKey(side: DiffSide, line: number): string {
    return `${side}:${line}`;
}

function groupThreadsByDiffLine(threads: CommentThread[]): Map<string, CommentThread[]> {
    const buckets = new Map<string, CommentThread[]>();
    for (const thread of threads) {
        const line = resolveThreadLine(thread);
        if (!line) continue;
        const side = resolveThreadSide(thread);
        const sides: DiffSide[] = side ? [side] : ['right', 'left'];
        for (const s of sides) {
            const key = threadKey(s, line);
            const bucket = buckets.get(key) ?? [];
            bucket.push(thread);
            buckets.set(key, bucket);
        }
    }
    return buckets;
}

function getThreadsForDiffLine(
    buckets: Map<string, CommentThread[]>,
    line: ParsedDiffFile['lines'][number],
): CommentThread[] {
    if (line.kind === 'hunk') return [];
    const matches = new Map<string | number, CommentThread>();
    if (line.newLineNo != null) {
        for (const thread of buckets.get(threadKey('right', line.newLineNo)) ?? []) {
            matches.set(thread.id, thread);
        }
    }
    if (line.oldLineNo != null) {
        for (const thread of buckets.get(threadKey('left', line.oldLineNo)) ?? []) {
            matches.set(thread.id, thread);
        }
    }
    return [...matches.values()];
}

function InlineCommentThread({ thread }: { thread: CommentThread }) {
    return (
        <div
            className="mb-1.5 overflow-hidden rounded-[5px] border border-blue-200 bg-white text-[12px] last:mb-0 dark:border-blue-800 dark:bg-gray-900"
            data-testid="pr-file-real-comment"
        >
            <div className="flex items-center justify-between gap-2 border-b border-blue-100 bg-blue-50 px-2 py-1 dark:border-blue-900 dark:bg-blue-950/40">
                <span className="font-semibold text-blue-800 dark:text-blue-200">
                    Review comment
                </span>
                {thread.status && (
                    <span className="text-[10px] uppercase text-blue-600 dark:text-blue-300">
                        {thread.status}
                    </span>
                )}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {thread.comments.map(comment => (
                    <InlineComment key={comment.id} comment={comment} />
                ))}
            </div>
        </div>
    );
}

function InlineComment({ comment }: { comment: PrComment }) {
    const author = comment.author?.displayName ?? comment.author?.email ?? 'Unknown';
    return (
        <div className="px-2 py-1.5">
            <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                    @{author}
                </span>
                <span className="shrink-0 text-gray-400 dark:text-gray-500">
                    {formatTimestamp(comment.createdAt)}
                </span>
            </div>
            <p className="m-0 whitespace-pre-wrap text-[12px] leading-[1.35] text-gray-700 dark:text-gray-300">
                {comment.body}
            </p>
        </div>
    );
}
