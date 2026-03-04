/**
 * WikiAsk — AI chat panel with SSE streaming.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Spinner } from '../shared';
import { cn } from '../shared/cn';
import { getApiBase } from '../utils/config';
import { useBreakpoint } from '../hooks/useBreakpoint';

declare const marked: { parse(md: string): string } | undefined;
declare const hljs: { highlightElement(el: Element): void } | undefined;

interface AskMessage {
    role: 'user' | 'assistant' | 'context' | 'error';
    content: string;
}

interface WikiAskProps {
    wikiId: string;
    wikiName: string;
    currentComponentId: string | null;
}

export function WikiAsk({ wikiId, wikiName, currentComponentId }: WikiAskProps) {
    const [messages, setMessages] = useState<AskMessage[]>([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const historyRef = useRef<Array<{ role: string; content: string }>>([]);
    const { isMobile } = useBreakpoint();

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'i' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                setIsExpanded(v => !v);
            }
            if (e.key === 'Escape') {
                setIsExpanded(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    const scrollToBottom = useCallback(() => {
        if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === 'function') {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, []);

    useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

    const handleSend = useCallback(async () => {
        if (streaming || !input.trim()) return;
        const question = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', content: question }]);
        historyRef.current.push({ role: 'user', content: question });
        setStreaming(true);
        setIsExpanded(true); // Expand to show conversation

        const requestBody: any = { question };
        if (sessionId) {
            requestBody.sessionId = sessionId;
        } else {
            requestBody.conversationHistory = historyRef.current.slice(0, -1);
        }
        if (currentComponentId) {
            requestBody.componentId = currentComponentId;
        }

        try {
            const response = await fetch(
                getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/ask',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                }
            );

            if (!response.ok) {
                const err = await response.json().catch(() => ({ error: 'Request failed' }));
                setMessages(prev => [...prev, { role: 'error', content: err.error || 'Request failed' }]);
                setStreaming(false);
                return;
            }

            const reader = response.body!.getReader();
            const done = () => { setStreaming(false); };
            const decoder = new TextDecoder();
            let buffer = '';
            let fullResponse = '';

            // Add placeholder assistant message
            setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

            const processChunk = async (result: ReadableStreamReadResult<Uint8Array>): Promise<void> => {
                if (result.done) {
                    if (buffer.trim() && buffer.trim().startsWith('data: ')) {
                        try {
                            const data = JSON.parse(buffer.trim().slice(6));
                            if (data.type === 'chunk') fullResponse += data.content;
                            else if (data.type === 'done') {
                                fullResponse = data.fullResponse || fullResponse;
                                if (data.sessionId) setSessionId(data.sessionId);
                            }
                        } catch { /* ignore */ }
                    }
                    // Finalize
                    historyRef.current.push({ role: 'assistant', content: fullResponse });
                    setMessages(prev => {
                        const updated = [...prev];
                        if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                            updated[updated.length - 1] = { role: 'assistant', content: fullResponse };
                        }
                        return updated;
                    });
                    done();
                    return;
                }

                buffer += decoder.decode(result.value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(trimmed.slice(6));
                        if (data.type === 'context') {
                            const parts: string[] = [];
                            if (data.componentIds?.length) parts.push(`📦 ${data.componentIds.join(', ')}`);
                            if (data.themeIds?.length) parts.push(`📋 ${data.themeIds.join(', ')}`);
                            if (parts.length) {
                                setMessages(prev => {
                                    // Insert context before the last assistant message
                                    const copy = [...prev];
                                    const lastIdx = copy.length - 1;
                                    if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
                                        copy.splice(lastIdx, 0, { role: 'context', content: 'Context: ' + parts.join(', ') });
                                    }
                                    return copy;
                                });
                            }
                        } else if (data.type === 'chunk') {
                            fullResponse += data.content;
                            setMessages(prev => {
                                const updated = [...prev];
                                if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                                    updated[updated.length - 1] = { role: 'assistant', content: fullResponse };
                                }
                                return updated;
                            });
                        } else if (data.type === 'done') {
                            fullResponse = data.fullResponse || fullResponse;
                            if (data.sessionId) setSessionId(data.sessionId);
                            historyRef.current.push({ role: 'assistant', content: fullResponse });
                            setMessages(prev => {
                                const updated = [...prev];
                                if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                                    updated[updated.length - 1] = { role: 'assistant', content: fullResponse };
                                }
                                return updated;
                            });
                            done();
                            return;
                        } else if (data.type === 'error') {
                            setMessages(prev => [...prev, { role: 'error', content: data.message }]);
                            done();
                            return;
                        }
                    } catch { /* ignore */ }
                }

                return reader.read().then(processChunk);
            };

            await reader.read().then(processChunk);
        } catch (err: any) {
            setMessages(prev => [...prev, { role: 'error', content: err.message || 'Failed to connect' }]);
        } finally {
            setStreaming(false);
        }
    }, [input, streaming, wikiId, sessionId, currentComponentId]);

    const handleClear = useCallback(() => {
        if (sessionId) {
            fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId) + '/ask/session/' + encodeURIComponent(sessionId), { method: 'DELETE' }).catch(() => {});
        }
        setMessages([]);
        setSessionId(null);
        historyRef.current = [];
    }, [sessionId, wikiId]);

    const renderContent = (content: string): string => {
        if (typeof marked !== 'undefined') return marked.parse(content);
        return content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    return (
        <div
            id="wiki-ask-widget"
            className={cn('flex flex-col h-full', isExpanded && 'expanded')}
        >
            {/* Header */}
            <div
                id="wiki-ask-widget-header"
                className={cn(
                    'flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]',
                    !isExpanded && 'hidden'
                )}
            >
                <div className="text-xs text-[#848484]">
                    Ask about {wikiName}
                    {currentComponentId && <span className="ml-1 text-[#0078d4]">• {currentComponentId}</span>}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                        onClick={handleClear}
                    >Clear</button>
                    <button
                        id="wiki-ask-close"
                        className="text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                        onClick={() => setIsExpanded(false)}
                        title="Close"
                    >✕</button>
                </div>
            </div>

            {/* Messages */}
            <div
                className={cn('flex-1 overflow-y-auto p-3 space-y-3', !isExpanded && 'hidden')}
                id="wiki-ask-messages"
            >
                {messages.length === 0 && (
                    <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                        Ask a question about the codebase
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div key={i} className="ask-message">
                        {msg.role === 'user' && (
                            <div className="ask-message-user bg-[#0078d4]/10 rounded-lg px-3 py-2 text-sm text-[#1e1e1e] dark:text-[#cccccc] ml-8">
                                {msg.content}
                            </div>
                        )}
                        {msg.role === 'assistant' && (
                            <div className="ask-message-assistant">
                                <div
                                    className="markdown-body text-sm text-[#1e1e1e] dark:text-[#cccccc]"
                                    dangerouslySetInnerHTML={{ __html: renderContent(msg.content) }}
                                />
                                {streaming && i === messages.length - 1 && !msg.content && (
                                    <div className="flex items-center gap-1 text-xs text-[#848484]">
                                        <Spinner size="sm" /> Thinking…
                                    </div>
                                )}
                            </div>
                        )}
                        {msg.role === 'context' && (
                            <div className="ask-message-context text-[10px] text-[#848484] px-2 py-1 bg-[#f3f3f3] dark:bg-[#1e1e1e] rounded">
                                {msg.content}
                            </div>
                        )}
                        {msg.role === 'error' && (
                            <div className="ask-message-error text-xs text-[#f14c4c] px-2 py-1">
                                Error: {msg.content}
                            </div>
                        )}
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className={cn(
                'flex items-end gap-2 p-3 border-t border-[#e0e0e0] dark:border-[#3c3c3c]',
                isMobile && 'pb-[calc(0.75rem+56px)]'
            )} data-testid="wiki-ask-input-area">
                <textarea
                    className="flex-1 resize-none px-2 py-1.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4] max-h-[120px]"
                    id="wiki-ask-textarea"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onFocus={() => setIsExpanded(true)}
                    onKeyDown={e => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder="Ask a question…"
                    rows={1}
                    disabled={streaming}
                />
                <Button
                    size="sm"
                    disabled={streaming || !input.trim()}
                    onClick={handleSend}
                    id="wiki-ask-widget-send"
                >
                    Send
                </Button>
            </div>
        </div>
    );
}
