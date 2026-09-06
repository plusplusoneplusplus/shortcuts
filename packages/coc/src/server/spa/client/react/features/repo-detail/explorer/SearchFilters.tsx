/**
 * SearchFilters — the Search view's `…` section: files to include, files to
 * exclude, and the "use ignore files" gear.
 *
 * The two boxes appear only when the `…` button is expanded. Because a
 * collapsed section can still be filtering the results, the button carries a dot
 * whenever any filter is off its default — the one thing that keeps a filtered
 * search from looking like an unfiltered one.
 *
 * The button is exported on its own as `SearchFiltersToggle` so a narrow panel
 * can put it on the query box's toggle row (`showToggle={false}` here) rather
 * than give one glyph a row of its own.
 *
 * Purely presentational: the panel owns the state and decides when to re-run.
 */

import { cn } from '../../../ui/cn';
import { contentSearchFiltersActive, type ContentSearchFilters } from './types';

export interface SearchFiltersToggleProps {
    expanded: boolean;
    onToggleExpanded: () => void;
    /** True when a filter is off its default, which the button marks with a dot. */
    active: boolean;
    /** Prefix for every `data-testid`, matching the SearchBar's convention. */
    testIdPrefix?: string;
}

/**
 * The `…` button on its own, so a narrow panel can put it on the query box's
 * toggle row instead of spending a whole row on one glyph.
 */
export function SearchFiltersToggle({
    expanded,
    onToggleExpanded,
    active,
    testIdPrefix = 'content-search',
}: SearchFiltersToggleProps) {
    return (
        <button
            type="button"
            onClick={onToggleExpanded}
            title={expanded ? 'Hide search details' : 'Toggle search details'}
            aria-label="Toggle search details"
            aria-expanded={expanded}
            className={cn(
                'relative px-1.5 leading-none text-sm bg-transparent border-none cursor-pointer',
                expanded ? 'text-[#1e1e1e] dark:text-[#cccccc]' : 'text-[#848484]',
            )}
            data-testid={`${testIdPrefix}-filters-toggle`}
        >
            …
            {active && (
                <span
                    className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-[#0078d4]"
                    data-testid={`${testIdPrefix}-filters-dot`}
                />
            )}
        </button>
    );
}

export interface SearchFiltersProps {
    filters: ContentSearchFilters;
    onChange: (next: ContentSearchFilters) => void;
    expanded: boolean;
    onToggleExpanded: () => void;
    /**
     * False when the host is rendering `SearchFiltersToggle` itself — the narrow
     * layout, where the `…` shares the query box's toggle row.
     */
    showToggle?: boolean;
    /** Prefix for every `data-testid`, matching the SearchBar's convention. */
    testIdPrefix?: string;
}

const FIELD_CLASS = cn(
    'w-full px-2 py-1 text-xs rounded border border-[#e0e0e0] bg-white',
    'dark:border-[#3c3c3c] dark:bg-[#3c3c3c] dark:text-[#cccccc]',
    'focus:outline-none focus:border-[#0078d4]',
);

const LABEL_CLASS = 'block text-[11px] text-[#848484] mb-0.5';

export function SearchFilters({
    filters,
    onChange,
    expanded,
    onToggleExpanded,
    showToggle = true,
    testIdPrefix = 'content-search',
}: SearchFiltersProps) {
    const active = contentSearchFiltersActive(filters);

    return (
        <div data-testid={`${testIdPrefix}-filters`}>
            {showToggle && (
                <div className="flex justify-end px-2">
                    <SearchFiltersToggle
                        expanded={expanded}
                        onToggleExpanded={onToggleExpanded}
                        active={active}
                        testIdPrefix={testIdPrefix}
                    />
                </div>
            )}

            {expanded && (
                <div className="px-2 pb-2 flex flex-col gap-1.5" data-testid={`${testIdPrefix}-filters-fields`}>
                    <div>
                        <label className={LABEL_CLASS} htmlFor={`${testIdPrefix}-include`}>
                            files to include
                        </label>
                        <input
                            id={`${testIdPrefix}-include`}
                            type="text"
                            value={filters.include}
                            onChange={e => onChange({ ...filters, include: e.target.value })}
                            placeholder="e.g. *.ts, src/**"
                            className={FIELD_CLASS}
                            data-testid={`${testIdPrefix}-include`}
                        />
                    </div>
                    <div>
                        <label className={LABEL_CLASS} htmlFor={`${testIdPrefix}-exclude`}>
                            files to exclude
                        </label>
                        <div className="relative flex items-center">
                            <input
                                id={`${testIdPrefix}-exclude`}
                                type="text"
                                value={filters.exclude}
                                onChange={e => onChange({ ...filters, exclude: e.target.value })}
                                placeholder="e.g. **/dist/**"
                                className={cn(FIELD_CLASS, 'pr-7')}
                                data-testid={`${testIdPrefix}-exclude`}
                            />
                            <button
                                type="button"
                                onClick={() => onChange({ ...filters, useIgnoreFiles: !filters.useIgnoreFiles })}
                                title="Use Exclude Settings and Ignore Files"
                                aria-label="Use Exclude Settings and Ignore Files"
                                aria-pressed={filters.useIgnoreFiles}
                                className={cn(
                                    'absolute right-1 px-1 py-0.5 rounded text-[11px] leading-none border cursor-pointer transition-colors',
                                    filters.useIgnoreFiles
                                        ? 'bg-[#0078d4] text-white border-[#0078d4]'
                                        : 'bg-transparent text-[#848484] border-transparent hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                                )}
                                data-testid={`${testIdPrefix}-ignore-toggle`}
                            >
                                ⚙
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
