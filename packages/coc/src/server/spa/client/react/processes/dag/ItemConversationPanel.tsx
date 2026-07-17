/**
 * ItemConversationPanel — Slide-in panel that shows the full AI conversation
 * for a selected map item and allows the user to continue chatting.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../api/cocClient';
import { Badge, Button, Spinner, SendButton } from '../../ui';
import { AttachmentPreviews } from '../../ui/AttachmentPreviews';
import { ConversationTurnBubble } from '../../features/chat/conversation/ConversationTurnBubble';
import { WhisperSkillDetailDialogProvider } from '../../features/chat/conversation/tool-calls/WhisperSkillDetailDialog';
import { formatDuration, statusIcon, statusLabel } from '../../utils/format';
import { getProcessWorkspaceId } from '../../utils/workspace';
import { RichTextInput } from '../../shared/RichTextInput';
import type { RichTextInputHandle } from '../../shared/RichTextInput';
import { useFileAttachments } from '../../features/chat/hooks/useFileAttachments';
import type { ClientConversationTurn } from '../../types/dashboard';
import type { DeliveryMode } from '@plusplusoneplusplus/forge';
import { useModifierKey } from '../../hooks/ui/useModifierKey';

export interface ItemConversationPanelProps {
    processId: string;
    onClose: () => void;
    isDark: boolean;
}

function getConversationTurns(data: any): ClientConversationTurn[] {
    const process = data?.process;
    if (process?.conversationTurns && Array.isArray(process.conversationTurns) && process.conversationTurns.length > 0) {
        return process.conversationTurns;
    }
    if (Array.isArray(data?.conversation) && data.conversation.length > 0) {
        return data.conversation;
    }
    if (Array.isArray(data?.turns) && data.turns.length > 0) {
        return data.turns;
    }
    if (process) {
        const synthetic: ClientConversationTurn[] = [];
        const userContent = process.fullPrompt || process.promptPreview;
        if (userContent) {
            synthetic.push({ role: 'user', content: userContent, timestamp: process.startTime || undefined, timeline: [] });
        }
        if (process.result) {
            synthetic.push({ role: 'assistant', content: process.result, timestamp: process.endTime || undefined, timeline: [] });
        }
        return synthetic;
    }
    return [];
}

export function ItemConversationPanel({ processId, onClose, isDark }: ItemConversationPanelProps) {
    const richTextRef = useRef<RichTextInputHandle>(null);
    const inputContainerRef = useRef<HTMLDivElement>(null);
    const modHeld = useModifierKey(inputContainerRef);
    const [processData, setProcessData] = useState<any>(null);
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [sending, setSending] = useState(false);
    const [sessionExpired, setSessionExpired] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const streamRef = useRef<{ close: () => void } | null>(null);
    const { attachments, addFromPaste, removeAttachment, clearAttachments, error: attachmentError, toPayload } = useFileAttachments();

    // Fetch process data on mount
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        getSpaCocClient().processes.get(processId)
            .then(data => {
                if (cancelled) return;
                setProcessData(data);
                setTurns(getConversationTurns(data));
                setLoading(false);
            })
            .catch(err => {
                if (cancelled) return;
                setError(err.message ?? 'Failed to load conversation');
                setLoading(false);
            });

        return () => { cancelled = true; };
    }, [processId]);

    // Auto-scroll to bottom when turns change
    useEffect(() => {
        if (scrollRef.current && typeof scrollRef.current.scrollIntoView === 'function') {
            scrollRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [turns]);

    // Escape key to close (desktop)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    // Click outside to close (desktop)
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        // Use setTimeout to avoid immediate close from the click that opened the panel
        const timer = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 100);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [onClose]);

    // Cleanup active process stream on unmount
    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.close();
                streamRef.current = null;
            }
        };
    }, []);

    const waitForFollowUpCompletion = useCallback((pid: string) => {
        return new Promise<void>(resolve => {
            const client = getSpaCocClient();
            let done = false;
            let timeout: ReturnType<typeof setTimeout>;

            const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                streamRef.current?.close();
                streamRef.current = null;
                // Re-fetch full process to get complete turns
                client.processes.get(pid)
                    .then(data => {
                        setProcessData(data);
                        setTurns(getConversationTurns(data));
                    })
                    .catch(() => {})
                    .finally(() => resolve());
            };

            timeout = setTimeout(finish, 90_000);

            streamRef.current = client.processes.stream(pid, {
                onEvent: () => {},
                onDone: finish,
                onError: finish,
                onTypedEvent: (eventType, data) => {
                    if (eventType === 'status') {
                        const status = typeof data === 'object' && data !== null && 'status' in data
                            ? String((data as { status?: unknown }).status)
                            : '';
                        if (status && !['running', 'queued'].includes(status)) {
                            finish();
                        }
                    } else if (
                        eventType === 'conversation-snapshot'
                        && typeof data === 'object'
                        && data !== null
                        && 'turns' in data
                        && Array.isArray((data as { turns?: unknown }).turns)
                    ) {
                        setTurns((data as { turns: ClientConversationTurn[] }).turns);
                    }
                },
            });
        });
    }, []);

    const sendFollowUp = useCallback(async (deliveryMode: DeliveryMode = 'enqueue') => {
        const content = inputValue.trim();
        const attachmentPayload = toPayload();
        if (!content && attachmentPayload.length === 0) return;

        if (sending) {
            // While a previous send is in-flight, fire-and-forget the new
            // message to the server with the chosen delivery mode and show an
            // optimistic user turn. The server will either inject it
            // immediately (immediate) or queue it for later (enqueue).
            setInputValue('');
            richTextRef.current?.setValue('');
            clearAttachments();
            setTurns(prev => [...prev, { role: 'user', content, timestamp: new Date().toISOString(), timeline: [] }]);
            getSpaCocClient().processes.sendMessage(processId, {
                content,
                deliveryMode,
                ...(attachmentPayload.length > 0 ? { attachments: attachmentPayload } : {}),
            }).catch(() => {});
            return;
        }

        setInputValue('');
        richTextRef.current?.setValue('');
        clearAttachments();
        setSending(true);

        const timestamp = new Date().toISOString();
        // Optimistic UI: append user turn + streaming placeholder
        setTurns(prev => [
            ...prev,
            { role: 'user', content, timestamp, timeline: [] },
            { role: 'assistant', content: '', timestamp, streaming: true, timeline: [] },
        ]);

        try {
            await getSpaCocClient().processes.sendMessage(processId, {
                content,
                deliveryMode,
                ...(attachmentPayload.length > 0 ? { attachments: attachmentPayload } : {}),
            });

            // Subscribe to SSE for streaming response
            await waitForFollowUpCompletion(processId);
        } catch (error) {
            if (error instanceof CocApiError && error.status === 410) {
                setSessionExpired(true);
                // Remove streaming placeholder
                setTurns(prev => prev.filter(t => !t.streaming));
                setSending(false);
                return;
            }
            setTurns(prev => prev.map((t, i) =>
                i === prev.length - 1 ? { ...t, content: error instanceof CocApiError ? 'Failed to send message.' : 'Network error.', streaming: false, isError: true } : t
            ));
        } finally {
            setSending(false);
        }
    }, [inputValue, sending, processId, waitForFollowUpCompletion, toPayload, clearAttachments]);

    const handleRetry = useCallback(() => {
        // Find last user message and re-send
        const lastUserTurn = [...turns].reverse().find(t => t.role === 'user');
        if (lastUserTurn) {
            // Remove the error assistant turn
            setTurns(prev => prev.filter(t => !t.isError));
            setInputValue(lastUserTurn.content);
            // Auto-send after state update
            setTimeout(() => {
                const content = lastUserTurn.content;
                if (!content) return;
                setInputValue('');
                setSending(true);
                const timestamp = new Date().toISOString();
                setTurns(prev => [
                    ...prev,
                    { role: 'assistant', content: '', timestamp, streaming: true, timeline: [] },
                ]);
                getSpaCocClient().processes.sendMessage(processId, { content, deliveryMode: 'enqueue' as DeliveryMode })
                    .then(async () => {
                        await waitForFollowUpCompletion(processId);
                        setSending(false);
                    }).catch((error) => {
                        setTurns(prev => prev.map((t, i) =>
                            i === prev.length - 1 ? { ...t, content: error instanceof CocApiError ? 'Failed to send message.' : 'Network error.', streaming: false, isError: true } : t
                        ));
                        setSending(false);
                    });
            }, 0);
        }
    }, [turns, processId, waitForFollowUpCompletion]);

    const inputDisabled = sessionExpired;
    const proc = processData?.process ?? processData;
    const status = proc?.status ?? 'queued';
    const wsId = getProcessWorkspaceId(proc) ?? undefined;

    const panelContent = (
        <WhisperSkillDetailDialogProvider boundaryRef={panelRef} scopeKey={processId}>
        <div
            ref={panelRef}
            data-testid="item-conversation-panel"
            className="flex flex-col h-full"
            style={{
                backgroundColor: isDark ? '#1e1e1e' : '#ffffff',
                color: isDark ? '#cccccc' : '#1e1e1e',
            }}
        >
            {/* Header */}
            <div
                data-testid="item-conversation-header"
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{ borderColor: isDark ? '#3c3c3c' : '#e0e0e0' }}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {proc && (
                        <>
                            <Badge>{statusIcon(status)} {statusLabel(status, proc?.type)}</Badge>
                            {proc.metadata?.itemIndex != null && (
                                <span className="text-xs text-[#848484]">Item #{proc.metadata.itemIndex}</span>
                            )}
                            {proc.durationMs != null && (
                                <span className="text-xs text-[#848484]">{formatDuration(proc.durationMs)}</span>
                            )}
                        </>
                    )}
                </div>
                <button
                    data-testid="item-conversation-close"
                    onClick={onClose}
                    className="text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg leading-none px-1"
                    aria-label="Close"
                >
                    ✕
                </button>
            </div>

            {/* Input preview */}
            {(proc?.promptPreview || proc?.metadata?.promptPreview) && (
                <div
                    data-testid="item-conversation-input-preview"
                    className="px-4 py-2 text-xs text-[#848484] border-b truncate"
                    style={{ borderColor: isDark ? '#3c3c3c' : '#e0e0e0' }}
                >
                    {proc.promptPreview || proc.metadata.promptPreview}
                </div>
            )}

            {/* Conversation body */}
            <div className="flex-1 overflow-y-auto px-4 py-3" data-testid="item-conversation-body">
                {loading && (
                    <div className="flex items-center justify-center py-8" data-testid="item-conversation-loading">
                        <Spinner />
                    </div>
                )}
                {error && (
                    <div className="text-[#f14c4c] text-sm py-4" data-testid="item-conversation-error">
                        {error}
                    </div>
                )}
                {!loading && !error && turns.length === 0 && (
                    <div className="text-[#848484] text-sm" data-testid="item-conversation-empty">
                        No conversation data available.
                    </div>
                )}
                {turns.map((turn, i) => {
                    const rawProvider = proc?.metadata?.provider;
                    const provider = rawProvider === 'codex' || rawProvider === 'claude' || rawProvider === 'copilot'
                        ? rawProvider
                        : undefined;
                    return (
                        <ConversationTurnBubble
                            key={i}
                            turn={turn}
                            onRetry={turn.isError ? handleRetry : undefined}
                            wsId={wsId}
                            processType={proc?.type}
                            provider={provider}
                        />
                    );
                })}
                <div ref={scrollRef} />
            </div>

            {/* Session expired */}
            {sessionExpired && (
                <div className="px-4 py-2 text-xs text-[#e8912d] border-t" style={{ borderColor: isDark ? '#3c3c3c' : '#e0e0e0' }} data-testid="item-conversation-expired">
                    Session expired. Start a new conversation to continue.
                </div>
            )}

            {/* Chat input */}
            <div
                ref={inputContainerRef}
                data-testid="item-conversation-input"
                className="px-4 py-3 border-t flex flex-col gap-2"
                style={{ borderColor: isDark ? '#3c3c3c' : '#e0e0e0' }}
            >
                {attachmentError && (
                    <div className="text-xs text-[#f14c4c]" data-testid="item-conversation-attachment-error">{attachmentError}</div>
                )}
                <AttachmentPreviews attachments={attachments} onRemove={removeAttachment} />
                <div className="flex items-end gap-2">
                    <RichTextInput
                        ref={richTextRef}
                        placeholder="Follow up…"
                        disabled={inputDisabled}
                        className="w-full min-h-[34px] max-h-28 overflow-y-auto border rounded p-2 text-sm bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                        onChange={(val) => setInputValue(val)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                if (e.ctrlKey || e.metaKey) {
                                    e.preventDefault();
                                    void sendFollowUp('immediate');
                                } else if (!e.shiftKey) {
                                    e.preventDefault();
                                    void sendFollowUp('enqueue');
                                }
                            }
                        }}
                        onPaste={addFromPaste}
                        data-testid="item-conversation-textarea"
                    />
                    <SendButton
                        disabled={inputDisabled || (!inputValue.trim() && attachments.length === 0)}
                        ctrlHeld={modHeld}
                        onSend={(dm) => { void sendFollowUp(dm); }}
                        data-testid="item-conversation-send"
                    />
                </div>
            </div>
        </div>
        </WhisperSkillDetailDialogProvider>
    );

    // Portal rendering for proper z-index stacking
    return createPortal(
        <div
            data-testid="item-conversation-overlay"
            style={{
                position: 'fixed',
                top: 0,
                right: 0,
                bottom: 0,
                width: '400px',
                zIndex: 9500,
                boxShadow: '-2px 0 8px rgba(0,0,0,0.15)',
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            {panelContent}
        </div>,
        document.body,
    );
}
