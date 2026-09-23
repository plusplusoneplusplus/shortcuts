/**
 * ContentSearchOverlay — the centered, keyboard-first dialog behind
 * Ctrl/Cmd+Shift+F.
 *
 * This is the shell only: it owns the dialog chrome, the query field and the
 * keyboard model over a flat list of match rows. The search request, the mode
 * toggles and repository/file grouping arrive in later slices and plug in
 * through props, so nothing here knows how a match was produced.
 *
 * The keyboard model is a single roving selection with `-1` meaning "the query
 * field has focus":
 *
 *  - ArrowDown/ArrowUp walk the visible matches, and walking back off the top
 *    returns to the query rather than trapping the user in the list;
 *  - Enter opens the selected match, or submits the query when the selection is
 *    still on the query field or on one of the search controls;
 *  - Escape closes, and the host restores focus to whatever invoked the
 *    overlay.
 *
 * Selection lives here rather than on the DOM's own focus so a re-render with
 * fresh results cannot silently move the user: the index is clamped back into
 * range whenever the match list changes.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../../ui/cn';
import { usePortalContainer } from '../../../ui/usePortalContainer';
import type { ContentSearchScope } from './contentSearchShortcut';

/** One selectable row. Carries the owner identity the open path needs (AC-04). */
export interface ContentSearchOverlayMatch {
    /** Stable within a result set; used for React keys and test selection. */
    id: string;
    /** Member workspace the match belongs to — a group result spans several. */
    workspaceId: string;
    /** Concrete clone owner for the follow-up read, when the member is a clone. */
    routingRef?: string | null;
    /** Member label, shown only in a group scope. */
    repoLabel?: string | null;
    /** Repo-relative path. Never an absolute filesystem root. */
    path: string;
    /** One-based line number of the match. */
    line: number;
    /** The matching line, already trimmed by the server. */
    preview: string;
}

export interface ContentSearchOverlayProps {
    open: boolean;
    /** Decides the dialog's accessible name and whether member labels show. */
    scope: ContentSearchScope;
    query: string;
    onQueryChange: (query: string) => void;
    /** Enter from the query or the search controls — the only thing that searches. */
    onSubmit: () => void;
    onClose: () => void;
    matches: ContentSearchOverlayMatch[];
    onOpenMatch: (match: ContentSearchOverlayMatch) => void;
    /** A search is in flight. */
    busy?: boolean;
    /** Status line under the query: no results, errors, truncation notices. */
    status?: ReactNode;
    /**
     * Bump to pull focus back into the query and select it. A counter, not a
     * boolean, because repeating the shortcut while the overlay is already up
     * has to re-focus an overlay that never unmounted.
     */
    focusToken?: number;
}

const QUERY_SELECTION = -1;

