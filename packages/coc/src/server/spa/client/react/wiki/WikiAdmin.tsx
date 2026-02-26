/**
 * WikiAdmin — admin panel with Generate, Seeds, Config, Delete sub-tabs.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useCallback, useRef } from 'react';
import * as yaml from 'js-yaml';
import { Button, Card, Spinner, Badge } from '../shared';
import { cn } from '../shared/cn';
import { getApiBase } from '../utils/config';
import { fetchApi } from '../hooks/useApi';
import type { WikiAdminTab } from '../types/dashboard';

const ADMIN_TABS: WikiAdminTab[] = ['generate', 'seeds', 'config', 'delete'];

interface WikiAdminProps {
    wikiId: string;
    initialTab?: WikiAdminTab | null;
    onTabChange?: (tab: WikiAdminTab) => void;
}

const DEFAULT_CONFIG_TEMPLATE = `# deep-wiki configuration
# This file is optional — remove any lines you don't need.
# CLI flags always take precedence over values set here.

# AI model to use (e.g. claude-sonnet-4-5, gpt-4o)
# model: claude-sonnet-4-5

# Number of parallel AI sessions (default: 3)
# concurrency: 3

# Timeout per phase in seconds (default: 300)
# timeout: 300

# Article detail level: shallow | normal | deep (default: normal)
# depth: normal

# Use cached results when available (default: true)
# useCache: true

# Force regeneration, ignoring all caches (default: false)
# force: false

# Focus analysis on a specific subdirectory (e.g. src/auth)
# focus:

# Website output directory (default: ./wiki)
# output: ./wiki

# Website theme: light | dark | auto (default: auto)
# theme: auto

# Override the project title shown on the website
# title:

# Skip website generation phase (default: false)
# skipWebsite: false

# Per-phase overrides (optional)
# phases:
#   discovery:
#     model: claude-haiku-4-5
#     concurrency: 5
#   analysis:
#     depth: deep
#     concurrency: 2
#   writing:
#     depth: normal
`;

const PHASE_NAMES: Record<number, { name: string; desc: string }> = {
    1: { name: 'Discovery', desc: 'Discover component graph structure' },
    2: { name: 'Consolidation', desc: 'Merge and consolidate discovery output' },
    3: { name: 'Analysis', desc: 'Deep analysis per component' },
    4: { name: 'Writing', desc: 'Generate articles and synthesis' },
    5: { name: 'Website', desc: 'Build static site output' },
};

export function WikiAdmin({ wikiId, initialTab, onTabChange }: WikiAdminProps) {
    const [tab, setTab] = useState<WikiAdminTab>(
        initialTab && ADMIN_TABS.includes(initialTab) ? initialTab : 'generate'
    );

    useEffect(() => {
        if (initialTab && ADMIN_TABS.includes(initialTab)) {
            setTab(initialTab);
        }
    }, [initialTab]);

    const changeTab = useCallback((t: WikiAdminTab) => {
        setTab(t);
        onTabChange?.(t);
    }, [onTabChange]);

    return (
        <div className="flex flex-col h-full">
            {/* Sub-tab bar */}
            <div className="flex gap-1 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                {ADMIN_TABS.map(t => (
                    <button
                        key={t}
                        className={cn(
                            'px-3 py-1 text-xs rounded transition-colors',
                            t === 'delete'
                                ? tab === t
                                    ? 'bg-[#f14c4c] text-white'
                                    : 'text-[#f14c4c] hover:bg-[#f14c4c]/10'
                                : tab === t
                                    ? 'bg-[#0078d4] text-white'
                                    : 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                        )}
                        data-wiki-admin-tab={t}
                        onClick={() => changeTab(t)}
                    >
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-3">
                {tab === 'generate' && <div id="admin-content-generate"><GenerateTab wikiId={wikiId} /></div>}
                {tab === 'seeds' && <div id="admin-content-seeds"><EditorTab wikiId={wikiId} kind="seeds" /></div>}
                {tab === 'config' && <div id="admin-content-config"><EditorTab wikiId={wikiId} kind="config" /></div>}
                {tab === 'delete' && <DangerZone wikiId={wikiId} />}
            </div>
        </div>
    );
}

