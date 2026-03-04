import { useState } from 'react';
import { cn } from '../../shared/cn';
import { MapItemCard } from './MapItemCard';

export interface ChildProcess {
    processId: string;
    itemIndex: number;
    status: string;
    promptPreview?: string;
    durationMs?: number;
    error?: string;
}

export interface MapItemGridProps {
    items: ChildProcess[];
    onItemClick: (processId: string) => void;
    isLive: boolean;
    isDark?: boolean;
}

type FilterValue = 'all' | 'completed' | 'failed' | 'running';

const FILTERS: { label: string; value: FilterValue }[] = [
    { label: 'All', value: 'all' },
    { label: 'Completed', value: 'completed' },
    { label: 'Failed', value: 'failed' },
    { label: 'Running', value: 'running' },
];

export function MapItemGrid({ items, onItemClick, isLive, isDark = false }: MapItemGridProps) {
    const [filter, setFilter] = useState<FilterValue>('all');

    const completedCount = items.filter(i => i.status === 'completed').length;
    const failedCount = items.filter(i => i.status === 'failed').length;
    const runningCount = items.filter(i => i.status === 'running').length;

    const filteredItems = filter === 'all'
        ? items
        : items.filter(i => i.status === filter);

    return (
        <div data-testid="map-item-grid" className="mt-3">
            {/* Filter pills */}
            <div className="flex items-center gap-2 mb-2">
                {FILTERS.map(f => (
                    <button
                        key={f.value}
                        data-testid={`map-filter-${f.value}`}
                        className={cn(
                            'flex items-center gap-2 px-3 py-1 text-sm rounded-full border',
                            filter === f.value
                                ? 'bg-[#0078d4] text-white border-[#0078d4]'
                                : 'border-[#e0e0e0] dark:border-[#3c3c3c] text-[#848484]',
                        )}
                        onClick={() => setFilter(f.value)}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Stats bar */}
            <div className="text-xs text-[#848484] mb-2" data-testid="map-item-stats">
                {completedCount} completed, {failedCount} failed, {runningCount} running
            </div>

            {/* Grid */}
            <div
                data-testid="map-item-grid-container"
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                    gap: '8px',
                }}
            >
                {filteredItems.map(item => (
                    <MapItemCard
                        key={item.processId}
                        process={item}
                        onClick={() => onItemClick(item.processId)}
                        isDark={isDark}
                    />
                ))}
            </div>

            {filteredItems.length === 0 && (
                <div className="text-xs text-[#848484] text-center py-4">
                    No items match the current filter.
                </div>
            )}
        </div>
    );
}
