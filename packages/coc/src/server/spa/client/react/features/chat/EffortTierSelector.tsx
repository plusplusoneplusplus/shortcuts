/**
 * EffortTierSelector — a single-chip dropdown that lets the user pick
 * Very Low / Low / Medium / High as a composite effort tier in the composer toolbar.
 *
 * Unconfigured tiers (no model set in Admin) are shown greyed-out with a
 * "Not configured in Admin" tooltip and cannot be selected.
 *
 * When `onCustomChange` is set, a "Custom model & effort…" row opens a panel to
 * pick an exact model (from the provider's own `models` catalog) and one of that
 * model's reasoning efforts. The owner keeps the pick and clears it when a tier
 * is chosen or the provider changes.
 *
 * Visual style mirrors EffortPillSelector: a ghost button (label + chevron)
 * that opens a small popover listing the tier options.
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useCloneBaseUrl } from '../../repos/cloneRouting';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { useWorkspaceOwner } from '../../repos/workspaceOwnerContext';
import { openConfiguration, effortTierSettingsHash } from '../../admin/openConfiguration';
import { cn } from '../../ui/cn';
import { useAnchoredPanelPosition } from '../../shared/useAnchoredPanelPosition';
import type { EffortTierKey, LocalEffortTiersMap } from '../../hooks/useProviderEffortTiers';
import type { ModelInfo } from '../../hooks/useModels';

/** Exact model + reasoning effort chosen instead of a tier. `null` effort = Auto. */
export interface CustomModelEffort {
    model: string;
    reasoningEffort: string | null;
}

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

function effortChipLabel(effort: string | null): string {
    return effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : 'Auto';
}

function modelLabel(modelId: string, models: readonly ModelInfo[]): string {
    return models.find(m => m.id === modelId)?.name || modelId;
}

