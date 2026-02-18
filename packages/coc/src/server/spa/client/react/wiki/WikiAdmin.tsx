/**
 * WikiAdmin — admin panel with Generate, Seeds, Config sub-tabs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Card, Spinner, Badge } from '../shared';
import { cn } from '../shared/cn';
import { getApiBase } from '../../config';
import { fetchApi } from '../hooks/useApi';

type WikiAdminTab = 'generate' | 'seeds' | 'config';

interface WikiAdminProps {
    wikiId: string;
}

const PHASE_NAMES: Record<number, { name: string; desc: string }> = {
    1: { name: 'Discovery', desc: 'Discover component graph structure' },
    2: { name: 'Consolidation', desc: 'Merge and consolidate discovery output' },
    3: { name: 'Analysis', desc: 'Deep analysis per component' },
    4: { name: 'Writing', desc: 'Generate articles and synthesis' },
    5: { name: 'Website', desc: 'Build static site output' },
};

export function WikiAdmin({ wikiId }: WikiAdminProps) {
    const [tab, setTab] = useState<WikiAdminTab>('generate');

    return (
        <div className="flex flex-col h-full">
            {/* Sub-tab bar */}
            <div className="flex gap-1 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                {(['generate', 'seeds', 'config'] as WikiAdminTab[]).map(t => (
                    <button
                        key={t}
                        className={cn(
                            'px-3 py-1 text-xs rounded transition-colors',
                            tab === t
                                ? 'bg-[#0078d4] text-white'
                                : 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                        )}
                        onClick={() => setTab(t)}
                    >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-3">
                {tab === 'generate' && <GenerateTab wikiId={wikiId} />}
                {tab === 'seeds' && <EditorTab wikiId={wikiId} kind="seeds" />}
                {tab === 'config' && <EditorTab wikiId={wikiId} kind="config" />}

                {/* Danger zone */}
                <DangerZone wikiId={wikiId} />
            </div>
        </div>
    );
}

// ── Generate Tab ─────────────────────────────────────────────────────

