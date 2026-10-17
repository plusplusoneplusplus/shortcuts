import { useEffect, useMemo, useRef, useState } from 'react';
import type { CocClient, GitCommit, GitInfoResponse } from '@plusplusoneplusplus/coc-client';
import { CommitTooltip } from '../git/commits/CommitTooltip';
import { useCommitListGestures } from '../git/commits/useCommitListGestures';
import { isTouchOnly } from '../git/commits/commitListTypes';
import { buildFixupGroups, FIXUP_GROUP_COLORS_DARK, FIXUP_GROUP_COLORS_LIGHT } from '../git/fixup-utils';
import { CommitIdentity } from '../git/commits/CommitIdentity';
import { COMMIT_PAGE_SIZE, outgoingCommits } from '../git/commits/outgoingCommits';
import { workspaceReadSource } from '../../api/workspaceReads';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { syncState } from './railGitModel';
import { cn } from '../../ui';

interface Props {
    client: CocClient;
    routingRef: string;
    workspaceId: string;
    info: GitInfoResponse | null | undefined;
    readAt?: number;
    loading: boolean;
    failed: boolean;
    /** Group cards omit a confirmed empty comparison and use tighter spacing. */
    compact?: boolean;
    onOpen: (commit: GitCommit) => void;
    onRetry: () => void;
}

/** Mounted only inside an open Sync preview; never fetches or mutates Git. */
export function RailOutgoingCommits(props: Props) {
    const { client, routingRef, workspaceId, info, readAt, loading, failed, compact, onRetry } = props;
    const sync = syncState(info);
    const unresolved = !!parseRemoteCloneKey(routingRef) && !client.options?.baseUrl;
    const key = JSON.stringify([routingRef, workspaceReadSource(client), workspaceId, info?.branch, info?.upstream, info?.ahead, info?.behind, readAt]);
    let message: string | undefined;
    if (loading) message = 'Reading outgoing status...';
    else if (failed || unresolved || sync.kind === 'unknown') message = 'Outgoing commits unavailable.';
    else if (sync.kind === 'detached') message = 'Outgoing commits unavailable on detached HEAD.';
    else if (sync.kind === 'no-upstream') message = 'No upstream; outgoing commits cannot be compared.';
    if (compact && !message && sync.kind === 'compared' && info?.ahead === 0) return null;
    return <section aria-label="Outgoing commits" className={cn('min-w-0', compact ? 'mt-1' : 'mt-2')} data-testid="rail-outgoing">
        {(!compact || !message) && <div className={cn('text-[10px] font-semibold text-[#656d76] dark:text-[#aaa]', !compact && 'mb-1')}>Outgoing commits</div>}
        {message
            ? <div role="status" className="text-[11px] text-[#656d76] dark:text-[#aaa]">{message}</div>
            : <OutgoingHistory key={key} client={client} workspaceId={workspaceId} ahead={info?.ahead ?? 0} onOpen={props.onOpen} onRetry={onRetry} />}
    </section>;
}

