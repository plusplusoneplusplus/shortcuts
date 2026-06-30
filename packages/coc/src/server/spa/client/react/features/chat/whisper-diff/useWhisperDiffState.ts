/**
 * useWhisperDiffState — builds the renderable diff state for the transient
 * read-only whisper diff panel (AC-02 wiring).
 *
 * Driven by the `WhisperFileDiffContext` emitted when a user clicks an active
 * changed-file row in a whisper group's files popover. It produces a single
 * file's unified diff, preferring the data already captured in that whisper
 * group and falling back to a commit-backed single-file diff:
 *
 *  1. Primary — replay the group's `edit`/`create`/`apply_patch` tool calls for
 *     the clicked path via `buildWhisperFileDiff`. Fully synchronous, so the
 *     common case opens instantly with no network request.
 *  2. Fallback — when reconstruction is unavailable (e.g. Codex-style structured
 *     changes that carry no line content) and the group has detected commit(s),
 *     fetch a per-file commit diff routed through the chat's `workspaceId`/clone
 *     so remote clones hit their own server (multi-repo preserved). Commits are
 *     tried in latest-detected order; the first non-empty diff wins.
 *
 * Every terminal outcome is an EXPLICIT state — `success`, `empty` (nothing to
 * show / no fallback available), or `error` (a fallback fetch failed) — so the
 * panel never silently opens blank. `idle` means no file is open.
 */
import { useEffect, useMemo, useState } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { buildWhisperFileDiff } from '../conversation/tool-calls/buildWhisperFileDiff';
import {
    buildWhisperCombinedDiff,
    type CombinedWhisperDiffSection,
} from '../conversation/tool-calls/buildWhisperCombinedDiff';
import {
    isCombinedWhisperDiffContext,
    type WhisperDiffOpenContext,
} from '../conversation/tool-calls/WhisperCollapsedGroup';
import { computeFileEditTotals, type FileEdit } from '../conversation/tool-calls/toolGroupUtils';

export type WhisperDiffStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

/**
 * Combined-mode payload — present only when the panel was opened from the
 * files-popover footer (the whole-group "All changes" view, AC-03). It carries
 * everything the panel needs to render the header totals, the per-file dividers,
 * and the trailing "not shown" list, all built synchronously by
 * `buildWhisperCombinedDiff`.
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
    /** The reconstructed or fetched unified diff text (success only). */
    diffText: string;
    /** The clicked file's summary, for the panel header (null when idle/combined). */
    file: FileEdit | null;
    /** Failure / empty explanation, shown in the error/empty state. */
    error: string;
    /** Combined-mode payload — present only when opened in combined mode. */
    combined?: CombinedWhisperDiffView;
}

const IDLE: WhisperDiffState = { status: 'idle', diffText: '', file: null, error: '' };

