/**
 * ItemConversationPanel — Slide-in panel that shows the full AI conversation
 * for a selected map item and allows the user to continue chatting.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { fetchApi } from '../../hooks/useApi';
import { getApiBase } from '../../utils/config';
import { Badge, Button, Spinner } from '../../shared';
import { ConversationTurnBubble } from '../ConversationTurnBubble';
import { formatDuration, statusIcon, statusLabel } from '../../utils/format';
import type { ClientConversationTurn } from '../../types/dashboard';

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
    const [processData, setProcessData] = useState<any>(null);
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [sending, setSending] = useState(false);
    const [sessionExpired, setSessionExpired] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const eventSourceRef = useRef<EventSource | null>(null);

    // Fetch process data on mount
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        fetchApi(`/processes/${encodeURIComponent(processId)}`)
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

    // Cleanup EventSource on unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
        };
    }, []);

    const waitForFollowUpCompletion = useCallback((pid: string) => {
        return new Promise<void>(resolve => {
            const es = new EventSource(`${getApiBase()}/processes/${encodeURIComponent(pid)}/stream`);
            eventSourceRef.current = es;
            let done = false;

            const finish = () => {
                if (done) return;
                done = true;
                es.close();
                eventSourceRef.current = null;
                // Re-fetch full process to get complete turns
                fetchApi(`/processes/${encodeURIComponent(pid)}`)
                    .then(data => {
                        setProcessData(data);
                        setTurns(getConversationTurns(data));
                    })
                    .catch(() => {})
                    .finally(() => resolve());
            };

            const timeout = setTimeout(finish, 90_000);

            es.addEventListener('done', () => { clearTimeout(timeout); finish(); });
            es.addEventListener('status', (e) => {
                try {
                    const status = JSON.parse(e.data)?.status;
                    if (status && !['running', 'queued'].includes(status)) {
                        clearTimeout(timeout); finish();
                    }
                } catch { /* ignore */ }
            });
            es.addEventListener('conversation-snapshot', (e) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data.turns) setTurns(data.turns);
                } catch { /* ignore */ }
            });
            es.onerror = () => { clearTimeout(timeout); finish(); };
        });
    }, []);

    const sendFollowUp = useCallback(async () => {
        const content = inputValue.trim();
        if (!content || sending) return;

        setInputValue('');
        setSending(true);

        const timestamp = new Date().toISOString();
        // Optimistic UI: append user turn + streaming placeholder
        setTurns(prev => [
            ...prev,
            { role: 'user', content, timestamp, timeline: [] },
            { role: 'assistant', content: '', timestamp, streaming: true, timeline: [] },
        ]);

        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
            });

            if (response.status === 410) {
                setSessionExpired(true);
                // Remove streaming placeholder
                setTurns(prev => prev.filter(t => !t.streaming));
                setSending(false);
                return;
            }

            if (!response.ok) {
                // Mark last assistant turn as error
                setTurns(prev => prev.map((t, i) =>
                    i === prev.length - 1 ? { ...t, content: 'Failed to send message.', streaming: false, isError: true } : t
                ));
                setSending(false);
                return;
            }

            // Subscribe to SSE for streaming response
            await waitForFollowUpCompletion(processId);
        } catch {
            setTurns(prev => prev.map((t, i) =>
                i === prev.length - 1 ? { ...t, content: 'Network error.', streaming: false, isError: true } : t
            ));
        } finally {
            setSending(false);
        }
    }, [inputValue, sending, processId, waitForFollowUpCompletion]);

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
                fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content }),
                }).then(async response => {
                    if (!response.ok) {
                        setTurns(prev => prev.map((t, i) =>
                            i === prev.length - 1 ? { ...t, content: 'Failed to send message.', streaming: false, isError: true } : t
                        ));
                        setSending(false);
                        return;
                    }
                    await waitForFollowUpCompletion(processId);
                    setSending(false);
                }).catch(() => {
                    setTurns(prev => prev.map((t, i) =>
                        i === prev.length - 1 ? { ...t, content: 'Network error.', streaming: false, isError: true } : t
                    ));
                    setSending(false);
                });
            }, 0);
        }
    }, [turns, processId, waitForFollowUpCompletion]);

    const inputDisabled = sending || sessionExpired;
    const proc = processData?.process ?? processData;
    const status = proc?.status ?? 'queued';

    const panelContent = (
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
                            <Badge>{statusIcon(status)} {statusLabel(status)}</Badge>
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
                {turns.map((turn, i) => (
                    <ConversationTurnBubble
                        key={i}
                        turn={turn}
                        onRetry={turn.isError ? handleRetry : undefined}
                    />
                ))}
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
                data-testid="item-conversation-input"
                className="px-4 py-3 border-t flex items-end gap-2"
                style={{ borderColor: isDark ? '#3c3c3c' : '#e0e0e0' }}
            >
                <textarea
                    rows={1}
                    value={inputValue}
                    disabled={inputDisabled}
                    placeholder="Follow up…"
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendFollowUp(); }
                    }}
                    data-testid="item-conversation-textarea"
                    className="w-full border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                />
                <Button disabled={inputDisabled || !inputValue.trim()} onClick={() => void sendFollowUp()} data-testid="item-conversation-send">
                    {sending ? '...' : 'Send'}
                </Button>
            </div>
        </div>
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
