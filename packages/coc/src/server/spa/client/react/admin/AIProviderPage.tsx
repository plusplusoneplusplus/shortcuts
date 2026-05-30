/**
 * AIProviderPage — redesigned AI provider admin page.
 *
 * Replaces the old card-based layout with a summary-grid + routing-table +
 * model-catalog design (matching the `admin-agents-redesign.html` mockup).
 *
 * This component is pure UI — all state, handlers, and API calls remain in
 * `AdminPanel.tsx` and are passed as props.
 */
import { Suspense, lazy, type ReactNode } from 'react';
import { Spinner } from '../ui';
import type { ProviderInstallStatus, AgentProvidersQuotaResponse } from '@plusplusoneplusplus/coc-client';

const ProviderModelsSection = lazy(() => import('../features/models/ProviderModelsSection').then(m => ({ default: m.ProviderModelsSection })));

type Provider = 'copilot' | 'codex' | 'claude';

export interface AIProviderPageProps {
    defaultProvider: Provider;
    setDefaultProvider: (p: Provider) => void;
    codexEnabled: boolean;
    setCodexEnabled: (v: boolean) => void;
    claudeEnabled: boolean;
    setClaudeEnabled: (v: boolean) => void;
    providerAvailability: Record<string, { available: boolean; error?: string }>;
    sdkInstallStatuses: Record<string, ProviderInstallStatus>;
    sdkInstallErrors: Record<string, string | undefined>;
    onInstallSdk: (provider: 'codex' | 'claude') => void;

    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    onCancel: () => void;

    quotaData: AgentProvidersQuotaResponse | null;
    quotaLoading: boolean;
    quotaError: string | null;
    onRefreshQuota: () => void;

    sources: Record<string, string | undefined>;
}

const PROVIDER_LABELS: Record<Provider, string> = { copilot: 'Copilot', codex: 'Codex', claude: 'Claude' };
const PROVIDER_AVATARS: Record<Provider, string> = { copilot: 'GH', codex: 'CX', claude: 'CL' };
const PROVIDER_IDS: Provider[] = ['copilot', 'codex', 'claude'];

function ProviderAvatar({ provider }: { provider: Provider }) {
    return (
        <span className={`aip-avatar aip-avatar-${provider}`} aria-hidden="true">
            {PROVIDER_AVATARS[provider]}
        </span>
    );
}

function StatusBadge({ available }: { available: boolean }) {
    return available
        ? <span className="ar-badge ar-badge-success"><span className="aip-dot" /> Available</span>
        : <span className="ar-badge ar-badge-danger"><span className="aip-dot" /> Unavailable</span>;
}

function InstallBadge({ status }: { status?: ProviderInstallStatus }) {
    if (!status) return null;
    const label: Record<ProviderInstallStatus, string> = {
        'not-installed': 'Not Installed',
        'installing': 'Installing…',
        'installed': 'Installed',
        'install-failed': 'Install Failed',
    };
    const cls: Record<ProviderInstallStatus, string> = {
        'not-installed': '',
        'installing': 'ar-badge-accent',
        'installed': 'ar-badge-success',
        'install-failed': 'ar-badge-danger',
    };
    return <span className={`ar-badge ${cls[status]}`} data-testid={`sdk-install-badge-${status}`}>{label[status]}</span>;
}

