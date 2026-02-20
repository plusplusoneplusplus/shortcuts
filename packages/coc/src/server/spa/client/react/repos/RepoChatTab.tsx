/**
 * RepoChatTab — self-contained chat tab for a workspace/repo.
 *
 * Persists the active chatTaskId per workspace in localStorage,
 * creates a type:'chat' queue task on first message, and streams
 * follow-up responses via SSE.
 */

import { useEffect, useRef, useState } from 'react';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { Button, Spinner } from '../shared';
import { ConversationTurnBubble } from '../processes/ConversationTurnBubble';
import type { ClientConversationTurn } from '../types/dashboard';

interface RepoChatTabProps {
    workspaceId: string;
    workspacePath?: string;
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

export function RepoChatTab({ workspaceId, workspacePath }: RepoChatTabProps) {
    const STORAGE_KEY = `coc-chat-task-${workspaceId}`;

    const [chatTaskId, setChatTaskId] = useState<string | null>(null);
    const [task, setTask] = useState<any | null>(null);
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const [loading, setLoading] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);

    const turnsRef = useRef<ClientConversationTurn[]>([]);
    const eventSourceRef = useRef<EventSource | null>(null);

    const processId = task?.processId ?? (chatTaskId ? `queue_${chatTaskId}` : null);

    // --- helpers ---

    const setTurnsAndCache = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => {
        const resolved = typeof next === 'function' ? next(turnsRef.current) : next;
        turnsRef.current = resolved;
        setTurns(resolved);
    };

