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
import type { AgentProviderId, ProviderInstallStatus, AgentProvidersQuotaResponse } from '@plusplusoneplusplus/coc-client';
import {
    formatQuotaTypeLabel,
    getFiniteQuotaTypes,
    getMostConstrainedProviderQuota,
    getQuotaPercent,
    getQuotaRiskClasses,
    getTightestFiniteQuotaType,
    getUnlimitedQuotaTypes,
} from '../shared/quotaUtils';

const ProviderModelsSection = lazy(() => import('../features/models/ProviderModelsSection').then(m => ({ default: m.ProviderModelsSection })));
const ProviderEffortTiersSection = lazy(() => import('../features/models/ProviderEffortTiersSection').then(m => ({ default: m.ProviderEffortTiersSection })));

type Provider = AgentProviderId;

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
    onRefreshQuota: (options?: { force?: boolean }) => void;

    sources: Record<string, string | undefined>;
}

const PROVIDER_LABELS: Record<Provider, string> = { copilot: 'Copilot', codex: 'Codex', claude: 'Claude' };
const PROVIDER_IDS: Provider[] = ['copilot', 'codex', 'claude'];

function CopilotIcon() {
    return (
        <svg viewBox="0 0 256 208" width="18" height="14" fill="currentColor" aria-hidden="true">
            <path d="M205.28 31.36c14.096 14.88 20.016 35.2 22.512 63.68c6.626 0 12.805 1.47 16.976 7.152l7.792 10.56A17.55 17.55 0 0 1 256 123.2v28.688c-.008 3.704-1.843 7.315-4.832 9.504C215.885 187.222 172.35 208 128 208c-49.066 0-98.19-28.273-123.168-46.608c-2.989-2.189-4.825-5.8-4.832-9.504V123.2c0-3.776 1.2-7.424 3.424-10.464l7.792-10.544c4.173-5.657 10.38-7.152 16.992-7.152c2.496-28.48 8.4-48.8 22.512-63.68C77.331 3.165 112.567.06 127.552 0H128c14.72 0 50.4 2.88 77.28 31.36m-77.264 47.376c-3.04 0-6.544.176-10.272.544c-1.312 4.896-3.248 9.312-6.08 12.128c-11.2 11.2-24.704 12.928-31.936 12.928c-6.802 0-13.927-1.42-19.744-5.088c-5.502 1.808-10.786 4.415-11.136 10.912c-.586 12.28-.637 24.55-.688 36.824c-.026 6.16-.05 12.322-.144 18.488c.024 3.579 2.182 6.903 5.44 8.384C79.936 185.92 104.976 192 128.016 192c23.008 0 48.048-6.08 74.512-18.144c3.258-1.48 5.415-4.805 5.44-8.384c.317-18.418.062-36.912-.816-55.312h.016c-.342-6.534-5.648-9.098-11.168-10.912c-5.82 3.652-12.927 5.088-19.728 5.088c-7.232 0-20.72-1.728-31.936-12.928c-2.832-2.816-4.768-7.232-6.08-12.128a106 106 0 0 0-10.24-.544m-26.941 43.93c5.748 0 10.408 4.66 10.408 10.409v19.183c0 5.749-4.66 10.409-10.408 10.409s-10.408-4.66-10.408-10.409v-19.183c0-5.748 4.66-10.408 10.408-10.408m53.333 0c5.749 0 10.409 4.66 10.409 10.409v19.183c0 5.749-4.66 10.409-10.409 10.409c-5.748 0-10.408-4.66-10.408-10.409v-19.183c0-5.748 4.66-10.408 10.408-10.408M81.44 28.32c-11.2 1.12-20.64 4.8-25.44 9.92c-10.4 11.36-8.16 40.16-2.24 46.24c4.32 4.32 12.48 7.2 21.28 7.2c6.72 0 19.52-1.44 30.08-12.16c4.64-4.48 7.52-15.68 7.2-27.04c-.32-9.12-2.88-16.64-6.72-19.84c-4.16-3.68-13.6-5.28-24.16-4.32m68.96 4.32c-3.84 3.2-6.4 10.72-6.72 19.84c-.32 11.36 2.56 22.56 7.2 27.04c10.56 10.72 23.36 12.16 30.08 12.16c8.8 0 16.96-2.88 21.28-7.2c5.92-6.08 8.16-34.88-2.24-46.24c-4.8-5.12-14.24-8.8-25.44-9.92c-10.56-.96-20 .64-24.16 4.32" />
        </svg>
    );
}

