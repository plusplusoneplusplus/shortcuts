import { Spinner } from '../shared';
import { ConversationTurnBubble } from '../processes/ConversationTurnBubble';
import { PendingTaskInfoPanel } from '../queue/PendingTaskInfoPanel';
import { cn } from '../shared/cn';
import { QueuedBubble } from './QueuedBubble';
import type { ClientConversationTurn } from '../types/dashboard';
import type { QueuedMessage } from '../utils/chatUtils';

export interface ConversationAreaProps {
    loading: boolean;
    error: string | null;
    turns: ClientConversationTurn[];
    pendingQueue: QueuedMessage[];
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
}

export function ConversationArea({
    loading,
    error,
    turns,
    pendingQueue,
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
}: ConversationAreaProps) {
    return (
        <div className="relative flex-1 min-h-0 overflow-x-hidden min-w-0">
            <div
                ref={scrollRef}
                data-testid="activity-chat-conversation"
                className={cn('flex-1 min-h-0 overflow-y-auto h-full space-y-3 min-w-0', variant === 'floating' ? 'p-2' : 'p-4')}
            >
                {isPending ? (
                    <PendingTaskInfoPanel task={fullTask || task} onCancel={onCancel} onMoveToTop={onMoveToTop} />
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
                            return sortedTurns.map((turn, i) => (
                                <ConversationTurnBubble key={turn.turnIndex ?? i} turn={turn} taskId={taskId} wsId={wsId} />
                            ));
                        })()}
                        {pendingQueue.map(msg => <QueuedBubble key={msg.id} msg={msg} />)}
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
        </div>
    );
}
