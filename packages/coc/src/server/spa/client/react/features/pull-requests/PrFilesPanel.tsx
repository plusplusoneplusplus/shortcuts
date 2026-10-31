/** PR file metadata and actions adapt to the shared review navigator; diff transport stays provider-owned. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../ui';
import type { FileChange } from '../git/diff/FileTree';
import { SideBySideDiffViewer } from '../git/diff/SideBySideDiffViewer';
import type { DiffLine, UnifiedDiffViewerHandle } from '../git/diff/UnifiedDiffViewer';
import { DiffFindWidget } from '../git/diff/DiffFindWidget';
import { useDiffFind } from '../git/diff/useDiffFind';
import { useDiffFindShortcut } from '../git/diff/useDiffFindShortcut';
import { extractFileDiffFromCombined } from '../git/diff/diffSource';
import { SHOW_FOCUSED_DIFF } from '../../featureFlags';
import type { HunkCategory } from './classification-types';
import { HUNK_CATEGORIES, CATEGORY_LABELS } from './classification-types';
import type { UseClassificationReturn } from '../git/diff/useClassification';
import { useClassification } from '../git/diff/useClassification';
import type { ClassificationKey, DiffSource } from '../git/diff/diffSource';
import { FileDiffPanel, type ReviewContentSearchTarget } from '../git/diff/FileDiffPanel';
import { useReviewContentSearchController } from '../git/diff/useReviewContentSearchController';
import { reviewFileKey } from '../git/diff/gitReviewFiles';
import { useFileDiffEngineState } from '../git/hooks/useFileDiffEngineState';
import { ReviewFiles, type ReviewFileRenderContext } from '../git/diff/ReviewFiles';
import { useCloneBaseUrl } from '../../repos/cloneRouting';
import { usePrReviewProgress } from '../git/diff/usePrReviewProgress';
import type { ReviewProgressClientKey } from '../git/diff/reviewProgressApi';
import { useModalJobAiSelection } from '../../shared/ModalJobAiControls';
import { ClassifyDiffAiControls } from '../git/diff/ClassifyDiffAiControls';

export interface PrFilesPanelProps {
    files: FileChange[];
    /**
     * Combined unified diff text for the whole PR. Sliced per-file (lazily,
     * for the selected file only) to drive the inline diff panel. When
     * omitted/empty the panel shows a prompt instead of a diff.
     */
    diffText?: string;
    /** When true (small viewports), the split stacks vertically. */
    isMobile?: boolean;
    /** Workspace ID — enables classification and scoped AI provider preference. */
    workspaceId?: string;
    /** Concrete clone owner used for selection attachment routing. */
    attachmentDestinationId?: string;
    /** Classification key — enables focused-diff filter bar when provided. */
    classificationKey?: ClassificationKey;
    /** Explicit pop-out action — opens the separate review window for the file. */
    onPopOut?: (filePath: string) => void;
    /**
     * PR diff source. When supplied (and not on mobile) the right pane renders
     * the shared {@link FileDiffPanel} — the same component the pop-out review
     * window uses — so the inline tab gets split/unified, full-file context,
     * minimap, hunk navigation, inline comments and mark-reviewed.
     *
     * Without it (or on mobile) the slim `SideBySideDiffViewer` panel sliced
     * from `diffText` is rendered instead.
     */
    diffSource?: DiffSource;
    /** PR head SHA — scopes review progress; changing it resets reviewed/visited. */
    headSha?: string;
    /**
     * Persistence key for review progress. Must be the SAME key the pop-out
     * review window uses ({originId, workspaceId, repoId, prId}) so reviewed
     * state is shared between the two surfaces by construction. Omit to keep
     * progress in-memory only.
     */
    reviewPersistence?: ReviewProgressClientKey;
}

// ── Classification badge dots ────────────────────────────────────────

