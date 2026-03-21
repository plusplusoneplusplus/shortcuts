/**
 * ModelsView — card grid of available AI models with search & capability filter.
 */
import React, { useState, useMemo } from 'react';
import { useModels, type ModelInfo } from '../../hooks/useModels';

type CapFilter = 'all' | 'vision' | 'reasoning';

function fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
    return String(n);
}

function ModelCard({ model }: { model: ModelInfo }) {
    const [copied, setCopied] = useState(false);

    const handleClick = () => {
        try {
            navigator.clipboard.writeText(model.id);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // clipboard API unavailable — skip silently
        }
    };

    const vision = model.capabilities?.supports?.vision;
    const reasoning = model.capabilities?.supports?.reasoningEffort;
    const ctx = model.capabilities?.limits?.max_context_window_tokens ?? model.tokenLimit;

    return (
        <button
            type="button"
            className="relative text-left rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] p-4 hover:shadow-md transition-shadow cursor-pointer"
            data-testid="model-card"
            onClick={handleClick}
        >
            {copied && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg text-white font-semibold text-sm" data-testid="copied-overlay">
                    Copied!
                </div>
            )}
            <div className="font-semibold text-sm text-[#1e1e1e] dark:text-[#cccccc]">{model.name || model.id}</div>
            <div className="text-xs text-[#888] mt-0.5 font-mono">{model.id}</div>
            <hr className="my-2 border-[#e0e0e0] dark:border-[#3c3c3c]" />
            {ctx > 0 && <div className="text-xs text-[#666] dark:text-[#999]">Context: {fmt(ctx)}</div>}
            <div className="flex gap-2 mt-1.5 flex-wrap">
                {vision && <span className="text-xs bg-[#e8f5e9] dark:bg-[#1b3a26] text-[#2e7d32] dark:text-[#81c784] px-1.5 py-0.5 rounded" data-testid="badge-vision">👁 Vision</span>}
                {reasoning && <span className="text-xs bg-[#e3f2fd] dark:bg-[#1a2e45] text-[#1565c0] dark:text-[#64b5f6] px-1.5 py-0.5 rounded" data-testid="badge-reasoning">🧠 Reasoning</span>}
            </div>
        </button>
    );
}

export function ModelsView() {
    const { models, loading, error, reload } = useModels();
    const [search, setSearch] = useState('');
    const [capFilter, setCapFilter] = useState<CapFilter>('all');

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

    if (loading) {
        return (
            <div id="view-models" className="flex items-center justify-center h-[calc(100vh-48px)] text-[#888]" data-testid="models-loading">
                Loading models…
            </div>
        );
    }

    if (error) {
        return (
            <div id="view-models" className="flex flex-col items-center justify-center h-[calc(100vh-48px)] gap-3 text-[#888]" data-testid="models-error">
                <p>Failed to load models: {error}</p>
                <button
                    className="px-3 py-1.5 rounded bg-[#0078d4] text-white text-sm hover:bg-[#106ebe] transition-colors"
                    onClick={reload}
                    data-testid="models-retry"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div id="view-models" className="h-[calc(100vh-48px)] overflow-y-auto p-4 md:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 mb-4">
                <input
                    type="text"
                    placeholder="🔍 Search models..."
                    className="h-8 px-3 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc] flex-1 min-w-0 w-full sm:w-auto"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    data-testid="models-search"
                />
                <select
                    className="h-8 px-2 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                    value={capFilter}
                    onChange={e => setCapFilter(e.target.value as CapFilter)}
                    data-testid="models-filter"
                >
                    <option value="all">All</option>
                    <option value="vision">Vision</option>
                    <option value="reasoning">Reasoning</option>
                </select>
                <span className="text-xs text-[#888] whitespace-nowrap" data-testid="models-count">{filtered.length} model{filtered.length !== 1 ? 's' : ''}</span>
            </div>

            {filtered.length === 0 ? (
                <div className="text-center text-[#888] mt-12" data-testid="models-empty">
                    No models match your filter.{' '}
                    <button className="underline text-[#0078d4]" onClick={() => { setSearch(''); setCapFilter('all'); }}>Clear</button>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4" data-testid="models-grid">
                    {filtered.map(m => <ModelCard key={m.id} model={m} />)}
                </div>
            )}
        </div>
    );
}
