/**
 * RecentPromptsTab — displays a list of recent EnqueueDialog submissions.
 * Clicking a card pre-fills the prompt and switches to the Advanced tab.
 */

import React from 'react';
import type { RecentSkillEntry } from '../hooks/useRecentSkills';

function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface RecentPromptsTabProps {
    items: RecentSkillEntry[];
    loaded: boolean;
    onSelect: (entry: RecentSkillEntry) => void;
}

export function RecentPromptsTab({ items, loaded, onSelect }: RecentPromptsTabProps) {
    if (!loaded) {
        return (
            <div className="flex items-center justify-center py-8 text-[#848484] text-sm">
                <span className="animate-spin mr-2">⟳</span> Loading…
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="flex items-center justify-center py-8 text-[#848484] text-sm text-center px-4">
                No recent prompts yet. Submit a prompt to start building history.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-2 overflow-y-auto max-h-[400px]">
            {items.map((entry, i) => {
                const promptPreview = entry.prompt?.trim();
                const skillChips = entry.skills && entry.skills.length > 0 ? entry.skills : null;

                const bodyText = promptPreview
                    ? promptPreview
                    : skillChips
                        ? skillChips.join(', ')
                        : entry.name;

                return (
                    <button
                        key={i}
                        type="button"
                        onClick={() => onSelect(entry)}
                        className="text-left w-full rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] hover:border-[#0078d4] hover:bg-[#f0f7ff] dark:hover:bg-[#1e3a5f] transition-colors px-3 py-2"
                        data-testid={`recent-prompt-card-${i}`}
                    >
                        {/* Header row: timestamp + mode badge + model */}
                        <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-[11px] text-[#848484] shrink-0">🕐 {relativeTime(entry.timestamp)}</span>
                            <span className="flex-1" />
                            {entry.model && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-[#f3f3f3] dark:bg-[#3c3c3c] text-[#848484]" title="Model">
                                    {entry.model}
                                </span>
                            )}
                            {entry.mode && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                                    entry.mode === 'ask'
                                        ? 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1e3a5f] dark:text-[#93c5fd]'
                                        : 'bg-[#dcfce7] text-[#15803d] dark:bg-[#14532d] dark:text-[#86efac]'
                                }`}>
                                    {entry.mode}
                                </span>
                            )}
                        </div>

                        {/* Body: prompt preview */}
                        <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc] line-clamp-2 mb-1.5">
                            {bodyText}
                        </div>

                        {/* Footer: skill pills */}
                        {skillChips && (
                            <div className="flex flex-wrap gap-1">
                                {skillChips.map(s => (
                                    <span
                                        key={s}
                                        className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-[#e0e0e0] dark:border-[#555] bg-[#f9f9f9] dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                                    >
                                        <span>⚡</span>
                                        <span>{s}</span>
                                    </span>
                                ))}
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