    const stopStreaming = () => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setIsStreaming(false);
    };

    const removeStreamingPlaceholder = () => {
        setTurnsAndCache(prev => {
            const last = prev[prev.length - 1];
            return last?.role === 'assistant' && last.streaming ? prev.slice(0, -1) : prev;
        });
    };

    const waitForFollowUpCompletion = (pid: string) =>
        new Promise<void>(resolve => {
            const es = new EventSource(`${getApiBase()}/processes/${encodeURIComponent(pid)}/stream`);
            eventSourceRef.current = es;
            setIsStreaming(true);
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                es.close();
                eventSourceRef.current = null;
                setIsStreaming(false);
                fetchApi(`/processes/${encodeURIComponent(pid)}`)
                    .then(data => setTurnsAndCache(getConversationTurns(data)))
                    .catch(() => {})
                    .finally(() => resolve());
            };
            const timeout = setTimeout(finish, 90_000);
            es.addEventListener('done', () => { clearTimeout(timeout); finish(); });
            es.addEventListener('status', (e: Event) => {
                try {
                    const status = JSON.parse((e as MessageEvent).data)?.status;
                    if (status && !['running', 'queued'].includes(status)) { clearTimeout(timeout); finish(); }
                } catch { /* ignore */ }
            });
            es.onerror = () => { clearTimeout(timeout); finish(); };
        });

    // --- mount: restore persisted chat ---

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return;
        setChatTaskId(stored);
        setLoading(true);
        fetchApi(`/queue/${encodeURIComponent(stored)}`)
            .then(data => {
                setTask(data?.task ?? null);
                const pid = data?.task?.processId ?? `queue_${stored}`;
                return fetchApi(`/processes/${encodeURIComponent(pid)}`);
            })
            .then(data => setTurnsAndCache(getConversationTurns(data)))
            .catch((err: any) => {
                if (err?.message?.includes('404') || err?.status === 404) {
                    localStorage.removeItem(STORAGE_KEY);
                    setChatTaskId(null);
                }
            })
            .finally(() => setLoading(false));
    }, [workspaceId]);

    // --- SSE for initial running task ---

    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (!chatTaskId || task?.status !== 'running') return;

        const pid = processId || `queue_${chatTaskId}`;
        const es = new EventSource(`${getApiBase()}/processes/${encodeURIComponent(pid)}/stream`);
        eventSourceRef.current = es;
        setIsStreaming(true);

        const finish = () => {
            es.close();
            eventSourceRef.current = null;
            setIsStreaming(false);
            fetchApi(`/processes/${encodeURIComponent(pid)}`)
                .then(data => setTurnsAndCache(getConversationTurns(data)))
                .catch(() => {});
        };

        es.addEventListener('done', finish);
        es.addEventListener('status', (e: Event) => {
            try {
                const status = JSON.parse((e as MessageEvent).data)?.status;
                if (status && !['running', 'queued'].includes(status)) finish();
            } catch { /* ignore */ }
        });
        es.onerror = finish;

        return () => {
            es.close();
            eventSourceRef.current = null;
        };
    }, [chatTaskId, task?.status]);

    // --- cleanup on unmount ---

    useEffect(() => () => stopStreaming(), []);

    // --- handlers ---

    const handleStartChat = async () => {
        const prompt = inputValue.trim();
        if (!prompt) return;
        setInputValue('');
        setSending(true);
        setError(null);
        try {
            const response = await fetch(`${getApiBase()}/queue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'chat',
                    workspaceId,
                    workingDirectory: workspacePath,
                    prompt,
                    displayName: 'Chat',
                }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error ?? `Failed to create task (${response.status})`);
            }
            const body = await response.json();
            const newTaskId: string = body.task?.id ?? body.id;
            localStorage.setItem(STORAGE_KEY, newTaskId);
            setChatTaskId(newTaskId);
            setTask(body.task ?? null);
            const userTurn: ClientConversationTurn = {
                role: 'user', content: prompt,
                timestamp: new Date().toISOString(), timeline: [],
            };
            const assistantPlaceholder: ClientConversationTurn = {
                role: 'assistant', content: '',
                timestamp: new Date().toISOString(), streaming: true, timeline: [],
            };
            setTurnsAndCache([userTurn, assistantPlaceholder]);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to start chat.');
        } finally {
            setSending(false);
        }
    };

    const sendFollowUp = async () => {
        const content = inputValue.trim();
        if (!content || !processId || sending || sessionExpired) return;
        setInputValue('');
        setSending(true);
        setError(null);

        const timestamp = new Date().toISOString();
        setTurnsAndCache(prev => ([
            ...prev,
            { role: 'user', content, timestamp, timeline: [] },
            { role: 'assistant', content: '', timestamp, streaming: true, timeline: [] },
        ]));

        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
            });
            if (response.status === 410) {
                setSessionExpired(true);
                setError('Session expired. Start a new chat.');
                removeStreamingPlaceholder();
                return;
            }
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                setError(body?.error ?? `Failed to send message (${response.status})`);
                removeStreamingPlaceholder();
                return;
            }
            await waitForFollowUpCompletion(processId);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to send follow-up message.');
            removeStreamingPlaceholder();
        } finally {
            setSending(false);
        }
    };

    const handleNewChat = () => {
        stopStreaming();
        localStorage.removeItem(STORAGE_KEY);
        setChatTaskId(null);
        setTask(null);
        setTurns([]);
        setError(null);
        setSessionExpired(false);
        setInputValue('');
    };

    // --- render ---

    if (!chatTaskId) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
                <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">Chat with this repository</div>
                <textarea
                    className="w-full max-w-md border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                    rows={3}
                    placeholder="Ask anything about this repository…"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleStartChat(); } }}
                />
                {error && <div className="text-xs text-red-500">{error}</div>}
                <Button disabled={!inputValue.trim() || sending} onClick={() => void handleStartChat()}>
                    {sending ? '...' : 'Start Chat'}
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-0 flex-1">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">Chat</span>
                <div className="flex gap-2">
                    {isStreaming && <Button size="sm" variant="secondary" onClick={stopStreaming}>Stop</Button>}
                    <Button size="sm" variant="ghost" onClick={handleNewChat}>New Chat</Button>
                </div>
            </div>

            {/* Conversation area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {loading ? <Spinner /> : turns.map((turn, i) => <ConversationTurnBubble key={i} turn={turn} />)}
            </div>

            {/* Input area */}
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">
                {error && <div className="text-xs text-red-500">{error}</div>}
                <div className="flex items-end gap-2">
                    <textarea
                        rows={1}
                        value={inputValue}
                        disabled={sending || sessionExpired}
                        placeholder={sessionExpired ? 'Session expired. Start a new chat.' : 'Follow up…'}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendFollowUp(); } }}
                        className="flex-1 border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                    />
                    <Button disabled={sending || !inputValue.trim() || sessionExpired} onClick={() => void sendFollowUp()}>
                        {sending ? '...' : 'Send'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
