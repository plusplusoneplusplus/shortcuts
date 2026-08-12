/**
 * The two states Today shows when it has no list to show: still loading, and
 * genuinely empty.
 *
 * Both are about what the user does next. A skeleton says "rows are coming, in
 * roughly this shape" where `Loading tasks…` says only "wait"; and an empty
 * list almost never means "type something in by hand" — it means nothing has
 * been pulled in yet — so the empty state leads with Sync and the notes rather
 * than pointing at the quick-add box.
 */

/** Placeholder rows in the shape of the list that is about to arrive. */
export function TodaySkeleton() {
    // Uneven widths: equal bars read as a progress indicator rather than as
    // text about to land.
    const widths = ['w-3/5', 'w-4/5', 'w-2/5'];
    return (
        <div
            className="flex flex-col gap-2"
            role="status"
            aria-label="Loading tasks"
            data-testid="my-work-today-loading"
        >
            {widths.map((width, i) => (
                <div
                    key={i}
                    className="flex items-center gap-2 animate-pulse"
                    data-testid="my-work-today-skeleton-row"
                >
                    <div className="h-3.5 w-3.5 shrink-0 rounded-sm bg-gray-200 dark:bg-gray-700" />
                    <div className={`h-3.5 rounded bg-gray-200 dark:bg-gray-700 ${width}`} />
                </div>
            ))}
        </div>
    );
}

export interface TodayEmptyStateProps {
    onSync: () => void;
    onOpenNote: (path: string) => void;
    /** True while a mutation or a sync is in flight. */
    busy?: boolean;
}

export function TodayEmptyState({ onSync, onOpenNote, busy }: TodayEmptyStateProps) {
    const linkClass = 'text-xs text-blue-600 dark:text-blue-400 hover:underline';
    return (
        <div className="flex flex-col items-start gap-2 text-sm text-gray-500 dark:text-gray-400" data-testid="my-work-today-empty">
            <span>Nothing for today.</span>
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    className="text-sm px-3 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                    onClick={onSync}
                    disabled={busy}
                    aria-busy={busy}
                    data-testid="my-work-today-empty-sync"
                >
                    {busy ? 'Syncing…' : '🔄 Sync Work IQ'}
                </button>
                <button
                    type="button"
                    className={linkClass}
                    onClick={() => onOpenNote('Action Items.md')}
                    data-testid="my-work-today-empty-open-actions"
                >
                    Action Items
                </button>
                <button
                    type="button"
                    className={linkClass}
                    onClick={() => onOpenNote('Follow Ups.md')}
                    data-testid="my-work-today-empty-open-followups"
                >
                    Follow Ups
                </button>
            </div>
            <span className="text-xs">…or add one below.</span>
        </div>
    );
}

/** Shown when a filter is on and nothing matches — distinct from a bare empty list. */
export function TodayNoMatches({ onClear }: { onClear: () => void }) {
    return (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400" data-testid="my-work-today-no-matches">
            <span>No items match this filter.</span>
            <button
                type="button"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                onClick={onClear}
                data-testid="my-work-today-filter-clear"
            >
                Clear
            </button>
        </div>
    );
}
