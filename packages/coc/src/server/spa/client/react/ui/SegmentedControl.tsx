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
    'data-testid'?: string;
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
    className,
    ...rest
}: SegmentedControlProps<T>) {
    return (
        <div className={cn('flex items-center gap-2', className)} data-testid={rest['data-testid']}>
            {label && (
                <span className="text-[10px] text-[#616161] dark:text-[#999]">{label}</span>
            )}
            {options.map(opt => (
                <button
                    key={opt.value}
                    type="button"
                    className={cn(
                        'text-[10px] px-2 py-1 rounded',
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