function GenerateTab({ wikiId }: { wikiId: string }) {
    const [cache, setCache] = useState<Record<number, string>>({});
    const [runningPhase, setRunningPhase] = useState<number | null>(null);
    const [logs, setLogs] = useState<Record<number, string[]>>({});
    const [fromPhase, setFromPhase] = useState(1);
    const [phase4Components, setPhase4Components] = useState<string[]>([]);
    const [phase4Expanded, setPhase4Expanded] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    // Load cache status
    useEffect(() => {
        fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/admin/cache')
            .then(data => {
                if (data && typeof data === 'object') setCache(data);
            })
            .catch(() => {});
    }, [wikiId]);

    const runPhase = useCallback((phase: number) => {
        if (runningPhase !== null) return;
        setRunningPhase(phase);
        setLogs(prev => ({ ...prev, [phase]: [] }));
        setPhase4Components([]);

        const controller = new AbortController();
        abortRef.current = controller;

        const url = getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/generate?phase=' + phase;
        const evtSource = new EventSource(url);

        evtSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'log' || data.type === 'progress') {
                    setLogs(prev => ({
                        ...prev,
                        [phase]: [...(prev[phase] || []), data.message || data.text || JSON.stringify(data)],
                    }));
                } else if (data.type === 'component-written') {
                    setPhase4Components(prev => [...prev, data.name || data.componentId || '']);
                } else if (data.type === 'done' || data.type === 'complete') {
                    evtSource.close();
                    setRunningPhase(null);
                    // Refresh cache
                    fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/admin/cache')
                        .then(d => { if (d && typeof d === 'object') setCache(d); })
                        .catch(() => {});
                } else if (data.type === 'error') {
                    setLogs(prev => ({
                        ...prev,
                        [phase]: [...(prev[phase] || []), '❌ ' + (data.message || 'Error')],
                    }));
                    evtSource.close();
                    setRunningPhase(null);
                }
            } catch { /* ignore */ }
        };

        evtSource.onerror = () => {
            evtSource.close();
            setRunningPhase(null);
        };

        // Cleanup on abort
        controller.signal.addEventListener('abort', () => {
            evtSource.close();
            setRunningPhase(null);
        });
    }, [wikiId, runningPhase]);

    const runAll = useCallback(() => {
        runPhase(fromPhase);
    }, [runPhase, fromPhase]);

    const handleAbort = useCallback(() => {
        if (abortRef.current) abortRef.current.abort();
    }, []);

    const getCacheBadge = (phase: number): { label: string; status: string } => {
        const v = cache[phase];
        if (v === 'cached' || v === 'valid') return { label: 'Cached', status: 'completed' };
        if (v === 'stale') return { label: 'Stale', status: 'cancelled' };
        return { label: 'None', status: 'queued' };
    };

    return (
        <div className="space-y-3">
            {/* Run All */}
            <div className="flex items-center gap-2">
                <label className="text-xs text-[#848484]">Start from:</label>
                <select
                    className="text-xs px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]"
                    value={fromPhase}
                    onChange={e => setFromPhase(parseInt(e.target.value))}
                    disabled={runningPhase !== null}
                >
                    {[1, 2, 3, 4, 5].map(p => (
                        <option key={p} value={p}>Phase {p}: {PHASE_NAMES[p].name}</option>
                    ))}
                </select>
                {runningPhase !== null ? (
                    <Button variant="danger" size="sm" onClick={handleAbort}>Abort</Button>
                ) : (
                    <Button size="sm" onClick={runAll}>Run All</Button>
                )}
            </div>

            {/* Phase cards */}
            {[1, 2, 3, 4, 5].map(phase => {
                const p = PHASE_NAMES[phase];
                const cacheBadge = getCacheBadge(phase);
                const isRunning = runningPhase === phase;
                const phaseLog = logs[phase] || [];

                return (
                    <Card key={phase} className="p-3" id={`phase-card-${phase}`}>
                        <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-[#0078d4]/10 text-[#0078d4] text-xs font-bold flex items-center justify-center flex-shrink-0">
                                {phase}
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">{p.name}</div>
                                <div className="text-[10px] text-[#848484]">{p.desc}</div>
                            </div>
                            <Badge status={cacheBadge.status} id={`phase-cache-${phase}`}>{cacheBadge.label}</Badge>
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={runningPhase !== null}
                                loading={isRunning}
                                onClick={() => runPhase(phase)}
                                id={`phase-run-${phase}`}
                            >
                                Run
                            </Button>
                        </div>

                        {/* Phase 4 component list */}
                        {phase === 4 && phase4Components.length > 0 && (
                            <div className="mt-2">
                                <button
                                    className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] flex items-center gap-1"
                                    id="phase4-component-toggle"
                                    onClick={() => setPhase4Expanded(p => !p)}
                                >
                                    <span className={cn('transition-transform text-[10px]', phase4Expanded && 'rotate-90')}>▶</span>
                                    Components (<span id="phase4-component-count">{phase4Components.length}</span>)
                                </button>
                                {phase4Expanded && (
                                    <div className="mt-1 pl-4 text-[10px] text-[#848484] space-y-0.5" id="phase4-component-list">
                                        {phase4Components.map((c, i) => <div key={i}>{c}</div>)}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Log output */}
                        {phaseLog.length > 0 && (
                            <pre
                                className="mt-2 text-[10px] leading-4 text-[#848484] bg-[#1e1e1e] dark:bg-black rounded p-2 max-h-48 overflow-y-auto font-mono"
                                id={`phase-log-${phase}`}
                            >
                                {phaseLog.join('\n')}
                            </pre>
                        )}
                    </Card>
                );
            })}
        </div>
    );
}

// ── Editor Tab (Seeds / Config) ──────────────────────────────────────

function EditorTab({ wikiId, kind }: { wikiId: string; kind: 'seeds' | 'config' }) {
    const [content, setContent] = useState('');
    const [original, setOriginal] = useState('');
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<string | null>(null);

    useEffect(() => {
        fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/admin/' + kind)
            .then(data => {
                const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
                setContent(text);
                setOriginal(text);
            })
            .catch(() => setStatus('Failed to load'));
    }, [wikiId, kind]);

    const handleSave = useCallback(async () => {
        setSaving(true);
        setStatus(null);
        try {
            const res = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/admin/' + kind, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: content,
            });
            if (res.ok) {
                setOriginal(content);
                setStatus('Saved');
            } else {
                setStatus('Failed to save');
            }
        } catch {
            setStatus('Network error');
        }
        setSaving(false);
    }, [wikiId, kind, content]);

    const handleReset = useCallback(() => {
        setContent(original);
        setStatus(null);
    }, [original]);

    const isModified = content !== original;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-[#848484]" id={`${kind}-path`}>{kind}.json</span>
                    {status && (
                        <span className={cn('text-xs', status === 'Saved' ? 'text-green-600' : 'text-[#f14c4c]')} id={`${kind}-status`}>
                            {status}
                        </span>
                    )}
                </div>
                <div className="flex gap-1">
                    <Button variant="secondary" size="sm" disabled={!isModified} onClick={handleReset} id={`${kind}-reset`}>Reset</Button>
                    <Button size="sm" disabled={!isModified} loading={saving} onClick={handleSave} id={`${kind}-save`}>Save</Button>
                </div>
            </div>
            <textarea
                className="w-full h-64 px-3 py-2 text-xs font-mono rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4] resize-y"
                id={`${kind}-editor`}
                value={content}
                onChange={e => { setContent(e.target.value); setStatus(null); }}
                spellCheck={false}
            />
        </div>
    );
}

// ── Danger Zone ─────────────────────────────────────────────────────

function DangerZone({ wikiId }: { wikiId: string }) {
    const [deleting, setDeleting] = useState(false);

    const handleDelete = useCallback(async () => {
        if (!confirm('Are you sure you want to delete this wiki? This cannot be undone.')) return;
        setDeleting(true);
        try {
            const res = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId), { method: 'DELETE' });
            if (res.ok) {
                location.hash = '#wiki';
            }
        } catch { /* ignore */ }
        setDeleting(false);
    }, [wikiId]);

    return (
        <div className="mt-8 p-3 border border-[#f14c4c]/30 rounded">
            <h4 className="text-xs font-semibold text-[#f14c4c] mb-2">Danger Zone</h4>
            <p className="text-[10px] text-[#848484] mb-2">Permanently delete this wiki and all its data.</p>
            <Button variant="danger" size="sm" loading={deleting} onClick={handleDelete}>
                Delete Wiki
            </Button>
        </div>
    );
}
