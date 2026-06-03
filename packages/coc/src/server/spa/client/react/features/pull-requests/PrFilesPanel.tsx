/**
 * Files Changed tab — minimal read-only file list with AI action triggers.
 *
 * No inline diff rendering. Clicking a file opens the pop-out window
 * (#popout/git-review/pr/<prId>) with all PR files loaded into the
 * file-list rail for full diff review.
 *
 * Display rules for the file list:
 *  - Tree mode (default): folders are collapsible and single-child
 *    folder chains are collapsed into one row (e.g.
 *    `packages/coc/src/server`) so the basename of each file stays
 *    visible at a stable depth.
 *  - Flat mode: each row shows the basename prominently with the
 *    dirname rendered above it in muted small text.
 */

import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../ui';
import type { FileChange } from '../git/diff/FileTree';
import {
    buildFileTree,
    collectFolderPaths,
    splitPath,
    type FileTreeNode,
} from './file-tree';
import { SHOW_FOCUSED_DIFF } from '../../featureFlags';
import type { HunkCategory } from './classification-types';
import { HUNK_CATEGORIES, CATEGORY_LABELS } from './classification-types';
import type { UseClassificationReturn } from '../git/diff/useClassification';
import { useClassification } from '../git/diff/useClassification';
import type { ClassificationKey } from '../git/diff/diffSource';
import { useModalJobAiSelection } from '../../shared/ModalJobAiControls';
import { ClassifyDiffAiControls } from '../git/diff/ClassifyDiffAiControls';

export interface PrFilesPanelProps {
    files: FileChange[];
    /** When true (small viewports), the file list stacks vertically. */
    isMobile?: boolean;
    /** Workspace ID — enables classification and scoped AI provider preference. */
    workspaceId?: string;
    /** Classification key — enables focused-diff filter bar when provided. */
    classificationKey?: ClassificationKey;
    /** Called when user clicks a file — opens pop-out for diff review. */
    onFileClick?: (filePath: string) => void;
}

type ViewMode = 'tree' | 'flat';

const STATUS_LABEL: Record<string, string> = {
    A: 'Added',
    M: 'Modified',
    D: 'Deleted',
    R: 'Renamed',
    added:    'Added',
    modified: 'Modified',
    deleted:  'Deleted',
    renamed:  'Renamed',
};

const STATUS_CLASS: Record<string, string> = {
    A: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    M: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    D: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    R: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
    added:    'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
    modified: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    deleted:  'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    renamed:  'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200',
};

// ── Classification badge dots ────────────────────────────────────────

const BADGE_COLORS: Record<HunkCategory, string> = {
    logic: 'text-orange-500 dark:text-orange-400',
    mechanical: 'text-gray-400 dark:text-gray-500',
    test: 'text-blue-500 dark:text-blue-400',
    generated: 'text-purple-500 dark:text-purple-400',
};

function ClassificationBadge({ category, intensity }: { category: HunkCategory; intensity: 'high' | 'low' }) {
    const color = BADGE_COLORS[category];
    const filled = intensity === 'high' ? 2 : 1;
    return (
        <span
            className={cn('ml-1 shrink-0 text-[10px] tracking-tight', color)}
            title={`${CATEGORY_LABELS[category]} (${intensity})`}
            data-testid="classification-badge"
        >
            {filled >= 1 ? '●' : '○'}{filled >= 2 ? '●' : '○'}
        </span>
    );
}

// ── Classification info popover ──────────────────────────────────────

const CATEGORY_DESCRIPTIONS: Record<HunkCategory, string> = {
    logic: 'Behavior changes — new features, bug fixes, conditional changes',
    mechanical: 'Refactors, renames, moves, signature cascades with no behavior change',
    test: 'Test file additions/updates, fixtures, mocks',
    generated: 'Lock files, codegen output, auto-formatted files',
};

