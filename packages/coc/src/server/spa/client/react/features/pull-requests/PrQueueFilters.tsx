/**
 * Filter pill row for the PR review command queue: All / Mine /
 * Blocked / Ready. The active pill controls both server scope and
 * client-side queue grouping in `PullRequestsTab`.
 */

import { cn } from '../../ui';
import {
    getQueueFilterDefinitions,
    type QueueFilter,
    type QueueFilterCounts,
} from './pr-mock-data';

interface PrQueueFiltersProps {
    active: QueueFilter;
    counts: QueueFilterCounts;
    onChange: (filter: QueueFilter) => void;
    suggestionsEnabled?: boolean;
}

export function PrQueueFilters({ active, counts, onChange, suggestionsEnabled }: PrQueueFiltersProps) {
    const filters = getQueueFilterDefinitions({ suggestionsEnabled });
    return (
        <div
            role="toolbar"
            aria-label="Queue filters"
            className="flex flex-wrap gap-1 border-b border-gray-200 px-2.5 py-1.5 dark:border-gray-700"
            data-testid="pr-queue-filters"
        >
            {filters.map(filter => {
                const isActive = filter.id === active;
                const count = counts[filter.id];
                return (
                    <button
                        key={filter.id}
                        type="button"
                        onClick={() => onChange(filter.id)}
                        aria-pressed={isActive}
                        className={cn(
                            'inline-flex min-h-[22px] items-center rounded-full border px-[7px] py-px text-xs font-semibold transition-colors',
                            isActive
                                ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-200 dark:bg-gray-100 dark:text-gray-900'
                                : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/60',
                        )}
                        data-testid={`pr-queue-filter-${filter.id}`}
                        data-active={isActive}
                    >
                        {filter.label} {count}
                    </button>
                );
            })}
        </div>
    );
}
