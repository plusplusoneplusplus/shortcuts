/**
 * "Restart with… ▾" split button for failed chats. Starts the same job over in
 * a new chat on a chosen provider via `POST /api/queue/:id/retry { provider }`.
 * Nothing is handed over between providers — only the original message is
 * re-sent — so this is not gated by `features.chatProviderSwitching`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentProvidersQuotaResponse, AgentProviderStatus } from '@plusplusoneplusplus/coc-client';
import { getQuotaPercent, getTightestFiniteQuotaType } from '@plusplusoneplusplus/coc-client';
import { useAgentProviders } from '../../hooks/useAgentProviders';
import { useAgentProvidersQuota } from '../../shared/useAgentProvidersQuota';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { cn } from '../../ui/cn';
import { isConcreteChatProvider, type ConcreteChatProvider } from '../../utils/providerSelection';
import { isQuotaFailure } from '../../utils/quotaFailure';
import { getProviderLabel } from './ProviderBadge';

export interface RestartOption {
    provider: ConcreteChatProvider;
    isCurrent: boolean;
    /** Tightest finite quota remaining (0–100), or null when unknown/unlimited. */
    remainingPercent: number | null;
    resetDate?: string;
    /** Exhausted providers are listed but can't be picked. */
    disabled: boolean;
}

/** Enabled concrete providers plus the current one, annotated with quota. */
export function buildRestartOptions(
    providers: readonly AgentProviderStatus[],
    quotaData: AgentProvidersQuotaResponse | null | undefined,
    currentProvider: ConcreteChatProvider,
): RestartOption[] {
    const options: RestartOption[] = [];
    for (const status of providers) {
        if (!isConcreteChatProvider(status.id)) continue;
        const isCurrent = status.id === currentProvider;
        if (!isCurrent && !(status.enabled && status.available)) continue;
        const quota = quotaData?.providers?.find(p => p.id === status.id && !p.error);
        const tightest = getTightestFiniteQuotaType(quota?.quotaTypes);
        const remainingPercent = tightest ? getQuotaPercent(tightest.remainingPercentage) : null;
        options.push({
            provider: status.id,
            isCurrent,
            remainingPercent,
            ...(tightest?.resetDate ? { resetDate: tightest.resetDate } : {}),
            disabled: remainingPercent === 0,
        });
    }
    if (!options.some(option => option.isCurrent)) {
        options.unshift({ provider: currentProvider, isCurrent: true, remainingPercent: null, disabled: false });
    }
    return options;
}

/**
 * Quota failure → the non-exhausted other provider with the most remaining
 * quota (unknown quota ranks last). Otherwise the same provider.
 */
export function pickDefaultRestartProvider(
    options: readonly RestartOption[],
    currentProvider: ConcreteChatProvider,
    error: string | null | undefined,
): ConcreteChatProvider {
    if (!isQuotaFailure(error)) return currentProvider;
    const candidates = options
        .filter(option => !option.isCurrent && !option.disabled)
        .sort((a, b) => (b.remainingPercent ?? -1) - (a.remainingPercent ?? -1));
    return candidates[0]?.provider ?? currentProvider;
}

