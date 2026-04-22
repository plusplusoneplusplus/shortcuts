/**
 * ExploreCacheBrowserPanel — browse the explore-cache (tool-call Q&A cache)
 * at 3 levels: Global (system), Git Remote, and Repo.
 *
 * Extracted from MemoryFilesPanel after the observations sub-mode was removed.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../../utils/config';
import { Button, Card, Spinner } from '../../shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CacheLevel = 'system' | 'git-remote' | 'repo';
type CacheSubTab = 'raw' | 'consolidated';

interface LevelStats {
    rawCount: number;
    consolidatedExists: boolean;
    lastAggregation: string | null;
    factCount: number;
}

interface CacheStats {
    rawCount: number;
    consolidatedExists: boolean;
    consolidatedCount: number;
    lastAggregation: string | null;
}

interface CacheRepoEntry extends CacheStats {
    hash: string;
    path?: string;
    name?: string;
    remoteUrl?: string;
}

interface CacheGitRemoteEntry extends CacheStats {
    hash: string;
    remoteUrl?: string;
    name?: string;
}

interface CacheLevelsOverview {
    system: CacheStats;
    repos: CacheRepoEntry[];
    gitRemotes: CacheGitRemoteEntry[];
}

interface ToolCallQAEntry {
    id: string;
    toolName: string;
    question: string;
    answer: string;
    args: Record<string, unknown>;
    gitHash?: string;
    timestamp: string;
}

interface ConsolidatedIndexEntry {
    id: string;
    question: string;
    topics: string[];
    toolSources: string[];
    createdAt: string;
    hitCount: number;
    gitHash?: string;
}

interface ConsolidatedEntryWithAnswer extends ConsolidatedIndexEntry {
    answer: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExploreCacheBrowserPanel() {
    const [overview, setOverview] = useState<CacheLevelsOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedLevel, setSelectedLevel] = useState<CacheLevel>('system');
    const [selectedHash, setSelectedHash] = useState<string | undefined>(undefined);
    const [selectedLabel, setSelectedLabel] = useState('Global');
    const [subTab, setSubTab] = useState<CacheSubTab>('raw');

    const [rawFiles, setRawFiles] = useState<string[]>([]);
    const [rawLoading, setRawLoading] = useState(false);
    const [selectedRaw, setSelectedRaw] = useState<ToolCallQAEntry | null>(null);
    const [rawEntryLoading, setRawEntryLoading] = useState(false);

    const [consolidatedEntries, setConsolidatedEntries] = useState<ConsolidatedIndexEntry[]>([]);
    const [consolidatedLoading, setConsolidatedLoading] = useState(false);
    const [selectedConsolidated, setSelectedConsolidated] = useState<ConsolidatedEntryWithAnswer | null>(null);
    const [consolidatedEntryLoading, setConsolidatedEntryLoading] = useState(false);

    const fetchOverview = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${getApiBase()}/memory/explore-cache/levels`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: CacheLevelsOverview = await res.json();
            setOverview(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchOverview(); }, [fetchOverview]);

    const fetchRawFiles = useCallback(async (level: CacheLevel, hash?: string) => {
        setRawLoading(true);
        setSelectedRaw(null);
        try {
            const params = new URLSearchParams({ level });
            if (hash) params.set('hash', hash);
            const res = await fetch(`${getApiBase()}/memory/explore-cache/raw?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setRawFiles(data.files ?? []);
        } catch {
            setRawFiles([]);
        } finally {
            setRawLoading(false);
        }
    }, []);

    const fetchConsolidated = useCallback(async (level: CacheLevel, hash?: string) => {
        setConsolidatedLoading(true);
        setSelectedConsolidated(null);
        try {
            const params = new URLSearchParams({ level });
            if (hash) params.set('hash', hash);
            const res = await fetch(`${getApiBase()}/memory/explore-cache/consolidated?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setConsolidatedEntries(data.entries ?? []);
        } catch {
            setConsolidatedEntries([]);
        } finally {
            setConsolidatedLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchRawFiles(selectedLevel, selectedHash);
        fetchConsolidated(selectedLevel, selectedHash);
    }, [fetchRawFiles, fetchConsolidated, selectedLevel, selectedHash]);

    const handleViewRaw = async (filename: string) => {
        setRawEntryLoading(true);
        try {
            const params = new URLSearchParams({ level: selectedLevel });
            if (selectedHash) params.set('hash', selectedHash);
            const res = await fetch(
                `${getApiBase()}/memory/explore-cache/raw/${encodeURIComponent(filename)}?${params}`,
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ToolCallQAEntry = await res.json();
            setSelectedRaw(data);
        } catch {
            setSelectedRaw(null);
        } finally {
            setRawEntryLoading(false);
        }
    };

    const handleViewConsolidated = async (id: string) => {
        setConsolidatedEntryLoading(true);
        try {
            const params = new URLSearchParams({ level: selectedLevel });
            if (selectedHash) params.set('hash', selectedHash);
            const res = await fetch(
                `${getApiBase()}/memory/explore-cache/consolidated/${encodeURIComponent(id)}?${params}`,
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ConsolidatedEntryWithAnswer = await res.json();
            setSelectedConsolidated(data);
        } catch {
            setSelectedConsolidated(null);
        } finally {
            setConsolidatedEntryLoading(false);
        }
    };

    const selectLevel = (level: CacheLevel, hash?: string, label?: string) => {
        setSelectedLevel(level);
        setSelectedHash(hash);
        setSelectedLabel(label ?? level);
        setSelectedRaw(null);
        setSelectedConsolidated(null);
    };

    if (loading) {
        return <div className="flex justify-center py-8"><Spinner /></div>;
    }

    if (error) {
        return <p className="text-sm text-red-500">{error}</p>;
    }

    const ecStats = (s: CacheStats): LevelStats => ({
        rawCount: s.rawCount,
        consolidatedExists: s.consolidatedExists,
        lastAggregation: s.lastAggregation,
        factCount: s.consolidatedCount,
    });

    return (
        <div className="flex flex-col md:flex-row h-full min-h-0">
            {/* Left panel: level selector + sub-tab + file list */}
            <div className="flex-shrink-0 w-full md:w-72 border-b md:border-b-0 md:border-r border-[#e0e0e0] dark:border-[#3c3c3c] overflow-y-auto p-3 space-y-3">
                {/* Level selector cards */}
                <div className="space-y-2">
                    <LevelCard
                        title="Global"
                        icon="🌐"
                        description="Cross-repo explore cache"
                        stats={overview ? ecStats(overview.system) : null}
                        active={selectedLevel === 'system' && !selectedHash}
                        onClick={() => selectLevel('system', undefined, 'Global')}
                    />

                    <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#616161] dark:text-[#9d9d9d]">
                            Git Remotes ({overview?.gitRemotes.length ?? 0})
                        </h4>
                        {overview?.gitRemotes.length === 0 && (
                            <p className="text-xs text-[#888]">No git remote cache</p>
                        )}
                        {overview?.gitRemotes.map(remote => (
                            <LevelCard
                                key={remote.hash}
                                title={remote.name || remote.remoteUrl || remote.hash}
                                icon="🔗"
                                description={remote.remoteUrl ?? `Hash: ${remote.hash}`}
                                stats={ecStats(remote)}
                                active={selectedLevel === 'git-remote' && selectedHash === remote.hash}
                                onClick={() => selectLevel('git-remote', remote.hash, remote.name || remote.hash)}
                            />
                        ))}
                    </div>

                    <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#616161] dark:text-[#9d9d9d]">
                            Repositories ({overview?.repos.length ?? 0})
                        </h4>
                        {overview?.repos.length === 0 && (
                            <p className="text-xs text-[#888]">No repo cache</p>
                        )}
                        {overview?.repos.map(repo => (
                            <LevelCard
                                key={repo.hash}
                                title={repo.name || repo.hash}
                                icon="📁"
                                description={repo.path ?? `Hash: ${repo.hash}`}
                                stats={ecStats(repo)}
                                active={selectedLevel === 'repo' && selectedHash === repo.hash}
                                onClick={() => selectLevel('repo', repo.hash, repo.name || repo.hash)}
                            />
                        ))}
                    </div>
                </div>

                {/* Sub-tab: Raw / Consolidated + file list */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                            {selectedLabel} — Cache
                        </h3>
                        <Button variant="ghost" size="sm" onClick={() => {
                            fetchRawFiles(selectedLevel, selectedHash);
                            fetchConsolidated(selectedLevel, selectedHash);
                        }}>
                            Refresh
                        </Button>
                    </div>
                    <div className="flex gap-1 mb-2">
                        {(['raw', 'consolidated'] as CacheSubTab[]).map(t => (
                            <button
                                key={t}
                                className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                                    subTab === t
                                        ? 'bg-[#0078d4]/20 text-[#0078d4]'
                                        : 'text-[#888] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]'
                                }`}
                                onClick={() => { setSubTab(t); setSelectedRaw(null); setSelectedConsolidated(null); }}
                            >
                                {t === 'raw' ? `Raw (${rawFiles.length})` : `Consolidated (${consolidatedEntries.length})`}
                            </button>
                        ))}
                    </div>

                    {/* Raw Q&A files */}
                    {subTab === 'raw' && (
                        <>
                            {rawLoading && <div className="flex justify-center py-4"><Spinner /></div>}
                            {!rawLoading && rawFiles.length === 0 && (
                                <p className="text-sm text-[#888] text-center py-4">No raw cache entries at this level.</p>
                            )}
                            {!rawLoading && rawFiles.length > 0 && (
                                <ul className="space-y-1" data-testid="explore-cache-raw-list">
                                    {rawFiles.map(filename => (
                                        <li key={filename}>
                                            <button
                                                className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] text-[#1e1e1e] dark:text-[#cccccc] truncate"
                                                onClick={() => handleViewRaw(filename)}
                                            >
                                                🔍 {filename}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}

                    {/* Consolidated entries */}
                    {subTab === 'consolidated' && (
                        <>
                            {consolidatedLoading && <div className="flex justify-center py-4"><Spinner /></div>}
                            {!consolidatedLoading && consolidatedEntries.length === 0 && (
                                <p className="text-sm text-[#888] text-center py-4">No consolidated entries at this level.</p>
                            )}
                            {!consolidatedLoading && consolidatedEntries.length > 0 && (
                                <ul className="space-y-1" data-testid="explore-cache-consolidated-list">
                                    {consolidatedEntries.map(entry => (
                                        <li key={entry.id}>
                                            <button
                                                className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] space-y-0.5"
                                                onClick={() => handleViewConsolidated(entry.id)}
                                            >
                                                <div className="text-[#1e1e1e] dark:text-[#cccccc] truncate">
                                                    💡 {entry.question}
                                                </div>
                                                {entry.topics.length > 0 && (
                                                    <div className="flex gap-1 flex-wrap">
                                                        {entry.topics.map(t => (
                                                            <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#0078d4]/10 text-[#0078d4]">{t}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Right panel: detail viewer */}
            <div className="flex-1 min-w-0 overflow-y-auto p-4">
                {rawEntryLoading && <div className="flex justify-center py-8"><Spinner /></div>}
                {selectedRaw && !rawEntryLoading && subTab === 'raw' && (
                    <Card className="p-4">
                        <div className="flex items-start justify-between mb-3">
                            <div>
                                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                                    {selectedRaw.toolName}
                                </h3>
                                <div className="flex gap-3 mt-1 text-[11px] text-[#888]">
                                    <span>{new Date(selectedRaw.timestamp).toLocaleString()}</span>
                                    {selectedRaw.gitHash && <span>Git: {selectedRaw.gitHash.slice(0, 8)}</span>}
                                </div>
                                <p className="mt-1 text-xs text-[#888] italic">{selectedRaw.question}</p>
                            </div>
                            <button
                                className="text-[#888] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none"
                                onClick={() => setSelectedRaw(null)}
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>
                        <pre className="text-sm whitespace-pre-wrap text-[#1e1e1e] dark:text-[#cccccc] font-sans bg-[#f5f5f5] dark:bg-[#1e1e1e] p-3 rounded max-h-96 overflow-auto">
                            {selectedRaw.answer}
                        </pre>
                    </Card>
                )}

                {consolidatedEntryLoading && <div className="flex justify-center py-8"><Spinner /></div>}
                {selectedConsolidated && !consolidatedEntryLoading && subTab === 'consolidated' && (
                    <Card className="p-4">
                        <div className="flex items-start justify-between mb-3">
                            <div>
                                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                                    {selectedConsolidated.question}
                                </h3>
                                <div className="flex gap-3 mt-1 text-[11px] text-[#888]">
                                    <span>Created: {new Date(selectedConsolidated.createdAt).toLocaleString()}</span>
                                    <span>Hits: {selectedConsolidated.hitCount}</span>
                                    {selectedConsolidated.toolSources.length > 0 && (
                                        <span>Tools: {selectedConsolidated.toolSources.join(', ')}</span>
                                    )}
                                </div>
                            </div>
                            <button
                                className="text-[#888] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none"
                                onClick={() => setSelectedConsolidated(null)}
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>
                        <pre className="text-sm whitespace-pre-wrap text-[#1e1e1e] dark:text-[#cccccc] font-sans bg-[#f5f5f5] dark:bg-[#1e1e1e] p-3 rounded max-h-96 overflow-auto">
                            {selectedConsolidated.answer}
                        </pre>
                    </Card>
                )}

                {!selectedRaw && !rawEntryLoading && !selectedConsolidated && !consolidatedEntryLoading && (
                    <div className="flex items-center justify-center h-full text-sm text-[#888]">
                        Select a file to view its content
                    </div>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface LevelCardProps {
    title: string;
    icon: string;
    description: string;
    stats: LevelStats | null;
    active: boolean;
    onClick: () => void;
}

function LevelCard({ title, icon, description, stats, active, onClick }: LevelCardProps) {
    return (
        <button
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
                active
                    ? 'border-[#0078d4] bg-[#0078d4]/5'
                    : 'border-[#e0e0e0] dark:border-[#3c3c3c] hover:border-[#0078d4]/50'
            }`}
            onClick={onClick}
        >
            <div className="flex items-center gap-2 mb-1">
                <span>{icon}</span>
                <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] truncate">{title}</span>
            </div>
            <p className="text-[11px] text-[#888] truncate">{description}</p>
            {stats && (
                <div className="flex gap-3 mt-2 text-[11px]">
                    <span className="text-[#616161] dark:text-[#9d9d9d]">
                        {stats.rawCount} file{stats.rawCount !== 1 ? 's' : ''}
                    </span>
                    {stats.consolidatedExists && (
                        <span className="text-green-600 dark:text-green-400">consolidated</span>
                    )}
                </div>
            )}
        </button>
    );
}
