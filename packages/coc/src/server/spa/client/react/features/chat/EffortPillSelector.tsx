/**
 * EffortPillSelector — dropdown chip for picking the per-turn reasoning
 * effort applied to the next chat message.
 *
 * Visual style mirrors `AgentSelectorChip`: a single ghost button (icon +
 * label + chevron) in the toolbar that opens a popover with all options.
 * Selection semantics: `value === null` means "no override" — the executor
 * falls back to the persisted per-model effort, then the SDK default. The
 * popover surfaces this as an explicit "Auto" option so the user can
 * always return to the unset state without guessing.
 *
 * Options are derived from the active model's `supportedReasoningEfforts`
 * so only valid per-model efforts are selectable. Pass the result of
 * `buildEffortOptionsForModel(model.supportedReasoningEfforts)` as the
 * `options` prop; omit it to show all four known options.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '../../ui/cn';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh';

export interface EffortPillOption {
    /** Effort value sent to the queue/follow-up payload. */
    value: EffortLevel;
    /** Plain text label shown next to the bars icon. */
    label: string;
    /** Tooltip explaining the effort level. */
    title: string;
    /** Colour theme for the bars icon when this level is the selected one. */
    barClass: string;
    /** Number of filled bars (1–3). */
    filled: number;
}

export interface EffortPillSelectorProps {
    options?: readonly EffortPillOption[];
    /** Current override. `null` = no override (use model default). */
    value: EffortLevel | null;
    /**
     * Called when the user picks a level. Picking the "Auto" entry in the
     * dropdown — or clicking the currently-selected level — passes `null`
     * (toggles the override off).
     */
    onChange: (value: EffortLevel | null) => void;
    /** When true, the chip is rendered but greyed out and not interactive. */
    disabled?: boolean;
    /** Optional disabled-state tooltip. */
    disabledTitle?: string;
    'data-testid'?: string;
    className?: string;
}

const ALL_EFFORT_PILL_OPTIONS: readonly EffortPillOption[] = [
    {
        value: 'low',
        label: 'Low',
        title: 'Low effort — fast, shallow reasoning',
        barClass: 'text-[#848484] dark:text-[#9e9e9e]',
        filled: 1,
    },
    {
        value: 'medium',
        label: 'Medium',
        title: 'Medium effort — balanced',
        barClass: 'text-[#0078d4] dark:text-[#3794ff]',
        filled: 2,
    },
    {
        value: 'high',
        label: 'High',
        title: 'High effort — deep reasoning, slower',
        barClass: 'text-[#8250df] dark:text-[#b392f0]',
        filled: 3,
    },
    {
        value: 'xhigh',
        label: 'Extra High',
        title: 'Extra High effort — maximum reasoning depth, slowest',
        barClass: 'text-[#cf222e] dark:text-[#ff7b72]',
        filled: 4,
    },
];

/** Default options (all four known efforts). */
export const DEFAULT_EFFORT_PILL_OPTIONS: readonly EffortPillOption[] = ALL_EFFORT_PILL_OPTIONS;

/**
 * Build the effort options for the active model.
 *
 * Only options whose `value` appears in `supportedEfforts` are returned,
 * preserving canonical ordering (low → medium → high → xhigh).
 * Returns all four options when `supportedEfforts` is empty or undefined.
 */
export function buildEffortOptionsForModel(supportedEfforts: readonly string[] | undefined): readonly EffortPillOption[] {
    if (!supportedEfforts || supportedEfforts.length === 0) {
        return ALL_EFFORT_PILL_OPTIONS;
    }
    const set = new Set(supportedEfforts);
    const filtered = ALL_EFFORT_PILL_OPTIONS.filter(opt => set.has(opt.value));
    return filtered.length > 0 ? filtered : ALL_EFFORT_PILL_OPTIONS;
}

/** Four-bar reasoning-effort icon. The first `filled` bars are opaque. */
function BarsIcon({ filled, className }: { filled: number; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn('inline-flex items-end gap-[2px] h-[12px]', className)}
        >
            <span className={cn('w-[2px] rounded-[1px]', filled >= 1 ? 'opacity-90' : 'opacity-30')} style={{ height: '3px', background: 'currentColor' }} />
            <span className={cn('w-[2px] rounded-[1px]', filled >= 2 ? 'opacity-90' : 'opacity-30')} style={{ height: '6px', background: 'currentColor' }} />
            <span className={cn('w-[2px] rounded-[1px]', filled >= 3 ? 'opacity-90' : 'opacity-30')} style={{ height: '9px', background: 'currentColor' }} />
            <span className={cn('w-[2px] rounded-[1px]', filled >= 4 ? 'opacity-90' : 'opacity-30')} style={{ height: '12px', background: 'currentColor' }} />
        </span>
    );
}

