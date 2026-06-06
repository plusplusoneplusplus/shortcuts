/**
 * ModePillSelector — rectangular segmented control for picking the chat mode.
 *
 * Visual: a single rounded-md container holding one button per mode. Each
 * option shows a coloured status dot followed by its label. The currently
 * selected mode is highlighted with a subtle sunken background and a thin
 * inset border (matching the OpenDesign chats.html reference's
 * `.mode-seg` / `.mode-opt.active` pattern). Optional disabled placeholder
 * modes (e.g. "Script") can be rendered for upcoming features without
 * wiring them to a real ChatMode.
 */

import { cn } from '../../ui/cn';
import { DEFAULT_CHAT_MODES, MODE_TOOLTIPS, WORKFLOW_REGISTRY, getVisibleChatModes } from '../../repos/modeConfig';
import type { ChatMode, VisibleChatModeOptions } from '../../repos/modeConfig';

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

export function getModePillOption(mode: ChatMode): ModePillOption {
    const entry = WORKFLOW_REGISTRY.find(candidate => candidate.mode === mode);
    if (!entry) {
        throw new Error(`Unknown chat mode: ${mode}`);
    }
    return {
        value: entry.mode,
        label: entry.label,
        dotClass: entry.dotClass,
        title: entry.tooltip,
    };
}

export function getVisibleModePillOptions(options: VisibleChatModeOptions): readonly ModePillOption[] {
    return getVisibleChatModes(options).map(getModePillOption);
}

const DEFAULT_OPTIONS: readonly ModePillOption[] = DEFAULT_CHAT_MODES.map(getModePillOption);

/**
 * Default mode → label/dot mapping used when the caller does not override
 * `options`. Exposed so other components (and tests) can build a consistent
 * pill set if they need to filter by `allowedModes`.
 */
export const DEFAULT_MODE_PILL_OPTIONS = DEFAULT_OPTIONS;

/** Pill option for Ralph mode — appended to DEFAULT_MODE_PILL_OPTIONS when Ralph is enabled. */
export const RALPH_MODE_PILL_OPTION: ModePillOption = getModePillOption('ralph');

/** Pill option for For Each mode — appended to DEFAULT_MODE_PILL_OPTIONS when For Each is enabled. */
export const FOR_EACH_MODE_PILL_OPTION: ModePillOption = getModePillOption('for-each');

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
                // h-[22px] + p-px keeps the segmented container at the same
                // 22px height as the sibling ghost chips (agent / model /
                // effort), so all four toolbar elements share one baseline
                // and visual row-height. Without this the bordered
                // container previously rendered ~24px tall and looked
                // bulkier than the adjacent chips.
                'inline-flex items-center gap-0 h-[22px] rounded-md border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] p-px',
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
                            'inline-flex items-center gap-1 rounded-[3px] px-2 py-[2px] text-[11px] leading-tight font-medium cursor-pointer transition-colors -tracking-[0.005em]',
                            'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50',
                            selected
                                ? 'bg-[#f3f3f3] dark:bg-[#2a2a2a] text-[#1e1e1e] dark:text-[#cccccc] shadow-[inset_0_0_0_1px_#d0d0d0] dark:shadow-[inset_0_0_0_1px_#4a4a4a]'
                                : 'text-[#5a5a5a] dark:text-[#999999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]',
                        )}
                        onClick={() => onChange(opt.value)}
                        data-testid={`mode-pill-${opt.value}`}
                        data-selected={selected ? 'true' : 'false'}
                    >
                        <span
                            aria-hidden="true"
                            className={cn(
                                'inline-block h-[4px] w-[4px] rounded-full',
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
