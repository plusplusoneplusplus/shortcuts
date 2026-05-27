/**
 * ProviderModelsSection — provider-scoped model catalog and query UI.
 * Embedded inside the Agent Provider page for each provider tab.
 */
import React, { useState, useMemo } from 'react';
import { useProviderModelConfig, type ProviderModelInfo, type AgentProvider } from '../../hooks/useProviderModels';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { Button } from '../../ui';

type CapFilter = 'all' | 'vision' | 'reasoning';
type ViewMode = 'catalog' | 'query';

interface QueryState {
    response: string;
    error: string;
    model?: string;
    sessionId?: string;
    durationMs?: number;
}

function fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
}

interface ModelCardProps {
    model: ProviderModelInfo;
    onToggle: (id: string, enabled: boolean) => void;
    saving: boolean;
    selectedEffort?: string;
    onSelectEffort: (modelId: string, effort: string) => void;
}

function ModelCard({ model, onToggle, saving, selectedEffort, onSelectEffort }: ModelCardProps) {
    const [copied, setCopied] = useState(false);

    const handleClick = () => {
        try {
            navigator.clipboard.writeText(model.id);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard API unavailable
        }
    };

    const handleToggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggle(model.id, !model.enabled);
    };

    const vision = model.capabilities?.supports?.vision;
    const reasoning = model.capabilities?.supports?.reasoningEffort;
    const ctx = model.capabilities?.limits?.max_context_window_tokens ?? model.tokenLimit;
    const supportedEfforts = model.supportedReasoningEfforts ?? [];
    const defaultEffort = model.defaultReasoningEffort;
    const activeEffort = selectedEffort ?? defaultEffort;

    const borderClass = model.enabled
        ? 'border-[#4caf50] dark:border-[#388e3c]'
        : 'border-[#e0e0e0] dark:border-[#3c3c3c]';

    return (
        <button
            type="button"
            className={`relative text-left rounded-lg border ${borderClass} bg-white dark:bg-[#1e1e1e] p-4 hover:shadow-md transition-shadow cursor-pointer`}
            data-testid="provider-model-card"
            onClick={handleClick}
        >
            {copied && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg text-white font-semibold text-sm" data-testid="copied-overlay">
                    Copied!
                </div>
            )}
            <div
                role="button"
                tabIndex={0}
                className="absolute top-2 right-2 flex items-center"
                onClick={handleToggle}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleToggle(e as unknown as React.MouseEvent); }}
                aria-label={model.enabled ? 'Disable model' : 'Enable model'}
                aria-disabled={saving}
                data-testid="provider-model-toggle"
            >
                <span
                    className={`inline-block w-8 h-4 rounded-full transition-colors relative ${model.enabled ? 'bg-[#4caf50] dark:bg-[#388e3c]' : 'bg-[#ccc] dark:bg-[#555]'}`}
                    data-testid={model.enabled ? 'toggle-on' : 'toggle-off'}
                >
                    <span
                        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${model.enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
                    />
                </span>
            </div>
            <div className="font-semibold text-sm text-[#1e1e1e] dark:text-[#cccccc] pr-10">{model.name || model.id}</div>
            <div className="text-xs text-[#888] mt-0.5 font-mono">{model.id}</div>
            <hr className="my-2 border-[#e0e0e0] dark:border-[#3c3c3c]" />
            {ctx > 0 && <div className="text-xs text-[#666] dark:text-[#999]">Context: {fmt(ctx)}</div>}
            <div className="flex gap-2 mt-1.5 flex-wrap">
                {vision && <span className="text-xs bg-[#e8f5e9] dark:bg-[#1b3a26] text-[#2e7d32] dark:text-[#81c784] px-1.5 py-0.5 rounded" data-testid="badge-vision">👁 Vision</span>}
                {reasoning && <span className="text-xs bg-[#e3f2fd] dark:bg-[#1a2e45] text-[#1565c0] dark:text-[#64b5f6] px-1.5 py-0.5 rounded" data-testid="badge-reasoning">🧠 Reasoning</span>}
            </div>
            {supportedEfforts.length > 0 && (
                <div className="flex gap-1 mt-1.5 flex-wrap items-center" data-testid="reasoning-efforts">
                    <span className="text-xs text-[#666] dark:text-[#999]">Effort:</span>
                    {supportedEfforts.map(effort => {
                        const isActive = effort === activeEffort;
                        const isDefault = effort === defaultEffort;
                        const badgeClass = isActive
                            ? 'bg-[#1565c0] dark:bg-[#1976d2] text-white'
                            : 'bg-[#e3f2fd] dark:bg-[#1a2e45] text-[#1565c0] dark:text-[#64b5f6]';
                        const handleEffortClick = (e: React.MouseEvent) => {
                            e.stopPropagation();
                            if (effort === defaultEffort && !selectedEffort) return;
                            if (effort === selectedEffort) {
                                onSelectEffort(model.id, '');
                            } else {
                                onSelectEffort(model.id, effort);
                            }
                        };
                        let title = effort;
                        if (isDefault) title += ' (default)';
                        if (selectedEffort === effort) title += ' (selected — click to reset)';
                        return (
                            <span
                                key={effort}
                                role="button"
                                tabIndex={0}
                                className={`text-[10px] px-1.5 py-0.5 rounded font-mono cursor-pointer hover:opacity-80 transition-opacity ${badgeClass}`}
                                data-testid={`effort-${effort}`}
                                data-active={isActive ? 'true' : 'false'}
                                data-default={isDefault ? 'true' : 'false'}
                                title={title}
                                onClick={handleEffortClick}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleEffortClick(e as unknown as React.MouseEvent); }}
                            >
                                {effort}{isActive ? '★' : ''}
                            </span>
                        );
                    })}
                    {selectedEffort && (
                        <span className="text-[10px] text-[#888] italic ml-0.5" data-testid="effort-override-indicator">
                            (custom)
                        </span>
                    )}
                </div>
            )}
        </button>
    );
}