const BADGE_COLORS: Record<HunkCategory, string> = {
    logic: 'text-orange-500 dark:text-orange-400',
    mechanical: 'text-gray-400 dark:text-gray-500',
    test: 'text-blue-500 dark:text-blue-400',
    simple: 'text-sky-500 dark:text-sky-400',
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
    simple: 'Straightforward deterministic functions with no I/O, branching, or side effects',
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

/** Reset all transient selection, classification and progress on exact owner/comparison changes. */
export function PrFilesPanel(props: PrFilesPanelProps) {
    const endpoint = useCloneBaseUrl(props.attachmentDestinationId ?? props.diffSource?.routingTarget ?? props.workspaceId);
    const identity = JSON.stringify([props.workspaceId, props.attachmentDestinationId, endpoint, props.diffSource?.routingTarget,
        props.diffSource?.cacheKey, props.diffSource?.fileContextRefs, props.headSha, props.reviewPersistence, props.classificationKey]);
    return <PrFilesBody key={identity} {...props} identity={identity} />;
}

function PrFilesBody({
    files,
    diffText,
    isMobile = false,
    workspaceId,
    attachmentDestinationId,
    classificationKey,
    onPopOut,
    diffSource,
    headSha,
    reviewPersistence,
    identity,
}: PrFilesPanelProps & { identity: string }) {
    const aiSelection = useModalJobAiSelection({ workspaceId, mode: 'ask' });
    const classificationHook = useClassification(classificationKey, aiSelection.resolved, { workspaceId });
    const [activePath, setActivePath] = useState<string>(files[0]?.path ?? '');
    const [contentSearchTarget, setContentSearchTarget] = useState<ReviewContentSearchTarget>();
    const fetchFileContent = diffSource?.fetchFileContent;
    const controller = useReviewContentSearchController(identity, files.map(file => ({ id: reviewFileKey(file), path: file.path })),
        fetchFileContent ? file => fetchFileContent(file.path) : undefined, diffText);
    useEffect(() => setContentSearchTarget(undefined), [controller]);
    const { classificationEnabled, onDiffEngineChange } = useFileDiffEngineState(
        !isMobile && diffSource && workspaceId && activePath
            ? `${workspaceId}\u0000${diffSource.cacheKey}\u0000${activePath}` : null,
    );
    const classification: UseClassificationReturn | undefined =
        SHOW_FOCUSED_DIFF && classificationKey && classificationEnabled ? classificationHook : undefined;

    // Review progress — same hook and same persistence key as the pop-out review
    // window, so marking a file reviewed here shows up there and vice versa.
    const reviewProgressOptions = useMemo(
        () => (reviewPersistence ? { persistence: reviewPersistence } : undefined),
        [reviewPersistence],
    );
    const reviewProgress = usePrReviewProgress(headSha, reviewProgressOptions);
    const { markVisited, setLastSelectedFile, isReviewed, toggleReviewed } = reviewProgress;

    // Whatever file the diff pane is showing counts as visited (the inline tab
    // auto-selects the first file, so there is no "nothing selected" state to
    // wait for like the pop-out has). Wait for hydration first — the fetched
    // record replaces the sets wholesale, so marking before it lands would be
    // silently overwritten.
    const progressHydrated = reviewProgress.state.hydrated;
    useEffect(() => {
        if (!progressHydrated) return;
        if (activePath) markVisited(activePath);
        setLastSelectedFile(activePath || null);
    }, [activePath, progressHydrated, markVisited, setLastSelectedFile]);

    // Desktop renders the shared FileDiffPanel (full review chrome); mobile
    // keeps the slim viewer so the stacked layout stays light.
    const useSharedPanel = (!isMobile || !!contentSearchTarget) && !!diffSource && !!workspaceId;

    const classificationReady = classification?.state.status === 'ready';
    function renderDiff({ file, paths, select, target, toggleViewed }: ReviewFileRenderContext) {
        if (useSharedPanel && diffSource && workspaceId) {
            return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="pr-shared-diff-panel">
                <FileDiffPanel key={`pr-${diffSource.cacheKey}-${file.path}`} workspaceId={workspaceId}
                    attachmentDestinationId={attachmentDestinationId} filePath={file.path}
                    source={{ ...diffSource, files: paths, fetchFileList: undefined }} showSourceLabel={false} onNavigateToFile={select}
                    initialHunkTarget={target} contentSearchTarget={contentSearchTarget} onDiffEngineChange={onDiffEngineChange}
                    headerActions={<PrPopOutButton filePath={file.path} onPopOut={onPopOut} />}
                    isReviewed={isReviewed(file.path)} onToggleReviewed={toggleViewed}
                    getHunkClassification={classificationReady ? classification!.getHunkClassification : undefined}
                    hunkActiveFilters={classificationReady ? classification!.state.activeFilters : undefined} />
            </div>;
        }
        return <PrInlineDiffPanel key={file.path} filePath={file.path}
            diff={diffText ? extractFileDiffFromCombined(diffText, file.path) : null}
            hasFiles={files.length > 0} onPopOut={onPopOut} />;
    }
    return <div className="flex h-full min-h-0 min-w-0 flex-1" data-testid="pr-files-panel">
        <ReviewFiles identity={identity} files={files} defaultView="tree" selectedPath={activePath}
            onSelect={path => { setContentSearchTarget(undefined); setActivePath(path); }}
            contentSearch={controller && workspaceId ? { controller, onOpenMatch: (file, match) => setContentSearchTarget({ ...match, filePath: file.path }) } : undefined}
            reviewedFiles={reviewProgress.state.reviewedFiles} onToggleReviewed={toggleReviewed}
            header={{ below: classification ? <ClassificationFilterBar classification={classification} aiSelection={aiSelection} /> : undefined }}
            isFileDimmed={classification?.isFileDimmed}
            rowDetails={file => {
                const badge = classification?.getFileBadge(file.path);
                return <>
                    {!isReviewed(file.path) && <PrReviewMark path={file.path} visitedFiles={reviewProgress.state.visitedFiles} />}
                    {badge && <ClassificationBadge category={badge.category} intensity={badge.intensity} />}
                </>;
            }}
            renderFile={renderDiff}
            renderEmpty={<PrInlineDiffPanel filePath="" diff={null} hasFiles={files.length > 0} onPopOut={onPopOut} />} />
    </div>;
}

/** "Pop out" action — shared by the slim inline header and FileDiffPanel's header slot. */
function PrPopOutButton({ filePath, onPopOut }: { filePath: string; onPopOut?: (filePath: string) => void }) {
    if (!onPopOut || !filePath) return null;
    return (
        <button
            type="button"
            onClick={() => onPopOut(filePath)}
            title="Open this file in the pop-out review window"
            className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-gray-300 bg-white px-1.5 text-[10px] font-semibold uppercase leading-none text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            data-testid="pr-diff-popout"
        >
            ⧉ Pop out
        </button>
    );
}

// ── Inline diff panel ────────────────────────────────────────────────

interface PrInlineDiffPanelProps {
    /** Path of the currently selected file (drives the diff shown). */
    filePath: string;
    /** Per-file diff slice for the selected file, or null when unavailable. */
    diff: string | null;
    /** Whether the PR has any changed files (drives the empty-state copy). */
    hasFiles: boolean;
    onPopOut?: (filePath: string) => void;
}

/**
 * Slim right-hand panel — the mobile / no-source fallback. Renders the
 * selected file's diff with the shared {@link SideBySideDiffViewer} sliced from
 * the combined diff, so the stacked mobile layout stays light and needs no
 * per-file fetch. Desktop uses {@link FileDiffPanel} instead.
 */
function PrInlineDiffPanel({ filePath, diff, hasFiles, onPopOut }: PrInlineDiffPanelProps) {
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    // Search scope is exactly what the viewer rendered for the selected file —
    // `onLinesReady` reports that model, so the "N of M" count always matches
    // what the user can see.
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);

    const scrollActiveMatchIntoView = useCallback((lineIndex: number) => {
        viewerRef.current?.scrollLineIntoView(lineIndex);
    }, []);
    const find = useDiffFind(diffLines, scrollActiveMatchIntoView);
    useDiffFindShortcut(scrollContainerRef, find.openFind);

    return (
        <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[5px] border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
            data-testid="pr-diff-panel"
        >
            <header className="flex min-h-[30px] shrink-0 items-center justify-between gap-1.5 border-b border-gray-200 bg-gray-50 px-2 py-1 dark:border-gray-700 dark:bg-gray-800/60">
                <span
                    className="min-w-0 truncate font-mono text-[12px] text-gray-700 dark:text-gray-300"
                    title={filePath || undefined}
                    data-testid="pr-diff-panel-path"
                >
                    {filePath || 'Diff'}
                </span>
                <PrPopOutButton filePath={filePath} onPopOut={onPopOut} />
            </header>
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                {/* ── In-diff find widget (Ctrl/Cmd+F) ── */}
                {find.open && diff && (
                    <DiffFindWidget
                        query={find.query}
                        caseSensitive={find.caseSensitive}
                        matchCount={find.matchCount}
                        activeIndex={find.activeIndex}
                        onQueryChange={find.setQuery}
                        onToggleCaseSensitive={find.toggleCaseSensitive}
                        onNext={find.goToNext}
                        onPrev={find.goToPrev}
                        onClose={find.closeFind}
                    />
                )}
                <div
                    ref={scrollContainerRef}
                    className="min-h-0 min-w-0 flex-1 overflow-auto p-1.5 outline-none"
                    data-testid="pr-diff-panel-scroll"
                    tabIndex={-1}
                >
                    {diff ? (
                        <SideBySideDiffViewer
                            ref={viewerRef}
                            diff={diff}
                            fileName={filePath}
                            showLineNumbers
                            onLinesReady={setDiffLines}
                            matchRangesByLine={find.matchRangesByLine}
                            data-testid="pr-inline-diff"
                        />
                    ) : (
                        <div
                            className="flex h-full items-center justify-center px-3 py-6 text-center text-[12px] text-gray-500 dark:text-gray-400"
                            data-testid="pr-diff-panel-empty"
                        >
                            {hasFiles
                                ? 'Select a file to view its diff.'
                                : 'No file changes in this pull request.'}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ── File list views ─────────────────────────────────────────────────

/**
 * Reviewed / visited mark for a file row — mirrors the pop-out file panel's
 * indicator (✓ reviewed, • visited-but-not-reviewed, nothing otherwise).
 */
function PrReviewMark({ path, visitedFiles }: { path: string; visitedFiles: ReadonlySet<string> }) {
    return visitedFiles.has(path) ? <span className="shrink-0 text-[11px] text-gray-400" title="Visited (not reviewed)"
        data-testid={`pr-file-visited-${path}`}>•</span> : null;
}
