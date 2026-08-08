/**
 * ChatStyleSelector — a single-chip dropdown that lets the user pick how the
 * response is written (Human / Direct / Analytical / Structured).
 *
 * Mirrors EffortTierSelector's button, popover, focus, outside-click, dark-mode,
 * and compact-trigger conventions so the two chips read as one control group.
 * Unlike effort tiers, every style is always selectable — there is no per-provider
 * configuration to look up.
 *
 * Style changes presentation only; it never affects the model, reasoning effort,
 * tools, or permission mode.
 */

import { useState, useRef, useEffect } from 'react';
import { cn } from '../../ui/cn';
import type { ChatStyle } from '@plusplusoneplusplus/coc-client';

export const CHAT_STYLE_KEYS: readonly ChatStyle[] = ['human', 'direct', 'analytical', 'structured'];

export const CHAT_STYLE_LABELS: Record<ChatStyle, string> = {
    human: 'Human',
    direct: 'Direct',
    analytical: 'Analytical',
    structured: 'Structured',
};

/** One-line behavior description shown on each dropdown row. */
export const CHAT_STYLE_DESCRIPTIONS: Record<ChatStyle, string> = {
    human: 'Natural, conversational, like a helpful coworker.',
    direct: 'Answer first, fewest words that keep the important facts.',
    analytical: 'Reasoning, assumptions, alternatives, and tradeoffs.',
    structured: 'Easy to scan: key points, decisions, risks, next steps.',
};

export interface ChatStyleSelectorProps {
    /** Currently selected style. */
    selectedStyle: ChatStyle;
    /** Called when the user picks a style. */
    onChange: (style: ChatStyle) => void;
    /** When true, the entire selector is disabled. */
    disabled?: boolean;
    'data-testid'?: string;
    className?: string;
    mobileTapTarget?: boolean;
    /**
     * Container-narrow signal: drop the "Style:" prefix and show only the value,
     * regardless of viewport. Fires in addition to the viewport `sm:` compaction
     * driven by `mobileTapTarget`.
     */
    compact?: boolean;
}

export function ChatStyleSelector({
    selectedStyle,
    onChange,
    disabled = false,
    className,
    mobileTapTarget = false,
    compact = false,
    ...rest
}: ChatStyleSelectorProps) {
    const testId = rest['data-testid'] ?? 'chat-style-selector';
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

    const selectedLabel = CHAT_STYLE_LABELS[selectedStyle] ?? CHAT_STYLE_LABELS.human;

    return (
        <div
            ref={containerRef}
            className={cn('relative shrink-0', className)}
            data-testid={testId}
            data-style-value={selectedStyle}
        >
            <button
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
                title="Choose how the response is written."
                data-testid="chat-style-trigger-btn"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`Style: ${selectedLabel}`}
            >
                <span aria-hidden="true" className={cn('font-mono text-[10px] font-semibold text-[#848484] dark:text-[#999]', mobileTapTarget ? 'inline sm:hidden' : 'hidden')}>
                    S
                </span>
                <span
                    className={cn(
                        'font-mono text-[10.5px] font-medium text-[#848484] dark:text-[#999] truncate',
                        mobileTapTarget && 'hidden sm:inline',
                    )}
                    data-testid="chat-style-label"
                >
                    {compact ? selectedLabel : `Style: ${selectedLabel}`}
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
                        'min-w-[230px] py-0.5 rounded-md shadow-lg',
                        'bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]',
                    )}
                    role="listbox"
                    aria-label="Select response style"
                    data-testid="chat-style-menu"
                >
                    {CHAT_STYLE_KEYS.map(style => {
                        const isSelected = style === selectedStyle;
                        return (
                            <button
                                key={style}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                title={CHAT_STYLE_DESCRIPTIONS[style]}
                                onClick={() => {
                                    onChange(style);
                                    setOpen(false);
                                }}
                                className={cn(
                                    'w-full flex items-start gap-1.5 px-2 py-1.5 text-left text-[12px] transition-colors cursor-pointer',
                                    isSelected
                                        ? 'bg-[#f3f3f3] dark:bg-[#2a2d2e] text-[#1e1e1e] dark:text-[#cccccc]'
                                        : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]',
                                )}
                                data-testid={`chat-style-option-${style}`}
                                data-selected={isSelected ? 'true' : 'false'}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block font-medium leading-tight">{CHAT_STYLE_LABELS[style]}</span>
                                    <span className="block text-[10.5px] leading-snug text-[#848484] dark:text-[#999]">
                                        {CHAT_STYLE_DESCRIPTIONS[style]}
                                    </span>
                                </span>
                                {isSelected && (
                                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 mt-0.5 text-[#0078d4] dark:text-[#3794ff]">
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
