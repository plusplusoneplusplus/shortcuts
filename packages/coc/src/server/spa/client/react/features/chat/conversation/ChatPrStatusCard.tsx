/**
 * ChatPrStatusCard — connected wrapper that wires {@link usePrChatStatusItems}
 * (AC-01 detect + persist + fetch) into the presentational {@link PrStatusCard}
 * (AC-02). Mounted at the top of {@link ConversationArea} via {@link ChatDetail}.
 *
 * Renders nothing until at least one PR is associated, so the pinned region stays
 * hidden for chats that never created a pull request.
 */
import React from 'react';
import { PrStatusCard } from './PrStatusCard';
import { usePrChatStatusItems, type UsePrChatStatusItemsOptions } from './usePrChatStatusItems';

export interface ChatPrStatusCardProps extends UsePrChatStatusItemsOptions {
    /** Forwarded to {@link PrStatusCard} — collapse to a count beyond this many PRs. */
    collapseThreshold?: number;
}

export function ChatPrStatusCard({ collapseThreshold, ...options }: ChatPrStatusCardProps) {
    const { items, retry, expandChecks, refresh, refreshing, lastUpdatedAt } = usePrChatStatusItems(options);
    if (items.length === 0) return null;
    return (
        <PrStatusCard
            items={items}
            onRetry={retry}
            onExpandChecks={expandChecks}
            onRefresh={refresh}
            refreshing={refreshing}
            lastUpdatedAt={lastUpdatedAt}
            collapseThreshold={collapseThreshold}
        />
    );
}
