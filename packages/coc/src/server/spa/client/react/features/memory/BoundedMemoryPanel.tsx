/**
 * BoundedMemoryPanel — primary panel for viewing and editing bounded MEMORY.md
 * content at any memory level (system / git-remote / repo).
 */

import { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '../../utils/config';
import { Button, Card, Spinner } from '../../shared';
import { CapacityBar } from '../../shared/CapacityBar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MemoryLevel = 'system' | 'repo' | 'git-remote';

interface LevelCharStats {
    charCount: number;
    charLimit: number;
    lastModified: string | null;
}

interface LevelsOverviewEntry extends LevelCharStats {
    hash: string;
}

interface LevelsOverview {
    system: LevelCharStats;
    repos: LevelsOverviewEntry[];
    gitRemotes: LevelsOverviewEntry[];
}

interface BoundedContent {
    content: string;
    charCount: number;
    charLimit: number;
    lastModified: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BoundedMemoryPanel() {
    const [overview, setOverview] = useState<LevelsOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Selection state
    const [selectedLevel, setSelectedLevel] = useState<MemoryLevel>('system');
    const [selectedHash, setSelectedHash] = useState<string | undefined>(undefined);
    const [selectedLabel, setSelectedLabel] = useState('System');

    // Content state
    const [content, setContent] = useState<BoundedContent | null>(null);
    const [contentLoading, setContentLoading] = useState(false);
    const [contentError, setContentError] = useState<string | null>(null);

    // Edit state
    const [editing, setEditing] = useState(false);
    const [editContent, setEditContent] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Fetch overview
    const fetchOverview = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${getApiBase()}/memory/bounded/levels`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setOverview(await res.json());
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchOverview(); }, [fetchOverview]);

    // Fetch content for selected level
    const fetchContent = useCallback(async (level: MemoryLevel, hash?: string) => {
        setContentLoading(true);
        setContentError(null);
        setEditing(false);
        setSaveError(null);
        try {
            const params = new URLSearchParams();
            if (hash) params.set('hash', hash);
            const url = `${getApiBase()}/memory/bounded/${level}${params.toString() ? '?' + params : ''}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: BoundedContent = await res.json();
            setContent(data);
        } catch (err) {
            setContentError(err instanceof Error ? err.message : String(err));
        } finally {
            setContentLoading(false);
        }
    }, []);

    // Auto-fetch on selection change
    useEffect(() => {
        fetchContent(selectedLevel, selectedHash);
    }, [selectedLevel, selectedHash, fetchContent]);

    const handleSelectLevel = (level: MemoryLevel, hash?: string, label?: string) => {
        setSelectedLevel(level);
        setSelectedHash(hash);
        setSelectedLabel(label ?? level);
    };

    const handleStartEdit = () => {
        setEditing(true);
        setEditContent(content?.content ?? '');
        setSaveError(null);
    };

    const handleCancelEdit = () => {
        setEditing(false);
        setSaveError(null);
    };

    const handleSave = async () => {
        setSaving(true);
        setSaveError(null);
        try {
            const params = new URLSearchParams();
            if (selectedHash) params.set('hash', selectedHash);
            const url = `${getApiBase()}/memory/bounded/${selectedLevel}${params.toString() ? '?' + params : ''}`;
            const res = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: editContent }),
            });
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 422) {
                    setSaveError(`Security violation: ${data.violations?.join(', ') ?? 'Content blocked'}`);
                } else if (res.status === 413) {
                    setSaveError(`Content exceeds limit: ${data.charCount}/${data.charLimit} chars`);
                } else {
                    setSaveError(data.error ?? `HTTP ${res.status}`);
                }
                return;
            }
            setContent({ content: editContent, ...data });
            setEditing(false);
            fetchOverview();
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return <div className="flex justify-center py-8"><Spinner /></div>;
    }
    if (error) {
        return <p className="p-4 text-sm text-red-500">{error}</p>;
    }

    const editCharCount = editContent.length;
    const editCharLimit = content?.charLimit ?? 0;

    return (
        <div className="p-4 space-y-4" data-testid="bounded-memory-panel">
            {/* Level selector cards */}
            <div className="grid grid-cols-3 gap-3">
                {/* System */}
                <button
                    onClick={() => handleSelectLevel('system', undefined, 'System')}
                    className={`text-left p-3 rounded border transition-colors ${
                        selectedLevel === 'system' && !selectedHash
                            ? 'border-[#0078d4] bg-[#0078d4]/5'
                            : 'border-[#e0e0e0] dark:border-[#3c3c3c] hover:border-[#0078d4]/50'
                    }`}
                    data-testid="level-system"
                >
                    <p className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">System</p>
                    <p className="text-[11px] text-[#848484] mt-1">
                        {overview?.system.charCount ?? 0} chars
                    </p>
                </button>

                {/* Git Remotes */}
                <div className="space-y-1">
                    <p className="text-xs font-medium text-[#848484] mb-1">Git Remotes ({overview?.gitRemotes.length ?? 0})</p>
                    {overview?.gitRemotes.map(r => (
                        <button
                            key={r.hash}
                            onClick={() => handleSelectLevel('git-remote', r.hash, `Remote ${r.hash.slice(0, 8)}`)}
                            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                                selectedLevel === 'git-remote' && selectedHash === r.hash
                                    ? 'bg-[#0078d4]/10 text-[#0078d4]'
                                    : 'text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]'
                            }`}
                        >
                            {r.hash.slice(0, 12)}… ({r.charCount} chars)
                        </button>
                    ))}
                    {(!overview?.gitRemotes.length) && (
                        <p className="text-[11px] text-[#848484] px-2">None</p>
                    )}
                </div>

                {/* Repos */}
                <div className="space-y-1">
                    <p className="text-xs font-medium text-[#848484] mb-1">Repos ({overview?.repos.length ?? 0})</p>
                    {overview?.repos.map(r => (
                        <button
                            key={r.hash}
                            onClick={() => handleSelectLevel('repo', r.hash, `Repo ${r.hash.slice(0, 8)}`)}
                            className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                                selectedLevel === 'repo' && selectedHash === r.hash
                                    ? 'bg-[#0078d4]/10 text-[#0078d4]'
                                    : 'text-[#616161] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]'
                            }`}
                        >
                            {r.hash.slice(0, 12)}… ({r.charCount} chars)
                        </button>
                    ))}
                    {(!overview?.repos.length) && (
                        <p className="text-[11px] text-[#848484] px-2">None</p>
                    )}
                </div>
            </div>

            {/* Content area */}
            <Card className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                        {selectedLabel} — MEMORY.md
                    </span>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={() => fetchContent(selectedLevel, selectedHash)} title="Refresh">
                            ↻
                        </Button>
                        {!editing ? (
                            <Button variant="ghost" size="sm" onClick={handleStartEdit} data-testid="edit-toggle">
                                Edit
                            </Button>
                        ) : (
                            <>
                                <Button variant="ghost" size="sm" onClick={handleCancelEdit}>Cancel</Button>
                                <Button size="sm" onClick={handleSave} disabled={saving} data-testid="save-btn">
                                    {saving ? 'Saving…' : 'Save'}
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {content && (
                    <CapacityBar
                        charCount={editing ? editCharCount : content.charCount}
                        charLimit={content.charLimit}
                    />
                )}

                {contentLoading ? (
                    <div className="flex justify-center py-4"><Spinner /></div>
                ) : contentError ? (
                    <p className="text-sm text-red-500">{contentError}</p>
                ) : editing ? (
                    <div className="space-y-2">
                        <textarea
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            className="w-full h-64 px-3 py-2 text-xs font-mono border border-[#c8c8c8] dark:border-[#3c3c3c] rounded bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:border-[#0078d4] resize-y"
                            data-testid="memory-editor"
                        />
                        {editCharCount > editCharLimit && (
                            <p className="text-xs text-red-500">
                                Content exceeds limit ({editCharCount.toLocaleString()}/{editCharLimit.toLocaleString()} chars)
                            </p>
                        )}
                        {saveError && <p className="text-xs text-red-500" data-testid="save-error">{saveError}</p>}
                    </div>
                ) : !content?.content ? (
                    <div className="text-center py-8" data-testid="empty-state">
                        <p className="text-sm text-[#848484] mb-3">
                            No memory entries yet. The AI will populate this during conversations.
                        </p>
                    </div>
                ) : (
                    <pre
                        className="text-xs text-[#1e1e1e] dark:text-[#cccccc] whitespace-pre-wrap break-words m-0 p-3 font-mono leading-relaxed border border-[#e0e0e0] dark:border-[#3c3c3c] rounded max-h-[60vh] overflow-y-auto"
                        data-testid="memory-content"
                    >
                        {content.content}
                    </pre>
                )}
            </Card>
        </div>
    );
}
