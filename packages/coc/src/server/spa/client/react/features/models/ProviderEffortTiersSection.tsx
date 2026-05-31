/**
 * ProviderEffortTiersSection — admin editor for per-provider effort tier mappings.
 *
 * Shows three rows (Low / Medium / High), each with a Model dropdown and a
 * dependent Reasoning Effort dropdown. Standard dirty/save/cancel card semantics.
 *
 * Uses the admin-redesign `.aip-*` and `.ar-*` class system. No Tailwind.
 */
import React, { useMemo } from 'react';
import { useProviderEffortTiers, type EffortTierKey } from '../../hooks/useProviderEffortTiers';
import { useProviderModels, type AgentProvider, type ProviderModelInfo } from '../../hooks/useProviderModels';
import { Spinner } from '../../ui';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';

const TIER_KEYS: EffortTierKey[] = ['low', 'medium', 'high'];
const TIER_LABELS: Record<EffortTierKey, string> = { low: 'Low', medium: 'Medium', high: 'High' };

interface ProviderEffortTiersSectionProps {
    provider: AgentProvider;
}

function getReasoningEffortOptions(model: ProviderModelInfo | undefined): string[] {
    if (!model) return [];
    return model.supportedReasoningEfforts ?? [];
}

export function ProviderEffortTiersSection({ provider }: ProviderEffortTiersSectionProps) {
    const { models, loading: modelsLoading } = useProviderModels(provider);
    const {
        tiers, loading, error, saveError, saving, dirty,
        setTier, clearTier, save, cancel, reload,
    } = useProviderEffortTiers(provider);

    const modelMap = useMemo(() => {
        const map = new Map<string, ProviderModelInfo>();
        for (const m of models) map.set(m.id, m);
        return map;
    }, [models]);

    // Models sorted: enabled first, then by id
    const sortedModels = useMemo(
        () => [...models].sort((a, b) => (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0)),
        [models],
    );

    const providerLabel = provider === 'copilot' ? 'Copilot' : provider === 'codex' ? 'Codex' : 'Claude';

    if (loading || modelsLoading) {
        return (
            <section className="ar-card" data-testid="provider-effort-tiers-loading">
                <header className="aip-panel-head">
                    <div>
                        <h3 className="aip-panel-title">Effort Tiers</h3>
                        <p className="aip-panel-desc">Loading {providerLabel} effort tiers…</p>
                    </div>
                </header>
                <div className="aip-empty"><Spinner size="sm" /> Loading…</div>
            </section>
        );
    }

    if (error) {
        return (
            <section className="ar-card" data-testid="provider-effort-tiers-error">
                <header className="aip-panel-head">
                    <div>
                        <h3 className="aip-panel-title">Effort Tiers</h3>
                        <p className="aip-panel-desc">Failed to load effort tiers: {error}</p>
                    </div>
                </header>
                <div className="aip-empty">
                    <button
                        type="button"
                        className="ar-btn ar-btn-secondary ar-btn-sm"
                        onClick={reload}
                        data-testid="provider-effort-tiers-retry"
                    >
                        Retry
                    </button>
                </div>
            </section>
        );
    }

    return (
        <section className="ar-card" data-testid="provider-effort-tiers-section" aria-labelledby="effort-tiers-title">
            <header className="aip-panel-head">
                <div>
                    <h3 className="aip-panel-title" id="effort-tiers-title">Effort Tiers</h3>
                    <p className="aip-panel-desc">
                        Map each effort level (Low / Medium / High) to a model and optional reasoning effort.
                        Admins can preconfigure tiers even when the feature flag is off.
                    </p>
                </div>
            </header>

            {saveError && (
                <div className="aip-error-banner" data-testid="effort-tiers-save-error">
                    ⚠ {saveError}
                </div>
            )}

            <div className="aip-tier-table" data-testid="effort-tiers-table">
                <table aria-label="Effort tiers">
                    <thead>
                        <tr>
                            <th>Tier</th>
                            <th>Model</th>
                            <th>Reasoning Effort</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {TIER_KEYS.map(tier => {
                            const entry = tiers[tier];
                            const selectedModel = entry?.model ?? '';
                            const selectedEffort = entry?.reasoningEffort ?? '';
                            const isDefault = entry?.source === 'default';
                            const modelInfo = selectedModel ? modelMap.get(selectedModel) : undefined;
                            const effortOptions = getReasoningEffortOptions(modelInfo);
                            const supportsReasoning = effortOptions.length > 0;

                            return (
                                <tr key={tier} data-testid={`effort-tier-row-${tier}`}>
                                    <td>
                                        <span className="aip-tier-label" data-testid={`effort-tier-name-${tier}`}>
                                            {TIER_LABELS[tier]}
                                        </span>
                                        {isDefault && (
                                            <span
                                                className="aip-tier-default-badge"
                                                data-testid={`effort-tier-default-badge-${tier}`}
                                                title="Hardcoded provider default. Editing this row creates an explicit override."
                                            >
                                                Default
                                            </span>
                                        )}
                                    </td>
                                    <td>
                                        <select
                                            className="aip-select"
                                            aria-label={`${TIER_LABELS[tier]} tier model`}
                                            value={selectedModel}
                                            onChange={e => {
                                                const model = e.target.value;
                                                if (!model) {
                                                    clearTier(tier);
                                                } else {
                                                    setTier(tier, model, '');
                                                }
                                            }}
                                            data-testid={`effort-tier-model-select-${tier}`}
                                        >
                                            <option value="">— Not set —</option>
                                            {sortedModels.map(m => (
                                                <option key={m.id} value={m.id}>
                                                    {m.name || m.id}{!m.enabled ? ' (disabled)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                    <td>
                                        <select
                                            className="aip-select"
                                            aria-label={`${TIER_LABELS[tier]} tier reasoning effort`}
                                            value={selectedEffort}
                                            disabled={!selectedModel || !supportsReasoning}
                                            onChange={e => {
                                                if (selectedModel) {
                                                    setTier(tier, selectedModel, e.target.value);
                                                }
                                            }}
                                            title={
                                                !selectedModel
                                                    ? 'Select a model first'
                                                    : !supportsReasoning
                                                    ? 'This model does not support reasoning effort'
                                                    : undefined
                                            }
                                            data-testid={`effort-tier-effort-select-${tier}`}
                                        >
                                            <option value="">Auto</option>
                                            {effortOptions.map(e => (
                                                <option key={e} value={e}>{e}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td>
                                        {selectedModel && !isDefault && (
                                            <button
                                                type="button"
                                                className="ar-btn ar-btn-ghost ar-btn-sm"
                                                onClick={() => clearTier(tier)}
                                                aria-label={`Revert ${TIER_LABELS[tier]} tier to default`}
                                                title="Revert to provider default"
                                                data-testid={`effort-tier-clear-${tier}`}
                                            >
                                                Clear
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <footer className="ar-card-foot">
                {dirty && (
                    <span className="ar-dirty-note">
                        <span className="ar-dirty-pulse" aria-hidden="true" />
                        Unsaved changes
                    </span>
                )}
                <button
                    type="button"
                    className="ar-btn ar-btn-ghost ar-btn-sm"
                    onClick={cancel}
                    disabled={saving || !dirty}
                    data-testid="effort-tiers-cancel"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    className="ar-btn ar-btn-primary ar-btn-sm"
                    onClick={save}
                    disabled={!dirty || saving}
                    data-testid="effort-tiers-save"
                >
                    {saving && <Spinner size="sm" />}
                    Save changes
                </button>
            </footer>
        </section>
    );
}
