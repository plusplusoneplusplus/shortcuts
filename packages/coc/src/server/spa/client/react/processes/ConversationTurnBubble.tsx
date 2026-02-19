/**
 * ConversationTurnBubble — role-aware chat bubble for conversation turns.
 */
import { cn } from '../shared';
import type { ClientConversationTurn } from '../types/dashboard';
import { MarkdownView } from './MarkdownView';
import { ToolCallView } from './ToolCallView';
import { renderMarkdownToHtml } from '../../markdown-renderer';

interface ConversationTurnBubbleProps {
    turn: ClientConversationTurn;
}

export function ConversationTurnBubble({ turn }: ConversationTurnBubbleProps) {
    const isUser = turn.role === 'user';
    const contentHtml = /<[a-z][\s\S]*>/i.test(turn.content || '')
        ? (turn.content || '')
        : renderMarkdownToHtml(turn.content || '');

    return (
        <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
            <div
                className={cn(
                    'w-full max-w-[95%] rounded-lg border px-3 py-2 shadow-sm',
                    isUser
                        ? 'bg-[#e8f3ff] dark:bg-[#0f2a42] border-[#b3d7ff] dark:border-[#2a4a66]'
                        : 'bg-[#f8f8f8] dark:bg-[#252526] border-[#e0e0e0] dark:border-[#3c3c3c]'
                )}
            >
                <div className="flex items-center gap-2 text-[11px] text-[#848484] mb-2">
                    <span
                        className={cn(
                            'font-medium uppercase tracking-wide',
                            isUser ? 'text-[#005a9e] dark:text-[#7bbef3]' : 'text-[#5f6a7a] dark:text-[#b0b8c3]'
                        )}
                    >
                        {isUser ? 'You' : 'Assistant'}
                    </span>
                    {turn.timestamp && (
                        <span className="ml-auto">{new Date(turn.timestamp).toLocaleTimeString()}</span>
                    )}
                    {turn.streaming && (
                        <span className="text-[#f14c4c]">Live</span>
                    )}
                </div>

                <div className="space-y-2">
                    {contentHtml && (
                        <MarkdownView html={contentHtml} />
                    )}

                    {!!turn.toolCalls?.length && (
                        <div className="space-y-1">
                            {turn.toolCalls.map((toolCall, index) => (
                                <ToolCallView key={toolCall.id || index} toolCall={toolCall} />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