function ClassificationInfoPopover({ onClose }: { onClose: () => void }) {
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') onClose();
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-40"
                onClick={onClose}
                data-testid="classification-info-backdrop"
            />
            {/* Popover */}
            <div
                role="dialog"
                aria-label="Classification Guide"
                className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-gray-200 bg-white p-3 shadow-lg dark:border-gray-600 dark:bg-gray-800"
                data-testid="classification-info-popover"
            >
                <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-800 dark:text-gray-100">Classification Guide</span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        aria-label="Close"
                        data-testid="classification-info-close"
                    >
                        ✕
                    </button>
                </div>
                <p className="mb-2 text-[10px] text-gray-500 dark:text-gray-400">
                    AI classifies each @@ hunk by change type:
                </p>
                <ul className="space-y-1.5">
                    {HUNK_CATEGORIES.map(cat => (
                        <li key={cat} className="text-[11px]">
                            <span className={cn('font-medium', BADGE_COLORS[cat])}>
                                ● {CATEGORY_LABELS[cat]}
                            </span>
                            <br />
                            <span className="ml-3 text-[10px] text-gray-500 dark:text-gray-400">
                                {CATEGORY_DESCRIPTIONS[cat]}
                            </span>
                        </li>
                    ))}
                </ul>
                <div className="mt-2 border-t border-gray-200 pt-2 text-[10px] text-gray-500 dark:border-gray-600 dark:text-gray-400">
                    <p><span className="font-medium">Intensity:</span> ●● high &nbsp; ●○ low</p>
                    <p className="mt-0.5">Dimmed hunks are in unchecked categories.</p>
                </div>
            </div>
        </>
    );
}

// ── Classification filter bar ───────────────────────────────────────

interface ClassificationFilterBarProps {
    classification: UseClassificationReturn;
    aiSelection: ReturnType<typeof useModalJobAiSelection>;
}

function ClassificationFilterBar({ classification, aiSelection }: ClassificationFilterBarProps) {
    const { state, classify, toggleFilter, setFilters } = classification;
    const { status, activeFilters, error } = state;
    const isLoading = status === 'loading';
    const isReady = status === 'ready';
    const [showInfo, setShowInfo] = useState(false);

    return (
        <div
            className="relative flex shrink-0 flex-wrap items-center gap-1.5 border-b border-gray-200 bg-gray-50/70 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/40"
            data-testid="classification-filter-bar"
        >
            {/* AI provider / effort-tier / model controls */}
            <ClassifyDiffAiControls
                selection={aiSelection}
                disabled={isLoading}
                testIdPrefix="classify"
            />

            {/* Classify button */}
            <button
                type="button"
                onClick={classify}
                disabled={isLoading}
                className={cn(
                    'inline-flex h-[22px] items-center gap-1 rounded border px-1.5 text-[10px] font-semibold uppercase leading-none',
                    isLoading
                        ? 'cursor-wait border-gray-300 bg-gray-100 text-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-500'
                        : 'border-indigo-400 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500 dark:bg-indigo-900/30 dark:text-indigo-200 dark:hover:bg-indigo-900/50',
                )}
                data-testid="classify-button"
            >
                {isLoading ? (
                    <>
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Classifying…
                    </>
                ) : isReady ? (
                    'Re-classify'
                ) : (
                    'Classify'
                )}
            </button>

            {/* Category checkboxes (shown once results are available) */}
            {isReady && (
                <>
                    <span className="mx-0.5 h-3 w-px bg-gray-300 dark:bg-gray-600" />
                    {HUNK_CATEGORIES.map(cat => (
                        <label
                            key={cat}
                            className={cn('inline-flex cursor-pointer items-center gap-0.5 text-[11px] font-medium', BADGE_COLORS[cat])}
                            data-testid={`classification-filter-label-${cat}`}
                        >
                            <input
                                type="checkbox"
                                checked={activeFilters.has(cat)}
                                onChange={() => toggleFilter(cat)}
                                className="h-3 w-3 rounded border-gray-300 text-indigo-500 focus:ring-indigo-500 dark:border-gray-600"
                                data-testid={`classification-filter-${cat}`}
                            />
                            {CATEGORY_LABELS[cat]}
                        </label>
                    ))}
                    <button
                        type="button"
                        onClick={() => setFilters(new Set(HUNK_CATEGORIES))}
                        className="ml-0.5 text-[10px] text-indigo-600 hover:underline dark:text-indigo-300"
                        data-testid="classification-filter-all"
                    >
                        All
                    </button>
                </>
            )}

            {/* Error indicator */}
            {status === 'error' && error && (
                <span className="text-[10px] text-red-600 dark:text-red-400" data-testid="classify-error">
                    {error}
                </span>
            )}

            {/* Info icon */}
            <button
                type="button"
                onClick={() => setShowInfo(!showInfo)}
                className="ml-auto inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                aria-label="Classification info"
                data-testid="classification-info-button"
            >
                ⓘ
            </button>

            {showInfo && <ClassificationInfoPopover onClose={() => setShowInfo(false)} />}
        </div>
    );
}

