/**
 * The palette's half of Go To All: hold workspace attachments while the dialog
 * is open, and run one debounced fan-out per keystroke.
 *
 * Two lifetimes meet here and they are not the same. The *attachments* live as
 * long as the dialog does — acquiring a language-server session per keystroke
 * would start and stop processes while somebody types. The *queries* live one
 * keystroke each, and a superseded one is aborted rather than merged, because
 * merging it would drop the answer to the query the user can actually see.
 *
 * Status is derived, never latched. "Indexing…" comes from the live session
 * state of the servers that are attached right now, so a repo that finishes
 * indexing mid-query becomes results without the user retyping, and a session
 * that dies stops claiming to be indexing. Deriving it is all a status push
 * does: it never restarts the query, because an indexing server pushes often
 * enough that restarting would keep aborting the fan-out mid-flight.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { getLanguageServerClient, type LanguageServerAttachment } from './languageServerClient';
import {
    queryWorkspaceSymbols,
    MAX_CONCURRENT_MEMBERS,
    type WorkspaceSymbolTarget,
    type WorkspaceSymbolResult,
    type WorkspaceSymbolStatus,
} from './workspaceSymbols';

/** One repository the palette should search. */
export interface WorkspaceSymbolScopeMember {
    workspaceId: string;
    /** Endpoint routing identity; defaults to `workspaceId` like everywhere else. */
    routingRef?: string | null;
    /** Rendered as the repo badge in group scope; omit for a single repo. */
    repoName?: string;
}

export interface UseWorkspaceSymbolsOptions {
    /** Nothing is attached and no query runs while this is false. */
    open: boolean;
    members: readonly WorkspaceSymbolScopeMember[];
    /** Already stripped of any prefix filter. Empty means "do not search". */
    query: string;
    debounceMs: number;
    limit: number;
}

export interface WorkspaceSymbolsState {
    results: WorkspaceSymbolResult[];
    /** A query is in flight and nothing is on screen for it yet. */
    loading: boolean;
    /** Some servers answered and others have not. */
    streaming: boolean;
    status: WorkspaceSymbolStatus | null;
    /** At least one attached server is still building its index. */
    indexing: boolean;
    /** Every attached server is unavailable, with the host's recovery hint. */
    unavailable: { detail: string; recoveryCommand?: string } | null;
}

const IDLE: WorkspaceSymbolsState = {
    results: [],
    loading: false,
    streaming: false,
    status: null,
    indexing: false,
    unavailable: null,
};

