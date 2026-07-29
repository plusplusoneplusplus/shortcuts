/**
 * DiffFindWidget — the small VSCode-style find overlay for the in-diff Ctrl+F
 * search. It is a thin, controlled view over `useDiffFind`: the host owns all
 * search state and wiring (query, case toggle, match navigation, scroll-into-
 * view); this component just renders the input, the "N of M" / "No results"
 * counter, the case-sensitivity toggle, and handles the widget-local keys
 * (Enter → next, Shift+Enter → previous, Esc → close).
 *
 * It intentionally holds no state of its own so it stays trivially testable and
 * reusable across both viewer modes. Styling reuses the diff panel's theme
 * tokens so it reads correctly in light and dark themes.
 */

import { useEffect, useRef } from 'react';

export interface DiffFindWidgetProps {
    /** Current search query (controlled). */
    query: string;
    /** Whether matching is case-sensitive. */
    caseSensitive: boolean;
    /** Total number of matches across the full diff model. */
    matchCount: number;
    /** Index of the active match into the match list, or -1 when there are none. */
    activeIndex: number;
    onQueryChange: (query: string) => void;
    onToggleCaseSensitive: () => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
}

/**
 * Renders the "N of M" match counter, or "No results" when a non-empty query
 * matches nothing, or an empty string while the query is blank.
 */
function formatMatchCount(query: string, matchCount: number, activeIndex: number): string {
    if (query.length === 0) return '';
    if (matchCount === 0) return 'No results';
    // activeIndex is 0-based; display it 1-based.
    const current = activeIndex >= 0 ? activeIndex + 1 : 0;
    return `${current} of ${matchCount}`;
}

export function DiffFindWidget({
    query,
    caseSensitive,
    matchCount,
    activeIndex,
    onQueryChange,
    onToggleCaseSensitive,
    onNext,
    onPrev,
    onClose,
}: DiffFindWidgetProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus (and select) the input when the widget mounts so Ctrl+F lands the
    // caret ready to type — and re-selects on reopen since the query persists.
    useEffect(() => {
        const input = inputRef.current;
        if (!input) return;
        input.focus();
        input.select();
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) onPrev();
            else onNext();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
        }
    };

    const noResults = query.length > 0 && matchCount === 0;

    return (
        <div
            className="absolute top-2 right-2 z-20 flex items-center gap-1 rounded border border-[#e0e0e0] bg-white px-2 py-1 shadow-md dark:border-[#3c3c3c] dark:bg-[#252526]"
            data-testid="diff-find-widget"
            role="search"
        >
            <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Find in diff"
                aria-label="Find in diff"
                className={
                    'h-6 w-40 rounded border bg-transparent px-1.5 text-xs text-[#1e1e1e] outline-none focus:border-[#0078d4] dark:text-[#ccc] dark:focus:border-[#3794ff] ' +
                    (noResults
                        ? 'border-[#d32f2f] dark:border-[#f48771]'
                        : 'border-[#e0e0e0] dark:border-[#3c3c3c]')
                }
                data-testid="diff-find-input"
            />
            <span
                className={
                    'min-w-[3.5rem] select-none text-center text-[11px] tabular-nums ' +
                    (noResults
                        ? 'text-[#d32f2f] dark:text-[#f48771]'
                        : 'text-[#616161] dark:text-[#999]')
                }
                data-testid="diff-find-count"
                aria-live="polite"
            >
                {formatMatchCount(query, matchCount, activeIndex)}
            </span>
            <button
                type="button"
                onClick={onToggleCaseSensitive}
                title="Match case"
                aria-label="Match case"
                aria-pressed={caseSensitive}
                className={
                    'inline-flex h-6 w-6 items-center justify-center rounded text-[11px] font-medium ' +
                    (caseSensitive
                        ? 'border border-[#0078d4] bg-[#ddeeff] text-[#005a9e] dark:border-[#3794ff] dark:bg-[#1e3a5f] dark:text-[#79c0ff]'
                        : 'border border-transparent text-[#616161] hover:bg-black/[0.06] dark:text-[#999] dark:hover:bg-white/[0.08]')
                }
                data-testid="diff-find-case-toggle"
            >
                Aa
            </button>
            <button
                type="button"
                onClick={onPrev}
                title="Previous match (Shift+Enter)"
                aria-label="Previous match"
                disabled={matchCount === 0}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[13px] text-[#616161] hover:bg-black/[0.06] disabled:opacity-40 disabled:hover:bg-transparent dark:text-[#999] dark:hover:bg-white/[0.08]"
                data-testid="diff-find-prev"
            >
                ↑
            </button>
            <button
                type="button"
                onClick={onNext}
                title="Next match (Enter)"
                aria-label="Next match"
                disabled={matchCount === 0}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[13px] text-[#616161] hover:bg-black/[0.06] disabled:opacity-40 disabled:hover:bg-transparent dark:text-[#999] dark:hover:bg-white/[0.08]"
                data-testid="diff-find-next"
            >
                ↓
            </button>
            <button
                type="button"
                onClick={onClose}
                title="Close (Esc)"
                aria-label="Close find"
                className="inline-flex h-6 w-6 items-center justify-center rounded text-[13px] text-[#616161] hover:bg-black/[0.06] dark:text-[#999] dark:hover:bg-white/[0.08]"
                data-testid="diff-find-close"
            >
                ✕
            </button>
        </div>
    );
}
