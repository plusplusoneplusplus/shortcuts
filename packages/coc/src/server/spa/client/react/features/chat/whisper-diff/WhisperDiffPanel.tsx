/**
 * WhisperDiffPanel — inner chrome for the transient read-only whisper diff
 * panel (AC-03).
 *
 * Two modes share the same docked slot, chosen by `state.combined`:
 *
 *  - Single-file (the default): the header shows the clicked file's name + its
 *    project-relative path, and the body renders the four explicit states
 *    produced by `useWhisperDiffState` (loading / success / empty / error).
 *  - Combined ("All changes"): the header shows "All changes" + "N files (+X −Y)"
 *    totals, and the body renders every reconstructable file's diff in one scroll
 *    — each under a filename divider — followed by a trailing "not shown" list of
 *    the group's deleted / non-reconstructable files. The empty case (nothing
 *    reconstructable) shows the same no-diff message rather than a blank body.
 *
 * This is a read-only surface in both modes: no copy/reveal/comments/Ask-AI, no
 * save, and no canvas record is ever written. Layout (docked column vs mobile
 * BottomSheet) and resizing are owned by the host (`WhisperDiffDock`); this is
 * inner chrome.
 */
import { Spinner } from '../../../ui/Spinner';
import { UnifiedDiffViewer } from '../../git/diff/UnifiedDiffViewer';
import { getSourceCanvasDisplayPath } from '../source-canvas/resolve';
import type { FileEdit } from '../conversation/tool-calls/toolGroupUtils';
import type { CombinedWhisperDiffView, WhisperDiffState } from './useWhisperDiffState';

function basename(p: string): string {
    const normalized = p.replace(/\\/g, '/');
    return normalized.split('/').pop() || p;
}

/** "N files (+X −Y)" — mirrors the popover footer's totals formatting. */
function combinedTotalsLabel(combined: CombinedWhisperDiffView): string {
    const { fileCount, totalInsertions, totalDeletions } = combined;
    const parts: string[] = [];
    if (totalInsertions > 0) parts.push(`+${totalInsertions}`);
    if (totalDeletions > 0) parts.push(`−${totalDeletions}`);
    const totals = parts.length ? ` (${parts.join(' ')})` : '';
    return `${fileCount} file${fileCount !== 1 ? 's' : ''}${totals}`;
}

const headerBtnClass =
    'shrink-0 flex items-center justify-center w-8 h-8 rounded text-[#848484] ' +
    'hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.06] dark:hover:bg-white/[0.08]';

export interface WhisperDiffPanelProps {
    /**
     * The clicked file's edit summary — drives the single-file header. Absent in
     * combined mode (the header is derived from `state.combined` instead).
     */
    file?: FileEdit | null;
    /** Renderable diff state from `useWhisperDiffState`. */
    state: WhisperDiffState;
    /** Current workspace root, used to show a project-relative path in the header. */
    workspaceRootPath?: string | null;
    /** Close the panel (X button). */
    onClose: () => void;
}

export function WhisperDiffPanel({
    file,
    state,
    workspaceRootPath,
    onClose,
}: WhisperDiffPanelProps) {
    const combined = state.combined;

    // ── Header (single-file vs combined) ──────────────────────────────────────
    let headerTitle: string;
    let headerSubtitle: string;
    let headerSubtitleTitle: string | undefined;
    let headerSubtitleTestId: string;
    if (combined) {
        headerTitle = 'All changes';
        headerSubtitle = combinedTotalsLabel(combined);
        headerSubtitleTitle = undefined;
        headerSubtitleTestId = 'whisper-diff-totals';
    } else {
        const fullPath = file?.path ?? '';
        const relPath = getSourceCanvasDisplayPath(fullPath, workspaceRootPath);
        headerTitle = basename(relPath) || 'Diff';
        headerSubtitle = relPath;
        headerSubtitleTitle = fullPath;
        headerSubtitleTestId = 'whisper-diff-path';
    }

    // `idle` only shows for the single render between the panel opening and the
    // diff effect resolving — treat it as loading so the body never flashes blank.
    const status = state.status === 'idle' ? 'loading' : state.status;

    return (
        <div
            className="flex flex-col h-full min-h-0 overflow-hidden bg-white dark:bg-[#1e1e1e]"
            data-testid="whisper-diff-panel"
        >
            <div className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div
                        className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate"
                        data-testid="whisper-diff-filename"
                    >
                        {headerTitle}
                    </div>
                    <div
                        className="text-xs text-[#848484] truncate mt-0.5"
                        title={headerSubtitleTitle}
                        data-testid={headerSubtitleTestId}
                    >
                        {headerSubtitle}
                    </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        type="button"
                        data-testid="whisper-diff-close-btn"
                        onClick={onClose}
                        className={headerBtnClass}
                        aria-label="Close"
                    >
                        ✕
                    </button>
                </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto" data-testid="whisper-diff-body">
                {combined ? (
                    <CombinedDiffBody
                        combined={combined}
                        status={status}
                        error={state.error}
                        workspaceRootPath={workspaceRootPath}
                    />
                ) : (
                    <SingleFileDiffBody
                        status={status}
                        diffText={state.diffText}
                        error={state.error}
                        fileName={headerTitle}
                    />
                )}
            </div>
        </div>
    );
}

