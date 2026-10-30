/**
 * EffortTierSelector — a single-chip dropdown that lets the user pick
 * Very Low / Low / Medium / High as a composite effort tier in the composer toolbar.
 *
 * Unconfigured tiers (no model set in Admin) are shown greyed-out with a
 * "Not configured in Admin" tooltip and cannot be selected.
 *
 * Visual style mirrors EffortPillSelector: a ghost button (label + chevron)
 * that opens a small popover listing the tier options.
 */

import { useState, useRef, useEffect } from 'react';
import { useCloneBaseUrl } from '../../repos/cloneRouting';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { useWorkspaceOwner } from '../../repos/workspaceOwnerContext';
import { openConfiguration, effortTierSettingsHash } from '../../admin/openConfiguration';
import { cn } from '../../ui/cn';
import type { EffortTierKey, LocalEffortTiersMap } from '../../hooks/useProviderEffortTiers';

const TIER_LABELS: Record<EffortTierKey, string> = {
    'very-low': 'Very Low',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
};

const TIER_KEYS: readonly EffortTierKey[] = ['very-low', 'low', 'medium', 'high'];

function formatReasoningEffort(effort: string): string {
    return effort || 'Auto';
}

function buildTierTitle(tier: EffortTierKey, tiers: LocalEffortTiersMap, autoProviderMode: boolean): string {
    const label = TIER_LABELS[tier];
    if (autoProviderMode) return `${label}: provider and model resolved by Auto at scheduling time`;
    const entry = tiers[tier];
    if (!entry?.model) return `${label}: Not configured in Admin`;
    return `${label}\nModel: ${entry.model}\nReasoning effort: ${formatReasoningEffort(entry.reasoningEffort)}`;
}

export interface EffortTierSelectorProps {
    /** Current tier map (from useProviderEffortTiers). */
    tiers: LocalEffortTiersMap;
    /** Currently selected tier. */
    selectedTier: EffortTierKey;
    /** Called when the user picks a tier. Only fires for configured tiers. */
    onChange: (tier: EffortTierKey) => void;
    /** When true, the entire selector is disabled. */
    disabled?: boolean;
    'data-testid'?: string;
    className?: string;
    mobileTapTarget?: boolean;
    /**
     * Container-narrow signal (AC-03): when true, drop the "Effort:" prefix and
     * show only the selected tier value, regardless of viewport. Fires in
     * addition to the viewport `sm:` compaction driven by `mobileTapTarget`.
     */
    compact?: boolean;
    /** Extra classes for the `Effort:` prefix span (e.g. a container-query hide). */
    prefixClassName?: string;
    autoProviderMode?: boolean;
    /** Exact owning workspace/clone; never infer it from the active sidebar. */
    workspaceId?: string;
    settingsBaseUrl?: string;
    provider?: string;
    configurationUnavailable?: boolean;
}

