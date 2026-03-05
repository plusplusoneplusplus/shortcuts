/**
 * MemoryEntriesPanel — searchable, paginated list of memory entries.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../../utils/config';
import { Button, Card, Spinner } from '../../shared';

interface MemoryIndexRecord {
    id: string;
    summary?: string;
    tags: string[];
    source: string;
    createdAt: string;
    updatedAt: string;
}

interface MemoryListResult {
    entries: MemoryIndexRecord[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

interface MemoryEntry extends MemoryIndexRecord {
    content: string;
}

export function MemoryEntriesPanel() {
    const [result, setResult] = useState<MemoryListResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [tagFilter, setTagFilter] = useState('');
    const [page, setPage] = useState(1);
    const [selectedEntry, setSelectedEntry] = useState<MemoryEntry | null>(null);
    const [viewLoading, setViewLoading] = useState(false);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const fetchEntries = useCallback(async (q: string, tag: string, p: number) => {
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            if (q) params.set('q', q);
            if (tag) params.set('tag', tag);
            params.set('page', String(p));
            const res = await fetch(`${getApiBase()}/memory/entries?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: MemoryListResult = await res.json();
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchEntries(searchQuery, tagFilter, page);
    }, [fetchEntries, searchQuery, tagFilter, page]);

    const handleView = async (id: string) => {
        setViewLoading(true);
        try {
            const res = await fetch(`${getApiBase()}/memory/entries/${encodeURIComponent(id)}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const entry: MemoryEntry = await res.json();
            setSelectedEntry(entry);
        } catch {
            // ignore
        } finally {
            setViewLoading(false);
        }
    };

    const handleDelete = async (id: string) => {
        try {
            const res = await fetch(`${getApiBase()}/memory/entries/${encodeURIComponent(id)}`, {
                method: 'DELETE',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setDeleteConfirmId(null);
            if (selectedEntry?.id === id) setSelectedEntry(null);
            fetchEntries(searchQuery, tagFilter, page);
        } catch {
            // ignore
        }
    };

    return (
        <div className="p-4 space-y-4">
            {/* Search and tag filter */}
            <div className="flex gap-2 flex-wrap">
                <input
                    type="text"
                    placeholder="Search entries…"
                    value={searchQuery}
                    onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
                    className="flex-1 min-w-40 h-8 px-3 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                />
                <input
                    type="text"
                    placeholder="Filter by tag…"
                    value={tagFilter}
                    onChange={e => { setTagFilter(e.target.value); setPage(1); }}
                    className="w-36 h-8 px-3 text-sm border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4]"
                />
            </div>

            {/* Status */}
            {loading && <div className="flex justify-center py-8"><Spinner /></div>}
            {error && <p className="text-sm text-red-500">{error}</p>}

            {/* Entry list */}
            {!loading && result && (
                <>
                    <div className="space-y-2">
                        {result.entries.length === 0 && (
                            <p className="text-sm text-[#888] py-4 text-center">No memory entries found.</p>
                        )}
                        {result.entries.map(entry => (
                            <Card key={entry.id} className="p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <p className="text-sm text-[#1e1e1e] dark:text-[#cccccc] truncate">
                                            {entry.summary ?? `(entry ${entry.id.slice(0, 8)})`}
                                        </p>
                                        <div className="flex flex-wrap gap-1 mt-1">
                                            {entry.tags.map(tag => (
                                                <span
                                                    key={tag}
                                                    className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078d4]/10 text-[#0078d4] dark:text-[#4fc3f7]"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                        <p className="text-[11px] text-[#888] mt-1">
                                            {entry.source} · {new Date(entry.createdAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => handleView(entry.id)}
                                            disabled={viewLoading}
                                        >
                                            View
                                        </Button>
                                        {deleteConfirmId === entry.id ? (
                                            <>
                                                <Button variant="danger" size="sm" onClick={() => handleDelete(entry.id)}>
                                                    Confirm
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmId(null)}>
                                                    Cancel
                                                </Button>
                                            </>
                                        ) : (
                                            <Button variant="ghost" size="sm" onClick={() => setDeleteConfirmId(entry.id)}>
                                                Delete
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>

                    {/* Pagination */}
                    {result.totalPages > 1 && (
                        <div className="flex items-center justify-between pt-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={page <= 1}
                                onClick={() => setPage(p => p - 1)}
                            >
                                ← Previous
                            </Button>
                            <span className="text-sm text-[#888]">
                                Page {result.page} of {result.totalPages} ({result.total} entries)
                            </span>
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={page >= result.totalPages}
                                onClick={() => setPage(p => p + 1)}
                            >
                                Next →
                            </Button>
                        </div>
                    )}
                </>
            )}

            {/* Full content dialog */}
            {selectedEntry && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelectedEntry(null)}>
                    <div
                        className="w-full max-w-2xl max-h-[80vh] overflow-auto rounded-lg bg-white dark:bg-[#252526] shadow-xl p-6"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between mb-3">
                            <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                                {selectedEntry.summary ?? 'Memory Entry'}
                            </h2>
                            <button
                                className="text-[#888] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none"
                                onClick={() => setSelectedEntry(null)}
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-1 mb-3">
                            {selectedEntry.tags.map(tag => (
                                <span
                                    key={tag}
                                    className="text-[10px] px-1.5 py-0.5 rounded bg-[#0078d4]/10 text-[#0078d4] dark:text-[#4fc3f7]"
                                >
                                    {tag}
                                </span>
                            ))}
                        </div>
                        <pre className="text-sm whitespace-pre-wrap text-[#1e1e1e] dark:text-[#cccccc] font-sans">
                            {selectedEntry.content}
                        </pre>
                        <p className="text-[11px] text-[#888] mt-4">
                            Source: {selectedEntry.source} · Created: {new Date(selectedEntry.createdAt).toLocaleString()}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