// ── Generate Tab ─────────────────────────────────────────────────────

interface CacheMetadata {
    components: number;
    categories: number;
    themes: number;
    domains: number;
    analyses: number;
    articles: number;
    projectName?: string;
    projectLanguage?: string;
}

function GenerateTab({ wikiId }: { wikiId: string }) {
    const [cache, setCache] = useState<Record<number, string>>({});
    const [metadata, setMetadata] = useState<CacheMetadata | null>(null);
    const [runningPhase, setRunningPhase] = useState<number | null>(null);
    const [lastError, setLastError] = useState<string | null>(null);
    const [logs, setLogs] = useState<Record<number, string[]>>({});
    const [fromPhase, setFromPhase] = useState(1);
    const [phase4Components, setPhase4Components] = useState<string[]>([]);
    const [phase4Expanded, setPhase4Expanded] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    const loadCacheStatus = useCallback(() => {
        fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/admin/generate/status')
            .then(data => {
                if (data?.phases && typeof data.phases === 'object') {
                    const m: Record<number, string> = {};
                    for (const [k, v] of Object.entries(data.phases as Record<string, { cached: boolean }>)) {
                        m[parseInt(k)] = v.cached ? 'cached' : 'none';
                    }
                    setCache(m);
                }
                if (data?.metadata) {
                    setMetadata(data.metadata);
                }
            })
            .catch(() => {});
    }, [wikiId]);

    useEffect(() => { loadCacheStatus(); }, [loadCacheStatus]);

    const runPhase = useCallback((startPhase: number, endPhase: number, force = false) => {
        if (runningPhase !== null) return;
        setLastError(null);
        setRunningPhase(startPhase);
        setLogs(prev => {
            const n = { ...prev };
            for (let p = startPhase; p <= endPhase; p++) n[p] = [];
            return n;
        });
        setPhase4Components([]);

        const controller = new AbortController();
        abortRef.current = controller;

        const url = getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/admin/generate';
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startPhase, endPhase, ...(force ? { force: true } : {}) }),
            signal: controller.signal,
        }).then(async res => {
            if (!res.ok) {
                const text = await res.text();
                let errMsg = text;
                try {
                    const json = JSON.parse(text);
                    if (json?.error) errMsg = json.error;
                } catch { /* ignore */ }
                setLastError(errMsg);
                setLogs(prev => ({ ...prev, [startPhase]: [...(prev[startPhase] || []), '❌ ' + text] }));
                setRunningPhase(null);
                return;
            }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(line.slice(6));
                        const phase: number = data.phase ?? startPhase;
                        if (data.type === 'log' || data.type === 'progress') {
                            setLogs(prev => ({
                                ...prev,
                                [phase]: [...(prev[phase] || []), data.message || data.text || JSON.stringify(data)],
                            }));
                        } else if (data.type === 'status') {
                            setRunningPhase(phase);
                            if (data.message) {
                                setLogs(prev => ({ ...prev, [phase]: [...(prev[phase] || []), data.message] }));
                            }
                        } else if (data.type === 'phase-complete') {
                            setLogs(prev => ({
                                ...prev,
                                [data.phase]: [...(prev[data.phase] || []), `✓ ${data.message || 'Complete'}`],
                            }));
                        } else if (data.type === 'component-written') {
                            setPhase4Components(prev => [...prev, data.name || data.componentId || '']);
                        } else if (data.type === 'done' || data.type === 'complete') {
                            setRunningPhase(null);
                            loadCacheStatus();
                        } else if (data.type === 'error') {
                            setLogs(prev => ({
                                ...prev,
                                [phase]: [...(prev[phase] || []), '❌ ' + (data.message || 'Error')],
                            }));
                            setRunningPhase(null);
                        }
                    } catch { /* ignore */ }
                }
            }
            setRunningPhase(null);
        }).catch(err => {
            if (err.name !== 'AbortError') {
                setLogs(prev => ({ ...prev, [startPhase]: [...(prev[startPhase] || []), '❌ Connection error'] }));
            }
            setRunningPhase(null);
        });
    }, [wikiId, runningPhase, loadCacheStatus]);

    const runAll = useCallback((force = false) => {
        runPhase(fromPhase, 5, force);
    }, [runPhase, fromPhase]);

    const handleAbort = useCallback(() => {
        if (abortRef.current) abortRef.current.abort();
        fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/admin/generate/cancel', { method: 'POST' })
            .catch(() => {});
    }, [wikiId]);

    const getCacheBadge = (phase: number): { label: string; status: string } => {
        const v = cache[phase];
        if (v === 'cached' || v === 'valid') return { label: 'Cached', status: 'completed' };
        if (v === 'stale') return { label: 'Stale', status: 'cancelled' };
        return { label: 'None', status: 'queued' };
    };

    return (
        <div className="space-y-3">
            {/* Status bar when running or error */}
            {runningPhase !== null && (
                <div id="generate-status-bar" className="text-xs text-[#848484] py-2">
                    Running phase {runningPhase}…
                </div>
            )}
            {lastError && (
                <div id="generate-status-bar" className={cn('text-xs py-2', 'text-[#f14c4c] error')}>
                    {lastError}
                </div>
            )}
            {/* Run All */}
            <div className="flex items-center gap-2">
                <label className="text-xs text-[#848484]">Start from:</label>
                <select
                    id="generate-start-phase"
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
                    <>
                        <Button size="sm" onClick={() => runAll(false)}>Run All</Button>
                        <Button size="sm" variant="secondary" onClick={() => runAll(true)} id="force-run-all">Force All</Button>
                    </>
                )}
            </div>

            {/* Cache metadata summary */}
            {metadata && hasCachedPhases(cache) && (
                <MetadataSummary metadata={metadata} />
            )}

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
                            {cacheBadge.label === 'Cached' && (
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={runningPhase !== null}
                                    loading={isRunning}
                                    onClick={() => runPhase(phase, phase, true)}
                                    id={`phase-force-${phase}`}
                                >
                                    Force
                                </Button>
                            )}
                            <Button
                                size="sm"
                                variant="secondary"
                                disabled={runningPhase !== null}
                                loading={isRunning}
                                onClick={() => runPhase(phase, phase)}
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

