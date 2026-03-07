import { useRef, useState } from 'react';
import { Button, Spinner, SuggestionChips } from '../shared';
import { ConversationTurnBubble } from '../processes/ConversationTurnBubble';
import { ConversationMetadataPopover } from '../processes/ConversationMetadataPopover';
import { ImagePreviews } from '../shared/ImagePreviews';
import { SlashCommandMenu } from '../repos/SlashCommandMenu';
import { cn } from '../shared/cn';
import { copyToClipboard, formatConversationAsText } from '../utils/format';
import type { ClientConversationTurn } from '../types/dashboard';
import type { SkillItem } from '../repos/SlashCommandMenu';

export interface ChatConversationPaneProps {
    isMobile: boolean;
    keyboardHeight: number;
    turns: ClientConversationTurn[];
    loading: boolean;
    task: any;
    isStreaming: boolean;
    sending: boolean;
    sessionExpired: boolean;
    error: string | null;
    inputValue: string;
    suggestions: string[];
    readOnly: boolean;
    resuming: boolean;
    metadataProcess: any;
    processId: string | null;
    chatTaskId: string | null;
    inputDisabled: boolean;
    taskFinished: boolean;

    onInputChange: (value: string, selectionStart: number) => void;
    onSetInputValue: (value: string) => void;
    onStopStreaming: () => void;
    onCancelChat: () => void;
    onResumeChat: () => void;
    onResumeInTerminal: () => void;
    onSendFollowUp: () => void;
    onRetryLastMessage: () => void;
    onLoadSession: (taskId: string) => void;
    onMobileBack?: () => void;

    followUpImages: string[];
    onRemoveFollowUpImage: (index: number) => void;
    onFollowUpPaste: (e: React.ClipboardEvent) => void;

    skills: SkillItem[];
    slashCommands: {
        menuFilter: string;
        menuVisible: boolean;
        highlightIndex: number;
        filteredSkills: SkillItem[];
        handleKeyDown: (e: React.KeyboardEvent) => boolean;
        selectSkill: (name: string, currentInput: string, setInput: (v: string) => void) => void;
        dismissMenu: () => void;
    };

