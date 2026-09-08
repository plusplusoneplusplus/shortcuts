import { cn } from './cn';

export interface SegmentedControlOption<T extends string> {
    value: T;
    label: string;
    testId?: string;
}

export interface SegmentedControlProps<T extends string> {
    options: readonly SegmentedControlOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Short label rendered before the buttons. */
    label?: string;
    /**
     * `'sm'` (default) is the compact 10px pill row used across the schedule
     * forms. `'touch'` grows the buttons to a full-width 44px bar for mobile,
     * matching `MobileScratchpadTabBar`'s tap-target sizing.
     */
    size?: 'sm' | 'touch';
    'data-testid'?: string;
    /** Accessible name for the group; used with the `touch` (tablist) variant. */
    'aria-label'?: string;
    className?: string;
}

/**
 * Compact pill-button toggle for a small fixed set of string options.
 * Replaces the repeated inline pill-button pattern used throughout schedule forms.
 */
export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    label,
    size = 'sm',
    className,
    ...rest
}: SegmentedControlProps<T>) {
    const touch = size === 'touch';
    return (
        <div
            className={cn('flex items-center', touch ? 'gap-1' : 'gap-2', className)}
            data-testid={rest['data-testid']}
            role={touch ? 'tablist' : undefined}
            aria-label={rest['aria-label']}
        >
            {label && (
                <span className="text-[10px] text-[#616161] dark:text-[#999]">{label}</span>
            )}
            {options.map(opt => (
                <button
                    key={opt.value}
                    type="button"
                    role={touch ? 'tab' : undefined}
                    aria-selected={touch ? value === opt.value : undefined}
                    className={cn(
                        'rounded',
                        touch
                            ? 'flex-1 h-11 text-sm font-medium touch-target'
                            : 'text-[10px] px-2 py-1',
                        value === opt.value
                            ? 'bg-[#0078d4] text-white'
                            : 'bg-[#e0e0e0] dark:bg-[#444] text-[#616161] dark:text-[#999]'
                    )}
                    onClick={() => onChange(opt.value)}
                    data-testid={opt.testId}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}
