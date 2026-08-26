import React, { useState } from 'react';
import { cn } from '../../../ui/cn';

export interface RepoGroupContextDisclosureProps {
    /** The `<repo_group_context>` block persisted on this user turn, verbatim. */
    context: string;
}

/**
 * Collapsible "Repo group context" disclosure hung under a user turn in a
 * repo-group chat.
 *
 * The block is appended to the outgoing prompt rather than the message the user
 * typed, so without this the injected member list is invisible in the
 * transcript. It renders exactly what was sent — tags included, stale members
 * already dropped — as preformatted text rather than markdown, so paths are not
 * reflowed or mangled.
 *
 * Collapsed by default; the open/closed state is local and does not persist
 * across reloads. Callers must only render this when a turn carries a context —
 * a turn without one shows no toggle at all.
 */
export function RepoGroupContextDisclosure({ context }: RepoGroupContextDisclosureProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="mt-1.5" data-testid="repo-group-context-disclosure">
            <button
                type="button"
                className={cn(
                    'inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer',
                    'text-[12px] text-[#6b7280] dark:text-[#9aa0a6] hover:text-[#1f2328] dark:hover:text-[#cccccc]',
                )}
                data-testid="repo-group-context-toggle"
                aria-expanded={expanded}
                onClick={() => setExpanded(v => !v)}
            >
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                <span>{expanded ? 'Hide repo group context' : 'Repo group context'}</span>
            </button>
            {expanded && (
                <pre
                    className={cn(
                        'mt-1.5 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]',
                        'bg-[#ffffff] dark:bg-[#1e1e1e] px-3 py-2 overflow-auto max-h-[360px]',
                        'text-[#1e1e1e] dark:text-[#cccccc]',
                        'text-[12px] leading-[1.5] whitespace-pre-wrap break-all font-mono',
                    )}
                    data-testid="repo-group-context-body"
                >
                    {context}
                </pre>
            )}
        </div>
    );
}
