import React, { useState } from 'react';
import { cn } from '../../../ui/cn';
import { MarkdownView } from '../../../shared/MarkdownView';
import { chatMarkdownToHtml } from './markdownHtml';

export interface CompactionSummaryDisclosureProps {
    /** The provider-generated summary persisted on the compaction result turn. */
    summary: string;
    /** Workspace ID — forwarded to the markdown renderer for file-path links. */
    wsId?: string;
}

/**
 * Collapsible "Show summary" disclosure hung under the counts line of a
 * compaction result turn (AC-02).
 *
 * The summary lives on the same display-only turn as the "Context compacted —
 * removed N messages, freed ~T tokens" line, so this renders inline in that
 * bubble rather than as a separate turn, panel, or canvas. Collapsed by
 * default; the open/closed state is local and intentionally does not persist
 * across reloads.
 *
 * Callers must only render this when a summary exists — a turn without one
 * (the Codex path, and every turn recorded before the field existed) shows no
 * toggle at all (AC-03).
 */
export function CompactionSummaryDisclosure({ summary, wsId }: CompactionSummaryDisclosureProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className="mt-1.5" data-testid="compaction-summary-disclosure">
            <button
                type="button"
                className={cn(
                    'inline-flex items-center gap-1 bg-transparent border-none p-0 cursor-pointer',
                    'text-[12px] text-[#6b7280] dark:text-[#9aa0a6] hover:text-[#1f2328] dark:hover:text-[#cccccc]',
                )}
                data-testid="compaction-summary-toggle"
                aria-expanded={expanded}
                onClick={() => setExpanded(v => !v)}
            >
                <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                <span>{expanded ? 'Hide summary' : 'Show summary'}</span>
            </button>
            {expanded && (
                <div
                    className={cn(
                        'mt-1.5 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]',
                        'bg-[#ffffff] dark:bg-[#1e1e1e] px-3 py-2 overflow-auto max-h-[360px]',
                    )}
                    data-testid="compaction-summary-body"
                >
                    <MarkdownView html={chatMarkdownToHtml(summary, wsId)} />
                </div>
            )}
        </div>
    );
}
