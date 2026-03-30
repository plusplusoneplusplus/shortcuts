/**
 * NewChatArea — empty-state chat component shown when no task is selected
 * on the Activity tab. Lets the user type a message and start a new conversation.
 */

import { useRef, useState } from 'react';
import { RichTextInput } from '../shared/RichTextInput';
import type { RichTextInputHandle } from '../shared/RichTextInput';
import { cn } from '../shared/cn';
import { MODE_BORDER_COLORS, cycleMode } from './modeConfig';
import type { ChatMode } from './modeConfig';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { getApiBase } from '../utils/config';

export interface NewChatAreaProps {
    workspaceId?: string;
}

export function NewChatArea({ workspaceId }: NewChatAreaProps) {
    const [input, setInput] = useState('');
    const [selectedMode, setSelectedMode] = useState<ChatMode>('autopilot');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const richTextRef = useRef<RichTextInputHandle>(null);

    const { dispatch: queueDispatch } = useQueue();
    const { state: appState } = useApp();

    async function handleSend() {
        const text = input.trim();
        if (!text || sending) return;

        setError(null);
        setSending(true);

        try {
            const ws = appState.workspaces?.find((w: any) => w.id === workspaceId);
            const res = await fetch(getApiBase() + '/queue/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'chat',
                    priority: 'normal',
                    payload: {
                        kind: 'chat',
                        mode: selectedMode,
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
            setError(err.message || 'Failed to create task');
        } finally {
            setSending(false);
        }
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
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="shrink-0" data-testid="mode-selector">
                        <select
                            value={selectedMode}
                            onChange={e => setSelectedMode(e.target.value as ChatMode)}
                            className="px-2.5 py-1.5 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 cursor-pointer"
                            data-testid="new-chat-mode-dropdown"
                        >
                            {([['ask', '💡 Ask'], ['plan', '📋 Plan'], ['autopilot', '🤖 Autopilot']] as const).map(([mode, label]) => (
                                <option key={mode} value={mode}>{label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex-1 w-full sm:w-auto">
                        <RichTextInput
                            ref={richTextRef}
                            disabled={sending}
                            placeholder="Send a message..."
                            className={cn(
                                'w-full min-h-[34px] max-h-28 overflow-y-auto rounded border bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 disabled:opacity-60',
                                MODE_BORDER_COLORS[selectedMode].border,
                                MODE_BORDER_COLORS[selectedMode].ring,
                            )}
                            onChange={(val) => setInput(val)}
                            onKeyDown={(e) => {
                                if (e.key === 'Tab' && e.shiftKey) {
                                    e.preventDefault();
                                    setSelectedMode(cycleMode(selectedMode));
                                    return;
                                }
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    void handleSend();
                                }
                            }}
                            data-testid="new-chat-input"
                        />
                    </div>
                    <button
                        type="button"
                        disabled={sending || !input.trim()}
                        className="w-full sm:w-auto h-[34px] px-3 rounded bg-[#0078d4] text-white text-sm font-medium hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => { void handleSend(); }}
                        data-testid="new-chat-send-btn"
                    >
                        {sending ? '...' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    );
}
