/**
 * FeedList — renders the full feed with empty state.
 */

import React from 'react';
import { FeedItem } from './FeedItem';
import type { FeedItem as FeedItemType } from './memoryApi';

interface FeedListProps {
    items: FeedItemType[];
    onDelete: (id: string, type: string) => void;
}

export function FeedList({ items, onDelete }: FeedListProps) {
    if (items.length === 0) {
        return (
            <div
                className="text-xs text-[#848484] py-8 text-center"
                data-testid="feed-empty-state"
            >
                No observations yet. Add a note or run a workflow to get started.
            </div>
        );
    }

    return (
        <div data-testid="feed-list">
            {items.map(item => (
                <FeedItem key={item.id} item={item} onDelete={onDelete} />
            ))}
        </div>
    );
}