// ── Main component ──────────────────────────────────────────────────

export function PrFilesPanel({ files, isMobile = false, workspaceId, classificationKey, onFileClick }: PrFilesPanelProps) {
    const [search, setSearch] = useState('');
    const [viewMode, setViewMode] = useState<ViewMode>('tree');

    const aiSelection = useModalJobAiSelection({ workspaceId, mode: 'ask' });
    const classificationHook = useClassification(classificationKey, aiSelection.resolved, { workspaceId });
    const classification: UseClassificationReturn | undefined = SHOW_FOCUSED_DIFF && classificationKey ? classificationHook : undefined;
    const [activePath, setActivePath] = useState<string>(files[0]?.path ?? '');

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

    const showTree = viewMode === 'tree' && !search.trim();
    const tree = useMemo(() => buildFileTree(visibleFiles), [visibleFiles]);

    const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
    useEffect(() => {
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

    function handleFileSelect(path: string) {
        setActivePath(path);
        onFileClick?.(path);
    }

    return (
        <div
            className={cn(
                'flex h-full min-h-0',
                isMobile ? 'flex-col' : 'flex-col',
            )}
            data-testid="pr-files-panel"
        >
            <div
                className="flex min-h-0 w-full flex-col overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
                data-testid="pr-file-list-panel"
            >
                <header className="flex min-h-[30px] shrink-0 flex-wrap items-center justify-between gap-x-1.5 gap-y-1 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <h2 className="m-0 truncate text-[13px] font-semibold leading-tight text-gray-900 dark:text-gray-100">
                            Changed files
                        </h2>
                        <span className="font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
                            {files.length}
                        </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-px" role="group" aria-label="File list view">
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
                {SHOW_FOCUSED_DIFF && classification && (
                    <ClassificationFilterBar classification={classification} aiSelection={aiSelection} />
                )}
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
                    className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2 pt-1.5 font-mono text-[12px] leading-[1.4]"
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
                            onSelect={handleFileSelect}
                            collapsedFolders={collapsedFolders}
                            onToggleFolder={toggleFolder}
                            depth={0}
                            classification={classification}
                        />
                    ) : (
                        <FlatFileList
                            files={visibleFiles}
                            activePath={activePath}
                            onSelect={handleFileSelect}
                            classification={classification}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

// ── File list views ─────────────────────────────────────────────────

interface FlatFileListProps {
    files: FileChange[];
    activePath: string;
    onSelect: (path: string) => void;
    classification?: UseClassificationReturn;
}

function FlatFileList({ files, activePath, onSelect, classification }: FlatFileListProps) {
    return (
        <div className="grid min-w-0 gap-px">
            {files.map(file => {
                const { dirname, basename } = splitPath(file.path);
                const isActive = file.path === activePath;
                const isDimmed = classification?.isFileDimmed(file.path) ?? false;
                return (
                    <button
                        key={file.path}
                        type="button"
                        onClick={() => onSelect(file.path)}
                        className={cn(
                            'flex min-w-0 flex-col items-stretch gap-px rounded px-1.5 py-1 text-left',
                            isActive
                                ? 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100'
                                : 'text-gray-800 hover:bg-blue-50 dark:text-gray-200 dark:hover:bg-blue-900/30',
                            isDimmed && 'opacity-40',
                        )}
                        data-testid="pr-file-row"
                        data-file-path={file.path}
                        data-file-dimmed={isDimmed || undefined}
                        title={file.path}
                    >
                        {dirname && (
                            <span className="truncate text-[10px] text-gray-500 dark:text-gray-400">
                                {dirname}/
                            </span>
                        )}
                        <span className="flex min-w-0 items-center justify-between gap-1.5">
                            <span className="min-w-0 flex-1 truncate" data-testid="pr-file-basename">
                                {basename}
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                                {(() => {
                                    const badge = classification?.getFileBadge(file.path);
                                    return badge ? <ClassificationBadge category={badge.category} intensity={badge.intensity} /> : null;
                                })()}
                                {file.status && (
                                    <span
                                        className={cn(
                                            'inline-flex shrink-0 items-center rounded-full px-1 py-px text-[9px] font-semibold uppercase tracking-normal leading-[1.4]',
                                            STATUS_CLASS[file.status] ?? '',
                                        )}
                                        data-testid="pr-file-status"
                                    >
                                        {STATUS_LABEL[file.status] ?? file.status}
                                    </span>
                                )}
                                <span className="text-green-700 dark:text-green-400">+{file.additions ?? 0}</span>{' '}
                                <span className="text-red-700 dark:text-red-400">-{file.deletions ?? 0}</span>
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
    classification?: UseClassificationReturn;
}

function FileTreeView({
    nodes,
    activePath,
    onSelect,
    collapsedFolders,
    onToggleFolder,
    depth,
    classification,
}: FileTreeViewProps) {
    return (
        <div className="grid min-w-0 gap-px">
            {nodes.map(node => {
                if (node.kind === 'folder') {
                    const isCollapsed = collapsedFolders.has(node.path);
                    return (
                        <div key={`folder:${node.path}`} className="min-w-0">
                            <button
                                type="button"
                                onClick={() => onToggleFolder(node.path)}
                                aria-expanded={!isCollapsed}
                                className="flex w-full min-w-0 items-center justify-between gap-1.5 rounded px-1.5 py-1 text-left text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800/60"
                                style={{ paddingLeft: `${6 + depth * 10}px` }}
                                data-testid="pr-file-tree-folder"
                                data-folder-path={node.path}
                                data-collapsed={isCollapsed}
                            >
                                <span className="flex min-w-0 flex-1 items-center gap-1">
                                    <span
                                        className="shrink-0 text-[9px] text-gray-400 dark:text-gray-500"
                                        aria-hidden="true"
                                    >
                                        {isCollapsed ? '▶' : '▼'}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate" title={node.path}>
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
                                    classification={classification}
                                />
                            )}
                        </div>
                    );
                }
                const isActive = node.path === activePath;
                const isDimmed = classification?.isFileDimmed(node.path) ?? false;
                return (
                    <button
                        key={`file:${node.path}`}
                        type="button"
                        onClick={() => onSelect(node.path)}
                        className={cn(
                            'flex min-w-0 items-center justify-between gap-1.5 rounded px-1.5 py-1 text-left',
                            isActive
                                ? 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100'
                                : 'text-gray-800 hover:bg-blue-50 dark:text-gray-200 dark:hover:bg-blue-900/30',
                            isDimmed && 'opacity-40',
                        )}
                        style={{ paddingLeft: `${6 + depth * 10}px` }}
                        data-testid="pr-file-row"
                        data-file-path={node.path}
                        data-file-dimmed={isDimmed || undefined}
                        title={node.path}
                    >
                        <span className="min-w-0 flex-1 truncate" data-testid="pr-file-basename">
                            {node.name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                            {(() => {
                                const badge = classification?.getFileBadge(node.path);
                                return badge ? <ClassificationBadge category={badge.category} intensity={badge.intensity} /> : null;
                            })()}
                            <span className="text-green-700 dark:text-green-400">+{node.file.additions ?? 0}</span>{' '}
                            <span className="text-red-700 dark:text-red-400">-{node.file.deletions ?? 0}</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
