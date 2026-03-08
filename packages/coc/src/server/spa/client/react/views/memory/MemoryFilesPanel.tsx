/**
 * MemoryFilesPanel — browse raw observation memory files at 3 levels:
 * Global (system), Git Remote, and Repo.
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../../utils/config';
import { Button, Card, Spinner } from '../../shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ObservationLevel = 'system' | 'git-remote' | 'repo';

interface LevelStats {
    rawCount: number;
    consolidatedExists: boolean;
    lastAggregation: string | null;
    factCount: number;
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

interface RawObservation {
    metadata: { pipeline: string; timestamp: string; repo?: string; model?: string };
    content: string;
    filename: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MemoryFilesPanel() {
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
        <div className="p-4 space-y-4">
            {/* Level selector cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Global */}
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
            <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        {selectedLabel} — Observation Files
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
            </Card>

            {/* Observation content viewer */}
            {obsLoading && <div className="flex justify-center py-4"><Spinner /></div>}
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
