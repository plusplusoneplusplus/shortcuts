/**
 * WhatChangedStrip — the "what happened while I was away" line at the top of
 * the Today tab.
 *
 * Renders the newest few entries of the Work Radar timeline note
 * (`notes/Work/timeline.md`), five at most, each linking back to its thread.
 *
 * Three rules shape everything here:
 *
 * 1. **Nothing to show costs nothing.** No note, no entries, a fetch that
 *    failed, or a strip the user dismissed all render `null` — not an empty
 *    box, not a "no updates yet" placeholder. Nothing writes that note yet, so
 *    empty is the normal state, and a placeholder pinned above the task list
 *    would be a permanent tax on the most valuable space on the page.
 * 2. **It can never break the tab.** The task list below is the content that
 *    matters. A failed fetch is logged and swallowed; there is no error state
 *    and no retry, because a strip that shouts about itself is worse than one
 *    that quietly isn't there.
 * 3. **Dismissible.** Once read, it is read. The dismissal lasts the browser
 *    session — Today is a keep-alive tab, so component state alone would also
 *    survive tab switches, but not the reload that a morning refresh implies.
 */
import { useCallback, useEffect, useState } from 'react';
import type { MyWorkTimelineEntry } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../api/cocClient';

const DISMISS_KEY = 'myWork.whatChanged.dismissed';

/** Session-scoped dismissal, tolerant of storage being unavailable. */
function readDismissed(): boolean {
    try {
        return sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
        return false;
    }
}

function writeDismissed(): void {
    try {
        sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
        /* private mode / storage disabled — the in-memory flag still works */
    }
}

export interface WhatChangedStripProps {
    /** Virtual workspace whose notes back the strip (e.g. `my_work`). */
    workspaceId: string;
    /** True while the Today tab is visible; drives the fetch. */
    active?: boolean;
}

export function WhatChangedStrip({ workspaceId, active = true }: WhatChangedStripProps) {
    const [entries, setEntries] = useState<MyWorkTimelineEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [notePath, setNotePath] = useState<string | null>(null);
    const [dismissed, setDismissed] = useState(readDismissed);

    // Refetches on each activation, like the task list: the note is written by
    // a scheduled sweep, so a snapshot taken once would go stale silently.
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        void (async () => {
            try {
                const result = await getSpaCocClient().myWork.getTimeline();
                if (cancelled) return;
                setEntries(Array.isArray(result?.entries) ? result.entries : []);
                setTotal(typeof result?.total === 'number' ? result.total : 0);
                setNotePath(typeof result?.notePath === 'string' ? result.notePath : null);
            } catch (err) {
                if (cancelled) return;
                // Rule 2: log, show nothing, leave the task list alone.
                console.warn('[my-work] failed to load the timeline strip', err);
                setEntries([]);
                setTotal(0);
            }
        })();
        return () => { cancelled = true; };
    }, [active]);

    const openNote = useCallback((path: string) => {
        location.hash = `#repos/${workspaceId}/notes/${encodeURIComponent(path)}`;
    }, [workspaceId]);

    const dismiss = useCallback(() => {
        setDismissed(true);
        writeDismissed();
    }, []);

    if (dismissed || entries.length === 0) return null;

    const linkClass = 'text-xs text-blue-600 dark:text-blue-400 hover:underline';

    return (
        <section
            className="rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2"
            aria-label="What changed"
            data-testid="my-work-today-timeline"
        >
            <div className="flex items-center justify-between gap-3 mb-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    What changed
                </h3>
                <div className="flex items-center gap-3">
                    {total > entries.length && notePath && (
                        <button
                            type="button"
                            className={linkClass}
                            onClick={() => openNote(notePath)}
                            data-testid="my-work-today-timeline-view-all"
                        >
                            View all {total}
                        </button>
                    )}
                    <button
                        type="button"
                        className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        onClick={dismiss}
                        aria-label="Dismiss what changed"
                        data-testid="my-work-today-timeline-dismiss"
                    >
                        ✕
                    </button>
                </div>
            </div>
            <ul className="flex flex-col gap-0.5">
                {entries.map(entry => (
                    <li
                        key={entry.id}
                        className="flex items-baseline gap-2 text-xs text-gray-700 dark:text-gray-300"
                        data-testid={`my-work-today-timeline-entry-${entry.id}`}
                    >
                        {(entry.time || entry.date) && (
                            <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
                                {entry.time || entry.date}
                            </span>
                        )}
                        {entry.thread && <ThreadLabel entry={entry} onOpenNote={openNote} />}
                        <span className="truncate">{entry.text}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

/**
 * The thread label, as a link when the bullet carried one the server was
 * willing to resolve. An unlinkable label still renders — knowing *which*
 * thread moved is most of the value of the line.
 */
function ThreadLabel({ entry, onOpenNote }: {
    entry: MyWorkTimelineEntry;
    onOpenNote: (path: string) => void;
}) {
    const className = 'shrink-0 font-medium text-blue-600 dark:text-blue-400 hover:underline';
    const testId = `my-work-today-timeline-thread-${entry.id}`;

    if (entry.link?.kind === 'note') {
        const path = entry.link.path;
        return (
            <button type="button" className={className} onClick={() => onOpenNote(path)} data-testid={testId}>
                {entry.thread}
            </button>
        );
    }
    if (entry.link?.kind === 'external') {
        return (
            <a
                href={entry.link.url}
                target="_blank"
                rel="noreferrer noopener"
                className={className}
                data-testid={testId}
            >
                {entry.thread}
            </a>
        );
    }
    return (
        <span className="shrink-0 font-medium text-gray-600 dark:text-gray-300" data-testid={testId}>
            {entry.thread}
        </span>
    );
}
