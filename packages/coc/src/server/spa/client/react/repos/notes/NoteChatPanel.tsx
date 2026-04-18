import { useState, useRef } from 'react';
import { useNotesChat } from '../../hooks/useNotesChat';
import { ActivityChatDetail } from '../ActivityChatDetail';
import { ChatPreferencesProvider } from '../../context/ChatPreferencesContext';
import { RichTextInput } from '../../shared/RichTextInput';
import type { RichTextInputHandle } from '../../shared/RichTextInput';

export interface NoteChatPanelProps {
    workspaceId: string;
    /** Currently selected note path — used as context for the initial message */
    notePath: string | null;
    noteTitle?: string;
    onClose: () => void;
    /** Called before creating a new chat to flush pending editor saves. */
    onBeforeSend?: () => Promise<void>;
    /** Called when the server emits a `note-file-edit` SSE event. */
    onNoteFileEdit?: (data: { toolCallId: string; filePath: string; oldStr: string; newStr: string }) => void;
}

export function NoteChatPanel({ workspaceId, notePath, noteTitle, onClose, onBeforeSend, onNoteFileEdit }: NoteChatPanelProps) {
    const { taskId, createChat, resetChat } = useNotesChat({ workspaceId, notePath, noteTitle });
    const [input, setInput] = useState('');
    const richTextRef = useRef<RichTextInputHandle>(null);

    const handleSend = async () => {
        const text = input.trim();
        if (!text) return;

        // Intercept /new and /clear commands
        if (/^\/(new|clear)$/i.test(text)) {
            setInput('');
            richTextRef.current?.setValue('');
            resetChat();
            return;
        }

        setInput('');
        richTextRef.current?.setValue('');
        await onBeforeSend?.();
        await createChat(text);
    };

    return (
        <div className="flex flex-col bg-[#f8f8f8] dark:bg-[#1e1e1e] overflow-hidden h-full w-full"
             data-testid="note-chat-panel">

            {/* Empty state — no chat yet */}
            {!taskId && (
                <>
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">🤖 Notes Chat</span>
                        <button onClick={onClose} className="text-xs px-1 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-white"
                                data-testid="note-chat-close-btn" title="Close">✕</button>
                    </div>
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center text-[#848484]">
                            <div className="text-3xl mb-2">🤖</div>
                            <div className="text-sm font-medium mb-1">Notes Chat</div>
                            <div className="text-xs">Ask about your notes — one chat per workspace</div>
                        </div>
                    </div>
                    <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3">
                        <div className="flex items-center gap-2">
                            <RichTextInput
                                ref={richTextRef}
                                placeholder="Ask about your notes..."
                                className="flex-1 min-h-[34px] max-h-28 overflow-y-auto rounded border bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm"
                                onChange={setInput}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                                }}
                                data-testid="note-chat-input"
                            />
                            <button
                                disabled={!input.trim()}
                                onClick={handleSend}
                                className="h-[34px] px-3 rounded bg-[#0078d4] text-white text-sm font-medium hover:bg-[#106ebe] disabled:opacity-50"
                                data-testid="note-chat-send-btn"
                            >Send</button>
                        </div>
                    </div>
                </>
            )}

            {/* Active chat */}
            {taskId && (
                <ChatPreferencesProvider workspaceId={workspaceId}>
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                        <span className="text-[10px] text-[#848484]">🤖 Notes Chat</span>
                        <button
                            onClick={resetChat}
                            className="text-[10px] px-1.5 py-0.5 rounded text-[#0078d4] hover:bg-[#e8e8e8] dark:hover:bg-[#333]"
                            data-testid="note-chat-new-btn"
                            title="Start a new chat (current chat is kept in history)"
                        >
                            🔄 New Chat
                        </button>
                    </div>
                    <ActivityChatDetail
                        taskId={taskId}
                        workspaceId={workspaceId}
                        variant="floating"
                        standalone
                        title="Notes Chat"
                        hideModeSelector
                        onBack={onClose}
                        onNoteFileEdit={onNoteFileEdit}
                    />
                </ChatPreferencesProvider>
            )}
        </div>
    );
}
