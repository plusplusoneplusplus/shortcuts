/**
 * RepoChatTab — split-panel chat tab for a workspace/repo.
 *
 * Left sidebar lists past chat sessions (fetched from server history).
 * Right panel shows the active conversation or start-chat screen.
 * Creates a type:'chat' queue task on first message and streams
 * follow-up responses via SSE.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { Button, Spinner } from '../shared';
import { ConversationTurnBubble } from '../processes/ConversationTurnBubble';
import { useImagePaste } from '../hooks/useImagePaste';
import { ImagePreviews } from '../shared/ImagePreviews';
import { ChatSessionSidebar } from '../chat/ChatSessionSidebar';
import { useChatSessions } from '../chat/useChatSessions';
import { useQueue } from '../context/QueueContext';
import type { ClientConversationTurn } from '../types/dashboard';

interface RepoChatTabProps {
    workspaceId: string;
    workspacePath?: string;
    initialSessionId?: string | null;
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

export function RepoChatTab({ workspaceId, workspacePath, initialSessionId }: RepoChatTabProps) {
    const sessionsHook = useChatSessions(workspaceId);
    const { state: queueState } = useQueue();

    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [chatTaskId, setChatTaskId] = useState<string | null>(null);
    const [task, setTask] = useState<any | null>(null);
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const [loading, setLoading] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);

    const initialImagePaste = useImagePaste();
    const followUpImagePaste = useImagePaste();

    const turnsRef = useRef<ClientConversationTurn[]>([]);
    const eventSourceRef = useRef<EventSource | null>(null);
    const autoSelectedRef = useRef(false);
    const currentChatTaskIdRef = useRef<string | null>(null);
    const loadSessionCounterRef = useRef(0);

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
            const ownerChatTaskId = currentChatTaskIdRef.current;
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
                if (currentChatTaskIdRef.current !== ownerChatTaskId) {
                    resolve();
                    return;
                }
                fetchApi(`/processes/${encodeURIComponent(pid)}`)
                    .then(data => {
                        if (currentChatTaskIdRef.current === ownerChatTaskId) {
                            setTurnsAndCache(getConversationTurns(data));
                        }
                    })
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

    // --- load a session by task ID ---

    const loadSession = useCallback(async (taskId: string) => {
        const loadId = ++loadSessionCounterRef.current;
        setLoading(true);
        setError(null);
        setSessionExpired(false);
        try {
            const queueData = await fetchApi(`/queue/${encodeURIComponent(taskId)}`);
            if (loadSessionCounterRef.current !== loadId) return;
            const loadedTask = queueData?.task ?? null;
            setTask(loadedTask);
            setChatTaskId(taskId);
            const pid = loadedTask?.processId ?? `queue_${taskId}`;
            const procData = await fetchApi(`/processes/${encodeURIComponent(pid)}`);
            if (loadSessionCounterRef.current !== loadId) return;
            const loadedTurns = getConversationTurns(procData);
            if (loadedTask?.status === 'running') {
                setTurnsAndCache([...loadedTurns, { role: 'assistant', content: '', streaming: true, timeline: [] }]);
            } else {
                setTurnsAndCache(loadedTurns);
            }
        } catch (err: any) {
            if (loadSessionCounterRef.current !== loadId) return;
            if (err?.message?.includes('404') || err?.status === 404) {
                setError('Chat session not found');
            } else {
                setError(err?.message ?? 'Failed to load chat');
            }
        } finally {
            if (loadSessionCounterRef.current === loadId) {
                setLoading(false);
            }
        }
    }, []);

    // --- auto-select on mount when sessions load ---

    useEffect(() => {
        if (sessionsHook.loading || autoSelectedRef.current) return;
        // Prefer initialSessionId from deep link
        if (initialSessionId) {
            autoSelectedRef.current = true;
            setSelectedTaskId(initialSessionId);
            loadSession(initialSessionId);
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(initialSessionId);
            return;
        }
        if (sessionsHook.sessions.length === 0) return;
        autoSelectedRef.current = true;
        const running = sessionsHook.sessions.find(s => s.status === 'running');
        const target = running ?? sessionsHook.sessions[0];
        if (target) {
            setSelectedTaskId(target.id);
            loadSession(target.id);
        }
    }, [sessionsHook.loading, sessionsHook.sessions, loadSession, initialSessionId, workspaceId]);

    // Reset auto-select when workspace changes
    useEffect(() => {
        autoSelectedRef.current = false;
        setSelectedTaskId(null);
        setChatTaskId(null);
        setTask(null);
        setTurnsAndCache([]);
        setError(null);
        setSessionExpired(false);
    }, [workspaceId]);

    // Refresh session list when per-repo queue state changes via WebSocket.
    // Skip refresh while streaming so optimistic status updates are not overwritten.
    // Use a serialized key (item counts) to avoid re-running on every object reference change.
    const repoQueue = queueState.repoQueueMap[workspaceId];
    const repoQueueKey = repoQueue
        ? `${repoQueue.running?.length ?? 0}-${repoQueue.queued?.length ?? 0}-${repoQueue.history?.length ?? 0}`
        : '';
    useEffect(() => {
        if (!repoQueue || eventSourceRef.current) return;
        const hasChatTask = [...(repoQueue.running ?? []), ...(repoQueue.queued ?? []), ...(repoQueue.history ?? [])]
            .some(t => t.type === 'chat');
        if (hasChatTask) sessionsHook.refresh();
    }, [repoQueueKey]);

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
    }, [chatTaskId, task?.status, processId]);

    // --- cleanup on unmount ---

    useEffect(() => () => stopStreaming(), []);

    // --- handlers ---

    const handleSelectSession = useCallback((taskId: string) => {
        if (isStreaming) stopStreaming();
        currentChatTaskIdRef.current = taskId;
        setSelectedTaskId(taskId);
        setTurnsAndCache([]);
        setError(null);
        setSessionExpired(false);
        loadSession(taskId);
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(taskId);
    }, [isStreaming, loadSession, workspaceId]);

    const handleNewChat = useCallback(() => {
        if (isStreaming) stopStreaming();
        currentChatTaskIdRef.current = null;
        setSelectedTaskId(null);
        setChatTaskId(null);
        setTask(null);
        setTurnsAndCache([]);
        setError(null);
        setSessionExpired(false);
        setInputValue('');
        initialImagePaste.clearImages();
        followUpImagePaste.clearImages();
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat';
    }, [isStreaming, initialImagePaste, followUpImagePaste, workspaceId]);

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
                    images: initialImagePaste.images.length > 0
                        ? initialImagePaste.images
                        : undefined,
                }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error ?? `Failed to create task (${response.status})`);
            }
            const body = await response.json();
            const newTaskId: string = body.task?.id ?? body.id;
            currentChatTaskIdRef.current = newTaskId;
            setSelectedTaskId(newTaskId);
            setChatTaskId(newTaskId);
            setTask(body.task ?? null);
            location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(newTaskId);
            const sentImages = initialImagePaste.images.length > 0
                ? [...initialImagePaste.images]
                : undefined;
            const userTurn: ClientConversationTurn = {
                role: 'user', content: prompt,
                timestamp: new Date().toISOString(), timeline: [],
                images: sentImages,
            };
            const assistantPlaceholder: ClientConversationTurn = {
                role: 'assistant', content: '',
                timestamp: new Date().toISOString(), streaming: true, timeline: [],
            };
            setTurnsAndCache([userTurn, assistantPlaceholder]);
            initialImagePaste.clearImages();
            sessionsHook.prependSession({
                id: newTaskId,
                processId: body.task?.processId,
                status: body.task?.status ?? 'queued',
                createdAt: new Date().toISOString(),
                firstMessage: prompt,
            });
            sessionsHook.refresh();
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
        const sentFollowUpImages = followUpImagePaste.images.length > 0
            ? [...followUpImagePaste.images]
            : undefined;
        setTurnsAndCache(prev => ([
            ...prev,
            { role: 'user', content, timestamp, timeline: [], images: sentFollowUpImages },
            { role: 'assistant', content: '', timestamp, streaming: true, timeline: [] },
        ]));

        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    images: followUpImagePaste.images.length > 0
                        ? followUpImagePaste.images
                        : undefined,
                }),
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
            if (chatTaskId) sessionsHook.updateSessionStatus(chatTaskId, 'running');
            await waitForFollowUpCompletion(processId);
            sessionsHook.refresh();
            followUpImagePaste.clearImages();
        } catch (err: any) {
            setError(err?.message ?? 'Failed to send follow-up message.');
            removeStreamingPlaceholder();
        } finally {
            setSending(false);
        }
    };

    // --- render helpers ---

    const renderStartScreen = () => (
        <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
            <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">Chat with this repository</div>
            <textarea
                className="w-full max-w-md border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                rows={3}
                placeholder="Ask anything about this repository…"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleStartChat(); } }}
                onPaste={initialImagePaste.addFromPaste}
            />
            <ImagePreviews images={initialImagePaste.images} onRemove={initialImagePaste.removeImage} />
            {error && <div className="text-xs text-red-500">{error}</div>}
            <Button disabled={!inputValue.trim() || sending} onClick={() => void handleStartChat()}>
                {sending ? '...' : 'Start Chat'}
            </Button>
        </div>
    );

    const renderConversation = () => (
        <div className="flex flex-col min-h-0 flex-1">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">Chat</span>
                <div className="flex gap-2">
                    {isStreaming && <Button size="sm" variant="secondary" onClick={stopStreaming}>Stop</Button>}
                </div>
            </div>

            {/* Conversation area */}
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {loading ? <Spinner /> : turns.map((turn, i) => <ConversationTurnBubble key={i} turn={turn} />)}
            </div>

            {/* Input area */}
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">
                {error && <div className="text-xs text-red-500">{error}</div>}
                <ImagePreviews images={followUpImagePaste.images} onRemove={followUpImagePaste.removeImage} />
                <div className="flex items-end gap-2">
                    <textarea
                        rows={1}
                        value={inputValue}
                        disabled={sending || sessionExpired}
                        placeholder={sessionExpired ? 'Session expired. Start a new chat.' : 'Follow up…'}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendFollowUp(); } }}
                        onPaste={followUpImagePaste.addFromPaste}
                        className="flex-1 border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                    />
                    <Button disabled={sending || !inputValue.trim() || sessionExpired} onClick={() => void sendFollowUp()}>
                        {sending ? '...' : 'Send'}
                    </Button>
                </div>
            </div>
        </div>
    );

    // --- render ---

    return (
        <div className="flex h-full overflow-hidden" data-testid="chat-split-panel">
            {/* Left sidebar — fixed width */}
            <ChatSessionSidebar
                className="w-80 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c]"
                workspaceId={workspaceId}
                sessions={sessionsHook.sessions}
                activeTaskId={selectedTaskId}
                onSelectSession={handleSelectSession}
                onNewChat={handleNewChat}
                loading={sessionsHook.loading}
            />
            {/* Right panel — grows to fill */}
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                {!chatTaskId ? renderStartScreen() : renderConversation()}
            </div>
        </div>
    );
}