export function useWhisperDiffState(
    ctx: WhisperDiffOpenContext | null,
): WhisperDiffState {
    // Combined mode (the whole-group "All changes" view) is fully synchronous and
    // has no commit/network fallback, so it is built in render rather than driven
    // through the async single-file state machine below. The single-file machine
    // must never see a combined context — it reads `.file`, which a combined
    // context does not carry — so split the union here.
    const combinedCtx = ctx && isCombinedWhisperDiffContext(ctx) ? ctx : null;
    const singleCtx = ctx && !isCombinedWhisperDiffContext(ctx) ? ctx : null;

    const [state, setState] = useState<WhisperDiffState>(IDLE);

    // Combined: reuse the AC-01 builder; pure + synchronous. `combinedCtx` is
    // held in panel state (stable identity) in the app, and nothing in this
    // branch calls setState, so recomputing on a fresh ctx cannot loop.
    const combined = useMemo<WhisperDiffState | null>(() => {
        if (!combinedCtx) return null;
        const built = buildWhisperCombinedDiff(combinedCtx.toolCalls, combinedCtx.files);
        const { totalInsertions, totalDeletions } = computeFileEditTotals(combinedCtx.files);
        const view: CombinedWhisperDiffView = {
            sections: built.sections,
            deletedFiles: built.deletedFiles,
            nonReconstructableFiles: built.nonReconstructableFiles,
            fileCount: combinedCtx.files.length,
            totalInsertions,
            totalDeletions,
        };
        const hasDiff = built.sections.length > 0;
        return {
            status: hasDiff ? 'success' : 'empty',
            diffText: built.diffText,
            file: null,
            error: hasDiff ? '' : 'No diff is available for these files.',
            combined: view,
        };
    }, [combinedCtx]);

    // The effect must NOT depend on the `ctx` object reference: callers (and
    // tests) may pass a freshly-constructed context on every render, which would
    // retrigger the effect → setState → re-render → effect, an infinite loop.
    // Instead depend on stable, resolution-relevant values, mirroring
    // useSourceCanvasContent. Strings/null compare by value under Object.is, so
    // these stay stable across renders even when `ctx` is a new object.

    // 1. Primary reconstruction is pure + synchronous; compute it in render. Its
    //    string (or null) result is value-stable, so it is safe as an effect dep.
    const reconstructed = useMemo(
        () => (singleCtx ? buildWhisperFileDiff(singleCtx.toolCalls, singleCtx.file.path) : null),
        [singleCtx],
    );
    // Stable identity for the commit fallback set.
    const commitKey = useMemo(
        () => (singleCtx?.commits ?? []).map((c) => c.fullHash || c.shortHash || '').join(','),
        [singleCtx],
    );
    const filePath = singleCtx?.file.path;
    const wsId = singleCtx?.workspaceId;

    useEffect(() => {
        if (!singleCtx) {
            setState(IDLE);
            return;
        }
        const file = singleCtx.file;

        // 1. Primary: reconstruct the diff from the group's captured tool calls.
        if (reconstructed) {
            setState({ status: 'success', diffText: reconstructed, file, error: '' });
            return;
        }

        // 2. Fallback: commit-backed single-file diff. Requires both a workspace
        //    to route through and at least one detected commit.
        const commits = singleCtx.commits ?? [];
        if (!wsId || commits.length === 0) {
            setState({
                status: 'empty',
                diffText: '',
                file,
                error: 'No diff is available for this file.',
            });
            return;
        }

        let cancelled = false;
        setState({ status: 'loading', diffText: '', file, error: '' });

        // Try commits in latest-detected order (the detection collects them in
        // chronological group order, so reverse); the first non-empty diff wins.
        const ordered = [...commits].reverse();
        void (async () => {
            let lastError = '';
            for (const commit of ordered) {
                const hash = commit.fullHash || commit.shortHash;
                if (!hash) continue;
                try {
                    const resp = await getCocClientForWorkspace(wsId)
                        .git.getCommitFileDiff(wsId, hash, file.path);
                    if (cancelled) return;
                    const diff = resp?.diff ?? '';
                    if (diff.trim()) {
                        setState({ status: 'success', diffText: diff, file, error: '' });
                        return;
                    }
                } catch (err) {
                    if (cancelled) return;
                    lastError = getSpaCocClientErrorMessage(err, 'Failed to load diff');
                }
            }
            if (cancelled) return;
            // A thrown fetch → error; all-empty-without-throw → nothing to show.
            setState(
                lastError
                    ? { status: 'error', diffText: '', file, error: lastError }
                    : {
                        status: 'empty',
                        diffText: '',
                        file,
                        error: 'No diff is available for this file.',
                    },
            );
        })();

        return () => {
            cancelled = true;
        };
        // `ctx` is intentionally excluded — see the stable-deps note above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath, wsId, commitKey, reconstructed]);

    // Combined mode short-circuits the single-file machine (whose effect parks at
    // IDLE while a combined context is held).
    return combined ?? state;
}