/** Keeps the effort when the model supports it, else falls back to the model default or Auto. */
function effortForModel(effort: string | null, model: ModelInfo | undefined): string | null {
    const supported = model?.supportedReasoningEfforts ?? [];
    if (effort && supported.includes(effort)) return effort;
    const fallback = model?.defaultReasoningEffort;
    return fallback && supported.includes(fallback) ? fallback : null;
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
    /** Active custom model + effort; replaces the tier in the chip while set. */
    custom?: CustomModelEffort | null;
    /** Enables the "Custom model & effort…" row. Not offered in Auto provider mode. */
    onCustomChange?: (custom: CustomModelEffort | null) => void;
    /** The selected provider's model catalog for the custom panel. */
    models?: readonly ModelInfo[];
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
    custom = null,
    onCustomChange,
    models = [],
    ...rest
}: EffortTierSelectorProps) {
    const owner = useWorkspaceOwner(workspaceId);
    const cloneBaseUrl = useCloneBaseUrl(workspaceId);
    const baseUrl = settingsBaseUrl ?? owner?.baseUrl ?? cloneBaseUrl;
    const canConfigure = !!provider && !configurationUnavailable && (owner !== null || resolveCloneRoute(workspaceId).kind !== 'unresolved-remote' || !!settingsBaseUrl);
    const testId = rest['data-testid'] ?? 'effort-tier-selector';
    const [open, setOpen] = useState(false);
    const [view, setView] = useState<'tiers' | 'custom'>('tiers');
    const [draft, setDraft] = useState<CustomModelEffort>({ model: '', reasoningEffort: null });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    // Portaled and fixed to the viewport, so a clipped or transformed host (the
    // Notes chat lens) cannot cut off the tier list. Inside a modal dialog it stays
    // there so the focus trap keeps working.
    const menuPosition = useAnchoredPanelPosition({
        open: open && !disabled, placement: 'up', align: 'left', constrainHeight: true,
        triggerRef, panelRef: menuRef, anchorKey: view,
    });

    useEffect(() => {
        if (!open) setView('tiers');
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)');
        const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled), [data-testid="effort-tier-configure"]:not(:disabled)');
        (selected ?? first)?.focus();
        function handleClick(e: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    const activeCustom = custom && !autoProviderMode ? custom : null;
    const customAvailable = !!onCustomChange && !autoProviderMode && models.length > 0;
    const selectedLabel = activeCustom
        ? `${modelLabel(activeCustom.model, models)} · ${effortChipLabel(activeCustom.reasoningEffort)}`
        : TIER_LABELS[selectedTier];
    const selectedTitle = activeCustom
        ? `Custom\nModel: ${activeCustom.model}\nReasoning effort: ${formatReasoningEffort(activeCustom.reasoningEffort ?? '')} (overrides tier)`
        : buildTierTitle(selectedTier, tiers, autoProviderMode);
    const draftModel = models.find(m => m.id === draft.model);

    function openCustomPanel() {
        const tier = tiers[selectedTier];
        const start = activeCustom ?? { model: tier?.model ?? '', reasoningEffort: tier?.reasoningEffort || null };
        const model = models.find(m => m.id === start.model) ?? models[0];
        setDraft({ model: model?.id ?? '', reasoningEffort: effortForModel(start.reasoningEffort, model) });
        setView('custom');
    }

    function closeMenu() {
        setOpen(false);
        triggerRef.current?.focus();
    }

    function renderCustomPanel() {
        const efforts = draftModel?.supportedReasoningEfforts ?? [];
        const startedFrom = tiers[selectedTier];
        const chipClass = (active: boolean) => cn(
            'flex-1 px-1 py-1 rounded-sm text-[11.5px] transition-colors',
            active
                ? 'bg-[#0e639c] text-white font-semibold'
                : 'text-[#5a5a5a] dark:text-[#bbb] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50',
        );
        return (
            <div className="px-2.5 py-1.5 text-[12px] text-[#1e1e1e] dark:text-[#cccccc]" data-testid="effort-tier-custom-panel">
                <div className="flex items-center gap-1.5 pb-1.5 mb-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <button
                        type="button"
                        onClick={() => setView('tiers')}
                        aria-label="Back to effort tiers"
                        className="px-1 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                        data-testid="effort-tier-custom-back"
                    >‹</button>
                    <span className="font-semibold">Custom model &amp; effort</span>
                </div>
                <label className="block text-[11px] text-[#848484] dark:text-[#999] mb-0.5" htmlFor={`${testId}-custom-model`}>Model</label>
                <select
                    id={`${testId}-custom-model`}
                    value={draft.model}
                    onChange={e => {
                        const model = models.find(m => m.id === e.target.value);
                        setDraft(d => ({ model: e.target.value, reasoningEffort: effortForModel(d.reasoningEffort, model) }));
                    }}
                    className="w-full h-7 px-1.5 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] font-mono text-[11.5px] focus:outline-none focus:border-[#0078d4]"
                    data-testid="effort-tier-custom-model"
                >
                    {models.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                </select>
                <div className="mt-2 mb-0.5 text-[11px] text-[#848484] dark:text-[#999]">Reasoning effort</div>
                {efforts.length > 0 ? (
                    <div role="radiogroup" aria-label="Reasoning effort" className="flex gap-0.5 p-0.5 rounded border border-[#d0d0d0] dark:border-[#3c3c3c]" data-testid="effort-tier-custom-efforts">
                        {[null, ...efforts].map(effort => (
                            <button
                                key={effort ?? 'auto'}
                                type="button"
                                role="radio"
                                aria-checked={draft.reasoningEffort === effort}
                                onClick={() => setDraft(d => ({ ...d, reasoningEffort: effort }))}
                                className={chipClass(draft.reasoningEffort === effort)}
                                data-testid={`effort-tier-custom-effort-${effort ?? 'auto'}`}
                            >{effortChipLabel(effort)}</button>
                        ))}
                    </div>
                ) : (
                    <div className="text-[11px] text-[#848484] dark:text-[#777]" data-testid="effort-tier-custom-no-efforts">This model has no reasoning effort setting.</div>
                )}
                <div className="mt-2 text-[10.5px] leading-snug text-[#848484] dark:text-[#777]">
                    {startedFrom?.model && !activeCustom && (
                        <div>Started from: {TIER_LABELS[selectedTier]} ({modelLabel(startedFrom.model, models)} · {formatReasoningEffort(startedFrom.reasoningEffort).toLowerCase()})</div>
                    )}
                    <div>Applies to this chat only. Tiers are not changed.</div>
                </div>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <button
                        type="button"
                        disabled={!activeCustom}
                        onClick={() => { onCustomChange?.(null); closeMenu(); }}
                        className="text-[12px] text-[#5a5a5a] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] disabled:opacity-40 disabled:cursor-not-allowed"
                        data-testid="effort-tier-custom-reset"
                    >Reset to tier</button>
                    <button
                        type="button"
                        disabled={!draftModel}
                        onClick={() => { onCustomChange?.({ model: draft.model, reasoningEffort: draft.reasoningEffort }); closeMenu(); }}
                        className="px-4 h-[26px] rounded bg-[#0e639c] hover:bg-[#1177bb] text-white text-[12px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid="effort-tier-custom-apply"
                    >Use</button>
                </div>
            </div>
        );
    }

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
                if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (event.target as HTMLElement).tagName !== 'SELECT') {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!open) { setOpen(true); return; }
                    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
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
                    'min-w-0 max-w-[40vw] transition-colors',
                    activeCustom
                        ? 'sm:max-w-[220px] bg-[#e5f1fb] dark:bg-[#04395e] ring-1 ring-[#0078d4]/40 dark:ring-[#3794ff]/50'
                        : 'sm:max-w-[140px]',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
                title={activeCustom ? selectedTitle : `Effort tier: ${selectedTitle}`}
                data-testid="effort-tier-trigger-btn"
                data-custom={activeCustom ? 'true' : undefined}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={activeCustom ? `Custom model and effort: ${selectedLabel}` : `Effort tier: ${selectedLabel}`}
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
                    {activeCustom
                        ? <span className="text-[#0e639c] dark:text-[#cfe6ff]">✎ {selectedLabel}</span>
                        : <>{!compact && <span className={prefixClassName}>Effort: </span>}{selectedLabel}</>}
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

            {open && !disabled && createPortal(
                <div
                    className={cn(
                        'z-[10003] overflow-y-auto',
                        view === 'custom' ? 'w-[300px]' : autoProviderMode ? 'min-w-[160px]' : 'min-w-[240px]',
                        'max-w-[calc(100vw-16px)] py-0.5 rounded-md shadow-lg',
                        'bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]',
                    )}
                    ref={menuRef}
                    style={{ position: 'fixed', ...menuPosition }}
                    role="group"
                    aria-label="Effort tier settings"
                    data-testid="effort-tier-menu"
                >
                    {view === 'custom' ? renderCustomPanel() : <>
                    <div role="listbox" aria-label="Select effort tier">
                        {TIER_KEYS.map(tier => {
                            const isSelected = tier === selectedTier && !activeCustom;
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
                                    {!autoProviderMode && tiers[tier]?.model && (
                                        <span className="ml-auto pl-3 font-mono text-[10.5px] text-[#848484] dark:text-[#777] truncate" data-testid={`effort-tier-hint-${tier}`}>
                                            {modelLabel(tiers[tier]!.model, models)} · {formatReasoningEffort(tiers[tier]!.reasoningEffort).toLowerCase()}
                                        </span>
                                    )}
                                    {isSelected && isConfigured && (
                                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true" className={cn('shrink-0 text-[#0078d4] dark:text-[#3794ff]', !tiers[tier]?.model || autoProviderMode ? 'ml-auto' : 'ml-1')}>
                                            <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    {onCustomChange && (
                        <>
                            <div role="presentation" className="my-0.5 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" />
                            <button
                                type="button"
                                disabled={!customAvailable}
                                onClick={openCustomPanel}
                                title={autoProviderMode ? 'Pick a provider first' : models.length === 0 ? 'No models available for this provider' : 'Pick an exact model and reasoning effort for this chat'}
                                data-selected={activeCustom ? 'true' : 'false'}
                                className={cn(
                                    'w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[12px] transition-colors cursor-pointer',
                                    activeCustom ? 'bg-[#f3f3f3] dark:bg-[#2a2d2e]' : '',
                                    'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]',
                                    'disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[#0078d4]/50',
                                )}
                                data-testid="effort-tier-custom"
                            >
                                <span aria-hidden="true">✎</span>
                                <span className="leading-tight">Custom model &amp; effort…</span>
                            </button>
                        </>
                    )}
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
                    </>}
                </div>,
                containerRef.current?.closest('[aria-modal="true"]') ?? document.body,
            )}
        </div>
    );
}
