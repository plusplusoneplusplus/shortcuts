/**
 * RepoMemorySection — top-level memory section for the repo settings tab.
 *
 * Sub-tabbed interface: Feed (default) | Consolidated.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { memoryApi } from './memoryApi';
import type { FeedItem, MemoryStats } from './memoryApi';
import { MemoryHeader } from './MemoryHeader';
import { AddNoteForm } from './AddNoteForm';
import { AggregatePanel } from './AggregatePanel';
import { ConsolidatedTab } from './ConsolidatedTab';
import { FeedControls } from './FeedControls';
import type { SourceFilter } from './FeedControls';
import { FeedList } from './FeedList';
import { cn } from '../../shared/cn';

type MemoryTab = 'feed' | 'consolidated';

interface RepoMemorySectionProps {
    repoId: string;
    repoPath?: string;
}

export function RepoMemorySection({ repoId }: RepoMemorySectionProps) {
    const [activeTab, setActiveTab] = useState<MemoryTab>('feed');
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [stats, setStats] = useState<MemoryStats>({ observationCount: 0, noteCount: 0, consolidatedAt: null, consolidationStatus: 'idle' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isAddingNote, setIsAddingNote] = useState(false);
    const [isAggregating, setIsAggregating] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await memoryApi.getOverview(repoId);
            const { items, totalCount: _, ...statsData } = data;
            setStats(statsData);
            setFeed(items);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load memory');
        } finally {
            setLoading(false);
        }
    }, [repoId]);

    useEffect(() => { refresh(); }, [refresh]);

    const handleSaveNote = async (content: string, tags: string[]) => {
        const newItem = await memoryApi.addNote(repoId, content, tags);
        setFeed(prev => [newItem, ...prev]);
        setStats(prev => ({ ...prev, noteCount: prev.noteCount + 1 }));
        setIsAddingNote(false);
    };

    const handleDelete = async (id: string, type: string) => {
        await memoryApi.deleteFeedItem(repoId, id, type);
        setFeed(prev => prev.filter(item => item.id !== id));
        setStats(prev => ({
            ...prev,
            observationCount: type === 'observation' ? Math.max(0, prev.observationCount - 1) : prev.observationCount,
            noteCount: type === 'note' ? Math.max(0, prev.noteCount - 1) : prev.noteCount,
        }));
    };

    const handleFilterChange = (filter: SourceFilter, query: string) => {
        setSourceFilter(filter);
        setSearchQuery(query);
    };

    const openAggregate = () => {
        setIsAggregating(v => !v);
        setIsAddingNote(false);
    };

    // Client-side filtering
    const filteredFeed = feed.filter(item => {
        if (sourceFilter === 'user' && (item.type !== 'note' || item.source === 'conversation')) return false;
        if (sourceFilter === 'conversation' && (item.type !== 'note' || item.source !== 'conversation')) return false;
        if (sourceFilter === 'ai' && item.type !== 'observation') return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return (
                item.content.toLowerCase().includes(q) ||
                item.source.toLowerCase().includes(q) ||
                item.tags.some(t => t.toLowerCase().includes(q))
            );
        }
        return true;
    });

    const TABS: { id: MemoryTab; label: string }[] = [
        { id: 'feed', label: 'Feed' },
        { id: 'consolidated', label: 'Consolidated' },
    ];

    return (
        <div data-testid="repo-memory-section">
            <MemoryHeader
                observationCount={stats.observationCount}
                noteCount={stats.noteCount}
                onAddNote={() => { setActiveTab('feed'); setIsAddingNote(v => !v); setIsAggregating(false); }}
                onAggregate={openAggregate}
            />

            {/* Sub-tab bar */}
            <div className="flex items-center gap-1 mb-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="memory-tab-bar">
                {TABS.map(({ id, label }) => (
                    <button
                        key={id}
                        className={cn(
                            'h-8 px-3 text-sm transition-colors border-b-2',
                            activeTab === id
                                ? 'border-[#0078d4] text-[#0078d4] font-medium'
                                : 'border-transparent text-[#616161] dark:text-[#999999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                        )}
                        data-testid={`memory-tab-${id}`}
                        onClick={() => setActiveTab(id)}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {isAggregating && (
                <AggregatePanel
                    repoId={repoId}
                    consolidationStatus={stats.consolidationStatus}
                    consolidationProcessId={stats.consolidationProcessId}
                    consolidationTaskId={stats.consolidationTaskId}
                    onClose={() => setIsAggregating(false)}
                    onDone={() => { setIsAggregating(false); refresh(); }}
                />
            )}

            {/* Feed tab */}
            {activeTab === 'feed' && (
                <>
                    {isAddingNote && (
                        <AddNoteForm
                            onSave={handleSaveNote}
                            onCancel={() => setIsAddingNote(false)}
                        />
                    )}

                    <FeedControls
                        sourceFilter={sourceFilter}
                        searchQuery={searchQuery}
                        onChange={handleFilterChange}
                    />

                    {loading ? (
                        <div className="text-xs text-[#848484] py-4 text-center" data-testid="memory-loading">
                            Loading…
                        </div>
                    ) : error ? (
                        <div className="text-xs text-red-500 py-4" data-testid="memory-error">{error}</div>
                    ) : (
                        <FeedList items={filteredFeed} onDelete={handleDelete} />
                    )}
                </>
            )}

            {/* Consolidated tab */}
            {activeTab === 'consolidated' && (
                <ConsolidatedTab
                    repoId={repoId}
                    consolidatedAt={stats.consolidatedAt}
                    consolidationStatus={stats.consolidationStatus}
                    consolidationProcessId={stats.consolidationProcessId}
                    consolidationTaskId={stats.consolidationTaskId}
                    onAggregate={openAggregate}
                />
            )}
        </div>
    );
}