export function EffortTierSelector({
    tiers,
    selectedTier,
    onChange,
    disabled = false,
    className,
    mobileTapTarget = false,
    compact = false,
    prefixClassName,
    autoProviderMode = false,
    workspaceId,
    settingsBaseUrl,
    provider,
    configurationUnavailable = false,
    ...rest
}: EffortTierSelectorProps) {
    const owner = useWorkspaceOwner(workspaceId);
    const cloneBaseUrl = useCloneBaseUrl(workspaceId);
    const baseUrl = settingsBaseUrl ?? owner?.baseUrl ?? cloneBaseUrl;
    const canConfigure = !!provider && !configurationUnavailable && (owner !== null || resolveCloneRoute(workspaceId).kind !== 'unresolved-remote' || !!settingsBaseUrl);
    const testId = rest['data-testid'] ?? 'effort-tier-selector';
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [menuLeft, setMenuLeft] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) setMenuLeft(Math.max(8 - rect.left, Math.min(0, window.innerWidth - rect.left - 180)));
        const selected = containerRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)');
        const first = containerRef.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled), [data-testid="effort-tier-configure"]:not(:disabled)');
        (selected ?? first)?.focus();
        function handleClick(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    const selectedLabel = TIER_LABELS[selectedTier];
    const selectedTitle = buildTierTitle(selectedTier, tiers, autoProviderMode);

    return (
        <div
            ref={containerRef}
            className={cn('relative shrink-0', className)}
            data-testid={testId}
            data-tier-value={selectedTier}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
                if (event.key === 'Escape' && open) {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(false);
                    triggerRef.current?.focus();
                }
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!open) { setOpen(true); return; }
                    const buttons = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[data-testid="effort-tier-menu"] button:not(:disabled)') ?? []);
                    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                        : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
                    buttons[index]?.focus();
                }
            }}
        >
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                onClick={() => setOpen(o => !o)}
                className={cn(
                    'ctool shrink-0 inline-flex items-center gap-1 rounded-sm text-[11px]',
                    mobileTapTarget ? 'h-8 w-8 justify-center px-0 sm:w-auto sm:px-2 lg:h-[22px] lg:px-1.5' : 'h-[22px] px-1.5',
                    'text-[#5a5a5a] dark:text-[#cccccc]',
                    'hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50',
                    'min-w-0 max-w-[40vw] sm:max-w-[140px] transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
                title={`Effort tier: ${selectedTitle}`}
                data-testid="effort-tier-trigger-btn"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`Effort tier: ${selectedLabel}`}
            >
                <span aria-hidden="true" className={cn('font-mono text-[10px] font-semibold text-[#848484] dark:text-[#999]', mobileTapTarget ? 'inline sm:hidden' : 'hidden')}>
                    E
                </span>
                <span
                    className={cn(
                        'font-mono text-[10.5px] font-medium text-[#848484] dark:text-[#999] truncate',
                        mobileTapTarget && 'hidden sm:inline',
                    )}
                    data-testid="effort-tier-label"
                >
                    {!compact && <span className={prefixClassName}>Effort: </span>}
                    {selectedLabel}
                </span>
                <svg
                    width="7" height="7"
                    viewBox="0 0 8 6"
                    fill="none"
                    aria-hidden="true"
                    className="shrink-0 opacity-60"
                >
                    <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {open && !disabled && (
                <div
                    className={cn(
                        'absolute bottom-full mb-1 left-0 z-[10000]',
                        'min-w-[160px] max-w-[calc(100vw-16px)] py-0.5 rounded-md shadow-lg',
                        'bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]',
                    )}
                    style={{ left: menuLeft }}
                    role="group"
                    aria-label="Effort tier settings"
                    data-testid="effort-tier-menu"
                >
                    <div role="listbox" aria-label="Select effort tier">
                        {TIER_KEYS.map(tier => {
                            const isSelected = tier === selectedTier;
                            const isConfigured = autoProviderMode || !!tiers[tier]?.model;
                            const tierTitle = buildTierTitle(tier, tiers, autoProviderMode);
                            return (
                                <button
                                    key={tier}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    aria-disabled={!isConfigured}
                                    disabled={!isConfigured}
                                    title={tierTitle}
                                    onClick={() => {
                                        if (!isConfigured) return;
                                        onChange(tier);
                                        setOpen(false);
                                        triggerRef.current?.focus();
                                    }}
                                    className={cn(
                                        'w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[12px] transition-colors',
                                        !isConfigured
                                            ? 'opacity-50 cursor-not-allowed text-[#848484] dark:text-[#666]'
                                            : isSelected
                                                ? 'bg-[#f3f3f3] dark:bg-[#2a2d2e] text-[#1e1e1e] dark:text-[#cccccc] cursor-pointer'
                                                : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] cursor-pointer',
                                    )}
                                    data-testid={`effort-tier-option-${tier}`}
                                    data-selected={isSelected ? 'true' : 'false'}
                                    data-configured={isConfigured ? 'true' : 'false'}
                                >
                                    <span className="font-medium leading-tight min-w-0 truncate">{TIER_LABELS[tier]}</span>
                                    {isSelected && isConfigured && (
                                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 ml-auto text-[#0078d4] dark:text-[#3794ff]">
                                            <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <div
                        role="presentation"
                        className="my-0.5 border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                    />
                    <button
                        type="button"
                        disabled={!canConfigure}
                        onClick={() => {
                            setOpen(false);
                            triggerRef.current?.focus();
                            openConfiguration(effortTierSettingsHash(provider, baseUrl));
                        }}
                        title={canConfigure ? "Configure provider effort mappings for all workspaces on the owning server." : "The owning server or provider is unavailable."}
                        className={cn(
                            'w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[12px] transition-colors cursor-pointer',
                            'text-[#5a5a5a] dark:text-[#999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]',
                            'hover:text-[#1e1e1e] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[#0078d4]/50',
                        )}
                        data-testid="effort-tier-configure"
                    >
                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
                            <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
                            <path
                                d="M8 1.6v1.6M8 12.8v1.6M14.4 8h-1.6M3.2 8H1.6M12.53 3.47l-1.13 1.13M4.6 11.4l-1.13 1.13M12.53 12.53l-1.13-1.13M4.6 4.6L3.47 3.47"
                                stroke="currentColor"
                                strokeWidth="1.4"
                                strokeLinecap="round"
                            />
                        </svg>
                        <span className="leading-tight">Configure tiers…</span>
                    </button>
                </div>
            )}
        </div>
    );
}
