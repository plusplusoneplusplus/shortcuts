/**
 * MemoryFilesPanel — browse raw observation memory files at 3 levels:
 * Global (system), Git Remote, and Repo. Also supports browsing the
 * explore-cache (tool-call Q&A cache) via a type toggle.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../../utils/config';
import { Button, Card, Spinner } from '../../shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ObservationLevel = 'system' | 'git-remote' | 'repo';
type MemoryFileType = 'observations' | 'explore-cache';
type ExploreCacheSubTab = 'raw' | 'consolidated';

interface LevelStats {
    rawCount: number;
    consolidatedExists: boolean;
    lastAggregation: string | null;
    factCount: number;
}

interface ExploreCacheStats {
    rawCount: number;
    consolidatedExists: boolean;
    consolidatedCount: number;
    lastAggregation: string | null;
}

interface RepoEntry extends LevelStats {
    hash: string;
    path?: string;
    name?: string;
    remoteUrl?: string;
}

interface GitRemoteEntry extends LevelStats {
    hash: string;
    remoteUrl?: string;
    name?: string;
}

interface LevelsOverview {
    global: LevelStats;
    repos: RepoEntry[];
    gitRemotes: GitRemoteEntry[];
}

interface ExploreCacheRepoEntry extends ExploreCacheStats {
    hash: string;
    path?: string;
    name?: string;
    remoteUrl?: string;
}

interface ExploreCacheGitRemoteEntry extends ExploreCacheStats {
    hash: string;
    remoteUrl?: string;
    name?: string;
}

interface ExploreCacheLevelsOverview {
    system: ExploreCacheStats;
    repos: ExploreCacheRepoEntry[];
    gitRemotes: ExploreCacheGitRemoteEntry[];
}

interface RawObservation {
    metadata: { pipeline: string; timestamp: string; repo?: string; model?: string };
    content: string;
    filename: string;
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

export function MemoryFilesPanel() {
    const [memoryType, setMemoryType] = useState<MemoryFileType>('observations');

    return (
        <div className="flex flex-col h-full">
            {/* Memory type toggle */}
            <div className="flex gap-2 p-4 pb-0">
                <button
                    className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                        memoryType === 'observations'
                            ? 'bg-[#0078d4] text-white'
                            : 'bg-[#e8e8e8] dark:bg-[#2a2d2e] text-[#616161] dark:text-[#9d9d9d] hover:bg-[#d0d0d0] dark:hover:bg-[#3c3c3c]'
                    }`}
                    onClick={() => setMemoryType('observations')}
                >
                    Observations
                </button>
                <button
                    className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                        memoryType === 'explore-cache'
                            ? 'bg-[#0078d4] text-white'
                            : 'bg-[#e8e8e8] dark:bg-[#2a2d2e] text-[#616161] dark:text-[#9d9d9d] hover:bg-[#d0d0d0] dark:hover:bg-[#3c3c3c]'
                    }`}
                    onClick={() => setMemoryType('explore-cache')}
                >
                    Explore Cache
                </button>
            </div>

            <div className="flex-1 min-h-0 mt-4">
                {memoryType === 'observations' && <ObservationsPanel />}
                {memoryType === 'explore-cache' && <ExploreCacheFilesPanel />}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// ObservationsPanel (original content extracted)
// ---------------------------------------------------------------------------

