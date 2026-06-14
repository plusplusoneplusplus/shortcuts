/**
 * AIProviderPage — redesigned AI provider admin page.
 *
 * Replaces the old card-based layout with a summary-grid + routing-table +
 * model-catalog design (matching the `admin-agents-redesign.html` mockup).
 *
 * This component is pure UI — all state, handlers, and API calls remain in
 * `AdminPanel.tsx` and are passed as props.
 */
import { Suspense, lazy, useState, type ReactNode } from 'react';
import { Spinner } from '../ui';
import type {
    ProviderInstallStatus,
    AgentProvidersQuotaResponse,
    AdminAutoProviderRoutingConfig,
    AdminConcreteAgentProvider,
    AdminDefaultProvider,
} from '@plusplusoneplusplus/coc-client';
import { resolveAutoAgentProvider } from '../../../../agent-providers/auto-provider-router';
import {
    formatQuotaTypeLabel,
    getFiniteQuotaTypes,
    getMostConstrainedProviderQuota,
    getQuotaPercent,
    getQuotaRiskClasses,
    getTightestFiniteQuotaType,
    getUnlimitedQuotaTypes,
} from '../shared/quotaUtils';
import { PROVIDER_LABELS, ProviderAvatar } from '../shared/providerVisuals';

const ProviderModelsSection = lazy(() => import('../features/models/ProviderModelsSection').then(m => ({ default: m.ProviderModelsSection })));
const ProviderEffortTiersSection = lazy(() => import('../features/models/ProviderEffortTiersSection').then(m => ({ default: m.ProviderEffortTiersSection })));

type Provider = AdminConcreteAgentProvider;
type DefaultProvider = AdminDefaultProvider;
export type NormalizedAutoProviderRoutingConfig = {
    rules: {
        provider: Provider;
        enabled: boolean;
        minimumRemainingPercent: number;
        weeklyGuard: {
            enabled: boolean;
            minimumRemainingPercent: number;
        };
    }[];
    fallbackProvider: Provider;
};

export interface AIProviderPageProps {
    defaultProvider: DefaultProvider;
    setDefaultProvider: (p: DefaultProvider) => void;
    codexEnabled: boolean;
    setCodexEnabled: (v: boolean) => void;
    claudeEnabled: boolean;
    setClaudeEnabled: (v: boolean) => void;
    autoAgentProviderRoutingEnabled: boolean;
    setAutoAgentProviderRoutingEnabled: (v: boolean) => void;
    autoRoutingConfig: AdminAutoProviderRoutingConfig | null | undefined;
    setAutoRoutingConfig: (config: NormalizedAutoProviderRoutingConfig) => void;
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
    onRefreshQuota: (options?: { force?: boolean }) => void;

    sources: Record<string, string | undefined>;
}

const DEFAULT_PROVIDER_LABELS: Record<DefaultProvider, string> = PROVIDER_LABELS;
const PROVIDER_IDS: Provider[] = ['copilot', 'codex', 'claude'];
export const DEFAULT_AUTO_PROVIDER_ROUTING_CONFIG: NormalizedAutoProviderRoutingConfig = {
    rules: [
        {
            provider: 'claude',
            enabled: true,
            minimumRemainingPercent: 33,
            weeklyGuard: {
                enabled: true,
                minimumRemainingPercent: 33,
            },
        },
        {
            provider: 'codex',
            enabled: true,
            minimumRemainingPercent: 33,
            weeklyGuard: {
                enabled: true,
                minimumRemainingPercent: 33,
            },
        },
        {
            provider: 'copilot',
            enabled: true,
            minimumRemainingPercent: 10,
            weeklyGuard: {
                enabled: true,
                minimumRemainingPercent: 10,
            },
        },
    ],
    fallbackProvider: 'copilot',
};

function isProvider(value: unknown): value is Provider {
    return typeof value === 'string' && PROVIDER_IDS.includes(value as Provider);
}

function normalizePercent(value: unknown, fallback: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(100, Math.round(value)));
}

function parsePercentInput(value: string, fallback: number): number {
    if (value.trim() === '') return fallback;
    return normalizePercent(Number(value), fallback);
}

