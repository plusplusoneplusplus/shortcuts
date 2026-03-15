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
        <div className="relative flex-1 min-h-0">
            <div
                ref={scrollRef}
                data-testid="activity-chat-conversation"
                className={cn('flex-1 min-h-0 overflow-y-auto h-full space-y-3', variant === 'floating' ? 'p-2' : 'p-4')}
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
                            const renderTurns =
                                task?.status === 'running' && !hasStreaming && turns.length > 0
                                    ? [...turns, { role: 'assistant' as const, content: '', streaming: true, timeline: [] }]
                                    : turns;
                            return renderTurns.map((turn, i) => (
                                <ConversationTurnBubble key={i} turn={turn} taskId={taskId} wsId={wsId} />
                            ));
                        })()}
                        {pendingQueue.map(msg => <QueuedBubble key={msg.id} msg={msg} />)}
                    </div>
                )}
            </div>
            <button
                data-testid="scroll-to-bottom-btn"
                className={cn(
                    'absolute bottom-4 right-4 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-[#0078d4] text-white shadow-md hover:bg-[#106ebe] text-sm pointer-events-none opacity-0 transition-opacity',
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
