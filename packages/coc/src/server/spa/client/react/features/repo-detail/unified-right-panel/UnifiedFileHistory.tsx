/**
 * UnifiedFileHistory — the read-only Git history of one right-panel file tab
 * (`features.fileHistory`).
 *
 * It replaces the file view while open; the panel keeps the file's
 * `PreviewPane` mounted underneath, so unsaved edits survive. The list is the
 * commits on HEAD that touched the file, newest first and following renames,
 * fetched a page at a time from the tab's owner. Picking a commit shows that
 * file's diff in the same place through the Git tab's `FileDiffPanel`, with
 * the path the file had in that commit (and its older path for a rename).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GitFileHistoryCommit } from '@plusplusoneplusplus/coc-client';
import { Button, Spinner } from '../../../ui';
import { formatRelativeTime } from '../../../utils/format';
import { FileDiffPanel } from '../../git/diff/FileDiffPanel';
import { createCommitDiffSource, getGitReviewClient } from '../../git/diff/diffSource';

export const FILE_HISTORY_PAGE_SIZE = 50;

export interface UnifiedFileHistoryProps {
    /** Workspace that owns the file tab. */
    workspaceId: string;
    /** Concrete local/remote route that owns the file tab. */
    routingRef?: string | null;
    /** Repo-relative path of the file as it is now. */
    filePath: string;
    /** Return to the file view. */
    onClose: () => void;
}

type HistoryState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'loaded'; commits: GitFileHistoryCommit[]; hasMore: boolean; loadingMore: boolean; moreError: string | null };

function errorMessage(reason: unknown): string {
    return reason instanceof Error ? reason.message : String(reason);
}