interface ProviderModelsSectionProps {
    provider: AgentProvider;
    /** Whether the provider is available (installed, auth'd, enabled). When false, shows setup state. */
    available: boolean;
    /** Optional message to show when provider is unavailable. */
    unavailableMessage?: string;
}

export function ProviderModelsSection({ provider, available, unavailableMessage }: ProviderModelsSectionProps) {
    const { models, loading, error, saving, reload, toggleModel, reasoningEfforts, setReasoningEffort } = useProviderModelConfig(provider);
    const [search, setSearch] = useState('');
    const [capFilter, setCapFilter] = useState<CapFilter>('all');
    const [viewMode, setViewMode] = useState<ViewMode>('catalog');
    const [queryModel, setQueryModel] = useState('');
    const [queryPrompt, setQueryPrompt] = useState('');
    const [queryRunning, setQueryRunning] = useState(false);
    const [queryState, setQueryState] = useState<QueryState>({ response: '', error: '' });

    const filtered = useMemo(() => {
        let list = models;
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(m => m.id.toLowerCase().includes(q) || (m.name?.toLowerCase().includes(q)));
        }
        if (capFilter === 'vision') list = list.filter(m => m.capabilities?.supports?.vision);
        if (capFilter === 'reasoning') list = list.filter(m => m.capabilities?.supports?.reasoningEffort);
        return list;
    }, [models, search, capFilter]);

    const enabledCount = useMemo(() => models.filter(m => m.enabled).length, [models]);
    const queryModels = useMemo(() => {
        const enabled = models.filter(m => m.enabled);
        return enabled.length > 0 ? enabled : models;
    }, [models]);
    const selectedQueryModel = queryModels.some(m => m.id === queryModel) ? queryModel : '';

    const handleRunQuery = async () => {
        const prompt = queryPrompt.trim();
        if (!prompt || queryRunning) return;
        setQueryRunning(true);
        setQueryState({ response: '', error: '' });
        try {
            const result = await getSpaCocClient().agentProviders.queryModel(provider, {
                prompt,
                ...(selectedQueryModel ? { model: selectedQueryModel } : {}),
                timeoutMs: 60_000,
            });
            setQueryState({
                response: result.response ?? '',
                error: result.success ? '' : (result.error ?? 'Model query failed'),
                model: result.model,
                sessionId: result.sessionId,
                durationMs: result.durationMs,
            });
        } catch (err) {
            setQueryState({ response: '', error: getSpaCocClientErrorMessage(err, 'Model query failed') });
        } finally {
            setQueryRunning(false);
        }
    };

    const providerLabel = provider === 'copilot' ? 'Copilot' : provider === 'codex' ? 'Codex' : 'Claude';

    if (!available) {
        return (
            <div data-testid="provider-models-unavailable" className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] p-4 mt-4">
                <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">
                    {providerLabel} Models
                </div>
                <div className="text-sm text-[#888]">
                    {unavailableMessage || `${providerLabel} is not available. Enable and configure the provider above to access its model catalog.`}
                </div>
            </div>
        );
    }

    if (loading) {
        return (
            <div data-testid="provider-models-loading" className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] p-4 mt-4 text-[#888] text-sm">
                Loading {providerLabel} models…
            </div>
        );
    }

    if (error) {
        return (
            <div data-testid="provider-models-error" className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] p-4 mt-4">
                <p className="text-sm text-[#888]">Failed to load {providerLabel} models: {error}</p>
                <button
                    className="mt-2 px-3 py-1.5 rounded bg-[#0078d4] text-white text-sm hover:bg-[#106ebe] transition-colors"
                    onClick={reload}
                    data-testid="provider-models-retry"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div data-testid="provider-models-section" className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] p-4 mt-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-4">
                <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">
                    {providerLabel} Models
                </div>
                <div className="inline-flex h-7 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] overflow-hidden shrink-0 ml-0 sm:ml-auto" role="tablist" aria-label="Provider models view">
                    <button
                        type="button"
                        className={`px-2.5 text-xs ${viewMode === 'catalog' ? 'bg-[#0078d4] text-white' : 'bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]'}`}
                        onClick={() => setViewMode('catalog')}
                        role="tab"
                        aria-selected={viewMode === 'catalog'}
                        data-testid="provider-models-tab-catalog"
                    >
                        Catalog
                    </button>
                    <button
                        type="button"
                        className={`px-2.5 text-xs border-l border-[#d0d0d0] dark:border-[#3c3c3c] ${viewMode === 'query' ? 'bg-[#0078d4] text-white' : 'bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc]'}`}
                        onClick={() => setViewMode('query')}
                        role="tab"
                        aria-selected={viewMode === 'query'}
                        data-testid="provider-models-tab-query"
                    >
                        Query
                    </button>
                </div>
            </div>

            {viewMode === 'catalog' && (
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-3">
                    <input
                        type="text"
                        placeholder="🔍 Search models..."
                        className="h-7 px-2.5 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] text-xs text-[#1e1e1e] dark:text-[#cccccc] flex-1 min-w-0 w-full sm:w-auto"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        data-testid="provider-models-search"
                    />
                    <select
                        className="h-7 px-2 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                        value={capFilter}
                        onChange={e => setCapFilter(e.target.value as CapFilter)}
                        data-testid="provider-models-filter"
                    >
                        <option value="all">All</option>
                        <option value="vision">Vision</option>
                        <option value="reasoning">Reasoning</option>
                    </select>
                    <span className="text-xs text-[#888] whitespace-nowrap" data-testid="provider-models-count">{filtered.length} model{filtered.length !== 1 ? 's' : ''}</span>
                    <span className="text-xs text-[#888] whitespace-nowrap" data-testid="provider-models-enabled-count">{enabledCount} of {models.length} enabled{saving ? ' …' : ''}</span>
                    <Button variant="ghost" size="sm" onClick={reload} title="Refresh Models" data-testid="provider-models-refresh-btn">
                        ↻
                    </Button>
                </div>
            )}

            {viewMode === 'query' ? (
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,480px)_minmax(0,1fr)] gap-3" data-testid="provider-model-query-view">
                    <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] p-3">
                        <div className="flex flex-col gap-2.5">
                            <label className="flex flex-col gap-1 text-xs text-[#666] dark:text-[#999]">
                                Model
                                <select
                                    className="h-7 px-2 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                                    value={selectedQueryModel}
                                    onChange={e => setQueryModel(e.target.value)}
                                    data-testid="provider-model-query-select"
                                >
                                    <option value="">Provider default</option>
                                    {queryModels.map(m => (
                                        <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-[#666] dark:text-[#999]">
                                Prompt
                                <textarea
                                    className="min-h-[140px] resize-y rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] p-2.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] font-mono"
                                    value={queryPrompt}
                                    onChange={e => setQueryPrompt(e.target.value)}
                                    data-testid="provider-model-query-prompt"
                                />
                            </label>
                            <div className="flex items-center gap-3">
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={handleRunQuery}
                                    disabled={!queryPrompt.trim() || queryRunning}
                                    data-testid="provider-model-query-run"
                                >
                                    {queryRunning ? 'Running...' : 'Run'}
                                </Button>
                                <span className="text-xs text-[#888]">
                                    {queryModels.length} selectable model{queryModels.length !== 1 ? 's' : ''}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526] p-3 min-h-[200px]">
                        <div className="flex items-center justify-between gap-3 mb-2">
                            <div className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Result</div>
                            {queryState.durationMs !== undefined && (
                                <div className="text-xs text-[#888]">
                                    {queryState.model || selectedQueryModel} · {queryState.durationMs}ms
                                    {queryState.sessionId ? ` · ${queryState.sessionId}` : ''}
                                </div>
                            )}
                        </div>
                        {queryState.error ? (
                            <pre className="whitespace-pre-wrap rounded bg-[#fff4f4] dark:bg-[#3a1f1f] border border-[#f2b8b8] dark:border-[#6f3333] p-2.5 text-xs text-[#9f1d1d] dark:text-[#ffb3b3]" data-testid="provider-model-query-error">{queryState.error}</pre>
                        ) : queryState.response ? (
                            <pre className="whitespace-pre-wrap text-xs text-[#1e1e1e] dark:text-[#cccccc]" data-testid="provider-model-query-result">{queryState.response}</pre>
                        ) : (
                            <div className="text-xs text-[#888]" data-testid="provider-model-query-empty">No query result yet.</div>
                        )}
                    </div>
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center text-[#888] text-xs mt-6" data-testid="provider-models-empty">
                    {models.length === 0
                        ? `No models available from ${providerLabel}.`
                        : <>No models match your filter. <button className="underline text-[#0078d4]" onClick={() => { setSearch(''); setCapFilter('all'); }}>Clear</button></>
                    }
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="provider-models-grid">
                    {filtered.map(m => (
                        <ModelCard
                            key={m.id}
                            model={m}
                            onToggle={toggleModel}
                            saving={saving}
                            selectedEffort={reasoningEfforts[m.id]}
                            onSelectEffort={setReasoningEffort}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
