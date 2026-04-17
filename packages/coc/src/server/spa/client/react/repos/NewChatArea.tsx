/**
 * NewChatArea — empty-state chat component shown when no task is selected
 * on the Activity tab. Lets the user type a message and start a new conversation.
 */

import { useRef, useState } from 'react';
import { RichTextInput } from '../shared/RichTextInput';
import type { RichTextInputHandle } from '../shared/RichTextInput';
import { PastePreview } from '../shared/PastePreview';
import { cn } from '../shared/cn';
import { MODE_BORDER_COLORS } from './modeConfig';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { useFileAttachments } from '../hooks/useFileAttachments';
import { getApiBase } from '../utils/config';
import { useTextPaste } from '../hooks/useTextPaste';

export interface NewChatAreaProps {
    workspaceId?: string;
    onBack?: () => void;
}

export function NewChatArea({ workspaceId, onBack }: NewChatAreaProps) {
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const richTextRef = useRef<RichTextInputHandle>(null);
    const textPaste = useTextPaste();

    const { dispatch: queueDispatch } = useQueue();
    const { state: appState, dispatch: appDispatch } = useApp();

    async function handleSend() {
        const trimmed = input.trim();
        const hasPaste = !!textPaste.pastedContent;
        if ((!trimmed && !hasPaste) || sending) return;

        // Compose: user input + pasted content (if any)
        const text = hasPaste
            ? (trimmed ? trimmed + '\n\n' + textPaste.pastedContent : textPaste.pastedContent!)
            : trimmed;

        setError(null);
        setSending(true);
        abortControllerRef.current = new AbortController();

        try {
            const ws = appState.workspaces?.find((w: any) => w.id === workspaceId);
            const attachmentPayload = toPayload();
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
                    ...(attachmentPayload.length > 0 ? { attachments: attachmentPayload } : {}),
                }),
            });

            if (!res.ok) {
                const errBody = await res.text();
                throw new Error(errBody || `HTTP ${res.status}`);
            }

            const newTask = await res.json();
            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: newTask.task?.id ?? newTask.id, repoId: workspaceId });
            if (!appState.onboardingProgress?.hasUsedChat) {
                appDispatch({ type: 'UPDATE_ONBOARDING', payload: { hasUsedChat: true } });
            }
            setInput('');
            richTextRef.current?.setValue('');
            textPaste.clearPaste();
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
            {/* Back button — rendered when a back handler is provided (mobile new-chat flow) */}
            {onBack && (
                <div className="flex items-center border-b border-[#e0e0e0] dark:border-[#3c3c3c] px-3 py-2">
                    <button
                        type="button"
                        onClick={onBack}
                        data-testid="new-chat-back-btn"
                        aria-label="Back to list"
                        className="inline-flex items-center gap-1 text-sm text-[#0078d4] hover:text-[#005a9e] dark:text-[#3794ff] dark:hover:text-[#60aeff]"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span className="font-medium">Chats</span>
                    </button>
                </div>
            )}
            {/* Hero area */}
            <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-[#848484]">
                    <div className="text-3xl mb-2">💬</div>
                    <div className="text-sm font-medium mb-1">Start a new conversation</div>
                    <div className="text-xs">Type a message below to begin</div>
                </div>
            </div>

            {/* Input area */}
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 pb-3 space-y-2">
                {error && <div className="text-xs text-[#f14c4c]" data-testid="new-chat-error">{error}</div>}
                {textPaste.charCount > 0 && (
                    <PastePreview
                        charCount={textPaste.charCount}
                        previewLines={textPaste.previewLines}
                        onDismiss={textPaste.clearPaste}
                    />
                )}
                <div className="flex flex-row items-center gap-2" data-testid="chat-input-bar">
                    {/* Hidden file input for the + button */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        data-testid="new-chat-file-input-hidden"
                        onChange={(e) => {
                            if (e.target.files && e.target.files.length > 0) {
                                addFromFileInput(e.target.files);
                            }
                            e.target.value = '';
                        }}
                    />
                    {/* Attach file button */}
                    <button
                        type="button"
                        disabled={sending}
                        onClick={() => fileInputRef.current?.click()}
                        className="shrink-0 h-[34px] w-[34px] flex items-center justify-center rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid="new-chat-attach-file-btn"
                        aria-label="Attach file"
                        title="Attach files"
                    >
                        +
                    </button>
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
                            onPaste={addFromPaste}
                            data-testid="new-chat-input"
                            onPaste={textPaste.addFromPaste}
                        />
                    </div>
                    <button
                        type="button"
                        disabled={sending || (!input.trim() && !textPaste.pastedContent)}
                        className="shrink-0 h-[34px] px-2 sm:px-3 rounded bg-[#0078d4] text-white text-sm font-medium hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() => { void handleSend(); }}
                        data-testid="new-chat-send-btn"
                        title="Send (Enter) · Shift+Enter for newline"
                    >
                        {sending ? '...' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    );
}