export function useWorkspaceSymbols(options: UseWorkspaceSymbolsOptions): WorkspaceSymbolsState {
    const { open, query, debounceMs, limit } = options;
    // Only the first `MAX_CONCURRENT_MEMBERS` are attached: each one holds
    // language-server sessions on its host for as long as the dialog is open.
    const members = useMemo(
        () => options.members.slice(0, MAX_CONCURRENT_MEMBERS),
        [options.members],
    );
    const membersKey = members.map((member) => `${member.workspaceId}|${member.routingRef ?? ''}`).join(',');

    const attachmentsRef = useRef<WorkspaceSymbolTarget[]>([]);
    const answerableRef = useRef(false);
    const [queryGeneration, setQueryGeneration] = useState(0);
    const [state, setState] = useState<WorkspaceSymbolsState>(IDLE);

    // Attachments live for as long as the dialog does.
    useEffect(() => {
        if (!open || members.length === 0) {
            return;
        }
        const views: WorkspaceSymbolTarget[] = members.map((member) => ({
            workspaceId: member.workspaceId,
            repoName: member.repoName,
            attachment: getLanguageServerClient(
                member.workspaceId,
                undefined,
                member.routingRef,
            ).attachWorkspace(),
        }));
        attachmentsRef.current = views;
        // A session that turns ready, starts indexing, or dies re-derives the
        // status without a keystroke — that is AC-07's "no retyping" rule.
        //
        // Only the status is re-derived here. An indexing server pushes status
        // constantly, and restarting the query on each push would abort the
        // fan-out the user is waiting on and flash "No symbols found" between
        // the tear-down and the next debounce. The one push that does deserve a
        // re-query is the edge where nothing could answer and now something
        // can: those results were computed against an empty server set.
        const sync = () => {
            const { answerable, ...status } = readSessionHealth(attachmentsRef.current);
            setState((previous) => (sameStatus(previous, status) ? previous : { ...previous, ...status }));
            if (answerable && !answerableRef.current) {
                setQueryGeneration((value) => value + 1);
            }
            answerableRef.current = answerable;
        };
        const disposers = views.flatMap(({ attachment }) => [
            attachment.onStatus(sync),
            attachment.onAttached(sync),
        ]);
        sync();
        return () => {
            for (const dispose of disposers) dispose();
            for (const { attachment } of views) attachment.release();
            attachmentsRef.current = [];
            answerableRef.current = false;
        };
    }, [open, membersKey]);

    useEffect(() => {
        if (!open) {
            setState(IDLE);
            return;
        }
        const trimmed = query.trim();
        if (!trimmed) {
            setState({ ...IDLE, ...readStatus(attachmentsRef.current) });
            return;
        }
        const abort = new AbortController();
        const timer = setTimeout(() => {
            setState((previous) => ({
                ...previous,
                loading: previous.results.length === 0,
                streaming: previous.results.length > 0,
                ...readStatus(attachmentsRef.current),
            }));
            void queryWorkspaceSymbols({
                targets: attachmentsRef.current,
                query: trimmed,
                signal: abort.signal,
                limit,
                onResults: (results, pending) => {
                    if (abort.signal.aborted) return;
                    setState((previous) => ({
                        ...previous,
                        results,
                        loading: false,
                        streaming: pending > 0,
                        ...readStatus(attachmentsRef.current),
                    }));
                },
            }).then((outcome) => {
                if (abort.signal.aborted) return;
                setState((previous) => ({
                    ...previous,
                    results: outcome.results,
                    status: outcome.status,
                    loading: false,
                    streaming: false,
                    ...readStatus(attachmentsRef.current),
                }));
            });
        }, debounceMs);
        return () => {
            clearTimeout(timer);
            abort.abort();
        };
    }, [open, query, debounceMs, limit, membersKey, queryGeneration]);

    return state;
}

type SymbolStatusFields = Pick<WorkspaceSymbolsState, 'indexing' | 'unavailable'>;

interface SessionHealth extends SymbolStatusFields {
    /** At least one attached server can answer a query right now. */
    answerable: boolean;
}

/** The rendered half of session health. */
function readStatus(
    views: readonly { attachment: LanguageServerAttachment }[],
): SymbolStatusFields {
    const { indexing, unavailable } = readSessionHealth(views);
    return { indexing, unavailable };
}

function sameStatus(a: SymbolStatusFields, b: SymbolStatusFields): boolean {
    return a.indexing === b.indexing
        && a.unavailable?.detail === b.unavailable?.detail
        && a.unavailable?.recoveryCommand === b.unavailable?.recoveryCommand;
}

/**
 * Indexing and unavailability, read off the sessions that are attached right
 * now. Derived rather than remembered, so neither state can outlive the session
 * that justified it.
 */
function readSessionHealth(
    views: readonly { attachment: LanguageServerAttachment }[],
): SessionHealth {
    let indexing = false;
    let servers = 0;
    let usable = 0;
    let unavailable: { detail: string; recoveryCommand?: string } | null = null;
    for (const { attachment } of views) {
        for (const info of attachment.getInfos()) {
            servers += 1;
            if (info.state.status === 'unavailable') {
                unavailable ??= {
                    detail: info.state.detail ?? `${info.state.displayName} is unavailable.`,
                    recoveryCommand: info.state.recoveryCommand,
                };
                continue;
            }
            usable += 1;
            if (info.state.status === 'indexing' || info.state.status === 'starting') indexing = true;
        }
        const refused = attachment.getUnavailable();
        if (refused) unavailable ??= { detail: refused.detail };
    }
    // The recovery hint is the whole story only when nothing else can answer;
    // one dead server beside a working one is not worth a banner.
    return {
        indexing,
        unavailable: servers === 0 || usable === 0 ? unavailable : null,
        answerable: usable > 0 && !indexing,
    };
}
