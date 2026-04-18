import { useEffect } from 'react';
import { Spinner } from '../shared';
import { ConversationTurnBubble } from '../processes/ConversationTurnBubble';
import { PendingTaskInfoPanel } from '../queue/PendingTaskInfoPanel';
import { cn } from '../shared/cn';
import { QueuedFollowUps } from './QueuedBubble';
import { BackgroundTasksIndicator } from './BackgroundTasksIndicator';
import type { ClientConversationTurn } from '../types/dashboard';
import type { QueuedMessage } from '../utils/chatUtils';
import type { BackgroundTasksState } from '../hooks/useChatSSE';

export interface ConversationAreaProps {
    loading: boolean;
    error: string | null;
    turns: ClientConversationTurn[];
    pendingQueue: QueuedMessage[];
    backgroundTasks?: BackgroundTasksState | null;
    isScrolledUp: boolean;
    scrollRef: React.RefObject<HTMLDivElement>;
    /** Ref attached to the inner turns container (for minimap navigation) */
    turnsContainerRef?: React.RefObject<HTMLDivElement | null>;
    onScrollToBottom: () => void;
    isPending: boolean;
    task: any;
    fullTask: any;
    onCancel: () => void;
    onMoveToTop: () => void;
    variant: 'inline' | 'floating';
    taskId: string;
    wsId?: string;
    /** Whether selection mode is active. */
    isSelecting?: boolean;
    /** Set of selected turn indices (used when isSelecting is true). */
    selectedTurns?: Set<number>;
    /** Click handler for turn selection (Ctrl/Shift+Click). */
    onTurnClick?: (index: number, event: React.MouseEvent) => void;
    /** Called to copy the selected turns as HTML snapshot. */
    onCopySelected?: () => void;
    /** Called to exit selection mode. */
    onCancelSelection?: () => void;
    /** Called when user selects "Attach as context" from a bubble's context menu. */
    onAttachContext?: (turnIndex: number, role: 'user' | 'assistant', snippet: string) => void;
}

export function ConversationArea({
    loading,
    error,
    turns,
    pendingQueue,
    backgroundTasks,
    isScrolledUp,
    scrollRef,
    turnsContainerRef,
    onScrollToBottom,
    isPending,
    task,
    fullTask,
    onCancel,
    onMoveToTop,
    variant,
    taskId,
    wsId,
    isSelecting,
    selectedTurns,
    onTurnClick,
    onCopySelected,
    onCancelSelection,
    onAttachContext,
}: ConversationAreaProps) {
    // Escape key exits selection mode
    useEffect(() => {
        if (!isSelecting) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancelSelection?.();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isSelecting, onCancelSelection]);

    const selectedCount = selectedTurns?.size ?? 0;

    return (
        <div className="relative flex-1 min-h-0 overflow-x-hidden min-w-0">
            <div
                ref={scrollRef}
                data-testid="activity-chat-conversation"
                className={cn('flex-1 min-h-0 overflow-y-auto h-full space-y-3 min-w-0', variant === 'floating' ? 'p-2' : 'p-4')}
            >
                {isPending ? (
                    task?.type === 'chat' ? (
                        <div className="flex items-center gap-2 text-[#848484] text-sm">
                            <Spinner size="sm" /> Task queued, starting soon…
                        </div>
                    ) : (
                        <PendingTaskInfoPanel task={fullTask || task} onCancel={onCancel} onMoveToTop={onMoveToTop} />
                    )
                ) : loading ? (
                    <div className="flex items-center gap-2 text-[#848484] text-sm">
                        <Spinner size="sm" /> Loading conversation...
                    </div>
                ) : turns.length === 0 ? (
                    <div className="text-[#848484] text-sm">No conversation data available.</div>
                ) : (
                    <div className="space-y-3" ref={turnsContainerRef}>
                        {(() => {
                            const hasStreaming = turns.some(t => t.streaming);
                            const nextTurnIndex = Math.max(0, ...turns.map(t => t.turnIndex ?? -1)) + 1;
                            const renderTurns =
                                task?.status === 'running' && !hasStreaming && turns.length > 0
                                    ? [...turns, { role: 'assistant' as const, content: '', streaming: true, timeline: [], turnIndex: nextTurnIndex }]
                                    : turns;
                            // Sort by turnIndex to handle storage order anomalies from race conditions;
                            // turns without turnIndex sort to end (they are always the newest)
                            const sortedTurns = [...renderTurns].sort((a, b) => {
                                const ai = a.turnIndex;
                                const bi = b.turnIndex;
                                if (ai == null && bi == null) return 0;
                                if (ai == null) return 1;
                                if (bi == null) return -1;
                                return ai - bi;
                            });
                            return sortedTurns.map((turn, i) => {
                                const idx = turn.turnIndex ?? i;
                                const isSelected = isSelecting && selectedTurns?.has(idx);
                                return (
                                    <div
                                        key={idx}
                                        className={cn(
                                            'flex items-start gap-2',
                                            isSelecting && 'cursor-pointer',
                                            isSelected && 'ring-2 ring-[#0078d4] ring-offset-1 rounded-lg',
                                        )}
                                        onClick={isSelecting ? (e: React.MouseEvent) => onTurnClick?.(idx, e) : undefined}
                                    >
                                        {isSelecting && (
                                            <div className="flex-shrink-0 pt-3 pl-1">
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected ?? false}
                                                    readOnly
                                                    className="w-4 h-4 accent-[#0078d4] pointer-events-none"
                                                    aria-label={`Select turn ${idx}`}
                                                />
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <ConversationTurnBubble turn={turn} taskId={taskId} wsId={wsId} turnIndex={idx} onAttachContext={onAttachContext} />
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                        {pendingQueue.length > 0 && <QueuedFollowUps queue={pendingQueue} />}
                        {backgroundTasks && backgroundTasks.backgroundTotalActive > 0 && (
                            <BackgroundTasksIndicator backgroundTasks={backgroundTasks} />
                        )}
                    </div>
                )}
            </div>
            <button
                data-testid="scroll-to-bottom-btn"
                className={cn(
                    'absolute bottom-4 right-4 z-10 flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 rounded-full bg-[#0078d4] text-white shadow-md hover:bg-[#106ebe] text-sm pointer-events-none opacity-0 transition-opacity',
                    isScrolledUp && 'visible pointer-events-auto opacity-100',
                )}
                onClick={onScrollToBottom}
                title="Scroll to bottom"
            >
                ↓
            </button>
            {/* Floating action bar for selection mode */}
            {isSelecting && selectedCount > 0 && (
                <div
                    data-testid="selection-action-bar"
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-[#0078d4] text-white shadow-lg text-sm"
                >
                    <span className="font-medium">{selectedCount} turn{selectedCount !== 1 ? 's' : ''} selected</span>
                    <button
                        data-testid="copy-selected-html-btn"
                        onClick={onCopySelected}
                        className="px-3 py-1 rounded-full bg-white text-[#0078d4] font-medium hover:bg-[#e8f3ff] transition-colors"
                    >
                        Copy HTML
                    </button>
                    <button
                        data-testid="cancel-selection-btn"
                        onClick={onCancelSelection}
                        className="px-2 py-1 rounded-full hover:bg-[#106ebe] transition-colors"
                    >
                        ✕
                    </button>
                </div>
            )}
        </div>
    );
}