export function normalizeAutoProviderRoutingConfig(config: AdminAutoProviderRoutingConfig | null | undefined): NormalizedAutoProviderRoutingConfig {
    const defaultsByProvider = new Map(DEFAULT_AUTO_PROVIDER_ROUTING_CONFIG.rules.map(rule => [rule.provider, rule]));
    const configuredRules = Array.isArray(config?.rules) ? config.rules : [];
    const seen = new Set<Provider>();
    const rules: NormalizedAutoProviderRoutingConfig['rules'] = [];

    for (const candidate of [...configuredRules, ...DEFAULT_AUTO_PROVIDER_ROUTING_CONFIG.rules]) {
        if (!isProvider(candidate.provider) || seen.has(candidate.provider)) continue;
        const defaults = defaultsByProvider.get(candidate.provider) ?? DEFAULT_AUTO_PROVIDER_ROUTING_CONFIG.rules[0];
        rules.push({
            provider: candidate.provider,
            enabled: candidate.enabled ?? defaults.enabled,
            minimumRemainingPercent: normalizePercent(candidate.minimumRemainingPercent, defaults.minimumRemainingPercent),
            weeklyGuard: {
                enabled: candidate.weeklyGuard?.enabled ?? defaults.weeklyGuard.enabled,
                minimumRemainingPercent: normalizePercent(candidate.weeklyGuard?.minimumRemainingPercent, defaults.weeklyGuard.minimumRemainingPercent),
            },
        });
        seen.add(candidate.provider);
    }

    const fallbackProvider = isProvider(config?.fallbackProvider)
        ? config.fallbackProvider
        : DEFAULT_AUTO_PROVIDER_ROUTING_CONFIG.fallbackProvider;
    return { rules, fallbackProvider };
}

