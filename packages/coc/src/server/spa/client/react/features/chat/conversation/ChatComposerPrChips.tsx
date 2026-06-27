/**
 * ChatComposerPrChips — connected wrapper that wires {@link usePrChatStatusItems}
 * (detect + persist + fetch) into a stack of presentational {@link ComposerPrChip}s
 * docked inside the composer (design 01·B). Mounted as the first child of the
 * follow-up input card via {@link FollowUpInputArea}.
 *
 * Renders nothing until at least one PR is associated and not yet dismissed, so
 * the composer keeps no PR chrome for chats that never created a pull request.
 * Dismiss is session-scoped (a ✕'d chip stays hidden until the chat reloads); a
 * fresh detection or binding re-surfaces it.
 *
 * The rounded top + clipped corners let the first chip sit flush with the
 * composer card's `rounded-lg` border; each chip's bottom border doubles as the
 * divider above the textarea.
 */
import React, { useCallback, useState } from 'react';
import { ComposerPrChip } from './ComposerPrChip';
import { usePrChatStatusItems, type UsePrChatStatusItemsOptions } from './usePrChatStatusItems';
import { isTriggersEnabled } from '../../../utils/config';
import type { PrStatusCardItem } from './PrStatusCard';

export interface ChatComposerPrChipsProps extends UsePrChatStatusItemsOptions {
    /**
     * The conversation's process id — the target of the CI auto-fix action
     * (AC-05). Omit to leave the auto-fix controls disabled with a tooltip.
     */
    processId?: string | null;
}

/** Stable newest-first ordering: descending `createdAt`, input order otherwise. */
function sortNewestFirst(items: PrStatusCardItem[]): PrStatusCardItem[] {
    const toMs = (v: string | number | undefined): number => {
        if (v == null) return Number.NEGATIVE_INFINITY;
        if (typeof v === 'number') return v;
        const t = new Date(v).getTime();
        return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
    };
    return items
        .map((item, idx) => ({ item, idx }))
        .sort((a, b) => {
            const diff = toMs(b.item.createdAt) - toMs(a.item.createdAt);
            return diff !== 0 ? diff : a.idx - b.idx;
        })
        .map(({ item }) => item);
}

export function ChatComposerPrChips(options: ChatComposerPrChipsProps) {
    const { processId, ...statusOptions } = options;
    const { items, retry, refresh, refreshingKeys } = usePrChatStatusItems(statusOptions);
    const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());

    const dismiss = useCallback((key: string) => {
        setDismissed(prev => {
            const next = new Set(prev);
            next.add(key);
            return next;
        });
    }, []);

    const visible = sortNewestFirst(items).filter(item => !dismissed.has(item.key));
    if (visible.length === 0) return null;

    const autoFix = {
        enabled: isTriggersEnabled(),
        workspaceId: statusOptions.workspaceId,
        processId: processId ?? undefined,
    };

    return (
        <div className="overflow-hidden rounded-t-lg" data-testid="composer-pr-chips">
            {visible.map(item => (
                <ComposerPrChip
                    key={item.key}
                    item={item}
                    onDismiss={dismiss}
                    onRetry={retry}
                    onRefresh={refresh}
                    refreshing={refreshingKeys.has(item.key)}
                    autoFix={autoFix}
                />
            ))}
        </div>
    );
}