export function UnifiedFileHistory({ workspaceId, routingRef, filePath, onClose }: UnifiedFileHistoryProps) {
    const [state, setState] = useState<HistoryState>({ status: 'loading' });
    const [selected, setSelected] = useState<GitFileHistoryCommit | null>(null);
    // Answers for a previous owner/path (or a reload) are dropped.
    const requestRef = useRef(0);

    const fetchPage = useCallback(
        (skip: number) => getGitReviewClient(workspaceId, routingRef)
            .git.listFileHistory(workspaceId, filePath, { limit: FILE_HISTORY_PAGE_SIZE, skip }),
        [workspaceId, routingRef, filePath],
    );

    const load = useCallback(() => {
        const request = ++requestRef.current;
        setState({ status: 'loading' });
        setSelected(null);
        fetchPage(0).then(
            page => {
                if (request === requestRef.current) {
                    setState({ status: 'loaded', commits: page.commits, hasMore: page.hasMore, loadingMore: false, moreError: null });
                }
            },
            reason => {
                if (request === requestRef.current) setState({ status: 'error', message: errorMessage(reason) });
            },
        );
    }, [fetchPage]);

    useEffect(() => {
        load();
        return () => { requestRef.current++; };
    }, [load]);

    const loadMore = useCallback(() => {
        if (state.status !== 'loaded' || state.loadingMore) return;
        const request = requestRef.current;
        const skip = state.commits.length;
        setState({ ...state, loadingMore: true, moreError: null });
        fetchPage(skip).then(
            page => {
                if (request !== requestRef.current) return;
                setState(prev => prev.status === 'loaded'
                    ? { ...prev, commits: [...prev.commits, ...page.commits], hasMore: page.hasMore, loadingMore: false }
                    : prev);
            },
            reason => {
                if (request !== requestRef.current) return;
                setState(prev => prev.status === 'loaded' ? { ...prev, loadingMore: false, moreError: errorMessage(reason) } : prev);
            },
        );
    }, [state, fetchPage]);

    const source = useMemo(() => selected && createCommitDiffSource(workspaceId, selected.hash, {
        commit: { subject: selected.subject },
        files: [selected.path],
        ...(routingRef === undefined ? {} : { routingTarget: routingRef }),
        ...(selected.oldPath ? { renames: { [selected.path]: selected.oldPath } } : {}),
    }), [workspaceId, routingRef, selected]);

    if (selected && source) {
        return (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="file-history-diff">
                <div
                    className="flex flex-shrink-0 items-center gap-2 border-b border-[#e5e5e5] px-2 py-1 text-[11px] text-[#616161] dark:border-[#333] dark:text-[#9d9d9d]"
                    data-testid="file-history-diff-header"
                >
                    <span className="min-w-0 truncate" title={selected.subject}>{selected.subject}</span>
                    {selected.oldPath && (
                        <span className="ml-auto flex-shrink-0 truncate text-[10px] text-[#848484]" title={`${selected.oldPath} → ${selected.path}`}>
                            renamed from {selected.oldPath}
                        </span>
                    )}
                </div>
                <div className="min-h-0 flex-1 overflow-auto">
                    <FileDiffPanel
                        key={`${selected.hash}:${selected.path}`}
                        workspaceId={workspaceId}
                        filePath={selected.path}
                        source={source}
                        showChatToggle={false}
                        onBack={() => setSelected(null)}
                        backLabel="History"
                        backTestId="file-history-diff-back"
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-testid="file-history">
            <div className="flex flex-shrink-0 items-center gap-2 border-b border-[#e5e5e5] px-2 py-1 dark:border-[#333]">
                <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[11px] text-[#0078d4] hover:bg-[#f0f0f0] dark:text-[#3794ff] dark:hover:bg-[#37373d]"
                    onClick={onClose}
                    data-testid="file-history-back"
                >
                    ← File
                </button>
                <span className="min-w-0 truncate text-[11px] text-[#616161] dark:text-[#9d9d9d]" title={filePath}>
                    History of {filePath}
                </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto" data-testid="file-history-list">
                {state.status === 'loading' && (
                    <div className="flex items-center gap-2 px-3 py-3 text-xs text-[#848484]" data-testid="file-history-loading">
                        <Spinner size="sm" /> Loading history…
                    </div>
                )}
                {state.status === 'error' && (
                    <div className="flex flex-col items-start gap-2 px-3 py-3 text-xs" data-testid="file-history-error">
                        <span className="text-[#a1260d] dark:text-[#f48771]" role="alert">{state.message}</span>
                        <Button variant="secondary" size="sm" onClick={load}>Retry</Button>
                    </div>
                )}
                {state.status === 'loaded' && state.commits.length === 0 && (
                    <div className="px-3 py-3 text-xs italic text-[#848484]" data-testid="file-history-empty">
                        No commits on this branch changed this file.
                    </div>
                )}
                {state.status === 'loaded' && state.commits.map(commit => (
                    <button
                        key={commit.hash}
                        type="button"
                        className="flex w-full flex-col gap-0.5 border-b border-[#e0e0e0] px-3 py-1.5 text-left hover:bg-[#f0f0f0] dark:border-[#3c3c3c] dark:hover:bg-[#2a2d2e]"
                        onClick={() => setSelected(commit)}
                        title={commit.oldPath ? `${commit.subject}\n${commit.oldPath} → ${commit.path}` : commit.subject}
                        data-testid={`file-history-row-${commit.shortHash}`}
                    >
                        <span className="flex min-w-0 items-center gap-2 text-[13px] text-[#1f1f1f] dark:text-[#cccccc]">
                            <span className="flex-shrink-0 font-mono text-[11px] text-[#0078d4] dark:text-[#3794ff]">{commit.shortHash}</span>
                            <span className="min-w-0 truncate">{commit.subject}</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-2 text-[11px] text-[#848484]">
                            <span className="min-w-0 truncate">{commit.author}</span>
                            <span className="flex-shrink-0" title={new Date(commit.date).toLocaleString()}>{formatRelativeTime(commit.date)}</span>
                        </span>
                    </button>
                ))}
                {state.status === 'loaded' && state.moreError && (
                    <div className="px-3 py-2 text-xs text-[#a1260d] dark:text-[#f48771]" role="alert" data-testid="file-history-more-error">
                        {state.moreError}
                    </div>
                )}
                {state.status === 'loaded' && state.hasMore && (
                    <div className="px-3 py-2">
                        <Button variant="secondary" size="sm" onClick={loadMore} disabled={state.loadingMore} data-testid="file-history-more">
                            {state.loadingMore ? 'Loading…' : 'Load more'}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
