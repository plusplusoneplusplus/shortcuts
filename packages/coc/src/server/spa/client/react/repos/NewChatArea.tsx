/**
 * NewChatArea — empty-state chat component shown when no task is selected
 * on the Activity tab. Lets the user type a message and start a new conversation.
 */

import { useRef, useState } from 'react';
import { RichTextInput } from '../shared/RichTextInput';
import type { RichTextInputHandle } from '../shared/RichTextInput';
import { cn } from '../shared/cn';
import { MODE_BORDER_COLORS } from './modeConfig';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { getApiBase } from '../utils/config';

export interface NewChatAreaProps {
    workspaceId?: string;
}

export function NewChatArea({ workspaceId }: NewChatAreaProps) {
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const richTextRef = useRef<RichTextInputHandle>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const { dispatch: queueDispatch } = useQueue();
    const { state: appState } = useApp();

    async function handleSend() {
        const text = input.trim();
        if (!text || sending) return;

        setError(null);
        setSending(true);
        abortControllerRef.current = new AbortController();

        try {
            const ws = appState.workspaces?.find((w: any) => w.id === workspaceId);
            const res = await fetch(getApiBase() + '/queue/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: abortControllerRef.current.signal,
                body: JSON.stringify({
                    type: 'chat',
                    priority: 'normal',
                    payload: {
                        kind: 'chat',
                        mode: 'ask',
                        prompt: text,
                        workingDirectory: ws?.rootPath,
                        workspaceId,
                    },
                }),
            });

            if (!res.ok) {
                const errBody = await res.text();
                throw new Error(errBody || `HTTP ${res.status}`);
            }

            const newTask = await res.json();
            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: newTask.task?.id ?? newTask.id, repoId: workspaceId });
            setInput('');
            richTextRef.current?.setValue('');
        } catch (err: any) {
            if (err?.name !== 'AbortError') {
                setError(err.message || 'Failed to create task');
            }
        } finally {
            setSending(false);
            abortControllerRef.current = null;
        }
    }

    function handleStop() {
        abortControllerRef.current?.abort();
        setSending(false);
    }

    return (
        <div className="flex flex-col h-full" data-testid="new-chat-area">
            {/* Hero area */}
            <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-[#848484]">
                    <div className="text-3xl mb-2">💬</div>
                    <div className="text-sm font-medium mb-1">Start a new conversation</div>
                    <div className="text-xs">Type a message below to begin</div>
                </div>
            </div>

            {/* Input area */}
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">
                {error && <div className="text-xs text-[#f14c4c]" data-testid="new-chat-error">{error}</div>}
                <div className="flex flex-row items-center gap-2" data-testid="chat-input-bar">
                    <div className="flex-1 min-w-0">
                        <RichTextInput
                            ref={richTextRef}
                            disabled={sending}
                            placeholder="Send a message..."
                            className={cn(
                                'w-full min-h-[34px] max-h-28 overflow-y-auto rounded border bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 disabled:opacity-60',
                                MODE_BORDER_COLORS['ask'].border,
                                MODE_BORDER_COLORS['ask'].ring,
                            )}
                            onChange={(val) => setInput(val)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void handleSend();
                                }
                            }}
                            data-testid="new-chat-input"
                        />
                    </div>
                    {sending ? (
                        <button
                            type="button"
                            className="shrink-0 h-[34px] px-2 sm:px-3 rounded bg-[#f14c4c] text-white text-sm font-medium hover:bg-[#d93636]"
                            onClick={handleStop}
                            data-testid="new-chat-stop-btn"
                        >
                            Stop
                        </button>
                    ) : (
                        <button
                            type="button"
                            disabled={!input.trim()}
                            className="shrink-0 h-[34px] px-2 sm:px-3 rounded bg-[#0078d4] text-white text-sm font-medium hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => { void handleSend(); }}
                            data-testid="new-chat-send-btn"
                        >
                            Send
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
