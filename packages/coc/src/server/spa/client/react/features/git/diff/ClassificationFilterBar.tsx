import { HUNK_CATEGORIES, CATEGORY_LABELS } from '../../pull-requests/classification-types';
import type { UseClassificationReturn } from './useClassification';

/** Category filters shown once classification results are ready. */
export function ClassificationFilterBar({ classification, testIdPrefix }: { classification: UseClassificationReturn; testIdPrefix: string }) {
    if (classification.state.status !== 'ready') return null;
    return (
        <div className="flex items-center gap-3 px-3 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f5f5f5] dark:bg-[#262626]" data-testid={`${testIdPrefix}-filter-bar`}>
            <span className="text-[10px] text-[#616161] dark:text-[#999] font-medium">Filter:</span>
            {HUNK_CATEGORIES.map(cat => {
                const active = classification.state.activeFilters.has(cat);
                return (
                    <label key={cat} className="flex items-center gap-1 text-[11px] cursor-pointer select-none" data-testid={`${testIdPrefix}-filter-${cat}`}>
                        <input type="checkbox" checked={active} onChange={() => classification.toggleFilter(cat)} className="h-3 w-3 rounded" />
                        <span className={active ? 'text-[#1e1e1e] dark:text-[#ccc]' : 'text-[#848484]'}>{CATEGORY_LABELS[cat]}</span>
                    </label>
                );
            })}
        </div>
    );
}