    conversationContainerRef: React.RefObject<HTMLDivElement | null>;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function ChatConversationPane({
    isMobile,
    keyboardHeight,
    turns,
    loading,
    task,
    isStreaming,
    sending,
    sessionExpired,
    error,
    inputValue,
    suggestions,
    readOnly,
    resuming,
    metadataProcess,
    processId,
    chatTaskId,
    inputDisabled,
    taskFinished,
    onInputChange,
    onSetInputValue,
    onStopStreaming,
    onCancelChat,
    onResumeChat,
    onResumeInTerminal,
    onSendFollowUp,
    onRetryLastMessage,
    onLoadSession,
    onMobileBack,
    followUpImages,
    onRemoveFollowUpImage,
    onFollowUpPaste,
    skills,
    slashCommands,
    conversationContainerRef,
    textareaRef,
}: ChatConversationPaneProps) {
    const [copied, setCopied] = useState(false);

    return (
        <div className="flex flex-col min-h-0 flex-1" style={isMobile && keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : undefined}>
            {/* Header */}
            <div className={cn(
                "px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]",
                isMobile ? "flex flex-col gap-1.5" : "flex items-center justify-between"
            )} data-testid="chat-conversation-header">
                <div className="flex items-center gap-2">
                    {isMobile && onMobileBack && (
                        <button
                            className="text-sm text-[#0078d4] hover:text-[#005a9e] dark:text-[#3794ff] dark:hover:text-[#60aeff] mr-1"
                            onClick={onMobileBack}
                            data-testid="chat-detail-back-btn"
                        >
                            ← Back
                        </button>
                    )}
                    <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">Chat</span>
                    {(task?.payload as any)?.readonly && (
                        <span
                            className="text-xs px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 whitespace-nowrap"
                            data-testid="chat-readonly-badge"
                            title="This chat session is read-only — the AI will not modify files"
                        >
                            Read-only
                        </span>
                    )}
                </div>
                <div className={cn("flex items-center gap-2", isMobile && "flex-wrap")}>
                    {isStreaming && <Button size="sm" variant="secondary" onClick={onStopStreaming}>Stop</Button>}
                    {task?.status === 'queued' && (
                        <Button size="sm" variant="secondary" onClick={() => void onCancelChat()} data-testid="cancel-chat-header-btn">
                            Cancel
                        </Button>
                    )}
                    {(sessionExpired || taskFinished) && !isStreaming && (
                        <>
                            <Button size="sm" variant="secondary" className="hidden sm:inline-flex" onClick={() => void onResumeInTerminal()} disabled={!processId}>
                                Resume in Terminal
                            </Button>
                            <Button size="sm" variant="primary" onClick={() => void onResumeChat()} disabled={resuming}>
                                {resuming ? '…' : '↻ Resume'}
                            </Button>
                        </>
                    )}
                    {(task?.config?.model || task?.metadata?.model) && (
                        <span
                            className={cn(
                                "text-xs px-2 py-1 rounded bg-[#e8e8e8] dark:bg-[#2d2d2d] text-[#848484]",
                                isMobile ? "truncate max-w-[160px]" : "whitespace-nowrap"
                            )}
                            data-testid="chat-model-badge"
                            title={task.config?.model || task.metadata?.model}
                        >
                            {task.config?.model || task.metadata?.model}
                        </span>
                    )}
                    <button
                        title="Copy conversation"
                        data-testid="copy-conversation-btn"
                        disabled={isStreaming || turns.length === 0}
                        onClick={() => {
                            void copyToClipboard(formatConversationAsText(turns)).then(() => {
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            });
                        }}
                        className="p-1 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    >
                        {copied ? (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path d="M2 8L6 12L14 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <rect x="4" y="4" width="9" height="11" rx="1" stroke="currentColor" strokeWidth="1.5"/>
                                <path d="M4 4V3a1 1 0 011-1h6a1 1 0 011 1v1" stroke="currentColor" strokeWidth="1.5"/>
                                <path d="M3 2h7a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.5"/>
                            </svg>
                        )}
                    </button>
                    {metadataProcess && <ConversationMetadataPopover process={metadataProcess} turnsCount={turns.length} />}
                </div>
            </div>

            {/* Conversation area */}
            <div ref={conversationContainerRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {loading ? <Spinner /> : turns.map((turn, i) => {
                    const prevTurn = i > 0 ? turns[i - 1] : null;
                    const showSeparator = prevTurn?.historical && !turn.historical;
                    return (
                        <div key={i}>
                            {showSeparator && (
                                <div className="flex items-center gap-2 py-2 text-xs text-[#848484]">
                                    <div className="flex-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" />
                                    <span>Resumed from previous session</span>
                                    <div className="flex-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" />
                                </div>
                            )}
                            <ConversationTurnBubble
                                turn={turn}
                                onRetry={
                                    !readOnly && turn.isError && turn.role === 'assistant' && !sending
                                        ? onRetryLastMessage
                                        : undefined
                                }
                            />
                        </div>
                    );
                })}
                {!loading && task?.status === 'queued' && (
                    <div className="flex items-center gap-2 text-sm text-[#848484] py-4">
                        <Spinner /> Waiting to start…
                        <Button size="sm" variant="secondary" onClick={() => void onCancelChat()} data-testid="cancel-chat-inline-btn">
                            Cancel
                        </Button>
                    </div>
                )}
                {!loading && error && turns.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-sm text-[#848484] gap-2">
                        <span>⚠️ {error}</span>
                        <Button size="sm" variant="secondary" onClick={() => onLoadSession(chatTaskId!)}>
                            Retry
                        </Button>
                    </div>
                )}
            </div>

            {/* Input area */}
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">
                {error && <div className="text-xs text-red-500">{error}</div>}
                {sessionExpired ? (
                    <div className="flex items-center justify-center gap-2 py-2 text-sm text-[#848484]">
                        Session expired — use header buttons to resume.
                    </div>
                ) : (
                    <>
                        {suggestions.length > 0 && !isStreaming && (
                            <SuggestionChips
                                suggestions={suggestions}
                                onSelect={(text) => {
                                        onSetInputValue(inputValue ? `${inputValue} ${text}` : text);
                                        textareaRef.current?.focus();
                                    }}
                                disabled={inputDisabled || sessionExpired}
                            />
                        )}
                        <ImagePreviews images={followUpImages} onRemove={onRemoveFollowUpImage} />
                        <div className="flex items-center gap-2 relative">
                            <div className="flex-1 relative">
                                <textarea
                                    ref={textareaRef}
                                    rows={1}
                                    value={inputValue}
                                    disabled={inputDisabled}
                                    placeholder="Follow up… Type / for skills"
                                    onChange={e => {
                                        onInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
                                    }}
                                    onKeyDown={e => {
                                        if (slashCommands.handleKeyDown(e)) {
                                            if (e.key === 'Enter' || e.key === 'Tab') {
                                                const selected = slashCommands.filteredSkills[slashCommands.highlightIndex];
                                                if (selected) slashCommands.selectSkill(selected.name, inputValue, onSetInputValue);
                                            }
                                            return;
                                        }
                                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void onSendFollowUp(); }
                                    }}
                                    onPaste={onFollowUpPaste}
                                    onFocus={isMobile ? e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) : undefined}
                                    className="w-full border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                                />
                                <SlashCommandMenu
                                    skills={skills}
                                    filter={slashCommands.menuFilter}
                                    onSelect={name => slashCommands.selectSkill(name, inputValue, onSetInputValue)}
                                    onDismiss={slashCommands.dismissMenu}
                                    visible={slashCommands.menuVisible}
                                    highlightIndex={slashCommands.highlightIndex}
                                />
                            </div>
                            <Button disabled={inputDisabled || !inputValue.trim()} onClick={() => void onSendFollowUp()}>
                                {sending ? '...' : 'Send'}
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
