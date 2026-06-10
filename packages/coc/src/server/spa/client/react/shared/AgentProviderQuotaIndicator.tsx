/**
 * AgentProviderQuotaIndicator — desktop top-bar quota gauge and dropdown.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentProviderId, AgentProvidersQuotaResponse, ProviderQuotaResult, ProviderQuotaType } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../api/cocClient';
import {
    formatQuotaTypeLabel,
    getFiniteQuotaTypes,
    getMostConstrainedProviderQuota,
    getQuotaPercent,
    getQuotaRiskClasses,
    getQuotaUsedPercent,
    getTightestFiniteQuotaType,
    getUnlimitedQuotaTypes,
} from './quotaUtils';
import { Spinner } from '../ui';
import { cn } from '../ui/cn';
import {
    formatProviderActivityTimeout,
    loadDreamProviderActivity,
    type AgentProviderWorkActivity,
} from './providerActivity';

export const AGENT_PROVIDER_QUOTA_POLL_MS = 5 * 60 * 1000;

const PROVIDER_LABELS: Record<AgentProviderId, string> = {
    copilot: 'Copilot',
    codex: 'Codex',
    claude: 'Claude',
};

function formatLastUpdated(lastUpdated: string | null | undefined): string {
    if (!lastUpdated) {
        return 'Last updated: not yet';
    }
    const timestamp = Date.parse(lastUpdated);
    if (!Number.isFinite(timestamp)) {
        return 'Last updated: unknown';
    }
    const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diffSeconds < 60) {
        return `Last updated ${diffSeconds}s ago`;
    }
    const minutes = Math.floor(diffSeconds / 60);
    if (minutes < 60) {
        return `Last updated ${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `Last updated ${hours}h ago`;
    }
    return `Last updated ${Math.floor(hours / 24)}d ago`;
}

function formatTimeRemaining(deltaMs: number): string {
    if (deltaMs <= 0) {
        return 'due';
    }
    const totalMinutes = Math.floor(deltaMs / 60_000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) {
        return `${days}d ${hours}h left`;
    }
    return `${hours}h ${minutes}m left`;
}

function formatResetDate(resetDate: string | undefined, now: number = Date.now()): string {
    if (!resetDate) {
        return 'Reset not reported';
    }
    const timestamp = Date.parse(resetDate);
    if (!Number.isFinite(timestamp)) {
        return 'Reset not reported';
    }
    // Minute-level UTC timestamp (YYYY-MM-DD HH:MM) keeps the absolute reset
    // unambiguous and deterministic across timezones.
    const absolute = new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');
    return `Reset ${absolute} · ${formatTimeRemaining(timestamp - now)}`;
}

function getGaugeColor(remainingPercent: number | null): string {
    if (remainingPercent === null) {
        return '#8c959f';
    }
    if (remainingPercent < 25) {
        return '#d1242f';
    }
    if (remainingPercent < 50) {
        return '#bf8700';
    }
    return '#1a7f37';
}

function getGaugeBackground(usedPercent: number, color: string): string {
    return `conic-gradient(${color} ${usedPercent}%, transparent 0)`;
}

function renderQuotaPie({ usedPercent, remainingPercent, testId }: { usedPercent: number; remainingPercent: number | null; testId: string }) {
    const color = getGaugeColor(remainingPercent);
    const background = getGaugeBackground(usedPercent, color);
    return (
        <span
            className="relative inline-flex h-5 w-5 items-center justify-center rounded-full border border-[#d0d7de] dark:border-[#3c3c3c] text-[10px] leading-none text-[#57606a] dark:text-[#999]"
            style={{ background }}
            data-testid={testId}
            data-used-percent={usedPercent}
            data-gauge-background={background}
            aria-hidden="true"
        >
            <span className="absolute inset-[4px] rounded-full bg-[#f3f3f3] dark:bg-[#252526]" />
            <span className="relative">◔</span>
        </span>
    );
}

function renderProviderQuotaRow(provider: ProviderQuotaResult) {
    const label = PROVIDER_LABELS[provider.id] ?? provider.id;
    const tightest = getTightestFiniteQuotaType(provider.quotaTypes);
    const unlimitedTypes = getUnlimitedQuotaTypes(provider.quotaTypes);

    if (provider.error) {
        return (
            <div key={provider.id} className="px-3 py-2 border-b border-[#f0f0f0] dark:border-[#2d2d2d] last:border-b-0" data-testid={`quota-provider-row-${provider.id}`}>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">{label}</span>
                    <span className="rounded-full border border-[#ffd7d5] dark:border-[#5a1e1e] bg-[#fff1f0] dark:bg-[#2a1215] px-2 py-0.5 text-[10px] font-semibold text-[#cf222e] dark:text-[#ff938a]">
                        Error
                    </span>
                </div>
                <div className="mt-1 text-xs text-[#6e6e6e] dark:text-[#999]">{provider.error}</div>
            </div>
        );
    }

    if (tightest) {
        const finiteTypes = getFiniteQuotaTypes(provider.quotaTypes);
        const remainingPercent = getQuotaPercent(tightest.remainingPercentage);
        const usedPercent = getQuotaUsedPercent(tightest.remainingPercentage);
        const risk = getQuotaRiskClasses(remainingPercent);
        return (
            <div key={provider.id} className="px-3 py-2 border-b border-[#f0f0f0] dark:border-[#2d2d2d] last:border-b-0" data-testid={`quota-provider-row-${provider.id}`}>
                <div className="flex items-start gap-2">
                    {renderQuotaPie({ usedPercent, remainingPercent, testId: `quota-provider-gauge-${provider.id}` })}
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">{label}</span>
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#6e6e6e] dark:text-[#999]">{risk.badgeLabel}</span>
                        </div>
                        {finiteTypes.map((quotaType, index) => (
                            <div
                                key={`${quotaType.type}-${quotaType.resetDate ?? index}`}
                                className="mt-1"
                                data-testid={`quota-provider-window-${provider.id}-${quotaType.type}`}
                            >
                                <div className="flex items-center justify-between gap-2 text-xs">
                                    <span className="font-medium text-[#57606a] dark:text-[#adbac7]">{formatQuotaTypeLabel(quotaType.type)}</span>
                                    <span className="text-[#6e6e6e] dark:text-[#999]">{quotaType.usedRequests} / {quotaType.entitlementRequests} used</span>
                                </div>
                                <div className="mt-0.5 text-[11px] text-[#6e6e6e] dark:text-[#999]">{formatResetDate(quotaType.resetDate)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    if (unlimitedTypes.length > 0) {
        return (
            <div key={provider.id} className="px-3 py-2 border-b border-[#f0f0f0] dark:border-[#2d2d2d] last:border-b-0" data-testid={`quota-provider-row-${provider.id}`}>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">{label}</span>
                    <span className="rounded-full border border-[#aceebb] dark:border-[#315f3a] bg-[#dafbe1] dark:bg-[#15331d] px-2 py-0.5 text-[10px] font-semibold text-[#1a7f37] dark:text-[#7ee787]">
                        Unlimited
                    </span>
                </div>
                <div className="mt-1 text-xs text-[#6e6e6e] dark:text-[#999]">
                    {unlimitedTypes.length} unlimited pool{unlimitedTypes.length !== 1 ? 's' : ''}
                </div>
            </div>
        );
    }

    return (
        <div key={provider.id} className="px-3 py-2 border-b border-[#f0f0f0] dark:border-[#2d2d2d] last:border-b-0" data-testid={`quota-provider-row-${provider.id}`}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">{label}</span>
                <span className="rounded-full border border-[#d0d7de] dark:border-[#3c3c3c] px-2 py-0.5 text-[10px] font-semibold text-[#6e6e6e] dark:text-[#999]">
                    No data
                </span>
            </div>
            <div className="mt-1 text-xs text-[#6e6e6e] dark:text-[#999]">Provider returned no quota snapshots</div>
        </div>
    );
}

function renderDreamActivityRow(activity: AgentProviderWorkActivity) {
    const label = PROVIDER_LABELS[activity.provider] ?? activity.provider;
    const trigger = activity.trigger === 'idle' ? 'Idle' : activity.trigger === 'manual' ? 'Manual' : 'Dreams';
    const status = activity.status ? activity.status.replace(/-/g, ' ') : 'unknown';
    const model = activity.model ?? 'provider default';
    return (
        <div key={activity.id} className="px-3 py-2 border-b border-[#f0f0f0] dark:border-[#2d2d2d] last:border-b-0" data-testid={`quota-dream-activity-${activity.id}`}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">{activity.label}</span>
                <span className="rounded-full border border-[#d0d7de] dark:border-[#3c3c3c] px-2 py-0.5 text-[10px] font-semibold text-[#6e6e6e] dark:text-[#999]">
                    {label}
                </span>
            </div>
            <div className="mt-1 text-xs text-[#6e6e6e] dark:text-[#999]">
                {trigger} · {status} · {model} · {formatProviderActivityTimeout(activity.timeoutMs)}
            </div>
            {activity.error && (
                <div className="mt-1 text-xs text-[#cf222e] dark:text-[#ff938a]">{activity.error}</div>
            )}
        </div>
    );
}

export function agentProviderQuotaIndicator() {
    const [open, setOpen] = useState(false);
    const [quotaData, setQuotaData] = useState<AgentProvidersQuotaResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dreamActivity, setDreamActivity] = useState<AgentProviderWorkActivity[]>([]);
    const [dreamActivityError, setDreamActivityError] = useState<string | null>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const mountedRef = useRef(false);
    const quotaDataRef = useRef<AgentProvidersQuotaResponse | null>(null);

    useEffect(() => {
        quotaDataRef.current = quotaData;
    }, [quotaData]);

    const refreshQuota = useCallback(async (options: { force?: boolean } = {}) => {
        const hasExistingData = quotaDataRef.current !== null;
        if (hasExistingData) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }
        setError(null);
        try {
            const data = await getSpaCocClient().admin.getAgentProvidersQuota(options.force ? { force: true } : undefined);
            if (!mountedRef.current) {
                return;
            }
            setQuotaData(data);
        } catch (err) {
            if (!mountedRef.current) {
                return;
            }
            setError(getSpaCocClientErrorMessage(err, 'Failed to load provider quota'));
        } finally {
            if (!mountedRef.current) {
                return;
            }
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    const refreshDreamActivity = useCallback(async () => {
        setDreamActivityError(null);
        try {
            const activity = await loadDreamProviderActivity();
            if (!mountedRef.current) {
                return;
            }
            setDreamActivity(activity);
        } catch (err) {
            if (!mountedRef.current) {
                return;
            }
            setDreamActivityError(getSpaCocClientErrorMessage(err, 'Failed to load Dreams provider activity'));
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void refreshQuota();
        void refreshDreamActivity();
        const timer = window.setInterval(() => {
            void refreshQuota();
            void refreshDreamActivity();
        }, AGENT_PROVIDER_QUOTA_POLL_MS);
        return () => {
            mountedRef.current = false;
            window.clearInterval(timer);
        };
    }, [refreshQuota, refreshDreamActivity]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handleClick = (event: MouseEvent) => {
            if (
                panelRef.current && !panelRef.current.contains(event.target as Node) &&
                buttonRef.current && !buttonRef.current.contains(event.target as Node)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    const constrainedQuota = useMemo(
        () => getMostConstrainedProviderQuota(quotaData, quotaData?.providers.map(provider => provider.id)),
        [quotaData],
    );
    const unlimitedCount = useMemo(
        () => quotaData?.providers.flatMap(provider => provider.error ? [] : getUnlimitedQuotaTypes(provider.quotaTypes)).length ?? 0,
        [quotaData],
    );
    const usedPercent = constrainedQuota?.usedPercent ?? 0;
    const remainingPercent = constrainedQuota?.remainingPercent ?? null;
    const state = error && !quotaData
        ? 'error'
        : constrainedQuota
            ? 'finite'
            : unlimitedCount > 0
                ? 'neutral'
                : loading
                    ? 'loading'
                    : 'neutral';
    const title = constrainedQuota
        ? `${PROVIDER_LABELS[constrainedQuota.provider.id] ?? constrainedQuota.provider.id} ${formatQuotaTypeLabel(constrainedQuota.quotaType.type)} quota: ${usedPercent}% used`
        : unlimitedCount > 0
            ? 'Agent provider quota: unlimited'
            : error
                ? `Agent provider quota: ${error}`
                : 'Agent provider quota';

    return (
        <div className="relative hidden md:block" data-testid="agent-provider-quota-container">
            <button
                ref={buttonRef}
                className={cn(
                    'h-7 w-7 md:h-8 md:w-8 inline-flex items-center justify-center rounded touch-target relative',
                    open
                        ? 'bg-[#0078d4] text-white'
                        : 'hover:bg-black/[0.05] dark:hover:bg-white/[0.08]',
                )}
                aria-label="Agent provider quota"
                title={title}
                data-testid="agent-provider-quota-indicator"
                data-state={state}
                data-used-percent={usedPercent}
                onClick={() => setOpen(prev => !prev)}
            >
                {renderQuotaPie({ usedPercent, remainingPercent, testId: 'agent-provider-quota-gauge' })}
            </button>

            {open && (
                <div
                    ref={panelRef}
                    className="absolute right-0 top-full mt-1 w-[360px] max-h-[440px] flex flex-col rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] shadow-lg z-[10002]"
                    data-testid="agent-provider-quota-panel"
                    role="dialog"
                    aria-label="Agent provider quota details"
                >
                    <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Provider quota</span>
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-[#0078d4] hover:underline disabled:opacity-60 disabled:hover:no-underline"
                            onClick={() => {
                                void refreshQuota({ force: true });
                                void refreshDreamActivity();
                            }}
                            disabled={loading || refreshing}
                            data-testid="agent-provider-quota-refresh"
                        >
                            {refreshing ? <Spinner size="sm" /> : '↻'} Refresh now
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {loading && !quotaData ? (
                            <div className="py-8 text-center text-sm text-[#6e6e6e] dark:text-[#999]" data-testid="agent-provider-quota-loading">
                                Loading quota…
                            </div>
                        ) : error && !quotaData ? (
                            <div className="px-3 py-4 text-sm text-[#cf222e] dark:text-[#ff938a]" data-testid="agent-provider-quota-error">
                                {error}
                            </div>
                        ) : quotaData && quotaData.providers.length > 0 ? (
                            quotaData.providers.map(renderProviderQuotaRow)
                        ) : (
                            <div className="py-8 text-center text-sm text-[#6e6e6e] dark:text-[#999]" data-testid="agent-provider-quota-empty">
                                No provider quota data
                            </div>
                        )}
                    </div>

                    <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="agent-provider-dream-activity">
                        <div className="px-3 py-2 border-b border-[#f0f0f0] dark:border-[#2d2d2d]">
                            <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Dreams work</div>
                            <div className="text-xs text-[#6e6e6e] dark:text-[#999]">Active and recent Dream jobs by provider</div>
                        </div>
                        {dreamActivityError ? (
                            <div className="px-3 py-3 text-xs text-[#cf222e] dark:text-[#ff938a]" data-testid="agent-provider-dream-activity-error">
                                {dreamActivityError}
                            </div>
                        ) : dreamActivity.length > 0 ? (
                            dreamActivity.map(renderDreamActivityRow)
                        ) : (
                            <div className="px-3 py-3 text-xs text-[#6e6e6e] dark:text-[#999]" data-testid="agent-provider-dream-activity-empty">
                                No active or recent Dreams work
                            </div>
                        )}
                    </div>

                    {error && quotaData && (
                        <div className="px-3 py-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] text-xs text-[#cf222e] dark:text-[#ff938a]" data-testid="agent-provider-quota-refresh-error">
                            {error}
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] text-xs">
                        <span className="text-[#6e6e6e] dark:text-[#999]" data-testid="agent-provider-quota-last-updated">
                            {formatLastUpdated(quotaData?.lastUpdated)}
                        </span>
                        <a
                            href="#admin/agents"
                            className="font-medium text-[#0078d4] hover:underline"
                            onClick={() => setOpen(false)}
                            data-testid="agent-provider-quota-admin-link"
                        >
                            Admin → AI Providers
                        </a>
                    </div>
                </div>
            )}
        </div>
    );
}