function QuotaCell({ providerId, quotaData }: { providerId: Provider; quotaData: AgentProvidersQuotaResponse | null }) {
    if (!quotaData) {
        return (
            <div className="aip-quota-cell">
                <div className="aip-quota-top">
                    <strong className="aip-quota-value">No data</strong>
                    <span className="ar-badge">No data</span>
                </div>
                <div className="aip-quota-caption">Quota not loaded</div>
            </div>
        );
    }
    const providerData = quotaData.providers.find(p => p.id === providerId);
    if (!providerData || providerData.error) {
        return (
            <div className="aip-quota-cell">
                <div className="aip-quota-top">
                    <strong className="aip-quota-value">{providerData?.error ? 'Error' : 'No data'}</strong>
                    <span className="ar-badge">{providerData?.error ? 'Error' : 'No data'}</span>
                </div>
                <div className="aip-quota-caption">{providerData?.error || 'Provider returned no quota snapshots'}</div>
            </div>
        );
    }
    if (!providerData.quotaTypes || providerData.quotaTypes.length === 0) {
        return (
            <div className="aip-quota-cell">
                <div className="aip-quota-top">
                    <strong className="aip-quota-value">Not reported</strong>
                    <span className="ar-badge">No data</span>
                </div>
                <div className="aip-quota-caption">Provider returned no quota snapshots</div>
            </div>
        );
    }

    const unlimitedTypes = providerData.quotaTypes.filter(q => q.isUnlimitedEntitlement);
    const finiteTypes = providerData.quotaTypes.filter(q => !q.isUnlimitedEntitlement);

    if (finiteTypes.length > 0) {
        const tightest = finiteTypes.reduce((best, qt) => {
            const pct = Math.round((qt.remainingPercentage ?? 1) * 100);
            const bestPct = Math.round((best.remainingPercentage ?? 1) * 100);
            return pct < bestPct ? qt : best;
        }, finiteTypes[0]);
        const pct = Math.round((tightest.remainingPercentage ?? 1) * 100);
        const barClass = pct < 25 ? 'aip-bar-danger' : pct < 50 ? 'aip-bar-warning' : '';
        const badgeClass = pct < 25 ? 'ar-badge-danger' : pct < 50 ? 'ar-badge-warning' : 'ar-badge-success';
        const badgeLabel = pct < 25 ? 'Risk' : pct < 50 ? 'Watch' : 'OK';
        return (
            <div className="aip-quota-cell">
                <div className="aip-quota-top">
                    <strong className="aip-quota-value">{pct}% remaining</strong>
                    <span className={`ar-badge ${badgeClass}`}>{badgeLabel}</span>
                </div>
                <div className="aip-quota-caption">
                    {tightest.usedRequests} / {tightest.entitlementRequests} used
                </div>
                <div className={`aip-bar ${barClass}`}>
                    <span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                </div>
            </div>
        );
    }

    if (unlimitedTypes.length > 0) {
        return (
            <div className="aip-quota-cell">
                <div className="aip-quota-top">
                    <strong className="aip-quota-value">Unlimited</strong>
                    <span className="ar-badge ar-badge-success">{unlimitedTypes.length} pool{unlimitedTypes.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="aip-quota-caption">Unlimited entitlement</div>
            </div>
        );
    }

    return (
        <div className="aip-quota-cell">
            <div className="aip-quota-top">
                <strong className="aip-quota-value">No data</strong>
                <span className="ar-badge">No data</span>
            </div>
            <div className="aip-quota-caption">Provider returned no quota snapshots</div>
        </div>
    );
}

function SummaryCard({ label, value, note }: { label: string; value: ReactNode; note: string }) {
    return (
        <div className="aip-summary-card">
            <div className="aip-summary-label">{label}</div>
            <div className="aip-summary-value">{value}</div>
            <div className="aip-summary-note">{note}</div>
        </div>
    );
}

function Toggle({ checked, onChange, disabled, label, testId }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
    label?: string;
    testId?: string;
}) {
    return (
        <button
            type="button"
            className="aip-toggle"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => !disabled && onChange(!checked)}
            data-testid={testId}
        >
            <span className={`aip-toggle-track ${checked ? 'is-on' : ''}`}>
                <span className="aip-toggle-knob" />
            </span>
        </button>
    );
}

