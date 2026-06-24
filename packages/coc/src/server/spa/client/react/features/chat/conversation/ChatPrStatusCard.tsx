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

export type ChatPrStatusCardProps = UsePrChatStatusItemsOptions;

export function ChatPrStatusCard(options: ChatPrStatusCardProps) {
    const { items, retry, expandChecks, refresh, refreshingKeys, lastUpdatedAt } = usePrChatStatusItems(options);
    if (items.length === 0) return null;
    return (
        <PrStatusCard
            items={items}
            onRetry={retry}
            onExpandChecks={expandChecks}
            // The card has one control that refreshes every row — call refresh with
            // no key (and ignore the click event so it isn't taken as a row key).
            onRefresh={() => refresh()}
            refreshing={refreshingKeys.size > 0}
            lastUpdatedAt={lastUpdatedAt}
        />
    );
}
