/**
 * ProviderModelsSection — provider-scoped model catalog and query UI.
 * Embedded inside the Agent Provider page for each provider tab.
 *
 * Uses the admin-redesign `.aip-*` class system for consistent styling
 * with the rest of the AI Provider page.
 */
import React, { useState, useMemo } from 'react';
import { useProviderModelConfig, type ProviderModelInfo, type AgentProvider } from '../../hooks/useProviderModels';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { Spinner } from '../../ui';

type CapFilter = 'all' | 'vision' | 'reasoning' | 'enabled';
type ViewMode = 'catalog' | 'query';

interface QueryState {
    response: string;
    error: string;
    model?: string;
    sessionId?: string;
    durationMs?: number;
}

function fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(0) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
    return String(n);
}

interface ProviderModelsSectionProps {
    provider: AgentProvider;
    available: boolean;
    unavailableMessage?: string;
    /** All providers to show in the toolbar tab bar. When set, renders provider-switching tabs. */
    allProviders?: AgentProvider[];
    /** Called when the user clicks a provider tab. */
    onProviderChange?: (provider: AgentProvider) => void;
}

const PROVIDER_TAB_LABELS: Record<AgentProvider, string> = { copilot: 'Copilot', codex: 'Codex', claude: 'Claude' };

export function ProviderModelsSection({ provider, available, unavailableMessage, allProviders, onProviderChange }: ProviderModelsSectionProps) {
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
        if (capFilter === 'enabled') list = list.filter(m => m.enabled);
        return [...list].sort((a, b) => (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0));
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
            <section className="ar-card" data-testid="provider-models-unavailable">
                <header className="aip-panel-head">
                    <div>
                        <h3 className="aip-panel-title">{providerLabel} Models</h3>
                        <p className="aip-panel-desc">
                            {unavailableMessage || `${providerLabel} is not available. Enable and configure the provider above to access its model catalog.`}
                        </p>
                    </div>
                </header>
            </section>
        );
    }

    if (loading) {
        return (
            <section className="ar-card" data-testid="provider-models-loading">
                <header className="aip-panel-head">
                    <div>
                        <h3 className="aip-panel-title">Model catalog and query</h3>
                        <p className="aip-panel-desc">Loading {providerLabel} models…</p>
                    </div>
                </header>
                <div className="aip-empty"><Spinner size="sm" /> Loading models…</div>
            </section>
        );
    }

    if (error) {
        return (
            <section className="ar-card" data-testid="provider-models-error">
                <header className="aip-panel-head">
                    <div>
                        <h3 className="aip-panel-title">Model catalog and query</h3>
                        <p className="aip-panel-desc">Failed to load {providerLabel} models: {error}</p>
                    </div>
                </header>
                <div className="aip-empty">
                    <button
                        type="button"
                        className="ar-btn ar-btn-secondary ar-btn-sm"
                        onClick={reload}
                        data-testid="provider-models-retry"
                    >
                        Retry
                    </button>
                </div>
            </section>
        );
    }

    const handleCopyModelId = (modelId: string) => {
        try { navigator.clipboard.writeText(modelId); } catch { /* clipboard unavailable */ }
    };

    return (
        <section className="ar-card" data-testid="provider-models-section" aria-labelledby="models-title">
            <header className="aip-panel-head">
                <div>
                    <h3 className="aip-panel-title" id="models-title">Model catalog and query</h3>
                    <p className="aip-panel-desc">A dense workspace for filtering enabled models, setting effort, and running a provider test.</p>
                </div>
                <span className="ar-badge" data-testid="provider-models-count">
                    {filtered.length} model{filtered.length !== 1 ? 's' : ''}
                </span>
            </header>

            {/* Toolbar */}
            <div className={`aip-toolbar ${allProviders ? 'aip-toolbar-5col' : ''}`} aria-label="Model controls">
                {allProviders && onProviderChange && (
                    <div className="aip-seg" role="tablist" aria-label="Provider">
                        {allProviders.map(p => (
                            <button
                                key={p}
                                type="button"
                                className={provider === p ? 'is-active' : ''}
                                onClick={() => onProviderChange(p)}
                                role="tab"
                                aria-selected={provider === p}
                                data-testid={`provider-tab-${p}`}
                            >
                                {PROVIDER_TAB_LABELS[p]}
                            </button>
                        ))}
                    </div>
                )}
                <input
                    className="aip-search"
                    type="search"
                    placeholder="Search models by name or ID"
                    aria-label="Search models"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    data-testid="provider-models-search"
                />
                <select
                    className="aip-select"
                    aria-label="Capability filter"
                    value={capFilter}
                    onChange={e => setCapFilter(e.target.value as CapFilter)}
                    data-testid="provider-models-filter"
                >
                    <option value="all">All capabilities</option>
                    <option value="vision">Vision</option>
                    <option value="reasoning">Reasoning</option>
                    <option value="enabled">Enabled</option>
                </select>
                <div className="aip-seg" role="tablist" aria-label="Model view">
                    <button
                        type="button"
                        className={viewMode === 'catalog' ? 'is-active' : ''}
                        onClick={() => setViewMode('catalog')}
                        role="tab"
                        aria-selected={viewMode === 'catalog'}
                        data-testid="provider-models-tab-catalog"
                    >
                        Catalog
                    </button>
                    <button
                        type="button"
                        className={viewMode === 'query' ? 'is-active' : ''}
                        onClick={() => setViewMode('query')}
                        role="tab"
                        aria-selected={viewMode === 'query'}
                        data-testid="provider-models-tab-query"
                    >
                        Query
                    </button>
                </div>
            </div>

            {viewMode === 'catalog' ? (
                filtered.length === 0 ? (
                    <div className="aip-empty" data-testid="provider-models-empty">
                        {models.length === 0
                            ? `No models available from ${providerLabel}.`
                            : <>No models match the current filter. <button type="button" className="ar-btn ar-btn-ghost ar-btn-sm" onClick={() => { setSearch(''); setCapFilter('all'); }}>Clear</button></>
                        }
                    </div>
                ) : (
                    <div className="aip-model-table" data-testid="provider-models-grid">
                        <table aria-label="Provider models">
                            <thead>
                                <tr>
                                    <th>Model</th>
                                    <th>Capabilities</th>
                                    <th>Context</th>
                                    <th>Reasoning</th>
                                    <th>Enabled</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(model => {
                                    const vision = model.capabilities?.supports?.vision;
                                    const reasoning = model.capabilities?.supports?.reasoningEffort;
                                    const ctx = model.capabilities?.limits?.max_context_window_tokens ?? model.tokenLimit;
                                    const supportedEfforts = model.supportedReasoningEfforts ?? [];
                                    const defaultEffort = model.defaultReasoningEffort;
                                    const activeEffort = reasoningEfforts[model.id] ?? defaultEffort;

                                    return (
                                        <tr key={model.id} data-testid="provider-model-card">
                                            <td>
                                                <div className="aip-model-name">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopyModelId(model.id)}
                                                        data-testid={`model-copy-${model.id}`}
                                                    >
                                                        {model.name || model.id}
                                                    </button>
                                                    <span className="aip-mono">{model.id}</span>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="aip-cap-list">
                                                    {vision && <span className="ar-badge ar-badge-accent" data-testid="badge-vision">Vision</span>}
                                                    {reasoning && <span className="ar-badge ar-badge-accent" data-testid="badge-reasoning">Reasoning</span>}
                                                    {!vision && !reasoning && <span className="ar-badge">Base</span>}
                                                </div>
                                            </td>
                                            <td className="aip-mono">{ctx ? fmt(ctx) : 'Not reported'}</td>
                                            <td>
                                                {supportedEfforts.length > 0 ? (
                                                    <div className="aip-effort">
                                                        {supportedEfforts.map(effort => (
                                                            <button
                                                                key={effort}
                                                                type="button"
                                                                className={activeEffort === effort ? 'is-active' : ''}
                                                                data-testid={`effort-${effort}`}
                                                                data-active={activeEffort === effort ? 'true' : 'false'}
                                                                data-default={defaultEffort === effort ? 'true' : 'false'}
                                                                onClick={() => {
                                                                    if (effort === defaultEffort && !reasoningEfforts[model.id]) return;
                                                                    if (effort === reasoningEfforts[model.id]) {
                                                                        setReasoningEffort(model.id, '');
                                                                    } else {
                                                                        setReasoningEffort(model.id, effort);
                                                                    }
                                                                }}
                                                            >
                                                                {effort}
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span className="ar-badge">None</span>
                                                )}
                                            </td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="aip-toggle"
                                                    role="switch"
                                                    aria-checked={model.enabled}
                                                    aria-label={model.enabled ? 'Disable model' : 'Enable model'}
                                                    aria-disabled={saving}
                                                    onClick={() => toggleModel(model.id, !model.enabled)}
                                                    data-testid="provider-model-toggle"
                                                >
                                                    <span className={`aip-toggle-track ${model.enabled ? 'is-on' : ''}`}>
                                                        <span className="aip-toggle-knob" />
                                                    </span>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )
            ) : (
                <div className="aip-query-grid" data-testid="provider-model-query-view">
                    <form className="aip-query-card" onSubmit={e => { e.preventDefault(); handleRunQuery(); }}>
                        <div className="aip-field">
                            <label htmlFor="query-model">Model</label>
                            <select
                                id="query-model"
                                className="aip-select"
                                value={selectedQueryModel}
                                onChange={e => setQueryModel(e.target.value)}
                                data-testid="provider-model-query-select"
                            >
                                <option value="">Provider default</option>
                                {queryModels.map(m => (
                                    <option key={m.id} value={m.id}>{m.name || m.id}</option>
                                ))}
                            </select>
                        </div>
                        <div className="aip-field">
                            <label htmlFor="query-prompt">Prompt</label>
                            <textarea
                                id="query-prompt"
                                className="aip-textarea"
                                placeholder="Ask the selected provider a short verification question."
                                value={queryPrompt}
                                onChange={e => setQueryPrompt(e.target.value)}
                                data-testid="provider-model-query-prompt"
                            />
                        </div>
                        <button
                            type="submit"
                            className="ar-btn ar-btn-primary ar-btn-sm"
                            disabled={!queryPrompt.trim() || queryRunning}
                            data-testid="provider-model-query-run"
                        >
                            {queryRunning ? <><Spinner size="sm" /> Running…</> : 'Run provider query'}
                        </button>
                    </form>
                    <div>
                        <div className="aip-panel-head" style={{ border: '1px solid var(--ar-border)', borderBottom: 0, borderRadius: 'var(--ar-radius-sm) var(--ar-radius-sm) 0 0' }}>
                            <div>
                                <h4 className="aip-panel-title" style={{ fontSize: 14 }}>Result</h4>
                                <p className="aip-panel-desc" data-testid="query-meta">
                                    {queryState.durationMs !== undefined
                                        ? `${queryState.model || selectedQueryModel || 'provider default'} · ${queryState.durationMs}ms${queryState.sessionId ? ` · ${queryState.sessionId}` : ''}`
                                        : 'No query has run yet.'}
                                </p>
                            </div>
                        </div>
                        {queryState.error ? (
                            <pre className="aip-result" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, color: 'var(--ar-danger)' }} data-testid="provider-model-query-error">{queryState.error}</pre>
                        ) : queryState.response ? (
                            <pre className="aip-result" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }} data-testid="provider-model-query-result">{queryState.response}</pre>
                        ) : (
                            <pre className="aip-result" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, color: 'var(--ar-text-mute)' }} data-testid="provider-model-query-empty">Select a model, enter a prompt, then run a provider query.</pre>
                        )}
                    </div>
                </div>
            )}

            {/* Enabled count footer */}
            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--ar-border)', fontSize: 12, color: 'var(--ar-text-mute)' }} data-testid="provider-models-enabled-count">
                {enabledCount} of {models.length} enabled{saving ? ' …' : ''}
            </div>
        </section>
    );
}
