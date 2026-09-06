/**
 * ContentSearchToolbar — the Search view's own header buttons, VS Code's
 * Refresh / Clear / Collapse All / View as Tree strip.
 *
 * The Files view's toolbar (collapse all, reveal, refresh) is about the tree and
 * says nothing useful in Search, so ExplorerPanel hides it there and this strip
 * takes its place in the same header row — a strip of its own would cost the
 * panel a whole row while the header sat empty.
 *
 * Purely presentational: the panel owns the query and the result state and
 * decides what each action means. Every button is disabled without a query —
 * there is nothing to refresh, clear, or collapse until one exists.
 *
 * `narrow` keeps only the three most-used actions inline and folds the rest
 * behind `⋯`; six glyphs do not fit beside the Files / Search tabs at 250px.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '../../../ui/cn';
import type { ContentSearchResultView } from './types';

export interface ContentSearchToolbarProps {
    /** False disables every button — no query means nothing to act on. */
    enabled: boolean;
    /** Re-run the current query now, bypassing the debounce. */
    onRefresh: () => void;
    /** Clear the query, the filters, and with them the results. */
    onClear: () => void;
    /** Collapse every result group. */
    onCollapseAll: () => void;
    /** Current result layout — the toggle button reports and flips it. */
    resultView: ContentSearchResultView;
    /** Switch between the flat list and the directory tree. */
    onToggleResultView: () => void;
    /**
     * Render the result set as a read-only text buffer. Gated on `hasResults`
     * as well as `enabled`: a query with nothing to show would export a header
     * and no body, which is not worth a pane.
     */
    onOpenInEditor: () => void;
    /** True when the current result set has at least one match. */
    hasResults?: boolean;
    /**
     * Rewrite every match on screen with the current replacement. The panel
     * confirms first — this is the only Explorer control that writes to disk
     * without opening a file.
     */
    onReplaceAll: () => void;
    /**
     * True when a replace is possible: the replace row is showing, the query is
     * one the endpoint accepts, and there is at least one match on screen. The
     * panel decides all three — the last of them is §2.2's "disabled at 0
     * results" — and this button asks nothing else.
     */
    canReplaceAll?: boolean;
    /**
     * Show three actions inline and the other three behind `⋯`. Ordered by how
     * often they are reached for, not by the order of the full strip.
     */
    narrow?: boolean;
    /** Prefix for every `data-testid`, matching the SearchBar's convention. */
    testIdPrefix?: string;
}

const BUTTON_CLASS = cn(
    'px-1 leading-none text-xs bg-transparent border-none cursor-pointer transition-colors',
    'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
    'disabled:opacity-40 disabled:cursor-default disabled:hover:text-[#848484]',
);

const MENU_ITEM_CLASS = cn(
    'flex w-full items-center gap-2 px-2 py-1 text-left text-xs bg-transparent border-none cursor-pointer',
    'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#37373d]',
    'disabled:opacity-40 disabled:cursor-default disabled:hover:bg-transparent',
);

interface ToolbarAction {
    id: string;
    label: string;
    title: string;
    onClick: () => void;
    disabled?: boolean;
}

/** Ids kept inline when `narrow`, most-reached-for first. */
const NARROW_INLINE_IDS = ['refresh', 'clear-results', 'view-mode'] as const;

export function ContentSearchToolbar({
    enabled,
    onRefresh,
    onClear,
    onCollapseAll,
    resultView,
    onToggleResultView,
    onOpenInEditor,
    hasResults = false,
    onReplaceAll,
    canReplaceAll = false,
    narrow = false,
    testIdPrefix = 'content-search',
}: ContentSearchToolbarProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // A menu left hanging over the results after a click elsewhere is worse than
    // no menu; it also has to close when the whole strip goes inert.
    useEffect(() => {
        if (!menuOpen) return;
        const onPointerDown = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown);
        return () => document.removeEventListener('mousedown', onPointerDown);
    }, [menuOpen]);
    useEffect(() => {
        if (!narrow || !enabled) setMenuOpen(false);
    }, [narrow, enabled]);

    // The button names the layout it switches *to*, as VS Code's does: showing a
    // list, it offers "View as Tree".
    const treeShowing = resultView === 'tree';
    const actions: ToolbarAction[] = [
        { id: 'refresh', label: '↻', title: 'Refresh', onClick: onRefresh },
        { id: 'clear-results', label: '⊘', title: 'Clear search results', onClick: onClear },
        {
            id: 'view-mode',
            label: treeShowing ? '☰' : '⌸',
            title: treeShowing ? 'View as List' : 'View as Tree',
            onClick: onToggleResultView,
        },
        { id: 'collapse-all', label: '⊟', title: 'Collapse all', onClick: onCollapseAll },
        {
            id: 'replace-all',
            label: '⇄',
            title: 'Replace All',
            onClick: onReplaceAll,
            disabled: !canReplaceAll,
        },
        {
            id: 'open-in-editor',
            label: '⎘',
            title: 'Open in editor',
            onClick: onOpenInEditor,
            disabled: !hasResults,
        },
    ];

    const inline = narrow
        ? NARROW_INLINE_IDS.map(id => actions.find(action => action.id === id)!)
        : actions;
    const overflow = narrow ? actions.filter(action => !NARROW_INLINE_IDS.includes(action.id as never)) : [];

    const renderButton = (action: ToolbarAction) => (
        <button
            key={action.id}
            type="button"
            onClick={action.onClick}
            disabled={!enabled || action.disabled === true}
            title={action.title}
            aria-label={action.title}
            className={BUTTON_CLASS}
            data-testid={`${testIdPrefix}-${action.id}`}
            data-result-view={action.id === 'view-mode' ? resultView : undefined}
        >
            {action.label}
        </button>
    );

    return (
        <div className="flex items-center justify-end gap-1" data-testid={`${testIdPrefix}-toolbar`}>
            {inline.map(renderButton)}
            {overflow.length > 0 && (
                <div className="relative" ref={menuRef}>
                    <button
                        type="button"
                        onClick={() => setMenuOpen(open => !open)}
                        disabled={!enabled}
                        title="More search actions"
                        aria-label="More search actions"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        className={BUTTON_CLASS}
                        data-testid={`${testIdPrefix}-more`}
                    >
                        ⋯
                    </button>
                    {menuOpen && (
                        <div
                            role="menu"
                            className={cn(
                                'absolute right-0 top-full z-20 mt-1 min-w-[10rem] py-1 rounded shadow-lg',
                                'border border-[#e0e0e0] bg-white dark:border-[#3c3c3c] dark:bg-[#252526]',
                            )}
                            data-testid={`${testIdPrefix}-more-menu`}
                        >
                            {overflow.map(action => (
                                <button
                                    key={action.id}
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setMenuOpen(false); action.onClick(); }}
                                    disabled={!enabled || action.disabled === true}
                                    title={action.title}
                                    aria-label={action.title}
                                    className={MENU_ITEM_CLASS}
                                    data-testid={`${testIdPrefix}-${action.id}`}
                                    data-result-view={action.id === 'view-mode' ? resultView : undefined}
                                >
                                    <span aria-hidden="true">{action.label}</span>
                                    {action.title}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
