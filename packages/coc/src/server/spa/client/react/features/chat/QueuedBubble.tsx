import { useCallback } from 'react';
import { cn } from '../../ui/cn';
import { ImageGallery } from '../../ui/ImageGallery';
import type { QueuedMessage } from '../../utils/chatUtils';

interface QueuedItemProps {
    msg: QueuedMessage;
    onCancel?: (messageId: string) => void;
}

function QueuedItem({ msg, onCancel }: QueuedItemProps) {
    const handleCancel = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        onCancel?.(msg.id);
    }, [msg.id, onCancel]);

    const hasImages = !!msg.images && msg.images.length > 0;

    return (
        <div
            className={cn(
                'queued-item flex flex-col',
                'px-2.5 py-1.5 mb-1 last:mb-0',
                'rounded border border-dashed',
                'border-[#e5e7eb] dark:border-[#3c3c3c]',
                'bg-[#fafafa] dark:bg-[#252526]',
                'text-[12.5px] text-[#2c2f33] dark:text-[#cccccc]',
            )}
            data-testid="queued-item"
            data-status={msg.status}
        >
            <div className="flex items-center gap-2.5">
                <span
                    className="text flex-1 min-w-0 truncate"
                    data-testid="queued-item-text"
                    title={msg.content}
                >
                    {msg.content}
                </span>
                {onCancel && (
                    <button
                        type="button"
                        className={cn(
                            'queued-item-cancel shrink-0 inline-flex items-center justify-center',
                            'w-5 h-5 rounded-sm text-[11px] leading-none',
                            'text-[#6b7280] dark:text-[#9aa0a6]',
                            'hover:bg-[#ffebe9] hover:text-[#cf222e]',
                            'dark:hover:bg-[#3a1a1a] dark:hover:text-[#f87171]',
                            'transition-colors',
                        )}
                        title="Cancel queued message"
                        aria-label="Cancel queued message"
                        onClick={handleCancel}
                        data-testid="queued-item-cancel"
                    >
                        ✕
                    </button>
                )}
            </div>
            {hasImages && (
                <ImageGallery images={msg.images!} />
            )}
        </div>
    );
}

interface QueuedFollowUpsProps {
    queue: QueuedMessage[];
    /** Optional handler invoked when the user cancels a queued message. */
    onCancel?: (messageId: string) => void;
}

/**
 * Compact "Queued · N" follow-ups section shown below conversation turns.
 *
 * Visual contract (per OpenDesign reference):
 *   - Section is left-indented to align with the assistant body (after the avatar gutter).
 *   - Header is `Queued · N` in font-mono uppercase muted text (no card border).
 *   - Each item is a single-line dashed-border surface card with optional ✕ cancel.
 */
export function QueuedFollowUps({ queue, onCancel }: QueuedFollowUpsProps) {
    if (queue.length === 0) return null;
    return (
        <section
            className="queued mt-3 mb-1.5 ml-9"
            data-testid="queued-followups"
            aria-label="Queued follow-up messages"
        >
            <div
                className={cn(
                    'queued-label',
                    'mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em]',
                    'text-[#6b7280] dark:text-[#9aa0a6]',
                )}
                data-testid="queued-label"
            >
                Queued · {queue.length}
            </div>
            <div role="list">
                {queue.map(msg => (
                    <div role="listitem" key={msg.id}>
                        <QueuedItem msg={msg} onCancel={onCancel} />
                    </div>
                ))}
            </div>
        </section>
    );
}

/** @deprecated Use QueuedFollowUps instead */
export function QueuedBubble({ msg, onCancel }: QueuedItemProps) {
    return <QueuedItem msg={msg} onCancel={onCancel} />;
}
