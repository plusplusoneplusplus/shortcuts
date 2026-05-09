/**
 * ModePillSelector — segmented pill control for picking the chat mode.
 *
 * Visual: a single rounded container holding one button per mode. Each option
 * shows a coloured status dot followed by its label. The currently selected
 * mode is highlighted with a raised background and a thin border, matching
 * the design mockup. Optional disabled placeholder modes (e.g. "Script") can
 * be rendered for upcoming features without wiring them to a real ChatMode.
 */

import { cn } from '../../ui/cn';
import { MODE_TOOLTIPS } from '../../repos/modeConfig';
import type { ChatMode } from '../../repos/modeConfig';

export interface ModePillOption {
    /** Mode value. Must be one of the registered ChatMode strings. */
    value: ChatMode;
    /** Plain text label displayed in the pill (no emoji). */
    label: string;
    /** Tailwind colour class for the leading status dot, e.g. `bg-blue-500`. */
    dotClass: string;
    /** Optional override for the title attribute. */
    title?: string;
}

export interface ModePillSelectorProps {
    options: readonly ModePillOption[];
    value: ChatMode;
    onChange: (value: ChatMode) => void;
    'data-testid'?: string;
    className?: string;
}

const DEFAULT_OPTIONS: readonly ModePillOption[] = [
    { value: 'ask', label: 'Ask', dotClass: 'bg-blue-500' },
    { value: 'plan', label: 'Plan', dotClass: 'bg-blue-500' },
    { value: 'autopilot', label: 'Autopilot', dotClass: 'bg-orange-500' },
];

/**
 * Default mode → label/dot mapping used when the caller does not override
 * `options`. Exposed so other components (and tests) can build a consistent
 * pill set if they need to filter by `allowedModes`.
 */
export const DEFAULT_MODE_PILL_OPTIONS = DEFAULT_OPTIONS;

export function ModePillSelector({
    options,
    value,
    onChange,
    className,
    ...rest
}: ModePillSelectorProps) {
    const testId = rest['data-testid'] ?? 'mode-pill-selector';
    return (
        <div
            role="radiogroup"
            aria-label="Chat mode"
            className={cn(
                'inline-flex items-center gap-1 rounded-full border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] p-1',
                className,
            )}
            data-testid={testId}
        >
            {options.map(opt => {
                const selected = opt.value === value;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        title={opt.title ?? MODE_TOOLTIPS[opt.value]}
                        className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium cursor-pointer transition-colors',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50',
                            selected
                                ? 'border border-[#d0d0d0] dark:border-[#4a4a4a] bg-[#f3f3f3] dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#cccccc] shadow-sm'
                                : 'border border-transparent text-[#5a5a5a] dark:text-[#999999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                        )}
                        onClick={() => onChange(opt.value)}
                        data-testid={`mode-pill-${opt.value}`}
                        data-selected={selected ? 'true' : 'false'}
                    >
                        <span
                            aria-hidden="true"
                            className={cn(
                                'inline-block h-1.5 w-1.5 rounded-full',
                                opt.dotClass,
                            )}
                        />
                        <span>{opt.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