function OutgoingHistory({ client, workspaceId, ahead, onOpen, onRetry }: {
    client: CocClient;
    workspaceId: string;
    ahead: number;
    onOpen: (commit: GitCommit) => void;
    onRetry: () => void;
}) {
    const gestures = useCommitListGestures({ touchOnly: isTouchOnly() });
    const focusWithin = useRef<HTMLElement | null>(null);
    const [commits, setCommits] = useState<GitCommit[]>([]);
    const [total, setTotal] = useState<number>();
    const [skip, setSkip] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>();
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(undefined);
        void client.git.listCommits(workspaceId, {
            limit: COMMIT_PAGE_SIZE, skip: skip || undefined, refresh: skip === 0,
        }).then(result => {
            if (cancelled) return;
            // A changed comparison (or a success-shaped empty history) cannot
            // substantiate the popup's ahead count. Ask for a fresh status read.
            const rows = outgoingCommits(result.commits, Math.max(0, result.unpushedCount - skip));
            if (result.unpushedCount !== ahead || (skip < result.unpushedCount && rows.length === 0)) {
                setCommits([]);
                setError('Git status changed or history is unavailable. Retry read.');
            } else {
                setTotal(result.unpushedCount);
                setCommits(previous => skip ? [...previous, ...rows] : rows);
            }
            setLoading(false);
        }, (reason: unknown) => {
            if (cancelled) return;
            setError(reason instanceof Error ? reason.message : 'Could not read outgoing commits.');
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [client, workspaceId, ahead, skip]);

    const fixups = useMemo(() => buildFixupGroups(commits), [commits]);
    const hovered = gestures.hoveredCommit;
    const fixupEntry = hovered ? fixups.fixupEntries.get(hovered.hash) : undefined;
    const targetGroup = hovered ? fixups.targetGroups.get(hovered.hash) : undefined;
    const colors = window.matchMedia('(prefers-color-scheme: dark)').matches ? FIXUP_GROUP_COLORS_DARK : FIXUP_GROUP_COLORS_LIGHT;
    const colorSlot = fixupEntry?.colorSlot ?? targetGroup?.colorSlot;

    // React focus/pointer ownership includes the tooltip's body portal. Keeping
    // it beside (not inside) the row button also isolates its Copy action.
    return <div onFocusCapture={event => {
        focusWithin.current = event.target;
        gestures.handleTooltipMouseEnter();
    }} onBlurCapture={() => {
        focusWithin.current = null;
        gestures.handleRowMouseLeave();
    }}>
        <ul aria-label="Outgoing commit history" aria-busy={loading} onScroll={gestures.dismissTooltip}
            className="max-h-48 overflow-y-auto overscroll-contain min-w-0" data-testid="rail-outgoing-list">
            {commits.map(commit => <li key={commit.hash}>
                <button type="button" className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-1 text-left hover:bg-[#f0f0f0] focus-visible:outline focus-visible:outline-[#007acc] dark:hover:bg-[#2a2d2e]"
                    aria-label={`Open commit ${commit.shortHash}: ${commit.subject}`}
                    onMouseEnter={isTouchOnly() ? undefined : event => gestures.handleRowMouseEnter(commit, event)}
                    onMouseLeave={() => { if (focusWithin.current !== document.activeElement) gestures.handleRowMouseLeave(); }}
                    onFocus={event => gestures.handleRowMouseEnter(commit, event)}
                    onClick={() => { gestures.dismissTooltip(); onOpen(commit); }}>
                    <CommitIdentity commit={commit} unpushed />
                </button>
            </li>)}
        </ul>
        {loading && <div role="status" className="text-[11px] text-[#656d76] dark:text-[#aaa]">Loading outgoing commits...</div>}
        {error && <div role="alert" className="break-words text-[11px] text-[#b42318] dark:text-[#f48771]">
            {error} <button type="button" className="underline" onClick={onRetry}>Retry outgoing read</button>
        </div>}
        {!loading && !error && total === 0 && <div role="status" className="text-[11px] text-[#656d76] dark:text-[#aaa]">No outgoing commits.</div>}
        {!error && total !== undefined && commits.length < total && <button type="button" disabled={loading}
            className="mt-1 text-[11px] text-[#1878c8] focus-visible:outline dark:text-[#3794ff]"
            onClick={() => setSkip(commits.length)}>Load more outgoing commits ({commits.length} of {total})</button>}
        {hovered && gestures.tooltipAnchorRect && <CommitTooltip commit={hovered} anchorRect={gestures.tooltipAnchorRect}
            fixupEntry={fixupEntry} targetGroup={targetGroup} groupColor={colorSlot === undefined ? undefined : colors[colorSlot]}
            onMouseEnter={gestures.handleTooltipMouseEnter}
            onMouseLeave={() => { if (focusWithin.current !== document.activeElement) gestures.handleTooltipMouseLeave(); }} />}
    </div>;
}
