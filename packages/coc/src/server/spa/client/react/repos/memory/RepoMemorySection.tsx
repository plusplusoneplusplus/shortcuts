/**
 * RepoMemorySection — top-level memory section for the repo settings tab.
 *
 * Manages feed state, stats, filtering/search, and inline sub-panels.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { memoryApi } from './memoryApi';
import type { FeedItem, MemoryStats } from './memoryApi';
import { MemoryHeader } from './MemoryHeader';
import { AddNoteForm } from './AddNoteForm';
import { AggregatePanel } from './AggregatePanel';
import { FeedControls } from './FeedControls';
import type { SourceFilter } from './FeedControls';
import { FeedList } from './FeedList';

interface RepoMemorySectionProps {
    repoId: string;
    repoPath?: string;
}

export function RepoMemorySection({ repoId }: RepoMemorySectionProps) {
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [stats, setStats] = useState<MemoryStats>({ observationCount: 0, noteCount: 0, consolidatedAt: null });
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
            const [statsData, feedData] = await Promise.all([
                memoryApi.getStats(repoId),
                memoryApi.getFeed(repoId),
            ]);
            setStats(statsData);
            setFeed(feedData.items);
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

    // Client-side filtering
    const filteredFeed = feed.filter(item => {
        if (sourceFilter === 'user' && item.type !== 'note') return false;
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

    return (
        <div data-testid="repo-memory-section">
            <MemoryHeader
                observationCount={stats.observationCount}
                noteCount={stats.noteCount}
                consolidatedAt={stats.consolidatedAt}
                onAddNote={() => { setIsAddingNote(v => !v); setIsAggregating(false); }}
                onAggregate={() => { setIsAggregating(v => !v); setIsAddingNote(false); }}
            />

            {isAddingNote && (
                <AddNoteForm
                    onSave={handleSaveNote}
                    onCancel={() => setIsAddingNote(false)}
                />
            )}

            {isAggregating && (
                <AggregatePanel
                    repoId={repoId}
                    onClose={() => setIsAggregating(false)}
                    onDone={() => { setIsAggregating(false); refresh(); }}
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
        </div>
    );
}
