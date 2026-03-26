/**
 * FeedItem — a single row in the memory feed.
 */

import React, { useState } from 'react';
import { formatRelativeTime } from '../../utils/format';
import type { FeedItem as FeedItemType } from './memoryApi';

interface FeedItemProps {
    item: FeedItemType;
    onDelete: (id: string, type: string) => void;
}

export function FeedItem({ item, onDelete }: FeedItemProps) {
    const [expanded, setExpanded] = useState(false);

    const isNote = item.type === 'note';
    const isConversation = isNote && item.source === 'conversation';
    const sourceBadge = isConversation
        ? '💬 You said'
        : isNote
            ? '👤 You'
            : `🤖 ${item.source}`;
    const badgeClass = isConversation
        ? 'bg-[#e6f4ea] dark:bg-[#1e3a2e] text-[#1a7f37] dark:text-[#56d364]'
        : isNote
            ? 'bg-[#0078d4]/10 text-[#0078d4] dark:text-[#4fc3f7]'
            : 'bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#616161] dark:text-[#999]';

    return (
        <div
            className="border-b border-[#e0e0e0] dark:border-[#3c3c3c] py-2 last:border-0"
            data-testid={`feed-item-${item.id}`}
        >
            {/* Header row */}
            <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badgeClass}`}>
                    {sourceBadge}
                </span>
                <span className="text-[11px] text-[#848484]">·</span>
                <span className="text-[11px] text-[#848484] flex-1">{formatRelativeTime(item.createdAt)}</span>
                <button
                    onClick={() => onDelete(item.id, item.type)}
                    className="text-[#848484] hover:text-red-500 transition-colors text-xs px-1 leading-none"
                    aria-label="Delete memory item"
                    data-testid={`feed-item-delete-${item.id}`}
                >
                    ✕
                </button>
            </div>

            {/* Content — truncated or expanded */}
            <div
                onClick={() => setExpanded(e => !e)}
                className="cursor-pointer text-xs text-[#1e1e1e] dark:text-[#cccccc] leading-relaxed"
                data-testid={`feed-item-content-${item.id}`}
            >
                {expanded ? (
                    <span className="whitespace-pre-wrap">{item.content}</span>
                ) : (
                    <span className="line-clamp-2">{item.content}</span>
                )}
            </div>

            {/* Tags */}
            {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                    {item.tags.map(tag => (
                        <span
                            key={tag}
                            className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0f0f0] dark:bg-[#2a2a2a] text-[#616161] dark:text-[#999]"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