export function EffortPillSelector({
    options = DEFAULT_EFFORT_PILL_OPTIONS,
    value,
    onChange,
    disabled = false,
    disabledTitle,
    className,
    ...rest
}: EffortPillSelectorProps) {
    const testId = rest['data-testid'] ?? 'effort-pill-selector';
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

    const selectedOption = value ? options.find(o => o.value === value) : undefined;
    const triggerLabel = selectedOption?.label ?? 'Auto';
    const triggerFilled = selectedOption?.filled ?? 0;
    const triggerBarClass = selectedOption?.barClass ?? 'text-[#848484] dark:text-[#999]';

    return (
        <div
            ref={containerRef}
            className={cn('relative shrink-0', className)}
            data-testid={testId}
            data-effort-value={value ?? 'auto'}
        >
            <button
                type="button"
                disabled={disabled}
                onClick={() => setOpen(o => !o)}
                className={cn(
                    'ctool shrink-0 inline-flex items-center gap-1 h-[22px] px-1.5 rounded-sm text-[11px]',
                    'text-[#5a5a5a] dark:text-[#cccccc]',
                    'hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50',
                    'min-w-0 max-w-[40vw] sm:max-w-[140px] transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
                title={disabled
                    ? (disabledTitle ?? 'Effort selector disabled')
                    : `Reasoning effort: ${triggerLabel}${value === null ? ' (model default)' : ''}`}
                data-testid="effort-pill-trigger-btn"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label="Reasoning effort"
            >
                <BarsIcon filled={triggerFilled} className={triggerBarClass} />
                <span className="font-mono text-[10.5px] font-medium text-[#848484] dark:text-[#999] truncate">
                    {triggerLabel}
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
                    aria-label="Select reasoning effort"
                    data-testid="effort-pill-menu"
                >
                    {/* "Auto" entry — clears the override so the executor
                         falls back to the persisted per-model effort and
                         then the SDK default. Listed first so it reads as
                         the no-op / default choice. */}
                    <button
                        key="auto"
                        type="button"
                        role="option"
                        aria-selected={value === null}
                        title="No override — use the model's default reasoning effort"
                        onClick={() => {
                            onChange(null);
                            setOpen(false);
                        }}
                        className={cn(
                            'w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[12px] cursor-pointer transition-colors',
                            value === null
                                ? 'bg-[#f3f3f3] dark:bg-[#2a2d2e] text-[#1e1e1e] dark:text-[#cccccc]'
                                : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]',
                        )}
                        data-testid="effort-pill-option-auto"
                        data-selected={value === null ? 'true' : 'false'}
                    >
                        <BarsIcon filled={0} className="text-[#848484] dark:text-[#999]" />
                        <span className="font-medium leading-tight min-w-0 truncate">Auto</span>
                        {value === null && (
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 ml-auto text-[#0078d4] dark:text-[#3794ff]">
                                <path d="M3 8l4 4 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        )}
                    </button>
                    {options.map(opt => {
                        const isSelected = opt.value === value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                title={opt.title}
                                onClick={() => {
                                    onChange(isSelected ? null : opt.value);
                                    setOpen(false);
                                }}
                                className={cn(
                                    'w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[12px] cursor-pointer transition-colors',
                                    isSelected
                                        ? 'bg-[#f3f3f3] dark:bg-[#2a2d2e] text-[#1e1e1e] dark:text-[#cccccc]'
                                        : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]',
                                )}
                                data-testid={`effort-pill-option-${opt.value}`}
                                data-selected={isSelected ? 'true' : 'false'}
                            >
                                <BarsIcon filled={opt.filled} className={isSelected ? opt.barClass : 'text-[#848484] dark:text-[#999]'} />
                                <span className="font-medium leading-tight min-w-0 truncate">{opt.label}</span>
                                {isSelected && (
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
