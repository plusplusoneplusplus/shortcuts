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
 * Settled PRs fold into a single {@link ComposerPrFoldRow} so a chat that shipped
 * five commits does not out-grow the textarea it sits above — see
 * {@link partitionComposerPrChips} for the rules. Fold state is local, defaults to
 * closed, and is deliberately not persisted: it is derived from PR state rather
 * than a user preference, and a merged PR will not un-merge, so recomputing it on
 * every load is always correct. It is also orthogonal to dismiss — folding hides,
 * dismissing removes for the session, and dismiss keeps working on chips rendered
 * inside an expanded fold.
 *
 * The rounded top + clipped corners let whichever row lands first (chip or fold
 * row) sit flush with the composer card's `rounded-lg` border; each row's bottom
 * border doubles as the divider above the textarea.
 */
import React, { useCallback, useState } from 'react';
import { ComposerPrChip } from './ComposerPrChip';
import { ComposerPrFoldRow } from './ComposerPrFoldRow';
import { partitionComposerPrChips, summarizeFoldedPrChips } from './composerPrChipFold';
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

export function ChatComposerPrChips(options: ChatComposerPrChipsProps) {
    const { processId, ...statusOptions } = options;
    const { items, retry, refresh, refreshingKeys } = usePrChatStatusItems(statusOptions);
    const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
    const [foldOpen, setFoldOpen] = useState(false);

    const dismiss = useCallback((key: string) => {
        setDismissed(prev => {
            const next = new Set(prev);
            next.add(key);
            return next;
        });
    }, []);

    const visible = items.filter(item => !dismissed.has(item.key));
    const { head, folded } = partitionComposerPrChips(visible);
    if (head.length === 0 && folded.length === 0) return null;

    const autoFix = {
        enabled: isTriggersEnabled(),
        workspaceId: statusOptions.workspaceId,
        processId: processId ?? undefined,
    };

    const renderChip = (item: PrStatusCardItem) => (
        <ComposerPrChip
            key={item.key}
            item={item}
            onDismiss={dismiss}
            onRetry={retry}
            onRefresh={refresh}
            refreshing={refreshingKeys.has(item.key)}
            autoFix={autoFix}
        />
    );

    return (
        <div className="overflow-hidden rounded-t-lg" data-testid="composer-pr-chips">
            {head.map(renderChip)}
            {folded.length > 0 && (
                <>
                    <ComposerPrFoldRow
                        summary={summarizeFoldedPrChips(folded)}
                        open={foldOpen}
                        onToggle={() => setFoldOpen(prev => !prev)}
                    />
                    {foldOpen && folded.map(renderChip)}
                </>
            )}
        </div>
    );
}
