/**
 * PrChatPanel — AI chat panel for pull request review in the pop-out window.
 *
 * Sends (workspaceId, prId, currentFilePath) as context identifiers.
 * The AI determines what to read — no diff content in the prompt.
 */

import { useState, useRef } from 'react';
import { usePrChatBinding } from '../hooks/usePrChatBinding';
import { ChatDetail } from '../../chat/ChatDetail';
import { ChatPreferencesProvider } from '../../../contexts/ChatPreferencesContext';
import { RichTextInput } from '../../../shared/RichTextInput';
import type { RichTextInputHandle } from '../../../shared/RichTextInput';
import { useFileAttachments } from '../../chat/hooks/useFileAttachments';
import { AttachmentPreviews } from '../../../ui/AttachmentPreviews';

export interface PrChatPanelProps {
    workspaceId: string;
    prId: string;
    /** Currently selected file path in the pop-out (for context). */
    filePath?: string;
    onClose: () => void;
}

export function PrChatPanel({ workspaceId, prId, filePath, onClose }: PrChatPanelProps) {
    const { taskId, loading, error, createChat } = usePrChatBinding({ workspaceId, prId, filePath });
    const [input, setInput] = useState('');
    const richTextRef = useRef<RichTextInputHandle>(null);
    const { attachments, addFromPaste, removeAttachment, clearAttachments, error: attachmentError, toPayload } = useFileAttachments();

    const handleSend = async () => {
        const text = input.trim();
        if (!text && attachments.length === 0) return;
        const attachmentPayload = toPayload();
        setInput('');
        richTextRef.current?.setValue('');
        clearAttachments();
        await createChat(text, attachmentPayload.length > 0 ? attachmentPayload : undefined);
    };

    return (
        <div className="flex flex-col bg-[#f8f8f8] dark:bg-[#1e1e1e] overflow-hidden h-full w-full"
             data-testid="pr-chat-panel">

            {/* Header */}
            {!taskId && (
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">💬 PR Chat</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#e8e8e8] dark:bg-[#333] text-blue-600 dark:text-blue-400">
                            #{prId}
                        </span>
                        {filePath && (
                            <span className="text-[10px] text-[#848484] truncate max-w-[200px]" title={filePath}>
                                · {filePath.split('/').pop()}
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} className="text-xs px-1 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-white"
                            data-testid="pr-chat-close-btn" title="Close">✕</button>
                </div>
            )}

            {/* Loading state */}
            {loading && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-sm text-[#848484]">Loading...</div>
                </div>
            )}

            {/* Error state */}
            {error && !loading && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-sm text-[#f14c4c]">{error}</div>
                </div>
            )}

            {/* Empty state — no chat yet */}
            {!taskId && !loading && !error && (
                <>
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center text-[#848484]">
                            <div className="text-3xl mb-2">💬</div>
                            <div className="text-sm font-medium mb-1">Chat about this PR</div>
                            <div className="text-xs">Ask questions about the changes</div>
                        </div>
                    </div>
                    <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">
                        {attachmentError && (
                            <div className="text-xs text-[#f14c4c]" data-testid="pr-chat-attachment-error">{attachmentError}</div>
                        )}
                        <AttachmentPreviews attachments={attachments} onRemove={removeAttachment} />
                        <div className="flex items-center gap-2">
                            <RichTextInput
                                ref={richTextRef}
                                placeholder="Ask about this PR..."
                                className="flex-1 min-h-[34px] max-h-28 overflow-y-auto rounded border bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm"
                                onChange={setInput}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                                }}
                                onPaste={addFromPaste}
                                data-testid="pr-chat-input"
                            />
                            <button
                                disabled={!input.trim() && attachments.length === 0}
                                onClick={handleSend}
                                className="h-[34px] px-3 rounded bg-[#0078d4] text-white text-sm font-medium hover:bg-[#106ebe] disabled:opacity-50"
                                data-testid="pr-chat-send-btn"
                            >Send</button>
                        </div>
                    </div>
                </>
            )}

            {/* Active chat */}
            {taskId && !loading && (
                <ChatPreferencesProvider workspaceId={workspaceId}>
                    <ChatDetail
                        taskId={taskId}
                        workspaceId={workspaceId}
                        variant="floating"
                        standalone
                        title={`PR Chat · #${prId}`}
                        hideModeSelector
                        onBack={onClose}
                    />
                </ChatPreferencesProvider>
            )}
        </div>
    );
}
