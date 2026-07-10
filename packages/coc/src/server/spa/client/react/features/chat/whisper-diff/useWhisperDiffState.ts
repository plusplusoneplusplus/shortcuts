/**
 * useWhisperDiffState — builds the renderable diff state for the converged
 * read-only whisper diff panel (AC-02 wiring).
 *
 * Driven by the single `WhisperDiffOpenContext` emitted when a user opens the
 * panel from a whisper group's files popover (either the "N files" footer or a
 * file row). It is fully synchronous and network-free: it replays the group's
 * captured `edit`/`create`/`apply_patch` tool calls through
 * `buildWhisperCombinedDiff` once, producing every reconstructable file's diff
 * section plus the deleted / non-reconstructable "not shown" lists. The panel
 * then renders the stacked "All files" view or narrows to one file by the
 * user's dropdown selection.
 *
 * `buildWhisperCombinedDiff` is the single source of truth for the sections +
 * "not shown" split, so there is no per-file async/commit-diff fallback — a
 * non-reconstructable file is listed-but-disabled in the dropdown and can only
 * be seen (as "not shown") in the All-files view. `idle` means no group is open.
 */
import { useMemo } from 'react';
import {
    buildWhisperCombinedDiff,
    type CombinedWhisperDiffSection,
} from '../conversation/tool-calls/buildWhisperCombinedDiff';
import type { WhisperDiffOpenContext } from '../conversation/tool-calls/WhisperCollapsedGroup';
import { computeFileEditTotals, type FileEdit } from '../conversation/tool-calls/toolGroupUtils';

export type WhisperDiffStatus = 'idle' | 'success' | 'empty';

/**
 * The whole-group combined view — the panel's single data source. It carries
 * the per-file reconstructed sections, the trailing "not shown" lists, and the
 * header totals, all built synchronously by `buildWhisperCombinedDiff`.
 */
export interface CombinedWhisperDiffView {
    /** Per-file reconstructed sections in group order (a divider + diff each). */
    sections: CombinedWhisperDiffSection[];
    /** Deleted files (no diff body) — listed under "not shown". */
    deletedFiles: FileEdit[];
    /** Non-reconstructable files (no line content) — listed under "not shown". */
    nonReconstructableFiles: FileEdit[];
    /** Total file count in the group, for the "N files" header. */
    fileCount: number;
    /** Combined insertions across the whole group (header totals). */
    totalInsertions: number;
    /** Combined deletions across the whole group (header totals). */
    totalDeletions: number;
}

export interface WhisperDiffState {
    status: WhisperDiffStatus;
    /** The whole-group combined view (sections + "not shown" lists + totals). */
    view: CombinedWhisperDiffView;
    /** Every file in the group, group order — the header dropdown's item list. */
    files: FileEdit[];
    /**
     * Entry-point focus target: a file path (opened from a popover file row) or
     * `undefined` (opened from the footer → All files). Drives the panel's
     * initial dropdown selection; thereafter selection is user-driven.
     */
    focusPath?: string;
    /** No-diff explanation, shown when the All-files view is empty. */
    error: string;
}

const EMPTY_VIEW: CombinedWhisperDiffView = {
    sections: [],
    deletedFiles: [],
    nonReconstructableFiles: [],
    fileCount: 0,
    totalInsertions: 0,
    totalDeletions: 0,
};

const IDLE: WhisperDiffState = {
    status: 'idle',
    view: EMPTY_VIEW,
    files: [],
    error: '',
};

export function useWhisperDiffState(
    ctx: WhisperDiffOpenContext | null,
): WhisperDiffState {
    // Pure + synchronous. Memoized on the held context so the returned state has
    // a stable identity per open — the panel keys its selection-reset effect on
    // that identity to re-initialize the dropdown when a new group replaces the
    // current one. `ctx` is held in panel state (useWhisperDiffPanelState), so it
    // is a stable reference across unrelated re-renders; only a fresh `open()`
    // changes it. Nothing here calls setState, so recomputing on a new ctx is
    // safe (no render loop) even if a caller passes a freshly-built context.
    return useMemo<WhisperDiffState>(() => {
        if (!ctx) return IDLE;
        const built = buildWhisperCombinedDiff(ctx.toolCalls, ctx.files);
        const { totalInsertions, totalDeletions } = computeFileEditTotals(ctx.files);
        const view: CombinedWhisperDiffView = {
            sections: built.sections,
            deletedFiles: built.deletedFiles,
            nonReconstructableFiles: built.nonReconstructableFiles,
            fileCount: ctx.files.length,
            totalInsertions,
            totalDeletions,
        };
        const hasDiff = built.sections.length > 0;
        return {
            status: hasDiff ? 'success' : 'empty',
            view,
            files: ctx.files,
            focusPath: ctx.focusPath,
            error: hasDiff ? '' : 'No diff is available for these files.',
        };
    }, [ctx]);
}