function ObservationsPanel() {
    const [overview, setOverview] = useState<LevelsOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Selected level state
    const [selectedLevel, setSelectedLevel] = useState<ObservationLevel>('system');
    const [selectedHash, setSelectedHash] = useState<string | undefined>(undefined);
    const [selectedLabel, setSelectedLabel] = useState('Global');

    // File list at the selected level
    const [files, setFiles] = useState<string[]>([]);
    const [filesLoading, setFilesLoading] = useState(false);

    // Selected file content
    const [selectedObs, setSelectedObs] = useState<RawObservation | null>(null);
    const [obsLoading, setObsLoading] = useState(false);

    // Fetch overview of all 3 levels
    const fetchOverview = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${getApiBase()}/memory/observations/levels`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: LevelsOverview = await res.json();
            setOverview(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchOverview(); }, [fetchOverview]);

    // Fetch files at the selected level
    const fetchFiles = useCallback(async (level: ObservationLevel, hash?: string) => {
        setFilesLoading(true);
        setSelectedObs(null);
        try {
            const params = new URLSearchParams({ level });
            if (hash) params.set('hash', hash);
            const res = await fetch(`${getApiBase()}/memory/observations?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setFiles(data.files ?? []);
        } catch {
            setFiles([]);
        } finally {
            setFilesLoading(false);
        }
    }, []);

    // Fetch on level selection change
    useEffect(() => {
        fetchFiles(selectedLevel, selectedHash);
    }, [fetchFiles, selectedLevel, selectedHash]);

    // Read a single observation file
    const handleViewFile = async (filename: string) => {
        setObsLoading(true);
        try {
            const params = new URLSearchParams({ level: selectedLevel });
            if (selectedHash) params.set('hash', selectedHash);
            const res = await fetch(
                `${getApiBase()}/memory/observations/${encodeURIComponent(filename)}?${params}`,
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: RawObservation = await res.json();
            setSelectedObs(data);
        } catch {
            setSelectedObs(null);
        } finally {
            setObsLoading(false);
        }
    };

    // Select a level + optional hash
    const selectLevel = (level: ObservationLevel, hash?: string, label?: string) => {
        setSelectedLevel(level);
        setSelectedHash(hash);
        setSelectedLabel(label ?? level);
    };

    if (loading) {
        return <div className="flex justify-center py-8"><Spinner /></div>;
    }

    if (error) {
        return <p className="p-4 text-sm text-red-500">{error}</p>;
    }

    return (
        <div className="flex flex-col md:flex-row h-full min-h-0">
            {/* Left panel: level selector + file list */}
            <div className="flex-shrink-0 w-full md:w-72 border-b md:border-b-0 md:border-r border-[#e0e0e0] dark:border-[#3c3c3c] overflow-y-auto p-3 space-y-3">
                {/* Level selector cards */}
                <div className="space-y-2">
                    <LevelCard
                        title="Global"
                        icon="🌐"
                        description="Cross-repo observations"
                        stats={overview?.global ?? null}
                        active={selectedLevel === 'system' && !selectedHash}
                        onClick={() => selectLevel('system', undefined, 'Global')}
                    />

                    {/* Git Remotes */}
                    <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#616161] dark:text-[#9d9d9d]">
                            Git Remotes ({overview?.gitRemotes.length ?? 0})
                        </h4>
                        {overview?.gitRemotes.length === 0 && (
                            <p className="text-xs text-[#888]">No git remote observations</p>
                        )}
                        {overview?.gitRemotes.map(remote => (
                            <LevelCard
                                key={remote.hash}
                                title={remote.name || remote.remoteUrl || remote.hash}
                                icon="🔗"
                                description={remote.remoteUrl ? `${remote.remoteUrl}` : `Hash: ${remote.hash}`}
                                stats={remote}
                                active={selectedLevel === 'git-remote' && selectedHash === remote.hash}
                                onClick={() => selectLevel('git-remote', remote.hash, remote.name || remote.hash)}
                            />
                        ))}
                    </div>

                    {/* Repos */}
                    <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-[#616161] dark:text-[#9d9d9d]">
                            Repositories ({overview?.repos.length ?? 0})
                        </h4>
                        {overview?.repos.length === 0 && (
                            <p className="text-xs text-[#888]">No repo observations</p>
                        )}
                        {overview?.repos.map(repo => (
                            <LevelCard
                                key={repo.hash}
                                title={repo.name || repo.hash}
                                icon="📁"
                                description={repo.path || `Hash: ${repo.hash}`}
                                stats={repo}
                                active={selectedLevel === 'repo' && selectedHash === repo.hash}
                                onClick={() => selectLevel('repo', repo.hash, repo.name || repo.hash)}
                            />
                        ))}
                    </div>
                </div>

                {/* File list for selected level */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                            {selectedLabel} — Files
                        </h3>
                        <Button variant="ghost" size="sm" onClick={() => fetchFiles(selectedLevel, selectedHash)}>
                            Refresh
                        </Button>
                    </div>

                    {filesLoading && <div className="flex justify-center py-4"><Spinner /></div>}

                    {!filesLoading && files.length === 0 && (
                        <p className="text-sm text-[#888] text-center py-4">No observation files at this level.</p>
                    )}

                    {!filesLoading && files.length > 0 && (
                        <ul className="space-y-1" data-testid="file-list">
                            {files.map(filename => (
                                <li key={filename}>
                                    <button
                                        className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e] text-[#1e1e1e] dark:text-[#cccccc] truncate"
                                        onClick={() => handleViewFile(filename)}
                                    >
                                        📄 {filename}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {/* Right panel: observation content viewer */}
            <div className="flex-1 min-w-0 overflow-y-auto p-4">
                {obsLoading && <div className="flex justify-center py-8"><Spinner /></div>}
                {selectedObs && !obsLoading && (
                    <Card className="p-4">
                        <div className="flex items-start justify-between mb-3">
                            <div>
                                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                                    {selectedObs.filename}
                                </h3>
                                <div className="flex gap-3 mt-1 text-[11px] text-[#888]">
                                    <span>Pipeline: {selectedObs.metadata.pipeline}</span>
                                    <span>{new Date(selectedObs.metadata.timestamp).toLocaleString()}</span>
                                    {selectedObs.metadata.model && <span>Model: {selectedObs.metadata.model}</span>}
                                    {selectedObs.metadata.repo && <span>Repo: {selectedObs.metadata.repo}</span>}
                                </div>
                            </div>
                            <button
                                className="text-[#888] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none"
                                onClick={() => setSelectedObs(null)}
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>
                        <pre className="text-sm whitespace-pre-wrap text-[#1e1e1e] dark:text-[#cccccc] font-sans bg-[#f5f5f5] dark:bg-[#1e1e1e] p-3 rounded">
                            {selectedObs.content}
                        </pre>
                    </Card>
                )}
                {!selectedObs && !obsLoading && (
                    <div className="flex items-center justify-center h-full text-sm text-[#888]">
                        Select a file to view its content
                    </div>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// ExploreCacheFilesPanel — browse explore-cache raw Q&A + consolidated entries
// ---------------------------------------------------------------------------

function ExploreCacheFilesPanel() {
    const [overview, setOverview] = useState<ExploreCacheLevelsOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [selectedLevel, setSelectedLevel] = useState<ObservationLevel>('system');
    const [selectedHash, setSelectedHash] = useState<string | undefined>(undefined);
    const [selectedLabel, setSelectedLabel] = useState('Global');
    const [subTab, setSubTab] = useState<ExploreCacheSubTab>('raw');

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
            const data: ExploreCacheLevelsOverview = await res.json();
            setOverview(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchOverview(); }, [fetchOverview]);

    const fetchRawFiles = useCallback(async (level: ObservationLevel, hash?: string) => {
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

    const fetchConsolidated = useCallback(async (level: ObservationLevel, hash?: string) => {
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

    const selectLevel = (level: ObservationLevel, hash?: string, label?: string) => {
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

    const ecStats = (s: ExploreCacheStats): LevelStats => ({
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
                        {(['raw', 'consolidated'] as ExploreCacheSubTab[]).map(t => (
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
                {/* Raw entry viewer */}
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

                {/* Consolidated entry viewer */}
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

                {/* Placeholder when nothing selected */}
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