function OpenAIIcon() {
    return (
        <svg viewBox="140 140 520 520" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="m617.24 354a126.36 126.36 0 0 0-10.86-103.79 127.8 127.8 0 0 0-137.65-61.32 126.36 126.36 0 0 0-95.31-42.49 127.81 127.81 0 0 0-121.92 88.49 126.4 126.4 0 0 0-84.5 61.3 127.82 127.82 0 0 0 15.72 149.86 126.36 126.36 0 0 0 10.86 103.79 127.81 127.81 0 0 0 137.65 61.32 126.36 126.36 0 0 0 95.31 42.49 127.81 127.81 0 0 0 121.96-88.54 126.4 126.4 0 0 0 84.5-61.3 127.82 127.82 0 0 0-15.76-149.81zm-190.66 266.49a94.79 94.79 0 0 1-60.85-22c.77-.42 2.12-1.16 3-1.7l101-58.34a16.42 16.42 0 0 0 8.3-14.37v-142.39l42.69 24.65a1.52 1.52 0 0 1 .83 1.17v117.92a95.18 95.18 0 0 1-94.97 95.06zm-204.24-87.23a94.74 94.74 0 0 1-11.34-63.7c.75.45 2.06 1.25 3 1.79l101 58.34a16.44 16.44 0 0 0 16.59 0l123.31-71.2v49.3a1.53 1.53 0 0 1-.61 1.31l-102.1 58.95a95.16 95.16 0 0 1-129.85-34.79zm-26.57-220.49a94.71 94.71 0 0 1 49.48-41.68c0 .87-.05 2.41-.05 3.48v116.68a16.41 16.41 0 0 0 8.29 14.36l123.31 71.19-42.69 24.65a1.53 1.53 0 0 1-1.44.13l-102.11-59a95.16 95.16 0 0 1-34.79-129.81zm350.74 81.62-123.31-71.2 42.69-24.64a1.53 1.53 0 0 1 1.44-.13l102.11 58.95a95.08 95.08 0 0 1-14.69 171.55c0-.88 0-2.42 0-3.49v-116.68a16.4 16.4 0 0 0-8.24-14.36zm42.49-63.95c-.75-.46-2.06-1.25-3-1.79l-101-58.34a16.46 16.46 0 0 0-16.59 0l-123.31 71.2v-49.3a1.53 1.53 0 0 1 .61-1.31l102.1-58.9a95.07 95.07 0 0 1 141.19 98.44zm-267.11 87.87-42.7-24.65a1.52 1.52 0 0 1-.83-1.17v-117.92a95.07 95.07 0 0 1 155.9-73c-.77.42-2.11 1.16-3 1.7l-101 58.34a16.41 16.41 0 0 0-8.3 14.36zm23.19-50 54.92-31.72 54.92 31.7v63.42l-54.92 31.7-54.92-31.7z" />
        </svg>
    );
}

function ClaudeIcon() {
    return (
        <svg viewBox="0 0 100 100" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
        </svg>
    );
}

const PROVIDER_ICONS: Record<Provider, () => JSX.Element> = {
    copilot: CopilotIcon,
    codex: OpenAIIcon,
    claude: ClaudeIcon,
};

function ProviderAvatar({ provider }: { provider: Provider }) {
    const Icon = PROVIDER_ICONS[provider];
    return (
        <span className={`aip-avatar aip-avatar-${provider}`} aria-hidden="true">
            <Icon />
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
        providerAvailability, sdkInstallStatuses, sdkInstallErrors, onInstallSdk,
        dirty, saving, onSave, onCancel,
        quotaData, quotaLoading, quotaError, onRefreshQuota,
    } = props;

    const [activeModelProvider, setActiveModelProvider] = useState<Provider>(defaultProvider);
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
