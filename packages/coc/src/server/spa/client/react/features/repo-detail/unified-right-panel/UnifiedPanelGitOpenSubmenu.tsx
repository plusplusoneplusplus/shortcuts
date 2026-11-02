/**
 * UnifiedPanelGitOpenSubmenu — the body of a Git tab's "Open" submenu: the
 * owner's working tree ("Workspace") and its few most recent commits. A group
 * tab that names no member first asks which repository to open; nothing is
 * read until one is chosen.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GitCommit } from '@plusplusoneplusplus/coc-client';
import { GIT_OPEN_RECENT_LIMIT, type GitTabOpenOwner, type UnifiedPanelGitOpenSource } from './panelGitCommit';

const SUBJECT_MAX = 48;

type Recent =
    | { status: 'loading' }
    | { status: 'ready'; commits: readonly GitCommit[] }
    | { status: 'error' };

export function truncateCommitSubject(subject: string): string {
    return subject.length > SUBJECT_MAX ? `${subject.slice(0, SUBJECT_MAX - 1)}…` : subject;
}

const ITEM_CLASS = 'block w-full border-none bg-transparent px-3 py-1 text-left cursor-pointer hover:bg-[#e8e8e8] focus:bg-[#e8e8e8] focus:outline-none dark:hover:bg-[#37373d] dark:focus:bg-[#37373d]';
const NOTE_CLASS = 'px-3 py-1 text-[#6e6e6e] dark:text-[#9d9d9d]';

export function UnifiedPanelGitOpenSubmenu({ source, onDone, onLayoutChange }: {
    source: UnifiedPanelGitOpenSource;
    /** Close the whole menu after an open. */
    onDone: () => void;
    /** Content changed size; the submenu re-measures its placement. */
    onLayoutChange: () => void;
}) {
    // The strip rebuilds `source` each render; reads key on the chosen owner only.
    const sourceRef = useRef(source);
    sourceRef.current = source;
    const rootRef = useRef<HTMLDivElement>(null);
    const [chosen, setChosen] = useState<GitTabOpenOwner | null>(source.owner);
    const [attempt, setAttempt] = useState(0);
    const [recent, setRecent] = useState<Recent>({ status: 'loading' });
    // A view switch unmounts the focused item; move focus to the new first item.
    const [refocus, setRefocus] = useState(false);
    const ownerKey = chosen ? JSON.stringify(chosen.target) : null;

    useEffect(() => {
        if (!chosen || source.unavailable) return;
        let cancelled = false;
        setRecent({ status: 'loading' });
        sourceRef.current.loadRecent(chosen).then(
            commits => { if (!cancelled) setRecent({ status: 'ready', commits: commits.slice(0, GIT_OPEN_RECENT_LIMIT) }); },
            () => { if (!cancelled) setRecent({ status: 'error' }); },
        );
        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the owner identity, not the per-render source object
    }, [ownerKey, attempt, source.unavailable]);

    useLayoutEffect(() => {
        onLayoutChange();
        if (!refocus) return;
        setRefocus(false);
        rootRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chosen, recent, refocus]);

    const open = (owner: GitTabOpenOwner, commit: GitCommit | null) => {
        source.open(owner, commit);
        onDone();
    };

    if (!chosen) {
        return (
            <div ref={rootRef}>
                <div role="presentation" className={NOTE_CLASS}>Choose a repository</div>
                {source.choices.length === 0
                    ? <div role="status" className={NOTE_CLASS}>No repositories available.</div>
                    : source.choices.map(choice => (
                        <button key={choice.workspaceId} type="button" role="menuitem" className={ITEM_CLASS}
                            data-testid="unified-panel-git-open-member"
                            onClick={() => { setChosen(choice); setRefocus(true); }}>
                            {choice.label}
                        </button>
                    ))}
            </div>
        );
    }

    return (
        <div ref={rootRef}>
            <button type="button" role="menuitem" className={ITEM_CLASS}
                data-testid="unified-panel-git-open-workspace"
                aria-label={source.owner ? 'Workspace' : `Workspace: ${chosen.label}`}
                onClick={() => open(chosen, null)}>
                Workspace
            </button>
            <div role="separator" className="my-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" />
            {source.unavailable
                ? <div role="status" className={NOTE_CLASS}>{source.unavailable}</div>
                : recent.status === 'loading'
                    ? <div role="status" className={NOTE_CLASS}>Loading recent commits…</div>
                    : recent.status === 'error'
                        ? <>
                            <div role="status" className={NOTE_CLASS}>Could not load recent commits.</div>
                            <button type="button" role="menuitem" className={ITEM_CLASS}
                                onClick={() => { setAttempt(n => n + 1); setRefocus(true); }}>
                                Retry
                            </button>
                        </>
                        : recent.commits.length === 0
                            ? <div role="status" className={NOTE_CLASS}>No commits yet.</div>
                            : recent.commits.map(commit => (
                                <button key={commit.hash} type="button" role="menuitem"
                                    className={`${ITEM_CLASS} flex max-w-[320px] gap-2`}
                                    data-testid="unified-panel-git-open-commit"
                                    aria-label={`Open commit ${commit.shortHash}: ${commit.subject}`}
                                    title={commit.subject}
                                    onClick={() => open(chosen, commit)}>
                                    <span className="shrink-0 font-mono">{commit.shortHash}</span>
                                    <span className="min-w-0 truncate">{truncateCommitSubject(commit.subject)}</span>
                                </button>
                            ))}
            {!source.owner && (
                <>
                    <div role="separator" className="my-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" />
                    <button type="button" role="menuitem" className={ITEM_CLASS}
                        onClick={() => { setChosen(null); setRefocus(true); }}>
                        Choose another repository
                    </button>
                </>
            )}
        </div>
    );
}
