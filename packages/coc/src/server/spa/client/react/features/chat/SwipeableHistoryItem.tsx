/**
 * SwipeableHistoryItem — wraps a conversation history row with swipe-to-archive
 * (or swipe-to-unarchive) gesture support on mobile.
 *
 * On desktop, renders children directly without the swipe layer.
 */

import { type ReactNode } from 'react';
import { useSwipeToArchive } from '../hooks/useSwipeToArchive';

export interface SwipeableHistoryItemProps {
    /** Whether mobile swipe is enabled. */
    isMobile: boolean;
    /** Called when the swipe gesture confirms archive. */
    onArchive?: () => void;
    /** Called when the swipe gesture confirms unarchive. */
    onUnarchive?: () => void;
    /** True for items in the archived section (swipe = unarchive). */
    isArchived?: boolean;
    children: ReactNode;
}

export function SwipeableHistoryItem({
    isMobile,
    onArchive,
    onUnarchive,
    isArchived = false,
    children,
}: SwipeableHistoryItemProps) {
    const action = isArchived ? onUnarchive : onArchive;

    const { handlers, swipeOffset, isSwiping, isExiting } = useSwipeToArchive({
        onSwipeConfirm: () => action?.(),
        enabled: isMobile && !!action,
    });

    // Desktop: render children directly
    if (!isMobile || !action) {
        return <>{children}</>;
    }

    const progress = Math.min(Math.abs(swipeOffset) / 80, 1);

    return (
        <div
            className="relative overflow-hidden rounded-md"
            {...handlers}
            style={{ touchAction: isSwiping ? 'none' : 'pan-y' }}
        >
            {/* Reveal layer behind the row */}
            <div
                className={`absolute inset-0 flex items-center justify-end px-4 ${
                    isArchived
                        ? 'bg-blue-500 dark:bg-blue-600'
                        : 'bg-red-500 dark:bg-red-600'
                }`}
                style={{ opacity: progress }}
                data-testid="swipe-reveal-layer"
            >
                <span className="text-white text-sm font-medium">
                    {isArchived ? '📤 Unarchive' : '📦 Archive'}
                </span>
            </div>
            {/* Foreground row */}
            <div
                className="relative bg-[#ffffff] dark:bg-[#1e1e1e]"
                style={{
                    transform: `translateX(${swipeOffset}px)`,
                    transition: isSwiping ? 'none' : 'transform 200ms ease-out',
                }}
                data-testid="swipe-foreground"
            >
                {children}
            </div>
        </div>
    );
}
