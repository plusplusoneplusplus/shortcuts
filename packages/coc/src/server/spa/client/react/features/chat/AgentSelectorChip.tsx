/**
 * AgentSelectorChip — compact toolbar chip for selecting the AI agent provider.
 *
 * Renders a small button in the chat input toolbar that shows the active agent
 * ("Copilot", "Codex", or "Claude") and opens a popover menu to switch providers.
 * Codex and Claude appear disabled when not available, with a short explanation.
 *
 * Visual style mirrors the existing model picker chip in NewChatArea/FollowUpInputArea.
 */

import { useRef, useState, useEffect } from 'react';
import { cn } from '../../ui/cn';
import type { AgentProviderStatus } from '@plusplusoneplusplus/coc-client';

export type ChatProvider = 'copilot' | 'codex' | 'claude';

export interface AgentSelectorChipProps {
    providers: AgentProviderStatus[];
    loading: boolean;
    selected: ChatProvider;
    onChange: (provider: ChatProvider) => void;
    disabled?: boolean;
}

/** Bot icon for Codex — small hexagon outline, matching the existing provider badge. */
function CodexIcon() {
    return (
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
            <polygon
                points="8,1 14,4.5 14,11.5 8,15 2,11.5 2,4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
            />
        </svg>
    );
}

/** Person icon for Copilot — simple circle + arc. */
function CopilotIcon() {
    return (
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
            <circle cx="8" cy="5" r="3" stroke="currentColor" strokeWidth="1.4" />
            <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
    );
}

/** Spark/diamond icon for Claude — distinct geometric glyph. */
function ClaudeIcon() {
    return (
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
            <path
                d="M8 1l2 5.5L16 8l-6 1.5L8 15l-2-5.5L0 8l6-1.5z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function ProviderIcon({ id }: { id: string }) {
    if (id === 'codex') return <CodexIcon />;
    if (id === 'claude') return <ClaudeIcon />;
    return <CopilotIcon />;
}

export function AgentSelectorChip({ providers, loading, selected, onChange, disabled }: AgentSelectorChipProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Close the menu when clicking outside
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

    const selectedLabel = selected === 'codex' ? 'Codex' : selected === 'claude' ? 'Claude' : 'Copilot';

    return (
        <div ref={containerRef} className="relative shrink-0" data-testid="agent-selector-chip-container">
            <button
                type="button"
                disabled={disabled || loading}
                onClick={() => setOpen(o => !o)}
                className={cn(
                    'ctool shrink-0 inline-flex items-center gap-1 h-[22px] px-1.5 rounded-sm text-[11px]',
                    'text-[#5a5a5a] dark:text-[#cccccc]',
                    'hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e]',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50',
                    'min-w-0 max-w-[40vw] sm:max-w-[140px] transition-colors',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
                title={`Agent: ${selectedLabel} (click to switch)`}
                data-testid="agent-selector-chip-btn"
                aria-haspopup="listbox"
                aria-expanded={open}
            >
                <ProviderIcon id={selected} />
                <span className="font-mono text-[10.5px] font-medium text-[#848484] dark:text-[#999] truncate">
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

            {open && (
                <div
                    className={cn(
                        'absolute bottom-full mb-1 left-0 z-50',
                        'min-w-[140px] py-0.5 rounded-md shadow-lg',
                        'bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]',
                    )}
                    role="listbox"
                    aria-label="Select agent provider"
                    data-testid="agent-selector-menu"
                >
                    {providers.map(provider => {
                        const isSelected = provider.id === selected;
                        const isDisabled = !provider.enabled || !provider.available;
                        return (
                            <button
                                key={provider.id}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                disabled={isDisabled}
                                onClick={() => {
                                    if (!isDisabled) {
                                        onChange(provider.id as ChatProvider);
                                        setOpen(false);
                                    }
                                }}
                                title={isDisabled
                                    ? (provider.reason
                                        ?? (!provider.enabled ? `${provider.label} is disabled by admin` : `${provider.label} is unavailable`))
                                    : undefined}
                                className={cn(
                                    'w-full flex items-start gap-1.5 px-2 py-1.5 text-left text-[12px]',
                                    'transition-colors',
                                    isSelected
                                        ? 'bg-[#f3f3f3] dark:bg-[#2a2d2e] text-[#1e1e1e] dark:text-[#cccccc]'
                                        : 'text-[#1e1e1e] dark:text-[#cccccc]',
                                    !isDisabled && !isSelected
                                        ? 'hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e]'
                                        : '',
                                    isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                                )}
                                data-testid={`agent-option-${provider.id}`}
                            >
                                <span className="mt-0.5 shrink-0">
                                    <ProviderIcon id={provider.id} />
                                </span>
                                {/* Disabled providers rely on the grey opacity-50
                                     row and the title-attribute tooltip (set
                                     above) to convey the reason. The inline
                                     "Disabled by admin" subtitle is intentionally
                                     omitted so the menu stays compact. */}
                                <span className="font-medium leading-tight min-w-0 truncate">{provider.label}</span>
                                {isSelected && (
                                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 ml-auto mt-0.5 text-[#0078d4] dark:text-[#3794ff]">
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