function formatResetDate(resetDate: string | undefined): string | null {
    if (!resetDate) return null;
    const date = new Date(resetDate);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export interface RestartWithProviderButtonProps {
    currentProvider: ConcreteChatProvider;
    /** Failure message; a quota error pre-selects another provider. */
    error?: string | null;
    /** User follow-ups after the first message — they won't be re-sent. */
    laterMessageCount: number;
    /** Owning clone server for remote workspaces. */
    baseUrl?: string;
    /** Routing target for the quota cache (clone base URL or workspace id). */
    quotaTarget?: string;
    busy?: boolean;
    onRestart: (provider: ConcreteChatProvider) => void;
    className?: string;
}

export function RestartWithProviderButton({
    currentProvider,
    error,
    laterMessageCount,
    baseUrl,
    quotaTarget,
    busy = false,
    onRestart,
    className,
}: RestartWithProviderButtonProps) {
    const { providers } = useAgentProviders(baseUrl);
    const { quotaData } = useAgentProvidersQuota(quotaTarget);
    const options = useMemo(
        () => buildRestartOptions(providers, quotaData, currentProvider),
        [providers, quotaData, currentProvider],
    );
    const defaultProvider = pickDefaultRestartProvider(options, currentProvider, error);
    const [menuOpen, setMenuOpen] = useState(false);
    const [confirmTarget, setConfirmTarget] = useState<ConcreteChatProvider | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!menuOpen) return;
        const onMouseDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
        };
        document.addEventListener('mousedown', onMouseDown);
        return () => document.removeEventListener('mousedown', onMouseDown);
    }, [menuOpen]);

    const choose = (provider: ConcreteChatProvider) => {
        setMenuOpen(false);
        setConfirmTarget(provider);
    };
    const targetLabel = confirmTarget ? getProviderLabel(confirmTarget) : '';
    const segment = 'px-2.5 py-1 text-[12px] font-medium leading-none text-white bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-50 disabled:cursor-not-allowed';

    return (
        <div ref={rootRef} className={cn('relative inline-flex', className)} data-testid="restart-with-provider">
            <button
                type="button"
                className={cn(segment, 'rounded-l')}
                disabled={busy}
                onClick={() => choose(defaultProvider)}
                data-testid="restart-with-provider-primary"
            >
                {busy ? 'Restarting…' : `Restart on ${getProviderLabel(defaultProvider)}`}
            </button>
            <button
                type="button"
                className={cn(segment, 'rounded-r border-l border-white/30')}
                disabled={busy}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Restart with another provider"
                onClick={() => setMenuOpen(open => !open)}
                data-testid="restart-with-provider-toggle"
            >
                ▾
            </button>
            {menuOpen && (
                <div
                    role="menu"
                    className="absolute left-0 top-full mt-1 z-30 min-w-[220px] rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] shadow-lg py-1"
                    data-testid="restart-with-provider-menu"
                >
                    {options.map(option => {
                        const label = getProviderLabel(option.provider);
                        const reset = option.disabled ? formatResetDate(option.resetDate) : null;
                        const quotaText = option.disabled
                            ? `No quota left${reset ? ` · resets ${reset}` : ''}`
                            : option.remainingPercent !== null ? `${option.remainingPercent}% left` : null;
                        return (
                            <button
                                key={option.provider}
                                type="button"
                                role="menuitem"
                                disabled={option.disabled}
                                onClick={() => choose(option.provider)}
                                className="w-full text-left px-3 py-1.5 text-[12px] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.05] dark:hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed"
                                data-testid={`restart-with-provider-option-${option.provider}`}
                            >
                                <div>
                                    Restart on {label}{option.isCurrent ? ' (same)' : ''}
                                    {option.provider === defaultProvider && <span className="ml-1 text-[#848484]">· suggested</span>}
                                </div>
                                {quotaText && <div className="text-[11px] text-[#848484]">{quotaText}</div>}
                            </button>
                        );
                    })}
                </div>
            )}
            <Dialog
                id="restart-with-provider-confirm"
                open={confirmTarget !== null}
                onClose={() => setConfirmTarget(null)}
                title={`Restart on ${targetLabel}?`}
                footer={
                    <>
                        <Button variant="secondary" data-testid="restart-with-provider-cancel" onClick={() => setConfirmTarget(null)}>Cancel</Button>
                        <Button
                            variant="primary"
                            data-testid="restart-with-provider-confirm"
                            onClick={() => {
                                const target = confirmTarget;
                                setConfirmTarget(null);
                                if (target) onRestart(target);
                            }}
                        >
                            Restart on {targetLabel}
                        </Button>
                    </>
                }
            >
                <p>
                    Start this job over on {targetLabel} in a new chat? Only your original message is re-sent.
                    Files changed by the previous run are not reverted.
                </p>
                {laterMessageCount > 0 && (
                    <p className="mt-2" data-testid="restart-with-provider-later-messages">
                        {laterMessageCount === 1 ? '1 later message won’t be re-sent.' : `${laterMessageCount} later messages won’t be re-sent.`}
                    </p>
                )}
            </Dialog>
        </div>
    );
}