export function AIProviderPage(props: AIProviderPageProps) {
    const {
        defaultProvider, setDefaultProvider,
        codexEnabled, setCodexEnabled,
        claudeEnabled, setClaudeEnabled,
        providerAvailability, sdkInstallStatuses, sdkInstallErrors, onInstallSdk,
        dirty, saving, onSave, onCancel,
        quotaData, quotaLoading, quotaError, onRefreshQuota,
    } = props;

    const providers: Array<{
        id: Provider;
        label: string;
        enabled: boolean;
        available: boolean;
        locked: boolean;
        source: string;
        note: string;
        installStatus?: ProviderInstallStatus;
    }> = [
        {
            id: 'copilot',
            label: 'Copilot',
            enabled: true,
            available: true,
            locked: true,
            source: 'default',
            note: 'Built in provider, no SDK install needed',
        },
        {
            id: 'codex',
            label: 'Codex',
            enabled: codexEnabled,
            available: providerAvailability['codex']?.available ?? false,
            locked: false,
            source: 'config',
            note: '@openai/codex-sdk',
            installStatus: sdkInstallStatuses['codex'],
        },
        {
            id: 'claude',
            label: 'Claude',
            enabled: claudeEnabled,
            available: providerAvailability['claude']?.available ?? false,
            locked: false,
            source: 'config',
            note: '@anthropic-ai/claude-agent-sdk',
            installStatus: sdkInstallStatuses['claude'],
        },
    ];

    const availableCount = providers.filter(p => p.available || p.locked).length;
    const enabledModelCount = '—';

    const overallQuotaRisk = (() => {
        if (!quotaData) return { badge: 'No data', cls: '', note: 'Quota not loaded' };
        const allProviders = quotaData.providers.filter(p => !p.error);
        const finiteQts = allProviders.flatMap(p =>
            (p.quotaTypes || []).filter(q => !q.isUnlimitedEntitlement),
        );
        if (finiteQts.length > 0) {
            const tightest = finiteQts.reduce((best, qt) => {
                const pct = Math.round((qt.remainingPercentage ?? 1) * 100);
                const bestPct = Math.round((best.remainingPercentage ?? 1) * 100);
                return pct < bestPct ? qt : best;
            }, finiteQts[0]);
            const pct = Math.round((tightest.remainingPercentage ?? 1) * 100);
            const label = pct < 25 ? 'Risk' : pct < 50 ? 'Watch' : 'Healthy';
            const cls = pct < 25 ? 'ar-badge-danger' : pct < 50 ? 'ar-badge-warning' : 'ar-badge-success';
            return { badge: label, cls, note: `${pct}% remaining` };
        }
        const unlimited = allProviders.flatMap(p => (p.quotaTypes || []).filter(q => q.isUnlimitedEntitlement));
        if (unlimited.length > 0) {
            return { badge: 'Healthy', cls: 'ar-badge-success', note: `${unlimited.length} unlimited pool${unlimited.length !== 1 ? 's' : ''}` };
        }
        return { badge: 'No data', cls: '', note: 'Quota endpoint has not reported usage' };
    })();

    return (
        <div className="aip-page" data-testid="ai-provider-page">
            {/* Page header */}
            <div className="aip-page-head">
                <div>
                    <h2 className="ar-page-title">AI Provider</h2>
                    <p className="ar-page-desc">Set defaults, provider readiness, quota, and model catalog from one admin route.</p>
                </div>
                <span className="ar-badge ar-badge-accent"><span className="aip-dot" /> Restart-aware</span>
            </div>

            {/* Summary grid */}
            <section className="aip-summary-grid" aria-label="Provider summary" data-testid="aip-summary-grid">
                <SummaryCard
                    label="Default provider"
                    value={PROVIDER_LABELS[defaultProvider]}
                    note="No per-chat override"
                />
                <SummaryCard
                    label="Provider health"
                    value={`${availableCount} / ${providers.length}`}
                    note={availableCount === providers.length ? 'All providers available' : `${providers.length - availableCount} unavailable`}
                />
                <SummaryCard
                    label="Enabled models"
                    value={enabledModelCount}
                    note="Visible providers"
                />
                <SummaryCard
                    label="Quota risk"
                    value={<span className={`ar-badge ${overallQuotaRisk.cls}`}>{overallQuotaRisk.badge}</span>}
                    note={overallQuotaRisk.note}
                />
            </section>

            {/* Provider routing table */}
            <section className="ar-card" aria-labelledby="provider-routing-title" data-testid="settings-default-provider">
                <header className="aip-panel-head">
                    <div>
                        <h3 className="aip-panel-title" id="provider-routing-title">Provider routing</h3>
                        <p className="aip-panel-desc">Availability, quota, install state, and default provider are visible in one scan.</p>
                    </div>
                    <div className="aip-panel-actions">
                        <button
                            type="button"
                            className="ar-btn ar-btn-secondary ar-btn-sm"
                            onClick={onRefreshQuota}
                            disabled={quotaLoading}
                            data-testid="btn-refresh-quota"
                        >
                            {quotaLoading ? <Spinner size="sm" /> : '↻'} Refresh quota
                        </button>
                        <span className="ar-badge ar-badge-warning">Restart required for default changes</span>
                    </div>
                </header>
                {quotaError && (
                    <div className="aip-error-banner" data-testid="quota-error-banner">
                        ⚠ {quotaError}
                    </div>
                )}
                <div className="aip-routing-table">
                    <table aria-label="Provider routing table">
                        <thead>
                            <tr>
                                <th>Provider</th>
                                <th>Status</th>
                                <th>Default</th>
                                <th>Quota</th>
                                <th>Enabled</th>
                            </tr>
                        </thead>
                        <tbody>
                            {providers.map(provider => {
                                const isDefault = defaultProvider === provider.id;
                                return (
                                    <tr key={provider.id} data-testid={`provider-row-${provider.id}`}>
                                        <td>
                                            <div className="aip-provider-cell">
                                                <ProviderAvatar provider={provider.id} />
                                                <div>
                                                    <div className="aip-provider-line">
                                                        <span className="aip-provider-main">{provider.label}</span>
                                                        <span className="aip-provider-source">{provider.source}</span>
                                                    </div>
                                                    <div className="aip-provider-meta">{provider.note}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div className="aip-status-cell">
                                                <StatusBadge available={provider.available || provider.locked} />
                                                {provider.installStatus && (
                                                    <InstallBadge status={provider.installStatus} />
                                                )}
                                                {provider.locked && <span className="ar-badge">Built in</span>}
                                                {!provider.locked && (!provider.installStatus || provider.installStatus === 'not-installed' || provider.installStatus === 'install-failed') && (
                                                    <button
                                                        type="button"
                                                        className="ar-btn ar-btn-secondary ar-btn-sm"
                                                        onClick={() => onInstallSdk(provider.id as 'codex' | 'claude')}
                                                        data-testid={`btn-install-${provider.id}`}
                                                    >
                                                        Install
                                                    </button>
                                                )}
                                                {provider.installStatus === 'installing' && <Spinner size="sm" />}
                                            </div>
                                            {provider.installStatus === 'install-failed' && sdkInstallErrors[provider.id] && (
                                                <div className="aip-install-error" data-testid={`${provider.id}-install-error`}>
                                                    ✕ {sdkInstallErrors[provider.id]}
                                                </div>
                                            )}
                                        </td>
                                        <td>
                                            <button
                                                type="button"
                                                className={`ar-btn ar-btn-sm ${isDefault ? 'ar-btn-primary' : 'ar-btn-secondary'}`}
                                                onClick={() => setDefaultProvider(provider.id)}
                                                data-testid={`select-default-provider-${provider.id}`}
                                            >
                                                {isDefault ? 'Default' : 'Make default'}
                                            </button>
                                        </td>
                                        <td>
                                            <QuotaCell providerId={provider.id} quotaData={quotaData} />
                                        </td>
                                        <td>
                                            <Toggle
                                                checked={provider.enabled}
                                                onChange={(v) => {
                                                    if (provider.id === 'codex') setCodexEnabled(v);
                                                    if (provider.id === 'claude') setClaudeEnabled(v);
                                                }}
                                                disabled={provider.locked}
                                                label={`Toggle ${provider.label}`}
                                                testId={provider.id === 'codex' ? 'toggle-codex-enabled' : provider.id === 'claude' ? 'toggle-claude-enabled' : undefined}
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {/* Unavailability warnings */}
                {defaultProvider === 'codex' && providerAvailability['codex'] && !providerAvailability['codex'].available && (
                    <div className="aip-unavailable-banner" data-testid="codex-sdk-unavailable-banner">
                        ⚠ {providerAvailability['codex'].error}
                    </div>
                )}
                {defaultProvider === 'claude' && providerAvailability['claude'] && !providerAvailability['claude'].available && (
                    <div className="aip-unavailable-banner" data-testid="claude-sdk-unavailable-banner">
                        ⚠ {providerAvailability['claude'].error}
                    </div>
                )}
                {/* Save/Cancel footer */}
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
                        onClick={onCancel}
                        disabled={saving || !dirty}
                        data-testid="settings-default-provider-cancel"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="ar-btn ar-btn-primary ar-btn-sm"
                        onClick={onSave}
                        disabled={!dirty || saving}
                        data-testid="settings-default-provider-save"
                    >
                        {saving && <Spinner size="sm" />}
                        Save changes
                    </button>
                </footer>
            </section>

            {/* Provider-scoped model catalog and query */}
            <Suspense fallback={<div className="ar-section ar-hstack ar-muted"><Spinner size="sm" /> Loading models…</div>}>
                <ProviderModelsSection
                    provider={defaultProvider}
                    available={
                        defaultProvider === 'copilot'
                            ? true
                            : (providerAvailability[defaultProvider]?.available ?? false)
                                && (defaultProvider === 'codex' ? codexEnabled : claudeEnabled)
                    }
                    unavailableMessage={
                        defaultProvider !== 'copilot' && !(defaultProvider === 'codex' ? codexEnabled : claudeEnabled)
                            ? `Enable the ${defaultProvider === 'codex' ? 'Codex' : 'Claude'} provider above to access its model catalog.`
                            : providerAvailability[defaultProvider]?.error
                    }
                />
            </Suspense>
        </div>
    );
}