function SingleFileDiffBody({
    status,
    diffText,
    error,
    fileName,
}: {
    status: WhisperDiffState['status'];
    diffText: string;
    error: string;
    fileName: string;
}) {
    return (
        <>
            {status === 'loading' && (
                <div
                    className="flex items-center gap-2 p-4 text-xs text-[#848484]"
                    data-testid="whisper-diff-loading"
                >
                    <Spinner size="sm" /> Loading diff for {fileName}…
                </div>
            )}
            {status === 'error' && (
                <div className="p-4 text-xs" data-testid="whisper-diff-error">
                    <div className="font-medium text-[#cc4444] dark:text-[#f48771]">
                        {`Couldn't load the diff for ${fileName}`}
                    </div>
                    {error && <div className="mt-1 text-[#848484]">{error}</div>}
                </div>
            )}
            {status === 'empty' && (
                <div className="p-4 text-xs text-[#848484]" data-testid="whisper-diff-empty">
                    {error || 'No diff is available for this file.'}
                </div>
            )}
            {status === 'success' && (
                <div className="p-2">
                    <UnifiedDiffViewer
                        diff={diffText}
                        fileName={fileName}
                        showLineNumbers
                        hideFileHeaders
                        data-testid="whisper-diff-viewer"
                    />
                </div>
            )}
        </>
    );
}

function CombinedDiffBody({
    combined,
    status,
    error,
    workspaceRootPath,
}: {
    combined: CombinedWhisperDiffView;
    status: WhisperDiffState['status'];
    error: string;
    workspaceRootPath?: string | null;
}) {
    const notShown = [...combined.deletedFiles, ...combined.nonReconstructableFiles];
    return (
        <>
            {status === 'empty' ? (
                // Nothing in the group has a reconstructable diff — show the
                // no-diff message rather than a blank body.
                <div className="p-4 text-xs text-[#848484]" data-testid="whisper-diff-empty">
                    {error || 'No diff is available for these files.'}
                </div>
            ) : (
                combined.sections.map((section) => {
                    const relPath = getSourceCanvasDisplayPath(section.file.path, workspaceRootPath);
                    return (
                        <div
                            key={section.file.path}
                            data-testid="whisper-diff-file-section"
                            data-path={section.file.path}
                        >
                            <div
                                className="sticky-0 px-3 py-1.5 text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] bg-[#f3f3f3] dark:bg-[#2a2a2b] border-b border-[#e0e0e0] dark:border-[#3c3c3c] truncate"
                                title={section.file.path}
                                data-testid="whisper-diff-file-divider"
                            >
                                {relPath}
                            </div>
                            <div className="p-2">
                                <UnifiedDiffViewer
                                    diff={section.diff}
                                    fileName={basename(relPath)}
                                    showLineNumbers
                                    hideFileHeaders
                                    data-testid="whisper-diff-section-viewer"
                                />
                            </div>
                        </div>
                    );
                })
            )}
            {notShown.length > 0 && (
                <div
                    className="px-3 py-2 text-xs text-[#848484] border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="whisper-diff-not-shown"
                >
                    <div className="font-medium text-[#1e1e1e] dark:text-[#cccccc] mb-1">
                        Not shown
                    </div>
                    {combined.deletedFiles.map((f) => (
                        <div
                            key={f.path}
                            className="truncate"
                            title={f.path}
                            data-testid="whisper-diff-not-shown-item"
                            data-path={f.path}
                        >
                            {getSourceCanvasDisplayPath(f.path, workspaceRootPath)} — deleted
                        </div>
                    ))}
                    {combined.nonReconstructableFiles.map((f) => (
                        <div
                            key={f.path}
                            className="truncate"
                            title={f.path}
                            data-testid="whisper-diff-not-shown-item"
                            data-path={f.path}
                        >
                            {getSourceCanvasDisplayPath(f.path, workspaceRootPath)} — no diff available
                        </div>
                    ))}
                </div>
            )}
        </>
    );
}