function formatCheckStatus(check: { status: string; reason: string } | undefined): string {
    if (!check) return 'Not checked';
    const label = check.status.replace(/_/g, ' ');
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} — ${check.reason}`;
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

    const unlimitedTypes = getUnlimitedQuotaTypes(providerData.quotaTypes);
    const finiteTypes = getFiniteQuotaTypes(providerData.quotaTypes);

    if (finiteTypes.length > 0 && (providerId === 'codex' || providerId === 'claude')) {
        return (
            <div className="aip-quota-cell aip-quota-list">
                {finiteTypes.map((quotaType, index) => {
                    const label = formatQuotaTypeLabel(quotaType.type);
                    const pct = getQuotaPercent(quotaType.remainingPercentage);
                    const { barClass } = getQuotaRiskClasses(pct);
                    return (
                        <div className="aip-quota-row" key={`${quotaType.type}-${quotaType.resetDate ?? index}`}>
                            <div className="aip-quota-top">
                                <span className="aip-quota-label">{label}</span>
                                <strong className="aip-quota-value">{pct}% remaining</strong>
                            </div>
                            <div className="aip-quota-caption">
                                {quotaType.usedRequests} / {quotaType.entitlementRequests} used
                            </div>
                            <div className={`aip-bar ${barClass}`} aria-label={`${label} quota remaining`}>
                                <span style={{ width: `${pct}%` }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    if (finiteTypes.length > 0) {
        const tightest = getTightestFiniteQuotaType(finiteTypes);
        if (tightest) {
            const pct = getQuotaPercent(tightest.remainingPercentage);
            const { barClass, badgeClass, badgeLabel } = getQuotaRiskClasses(pct);
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
                        <span style={{ width: `${pct}%` }} />
                    </div>
                </div>
            );
        }
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

function AdminPercentInput({ value, onChange, testId }: {
    value: number;
    onChange: (value: number) => void;
    testId: string;
}) {
    return (
        <span className="aip-percent-input">
            <input
                type="number"
                min={0}
                max={100}
                step={1}
                className="ar-input ar-short"
                value={value}
                onChange={event => onChange(parsePercentInput(event.target.value, value))}
                data-testid={testId}
            />
            <span className="aip-percent-suffix">%</span>
        </span>
    );
}

type AIProviderSubTab = 'routing' | 'models';
const AI_PROVIDER_SUBTABS: { id: AIProviderSubTab; label: string; icon: string }[] = [
    { id: 'routing', label: 'Provider routing', icon: '◇' },
    { id: 'models', label: 'Model catalog', icon: '◉' },
];

export function AIProviderPage(props: AIProviderPageProps) {
    const {
        defaultProvider, setDefaultProvider,
        codexEnabled, setCodexEnabled,
        claudeEnabled, setClaudeEnabled,
        autoAgentProviderRoutingEnabled, setAutoAgentProviderRoutingEnabled, autoRoutingConfig, setAutoRoutingConfig,
        providerAvailability, sdkInstallStatuses, sdkInstallErrors, onInstallSdk,
        dirty, saving, onSave, onCancel,
        quotaData, quotaLoading, quotaError, onRefreshQuota,
    } = props;

    const normalizedAutoRouting = normalizeAutoProviderRoutingConfig(autoRoutingConfig);
    const [activeModelProvider, setActiveModelProvider] = useState<Provider>(
        defaultProvider,
    );
    const [activeSubTab, setActiveSubTab] = useState<AIProviderSubTab>('routing');

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
    const autoPreview = autoAgentProviderRoutingEnabled
        ? resolveAutoAgentProvider(normalizedAutoRouting, {
            providerAvailability: {
                copilot: { enabled: true, available: true },
                codex: {
                    enabled: codexEnabled,
                    available: providerAvailability['codex']?.available ?? false,
                    error: providerAvailability['codex']?.error,
                },
                claude: {
                    enabled: claudeEnabled,
                    available: providerAvailability['claude']?.available ?? false,
                    error: providerAvailability['claude']?.error,
                },
            },
            quotaData,
        })
        : null;
    const autoPreviewSelectedDecision = autoPreview?.decisions.find(decision => decision.selected);
    const autoPreviewLabel = autoPreview?.provider
        ? `${PROVIDER_LABELS[autoPreview.provider]}${autoPreview.fallbackUsed ? ' fallback' : ''}`
        : 'No provider selected';
    const autoPreviewReason = autoPreview?.error
        ?? autoPreviewSelectedDecision?.reason
        ?? autoPreview?.fallback?.reason
        ?? 'Refresh quota to preview Auto selection with current provider data.';

    const updateAutoRule = (
        index: number,
        update: (rule: NormalizedAutoProviderRoutingConfig['rules'][number]) => NormalizedAutoProviderRoutingConfig['rules'][number],
    ) => {
        setAutoRoutingConfig({
            ...normalizedAutoRouting,
            rules: normalizedAutoRouting.rules.map((rule, ruleIndex) => ruleIndex === index ? update(rule) : rule),
        });
    };

    const moveAutoRule = (index: number, direction: -1 | 1) => {
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= normalizedAutoRouting.rules.length) return;
        const rules = [...normalizedAutoRouting.rules];
        const current = rules[index];
        rules[index] = rules[nextIndex];
        rules[nextIndex] = current;
        setAutoRoutingConfig({ ...normalizedAutoRouting, rules });
    };

    const overallQuotaRisk = (() => {
        if (!quotaData) return { badge: 'No data', cls: '', note: 'Quota not loaded' };
        const allProviders = quotaData.providers.filter(p => !p.error);
        const tightest = getMostConstrainedProviderQuota(quotaData);
        if (tightest) {
            const { badgeClass, badgeLabel } = getQuotaRiskClasses(tightest.remainingPercent);
            const label = badgeLabel === 'OK' ? 'Healthy' : badgeLabel;
            return { badge: label, cls: badgeClass, note: `${tightest.remainingPercent}% remaining` };
        }
        const unlimited = allProviders.flatMap(p => getUnlimitedQuotaTypes(p.quotaTypes));
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

            {/* Sub-tab bar */}
            <nav className="ar-subtab-row" role="tablist" aria-label="AI Provider sections" data-testid="aip-subtab-row">
                {AI_PROVIDER_SUBTABS.map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        className={`ar-subtab${activeSubTab === tab.id ? ' is-active' : ''}`}
                        onClick={() => setActiveSubTab(tab.id)}
                        data-testid={`aip-subtab-${tab.id}`}
                        aria-selected={activeSubTab === tab.id}
                    >
                        <span className="ar-subtab-icon">{tab.icon}</span>
                        {tab.label}
                    </button>
                ))}
            </nav>

            {activeSubTab === 'routing' && (
            <>
            {/* Summary grid */}
            <section className="aip-summary-grid" aria-label="Provider summary" data-testid="aip-summary-grid">
                <SummaryCard
                    label="Default route"
                    value={autoAgentProviderRoutingEnabled ? 'Auto' : DEFAULT_PROVIDER_LABELS[defaultProvider]}
                    note={autoAgentProviderRoutingEnabled ? 'Omitted-provider flows use Auto' : 'No per-chat override'}
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
                        <p className="aip-panel-desc">Availability, quota, install state, Auto routing, and default provider are visible in one scan.</p>
                    </div>
                    <div className="aip-panel-actions">
                        <button
                            type="button"
                            className="ar-btn ar-btn-secondary ar-btn-sm"
                            onClick={() => onRefreshQuota({ force: true })}
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
                <div className="aip-auto-card" data-testid="auto-provider-routing-card">
                    <div className="aip-auto-head">
                        <div>
                            <div className="aip-provider-line">
                                <span className="aip-provider-main">Auto provider routing</span>
                                <span className="aip-provider-source">feature flag</span>
                            </div>
                            <div className="aip-provider-meta">
                                Enable Auto to make omitted-provider chats, tasks, and API-created work route by priority, availability, quota, and weekly guardrails. Explicit provider selections and follow-ups keep their provider.
                            </div>
                        </div>
                        <Toggle
                            checked={autoAgentProviderRoutingEnabled}
                            onChange={setAutoAgentProviderRoutingEnabled}
                            label="Toggle Auto provider routing"
                            testId="toggle-auto-agent-provider-routing-enabled"
                        />
                    </div>
                    {!autoAgentProviderRoutingEnabled ? (
                        <div className="aip-auto-disabled" data-testid="auto-provider-routing-disabled">
                            Auto is disabled. New omitted-provider flows use the concrete default provider below.
                        </div>
                    ) : (
                        <>
                            <div className="aip-auto-preview" data-testid="auto-provider-preview">
                                <div>
                                    <div className="aip-summary-label">Current Auto preview</div>
                                    <div className="aip-summary-value">{autoPreviewLabel}</div>
                                    <div className="aip-summary-note">{autoPreviewReason}</div>
                                </div>
                                {autoPreview?.warnings.length ? (
                                    <div className="aip-auto-warnings" data-testid="auto-provider-preview-warnings">
                                        {autoPreview.warnings.map(warning => <span key={warning} className="ar-badge ar-badge-warning">{warning}</span>)}
                                    </div>
                                ) : null}
                            </div>
                            <div className="aip-auto-rules" data-testid="auto-provider-rules">
                                {normalizedAutoRouting.rules.map((rule, index) => {
                                    const decision = autoPreview?.decisions.find(item => item.provider === rule.provider);
                                    return (
                                        <div className="aip-auto-rule" key={rule.provider} data-testid={`auto-provider-rule-${rule.provider}`}>
                                            <div className="aip-auto-rule-main">
                                                <ProviderAvatar provider={rule.provider} />
                                                <div>
                                                    <div className="aip-provider-line">
                                                        <span className="aip-provider-main">{index + 1}. {PROVIDER_LABELS[rule.provider]}</span>
                                                        <span className={`ar-badge ${decision?.selected ? 'ar-badge-success' : decision?.eligible ? 'ar-badge-accent' : ''}`}>
                                                            {decision?.selected ? 'Selected' : decision?.eligible ? 'Eligible' : 'Candidate'}
                                                        </span>
                                                    </div>
                                                    <div className="aip-provider-meta" data-testid={`auto-provider-rule-reason-${rule.provider}`}>
                                                        {decision?.reason ?? 'Waiting for preview data.'}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="aip-auto-rule-controls">
                                                <button
                                                    type="button"
                                                    className="ar-btn ar-btn-secondary ar-btn-sm"
                                                    onClick={() => moveAutoRule(index, -1)}
                                                    disabled={index === 0}
                                                    data-testid={`auto-provider-move-up-${rule.provider}`}
                                                >
                                                    ↑
                                                </button>
                                                <button
                                                    type="button"
                                                    className="ar-btn ar-btn-secondary ar-btn-sm"
                                                    onClick={() => moveAutoRule(index, 1)}
                                                    disabled={index === normalizedAutoRouting.rules.length - 1}
                                                    data-testid={`auto-provider-move-down-${rule.provider}`}
                                                >
                                                    ↓
                                                </button>
                                                <label className="aip-auto-inline">
                                                    Enabled
                                                    <Toggle
                                                        checked={rule.enabled}
                                                        onChange={(enabled) => updateAutoRule(index, current => ({ ...current, enabled }))}
                                                        label={`Toggle ${PROVIDER_LABELS[rule.provider]} Auto rule`}
                                                        testId={`auto-provider-rule-enabled-${rule.provider}`}
                                                    />
                                                </label>
                                                <label className="aip-auto-inline">
                                                    Normal min
                                                    <AdminPercentInput
                                                        value={rule.minimumRemainingPercent}
                                                        onChange={value => updateAutoRule(index, current => ({ ...current, minimumRemainingPercent: value }))}
                                                        testId={`auto-provider-threshold-${rule.provider}`}
                                                    />
                                                </label>
                                                <label className="aip-auto-inline">
                                                    Weekly guard
                                                    <Toggle
                                                        checked={rule.weeklyGuard.enabled}
                                                        onChange={(enabled) => updateAutoRule(index, current => ({ ...current, weeklyGuard: { ...current.weeklyGuard, enabled } }))}
                                                        label={`Toggle ${PROVIDER_LABELS[rule.provider]} weekly guard`}
                                                        testId={`auto-provider-weekly-enabled-${rule.provider}`}
                                                    />
                                                </label>
                                                <label className="aip-auto-inline">
                                                    Weekly min
                                                    <AdminPercentInput
                                                        value={rule.weeklyGuard.minimumRemainingPercent}
                                                        onChange={value => updateAutoRule(index, current => ({
                                                            ...current,
                                                            weeklyGuard: { ...current.weeklyGuard, minimumRemainingPercent: value },
                                                        }))}
                                                        testId={`auto-provider-weekly-threshold-${rule.provider}`}
                                                    />
                                                </label>
                                            </div>
                                            <div className="aip-auto-rule-checks">
                                                <span data-testid={`auto-provider-normal-status-${rule.provider}`}>
                                                    Normal: {formatCheckStatus(decision?.normalThreshold)}
                                                </span>
                                                <span data-testid={`auto-provider-weekly-status-${rule.provider}`}>
                                                    Weekly: {formatCheckStatus(decision?.weeklyGuard)}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="aip-auto-footer">
                                <label className="aip-auto-inline">
                                    Fallback provider
                                    <select
                                        className="ar-select ar-med"
                                        value={normalizedAutoRouting.fallbackProvider}
                                        onChange={event => setAutoRoutingConfig({
                                            ...normalizedAutoRouting,
                                            fallbackProvider: event.target.value as Provider,
                                        })}
                                        data-testid="auto-provider-fallback"
                                    >
                                        {PROVIDER_IDS.map(provider => <option key={provider} value={provider}>{PROVIDER_LABELS[provider]}</option>)}
                                    </select>
                                </label>
                                <div className="aip-provider-meta">
                                    Weekly guards reserve shared provider quota for other tools. If a provider has no weekly quota snapshot, Auto falls back to the normal threshold and records a warning.
                                </div>
                            </div>
                        </>
                    )}
                </div>
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
            </>
            )}

            {activeSubTab === 'models' && (
            <>
            {/* Provider-scoped model catalog and query */}
            <Suspense fallback={<div className="ar-section ar-hstack ar-muted"><Spinner size="sm" /> Loading models…</div>}>
                <ProviderModelsSection
                    provider={activeModelProvider}
                    available={
                        activeModelProvider === 'copilot'
                            ? true
                            : (providerAvailability[activeModelProvider]?.available ?? false)
                                && (activeModelProvider === 'codex' ? codexEnabled : claudeEnabled)
                    }
                    unavailableMessage={
                        activeModelProvider !== 'copilot' && !(activeModelProvider === 'codex' ? codexEnabled : claudeEnabled)
                            ? `Enable the ${activeModelProvider === 'codex' ? 'Codex' : 'Claude'} provider above to access its model catalog.`
                            : providerAvailability[activeModelProvider]?.error
                    }
                    allProviders={PROVIDER_IDS}
                    onProviderChange={setActiveModelProvider}
                />
            </Suspense>

            {/* Per-provider effort tier editor */}
            <Suspense fallback={<div className="ar-section ar-hstack ar-muted"><Spinner size="sm" /> Loading effort tiers…</div>}>
                <ProviderEffortTiersSection provider={activeModelProvider} />
            </Suspense>
            </>
            )}
        </div>
    );
}
