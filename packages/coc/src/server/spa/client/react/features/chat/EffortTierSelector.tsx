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

function buildTierTitle(tier: EffortTierKey, tiers: LocalEffortTiersMap): string {
    const label = TIER_LABELS[tier];
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
}

export function EffortTierSelector({
    tiers,
    selectedTier,
    onChange,
    disabled = false,
    className,
    mobileTapTarget = false,
    ...rest
}: EffortTierSelectorProps) {
    const testId = rest['data-testid'] ?? 'effort-tier-selector';
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function handleClick(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    const selectedLabel = TIER_LABELS[selectedTier];
    const selectedTitle = buildTierTitle(selectedTier, tiers);

    return (
        <div
            ref={containerRef}
            className={cn('relative shrink-0', className)}
            data-testid={testId}
            data-tier-value={selectedTier}
        >
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen(o => !o)}
                className={cn(
                    'ctool shrink-0 inline-flex items-center gap-1 rounded-sm text-[11px]',
                    mobileTapTarget ? 'h-8 px-2 lg:h-[22px] lg:px-1.5' : 'h-[22px] px-1.5',
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
                aria-label="Effort tier"
            >
                <span className="font-mono text-[10.5px] font-medium text-[#848484] dark:text-[#999] truncate">
                    Effort: {selectedLabel}
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

            {open && (
                <div
                    className={cn(
                        'absolute bottom-full mb-1 left-0 z-[10000]',
                        'min-w-[140px] py-0.5 rounded-md shadow-lg',
                        'bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]',
                    )}
                    role="listbox"
                    aria-label="Select effort tier"
                    data-testid="effort-tier-menu"
                >
                    {TIER_KEYS.map(tier => {
                        const isSelected = tier === selectedTier;
                        const isConfigured = !!tiers[tier]?.model;
                        const tierTitle = buildTierTitle(tier, tiers);
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
            )}
        </div>
    );
}