export function ContentSearchOverlay(props: ContentSearchOverlayProps) {
    const {
        open,
        scope,
        query,
        onQueryChange,
        onSubmit,
        onClose,
        matches,
        onOpenMatch,
        busy,
        status,
        focusToken = 0,
    } = props;
    const portalContainer = usePortalContainer(open);
    const queryRef = useRef<HTMLInputElement | null>(null);
    const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const [selected, setSelected] = useState(QUERY_SELECTION);

    // Opening, and every repeat of the shortcut, puts the caret in the query
    // with the previous term selected so typing replaces it. A passive effect,
    // not a layout one: the portal container is attached by `usePortalContainer`
    // in its own effect, and focusing a detached input is a no-op.
    useEffect(() => {
        if (!open) return;
        setSelected(QUERY_SELECTION);
        const input = queryRef.current;
        if (input === null) return;
        input.focus();
        input.select();
    }, [open, focusToken]);

    // A new result set must not leave the selection pointing past the end.
    useEffect(() => {
        setSelected((current) =>
            current >= matches.length ? matches.length - 1 : current,
        );
    }, [matches]);

    // Move DOM focus to follow the selection, so screen readers and the browser
    // agree with the highlighted row.
    useEffect(() => {
        if (!open) return;
        if (selected === QUERY_SELECTION) return;
        rowRefs.current[selected]?.focus();
    }, [open, selected]);

    const onKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
                return;
            }
            if (event.key === 'ArrowDown') {
                if (matches.length === 0) return;
                event.preventDefault();
                setSelected((current) => Math.min(current + 1, matches.length - 1));
                return;
            }
            if (event.key === 'ArrowUp') {
                if (matches.length === 0) return;
                event.preventDefault();
                setSelected((current) => {
                    const next = current - 1;
                    if (next < QUERY_SELECTION) return QUERY_SELECTION;
                    if (next === QUERY_SELECTION) {
                        queryRef.current?.focus();
                    }
                    return next;
                });
                return;
            }
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                const match = selected >= 0 ? matches[selected] : undefined;
                if (match) onOpenMatch(match);
                else onSubmit();
            }
        },
        [matches, onClose, onOpenMatch, onSubmit, selected],
    );

    if (!open || portalContainer === null) return null;

    const title = scope === 'group' ? 'Search repository group' : 'Search repository';

    return createPortal(
        <div
            className="fixed inset-0 z-[10002] flex items-start justify-center bg-black/40 dark:bg-black/60 pt-[10vh]"
            data-testid="content-search-overlay-backdrop"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                data-testid="content-search-overlay"
                className="w-full max-w-2xl max-h-[70vh] flex flex-col rounded-lg border border-[#c8c8c8] dark:border-[#555555] bg-white dark:bg-[#252526] shadow-xl overflow-hidden"
                onKeyDown={onKeyDown}
            >
                <div className="flex items-center gap-2 p-3 border-b border-[#e5e5e5] dark:border-[#3c3c3c]">
                    <input
                        ref={queryRef}
                        type="text"
                        aria-label="Search query"
                        data-testid="content-search-overlay-query"
                        placeholder="Search tracked files"
                        className="flex-1 px-2 py-1 text-sm bg-transparent border border-[#c8c8c8] dark:border-[#555555] rounded outline-none focus:border-[#0078d4]"
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                    />
                    <button
                        type="button"
                        aria-label="Close search"
                        data-testid="content-search-overlay-close"
                        className="px-2 text-[#616161] dark:text-[#cccccc]"
                        onClick={onClose}
                    >
                        ✕
                    </button>
                </div>
                <div
                    role="status"
                    aria-live="polite"
                    data-testid="content-search-overlay-status"
                    className="px-3 py-1 text-xs text-[#616161] dark:text-[#a0a0a0] min-h-[1.5rem]"
                >
                    {busy ? 'Searching…' : status}
                </div>
                <div
                    role="listbox"
                    aria-label="Search results"
                    data-testid="content-search-overlay-results"
                    className="flex-1 overflow-auto"
                >
                    {matches.map((match, index) => (
                        <button
                            key={match.id}
                            ref={(node) => {
                                rowRefs.current[index] = node;
                            }}
                            type="button"
                            role="option"
                            aria-selected={index === selected}
                            tabIndex={index === selected ? 0 : -1}
                            data-testid={`content-search-overlay-match-${match.id}`}
                            className={cn(
                                'w-full flex items-baseline gap-2 px-3 py-1 text-left text-xs',
                                index === selected && 'bg-[#e8e8e8] dark:bg-[#37373d]',
                            )}
                            onClick={() => {
                                setSelected(index);
                                onOpenMatch(match);
                            }}
                        >
                            {scope === 'group' && match.repoLabel ? (
                                <span className="shrink-0 font-medium">{match.repoLabel}</span>
                            ) : null}
                            <span className="shrink-0 text-[#616161] dark:text-[#a0a0a0]">
                                {match.path}:{match.line}
                            </span>
                            <span className="truncate font-mono">{match.preview}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>,
        portalContainer,
    );
}
