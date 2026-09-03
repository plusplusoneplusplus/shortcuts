/**
 * ContentSearchToolbar — the Search view's own header buttons, VS Code's
 * Refresh / Clear / Collapse All / View as Tree strip.
 *
 * The Files view's toolbar (collapse all, reveal, refresh) is about the tree and
 * says nothing useful in Search, so ExplorerPanel hides it here and this strip
 * takes its place at the top of the panel.
 *
 * Purely presentational: the panel owns the query and the result state and
 * decides what each action means. Every button is disabled without a query —
 * there is nothing to refresh, clear, or collapse until one exists.
 */

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
    /** Prefix for every `data-testid`, matching the SearchBar's convention. */
    testIdPrefix?: string;
}

const BUTTON_CLASS = cn(
    'px-1 leading-none text-xs bg-transparent border-none cursor-pointer transition-colors',
    'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
    'disabled:opacity-40 disabled:cursor-default disabled:hover:text-[#848484]',
);

export function ContentSearchToolbar({
    enabled,
    onRefresh,
    onClear,
    onCollapseAll,
    resultView,
    onToggleResultView,
    testIdPrefix = 'content-search',
}: ContentSearchToolbarProps) {
    // The button names the layout it switches *to*, as VS Code's does: showing a
    // list, it offers "View as Tree".
    const treeShowing = resultView === 'tree';
    const actions = [
        { id: 'refresh', label: '↻', title: 'Refresh', onClick: onRefresh },
        { id: 'clear-results', label: '⊘', title: 'Clear search results', onClick: onClear },
        {
            id: 'view-mode',
            label: treeShowing ? '☰' : '⌸',
            title: treeShowing ? 'View as List' : 'View as Tree',
            onClick: onToggleResultView,
        },
        { id: 'collapse-all', label: '⊟', title: 'Collapse all', onClick: onCollapseAll },
    ];

    return (
        <div
            className="flex items-center justify-end gap-1 px-2 pt-1"
            data-testid={`${testIdPrefix}-toolbar`}
        >
            {actions.map(action => (
                <button
                    key={action.id}
                    type="button"
                    onClick={action.onClick}
                    disabled={!enabled}
                    title={action.title}
                    aria-label={action.title}
                    className={BUTTON_CLASS}
                    data-testid={`${testIdPrefix}-${action.id}`}
                    data-result-view={action.id === 'view-mode' ? resultView : undefined}
                >
                    {action.label}
                </button>
            ))}
        </div>
    );
}