// ── Metadata Summary ─────────────────────────────────────────────────

function hasCachedPhases(cache: Record<number, string>): boolean {
    return Object.values(cache).some(v => v === 'cached' || v === 'valid');
}

const METADATA_ITEMS: Array<{ key: keyof CacheMetadata; label: string; icon: string }> = [
    { key: 'components', label: 'Components', icon: '📦' },
    { key: 'themes', label: 'Themes', icon: '🎨' },
    { key: 'categories', label: 'Categories', icon: '📂' },
    { key: 'domains', label: 'Domains', icon: '🌐' },
    { key: 'analyses', label: 'Analyses', icon: '🔬' },
    { key: 'articles', label: 'Articles', icon: '📝' },
];

function MetadataSummary({ metadata }: { metadata: CacheMetadata }) {
    const items = METADATA_ITEMS.filter(item => {
        const val = metadata[item.key];
        return typeof val === 'number' && val > 0;
    });

    if (items.length === 0) return null;

    return (
        <Card className="p-3" id="cache-metadata-summary">
            <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                    Cache Summary
                </span>
                {metadata.projectName && (
                    <span className="text-[10px] text-[#848484]" id="metadata-project-name">
                        {metadata.projectName}
                        {metadata.projectLanguage ? ` · ${metadata.projectLanguage}` : ''}
                    </span>
                )}
            </div>
            <div className="grid grid-cols-3 gap-2" id="metadata-grid">
                {items.map(item => (
                    <div
                        key={item.key}
                        className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#f5f5f5] dark:bg-[#2d2d2d]"
                        data-metadata-item={item.key}
                    >
                        <span className="text-[10px]">{item.icon}</span>
                        <span className="text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]" data-metadata-value={item.key}>
                            {metadata[item.key] as number}
                        </span>
                        <span className="text-[10px] text-[#848484]">{item.label}</span>
                    </div>
                ))}
            </div>
        </Card>
    );
}

// ── Editor Tab (Seeds / Config) ──────────────────────────────────────

