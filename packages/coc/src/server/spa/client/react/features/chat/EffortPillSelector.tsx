/**
 * EffortPillSelector — segmented control for picking the reasoning effort
 * applied to the next chat turn.
 *
 * Visual style mirrors `ModePillSelector` (single rounded-md container with
 * one button per level) so the bar reads as a system of paired pills:
 * mode pill chooses *how* the AI plans, effort pill chooses *how hard* it
 * thinks. Three levels — Low / Medium / High — match the OpenDesign
 * composer reference and the SDK's `'low' | 'medium' | 'high'` values.
 *
 * The `xhigh` effort is intentionally not exposed here: it's a per-model
 * provisioned variant (admin sets it via Settings → Models), not a
 * per-turn override.
 *
 * Selection semantics: `value === null` means "no override" — the executor
 * falls back to the persisted per-model effort, then the SDK default. This
 * avoids sending a `reasoningEffort` that the active model doesn't
 * support, which would throw at request time.
 */

import { cn } from '../../ui/cn';

export type EffortLevel = 'low' | 'medium' | 'high';

export interface EffortPillOption {
    /** Effort value sent to the queue/follow-up payload. */
    value: EffortLevel;
    /** Plain text label shown next to the bars icon. */
    label: string;
    /** Tooltip explaining the effort level. */
    title: string;
    /** Colour theme for the bars icon — pulls from the existing mode-dot palette. */
    barClass: string;
    /** Number of filled bars (1–3). */
    filled: number;
}

export interface EffortPillSelectorProps {
    options?: readonly EffortPillOption[];
    /** Current override. `null` = no override (use model default). */
    value: EffortLevel | null;
    /**
     * Called when the user picks a level. Clicking the currently-selected
     * level passes `null` (toggles the override off).
     */
    onChange: (value: EffortLevel | null) => void;
    /** When true, the pill is rendered but greyed out and not interactive. */
    disabled?: boolean;
    /** Optional disabled-state tooltip. */
    disabledTitle?: string;
    'data-testid'?: string;
    className?: string;
}

export const DEFAULT_EFFORT_PILL_OPTIONS: readonly EffortPillOption[] = [
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
];

/** Three-bar reasoning-effort icon. The first `filled` bars are opaque. */
function BarsIcon({ filled, className }: { filled: number; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn('inline-flex items-end gap-[2px] h-[9px]', className)}
        >
            <span className={cn('w-[2px] rounded-[1px]', filled >= 1 ? 'opacity-90' : 'opacity-30')} style={{ height: '3px', background: 'currentColor' }} />
            <span className={cn('w-[2px] rounded-[1px]', filled >= 2 ? 'opacity-90' : 'opacity-30')} style={{ height: '6px', background: 'currentColor' }} />
            <span className={cn('w-[2px] rounded-[1px]', filled >= 3 ? 'opacity-90' : 'opacity-30')} style={{ height: '9px', background: 'currentColor' }} />
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
    return (
        <div
            role="radiogroup"
            aria-label="Reasoning effort"
            className={cn(
                'inline-flex items-center gap-0 rounded-md border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] p-0.5',
                disabled ? 'opacity-50 cursor-not-allowed' : '',
                className,
            )}
            data-testid={testId}
            data-effort-value={value ?? 'auto'}
        >
            {options.map(opt => {
                const selected = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={disabled}
                        title={disabled ? (disabledTitle ?? `Effort selector disabled`) : opt.title}
                        className={cn(
                            'inline-flex items-center gap-1 rounded-[3px] px-2 py-[2px] text-[11px] leading-tight font-medium transition-colors -tracking-[0.005em]',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50',
                            disabled
                                ? 'cursor-not-allowed text-[#848484] dark:text-[#999999]'
                                : 'cursor-pointer',
                            selected
                                ? 'bg-[#f3f3f3] dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#cccccc] shadow-[inset_0_0_0_1px_#d0d0d0] dark:shadow-[inset_0_0_0_1px_#4a4a4a]'
                                : !disabled
                                    ? 'text-[#5a5a5a] dark:text-[#999999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]'
                                    : '',
                        )}
                        onClick={() => {
                            if (disabled) return;
                            onChange(selected ? null : opt.value);
                        }}
                        data-testid={`effort-pill-${opt.value}`}
                        data-selected={selected ? 'true' : 'false'}
                    >
                        <BarsIcon filled={opt.filled} className={selected ? opt.barClass : 'text-[#848484] dark:text-[#999999]'} />
                        <span>{opt.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
