/**
 * SentinelTodoOriginBar — the way back from a chat opened through a Sentinel
 * To-do link (see `sentinelTodoExcursion`).
 *
 * Mounted above a hosted chat's header, it records the chat as a visit on the
 * running excursion and, while the chat is on that path, shows Back to
 * Sentinel, a breadcrumb from the origin, and a close button. Back returns
 * through the origin's own route; breadcrumbs return to earlier chats on the
 * path. The chat keeps its own title and mode — the bar only names where the
 * user came from.
 */

import { useEffect, useState } from 'react';
import { cn } from '../../../ui/cn';
import {
    endSentinelTodoExcursion,
    excursionStopIndex,
    returnFromSentinelTodoExcursion,
    useSentinelTodoExcursion,
    visitSentinelTodoExcursionChat,
} from './sentinelTodoExcursion';

export interface SentinelTodoOriginBarProps {
    /** The hosting panel's scope. */
    scopeWorkspaceId: string;
    chatId: string;
    title: string | null;
}

/** Crumbs shown before the earlier ones fold behind "…". */
const SHOWN_CRUMBS = 2;

const FOCUS = 'focus:outline-none focus-visible:ring-1 focus-visible:ring-[#8764b8]';

function navigate(href: string | null): void {
    if (href) window.location.hash = href;
}

export function SentinelTodoOriginBar({ scopeWorkspaceId, chatId, title }: SentinelTodoOriginBarProps) {
    const excursion = useSentinelTodoExcursion();
    const [showAll, setShowAll] = useState(false);

    // Keyed on the selection and title, not the excursion: the origin chat
    // starting one records nothing until the user arrives somewhere else.
    useEffect(() => {
        visitSentinelTodoExcursionChat({ scopeWorkspaceId, chatId, title, href: window.location.hash });
    }, [scopeWorkspaceId, chatId, title]);

    const index = excursionStopIndex(excursion, scopeWorkspaceId, chatId);
    if (excursion === null || index < 0) return null;

    const originTitle = excursion.origin.title ?? 'Sentinel';
    const crumbs = excursion.trail.slice(0, index + 1);
    const folded = showAll ? 0 : Math.max(0, crumbs.length - SHOWN_CRUMBS);

    return (
        <nav aria-label="Origin" data-testid="sentinel-todo-origin-bar"
            className="flex min-w-0 items-center gap-2 border-b border-[#8764b8]/30 bg-[#8764b8]/10 px-3 py-1 text-xs">
            <button type="button" data-testid="sentinel-todo-origin-back"
                onClick={() => navigate(returnFromSentinelTodoExcursion())}
                aria-label={`Back to Sentinel: ${originTitle}`}
                title="Return to the Sentinel with its To-do list as you left it"
                className={cn('inline-flex shrink-0 items-center gap-1 rounded border border-[#8764b8]/40 bg-white px-2 py-0.5 font-semibold text-[#5c3d99]',
                    'hover:bg-[#8764b8]/10 dark:bg-[#1e1e1e] dark:text-[#c5a5ed]', FOCUS)}>
                <span aria-hidden="true">←</span>Back to Sentinel
            </button>
            <ol className="m-0 flex min-w-0 flex-1 list-none items-center gap-1 p-0 text-[#616161] dark:text-[#9d9d9d]">
                <li className="min-w-0 shrink truncate font-medium text-[#5c3d99] dark:text-[#c5a5ed]" title={originTitle}>
                    <span aria-hidden="true">◆ </span>{originTitle}
                </li>
                {folded > 0 && (
                    <li className="flex shrink-0 items-center gap-1">
                        <span aria-hidden="true">›</span>
                        <button type="button" onClick={() => setShowAll(true)} data-testid="sentinel-todo-origin-more"
                            aria-label={`Show ${folded} earlier conversation${folded === 1 ? '' : 's'}`}
                            className={cn('rounded px-1 hover:bg-[#8764b8]/15', FOCUS)}>…</button>
                    </li>
                )}
                {crumbs.slice(folded).map((stop, offset) => {
                    const label = stop.title ?? 'Conversation';
                    const current = folded + offset === index;
                    return (
                        <li key={`${stop.scopeWorkspaceId}\n${stop.chatId}`} className="flex min-w-0 shrink items-center gap-1">
                            <span aria-hidden="true">›</span>
                            {current ? (
                                <span aria-current="page" className="truncate text-[#1e1e1e] dark:text-[#cccccc]" title={label}>{label}</span>
                            ) : (
                                <button type="button" onClick={() => navigate(stop.href)} title={label}
                                    className={cn('truncate rounded hover:underline', FOCUS)}>{label}</button>
                            )}
                        </li>
                    );
                })}
            </ol>
            <button type="button" onClick={endSentinelTodoExcursion} data-testid="sentinel-todo-origin-close"
                aria-label={`Stop tracking the way back and unpin ${originTitle} To-do`}
                title="Unpin the To-do and hide this bar"
                className={cn('shrink-0 rounded px-1 text-[#616161] hover:bg-[#8764b8]/15 dark:text-[#9d9d9d]', FOCUS)}>✕</button>
        </nav>
    );
}