function EditorTab({ wikiId, kind }: { wikiId: string; kind: 'seeds' | 'config' }) {
    const [content, setContent] = useState('');
    const [original, setOriginal] = useState('');
    const [resourcePath, setResourcePath] = useState<string | null>(null);
    const [isNewFile, setIsNewFile] = useState(false);
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [generating, setGenerating] = useState(false);
    const [genLogs, setGenLogs] = useState<string[]>([]);

    useEffect(() => {
        fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/admin/' + kind)
            .then(data => {
                let text = '';
                let resolvedPath: string | null = null;

                if (kind === 'config') {
                    resolvedPath = typeof data?.path === 'string' ? data.path : null;
                    if (typeof data?.content === 'string') {
                        text = data.content;
                    } else if (data?.exists === false) {
                        text = DEFAULT_CONFIG_TEMPLATE;
                        setIsNewFile(true);
                    }
                } else {
                    resolvedPath = typeof data?.path === 'string' ? data.path : null;
                    if (typeof data?.content === 'string') {
                        text = data.content;
                    } else if (data?.content !== null && data?.content !== undefined) {
                        text = yaml.dump(data.content);
                    }
                }

                setContent(text);
                setOriginal(text);
                setResourcePath(resolvedPath);
                setStatus(null);
            })
            .catch(() => setStatus('Failed to load'));
    }, [wikiId, kind]);

    const handleSave = useCallback(async () => {
        setSaving(true);
        setStatus(null);
        try {
            if (kind === 'seeds') {
                try {
                    yaml.load(content);
                } catch {
                    setStatus('Invalid YAML');
                    setSaving(false);
                    return;
                }
            }
            const res = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/admin/' + kind, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
            });
            if (res.ok) {
                setOriginal(content);
                setIsNewFile(false);
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

    const handleGenerateSeeds = useCallback(async () => {
        setGenerating(true);
        setGenLogs([]);
        try {
            const res = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/admin/seeds/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            });
            if (!res.ok) {
                setGenLogs(['❌ ' + await res.text()]);
                setGenerating(false);
                return;
            }

            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            // eslint-disable-next-line no-constant-condition
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.type === 'status' || data.type === 'log') {
                            setGenLogs(prev => [...prev, data.message || '']);
                        } else if (data.type === 'done' && data.success && Array.isArray(data.seeds)) {
                            // Build YAML matching ThemeSeed shape (theme/description/hints)
                            const normalized = data.seeds.map((s: any) => ({
                                theme: typeof s.theme === 'string' ? s.theme : String(s.theme ?? ''),
                                description: typeof s.description === 'string' ? s.description : '',
                                hints: Array.isArray(s.hints) ? s.hints : [],
                            }));
                            const yamlContent = yaml.dump({ themes: normalized });
                            setContent(yamlContent);
                            setGenLogs(prev => [...prev, `✓ Generated ${data.seeds.length} seeds`]);
                        } else if (data.type === 'error') {
                            setGenLogs(prev => [...prev, '❌ ' + (data.message || 'Error')]);
                        }
                    } catch { /* ignore */ }
                }
            }
        } catch (err: any) {
            setGenLogs(['❌ ' + (err?.message || 'Network error')]);
        }
        setGenerating(false);
    }, [wikiId]);

    return (
        <div className="space-y-2">
            {kind === 'seeds' && (
                <div className="flex items-center justify-between pb-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <span className="text-xs text-[#848484]">Generate theme seeds via AI</span>
                    <Button size="sm" loading={generating} onClick={handleGenerateSeeds} id="seeds-generate">
                        Generate Seeds
                    </Button>
                </div>
            )}
            {kind === 'seeds' && genLogs.length > 0 && (
                <pre className="text-[10px] leading-4 text-[#848484] bg-[#1e1e1e] dark:bg-black rounded p-2 max-h-24 overflow-y-auto font-mono" id="seeds-gen-log">
                    {genLogs.join('\n')}
                </pre>
            )}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-[#848484]" id={`${kind}-path`}>
                        {resourcePath || (kind === 'config' ? 'deep-wiki.config.yaml' : 'seeds.yaml')}
                    </span>
                    {isNewFile && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-[#0078d4]/10 text-[#0078d4]" id={`${kind}-new-badge`}>
                            New file — save to create
                        </span>
                    )}
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
