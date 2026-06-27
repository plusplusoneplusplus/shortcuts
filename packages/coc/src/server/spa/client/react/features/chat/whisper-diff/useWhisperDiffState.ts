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
import type { WhisperFileDiffContext } from '../conversation/tool-calls/WhisperCollapsedGroup';
import type { FileEdit } from '../conversation/tool-calls/toolGroupUtils';

export type WhisperDiffStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

export interface WhisperDiffState {
    status: WhisperDiffStatus;
    /** The reconstructed or fetched unified diff text (success only). */
    diffText: string;
    /** The clicked file's summary, for the panel header (null when idle). */
    file: FileEdit | null;
    /** Failure / empty explanation, shown in the error/empty state. */
    error: string;
}

const IDLE: WhisperDiffState = { status: 'idle', diffText: '', file: null, error: '' };

export function useWhisperDiffState(
    ctx: WhisperFileDiffContext | null,
): WhisperDiffState {
    const [state, setState] = useState<WhisperDiffState>(IDLE);

    // The effect must NOT depend on the `ctx` object reference: callers (and
    // tests) may pass a freshly-constructed context on every render, which would
    // retrigger the effect → setState → re-render → effect, an infinite loop.
    // Instead depend on stable, resolution-relevant values, mirroring
    // useSourceCanvasContent. Strings/null compare by value under Object.is, so
    // these stay stable across renders even when `ctx` is a new object.

    // 1. Primary reconstruction is pure + synchronous; compute it in render. Its
    //    string (or null) result is value-stable, so it is safe as an effect dep.
    const reconstructed = useMemo(
        () => (ctx ? buildWhisperFileDiff(ctx.toolCalls, ctx.file.path) : null),
        [ctx],
    );
    // Stable identity for the commit fallback set.
    const commitKey = useMemo(
        () => (ctx?.commits ?? []).map((c) => c.fullHash || c.shortHash || '').join(','),
        [ctx],
    );
    const filePath = ctx?.file.path;
    const wsId = ctx?.workspaceId;

    useEffect(() => {
        if (!ctx) {
            setState(IDLE);
            return;
        }
        const file = ctx.file;

        // 1. Primary: reconstruct the diff from the group's captured tool calls.
        if (reconstructed) {
            setState({ status: 'success', diffText: reconstructed, file, error: '' });
            return;
        }

        // 2. Fallback: commit-backed single-file diff. Requires both a workspace
        //    to route through and at least one detected commit.
        const commits = ctx.commits ?? [];
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

    return state;
}
