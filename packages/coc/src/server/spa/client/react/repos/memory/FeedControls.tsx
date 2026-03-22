/**
 * FeedControls — source filter dropdown + search bar row.
 * Filtering is client-side; no network calls are made here.
 */

import React from 'react';

export type SourceFilter = 'all' | 'user' | 'ai';

interface FeedControlsProps {
    sourceFilter: SourceFilter;
    searchQuery: string;
    onChange: (filter: SourceFilter, query: string) => void;
}

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'user', label: '👤 You' },
    { value: 'ai', label: '🤖 AI' },
];

export function FeedControls({ sourceFilter, searchQuery, onChange }: FeedControlsProps) {
    return (
        <div className="flex items-center gap-2 mb-3" data-testid="feed-controls">
            <span className="text-[11px] text-[#848484]">Source:</span>
            <select
                value={sourceFilter}
                onChange={e => onChange(e.target.value as SourceFilter, searchQuery)}
                className="text-xs px-2 py-1 border border-[#c8c8c8] dark:border-[#555] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                data-testid="feed-source-filter"
            >
                {SOURCE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
            <div className="flex-1 relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#848484] text-xs select-none">🔍</span>
                <input
                    type="text"
                    placeholder="Search…"
                    value={searchQuery}
                    onChange={e => onChange(sourceFilter, e.target.value)}
                    className="w-full pl-6 pr-2 py-1 text-xs border border-[#c8c8c8] dark:border-[#555] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                    data-testid="feed-search-input"
                />
            </div>
        </div>
    );
}
