/**
 * MemoryV2EpisodesTab — compact episode log with process/Ralph links.
 *
 * Episodes are compact session/turn summaries with provenance links back
 * to source processes. They are read-only in the UI.
 */

import { useState, useEffect, useCallback } from 'react';
import { Spinner } from '../../ui';
import { memoryV2Api, type MemoryEpisode, type MemoryEpisodeEventType } from './memoryV2Api';
import { useApp } from '../../contexts/AppContext';

// ── Helpers ───────────────────────────────────────────────────────────────────

function eventTypeLabel(type: MemoryEpisodeEventType): string {
    switch (type) {
        case 'chat-turn': return 'Chat';
        case 'ralph-iteration': return 'Ralph';
        case 'note-session': return 'Notes';
        case 'commit-chat': return 'Commit';
        default: return type;
    }
}

function eventTypeBadgeColor(type: MemoryEpisodeEventType): string {
    switch (type) {
        case 'chat-turn': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
        case 'ralph-iteration': return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
        case 'note-session': return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
        case 'commit-chat': return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300';
        default: return 'bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-400';
    }
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 60) return m <= 1 ? 'just now' : `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
}

// ── EpisodeRow ────────────────────────────────────────────────────────────────

interface EpisodeRowProps {
    episode: MemoryEpisode;
    onOpenProcess?: (processId: string) => void;
}

function EpisodeRow({ episode, onOpenProcess }: EpisodeRowProps) {
    return (
        <div
            className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded p-3 space-y-1.5 bg-white dark:bg-[#1e1e1e]"
            data-testid="episode-row"
        >
            {/* Summary */}
            <p className="text-sm text-[#1e1e1e] dark:text-[#cccccc] leading-relaxed">
                {episode.summary}
            </p>

            {/* Meta row */}
            <div className="flex items-center gap-2 text-[11px] text-[#888] flex-wrap">
                <span className={`px-1.5 py-0.5 rounded font-medium text-[10px] ${eventTypeBadgeColor(episode.eventType)}`}>
                    {eventTypeLabel(episode.eventType)}
                </span>

                {episode.turnIndex !== undefined && (
                    <span>turn {episode.turnIndex + 1}</span>
                )}
                {episode.iterationIndex !== undefined && (
                    <span>iter {episode.iterationIndex + 1}</span>
                )}

                <span className="text-[#aaa]">·</span>
                <span title={episode.createdAt}>{relativeTime(episode.createdAt)}</span>

                {episode.processId && (
                    <>
                        <span className="text-[#aaa]">·</span>
                        {onOpenProcess ? (
                            <button
                                className="font-mono text-[#0078d4] hover:underline"
                                onClick={() => onOpenProcess(episode.processId)}
                                data-testid="episode-process-link"
                            >
                                proc:{episode.processId.slice(0, 8)}
                            </button>
                        ) : (
                            <span className="font-mono">proc:{episode.processId.slice(0, 8)}</span>
                        )}
                    </>
                )}

                {episode.ralphId && (
                    <>
                        <span className="text-[#aaa]">·</span>
                        <span className="font-mono">ralph:{episode.ralphId.slice(0, 8)}</span>
                    </>
                )}
            </div>
        </div>
    );
}

// ── MemoryV2EpisodesTab ───────────────────────────────────────────────────────

interface MemoryV2EpisodesTabProps {
    wsId: string;
}

export function MemoryV2EpisodesTab({ wsId }: MemoryV2EpisodesTabProps) {
    const [episodes, setEpisodes] = useState<MemoryEpisode[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const { dispatch } = useApp();

    const loadEpisodes = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setEpisodes(await memoryV2Api.listEpisodes(wsId, 100));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [wsId]);

    useEffect(() => { loadEpisodes(); }, [loadEpisodes]);

    const handleOpenProcess = (processId: string) => {
        dispatch({ type: 'SELECT_PROCESS', id: processId });
        dispatch({ type: 'SET_ACTIVE_TAB', tab: 'processes' });
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                    {loading ? 'Loading…' : `${episodes.length} episode${episodes.length !== 1 ? 's' : ''}`}
                </span>
                <button
                    className="text-xs text-[#0078d4] hover:underline"
                    onClick={loadEpisodes}
                    data-testid="episodes-refresh-btn"
                >
                    ↻ Refresh
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {loading && (
                    <div className="flex justify-center py-8"><Spinner /></div>
                )}

                {!loading && error && (
                    <p className="text-sm text-red-500" data-testid="episodes-error">{error}</p>
                )}

                {!loading && !error && episodes.length === 0 && (
                    <div className="text-center py-12 text-[#888]" data-testid="episodes-empty">
                        <p className="text-sm">No episodes yet.</p>
                        <p className="text-xs mt-1">
                            Episodes are created automatically from completed chat turns and Ralph iterations.
                        </p>
                    </div>
                )}

                {!loading && episodes.map(ep => (
                    <EpisodeRow
                        key={ep.id}
                        episode={ep}
                        onOpenProcess={handleOpenProcess}
                    />
                ))}
            </div>
        </div>
    );
}
