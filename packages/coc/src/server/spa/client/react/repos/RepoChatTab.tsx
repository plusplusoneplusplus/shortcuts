/**
 * RepoChatTab — split-panel chat tab for a workspace/repo.
 *
 * Left sidebar lists past chat sessions (fetched from server history).
 * Right panel shows the active conversation or start-chat screen.
 * Creates a type:'chat' queue task on first message and streams
 * follow-up responses via SSE.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { Button, Spinner, SuggestionChips } from '../shared';
import { ResponsiveSidebar } from '../shared/ResponsiveSidebar';
import { ConversationTurnBubble } from '../processes/ConversationTurnBubble';
import { ConversationMetadataPopover } from '../processes/ConversationMetadataPopover';
import { useImagePaste } from '../hooks/useImagePaste';
import { ImagePreviews } from '../shared/ImagePreviews';
import { ChatSessionSidebar } from '../chat/ChatSessionSidebar';
import { useChatSessions } from '../chat/useChatSessions';
import { useChatReadState } from '../chat/useChatReadState';
import { usePinnedChats } from '../chat/usePinnedChats';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { cn } from '../shared/cn';
import { useQueue } from '../context/QueueContext';
import { usePreferences } from '../hooks/usePreferences';
import { SlashCommandMenu } from './SlashCommandMenu';
import { useSlashCommands } from './useSlashCommands';
import type { SkillItem } from './SlashCommandMenu';
import type { ClientConversationTurn } from '../types/dashboard';

interface RepoChatTabProps {
    workspaceId: string;
    workspacePath?: string;
    initialSessionId?: string | null;
    newChatTrigger?: { count: number; readOnly: boolean; useProjectRoot?: boolean };
    newChatTriggerProcessedRef?: React.MutableRefObject<number>;
}

function getConversationTurns(data: any, task?: any): ClientConversationTurn[] {
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
    // Fallback: construct from task payload when process has no turns
    if (task?.payload?.prompt) {
        return [{ role: 'user', content: task.payload.prompt, timeline: [] }];
    }
    return [];
}

export function RepoChatTab({ workspaceId, workspacePath, initialSessionId, newChatTrigger, newChatTriggerProcessedRef }: RepoChatTabProps) {
    const sessionsHook = useChatSessions(workspaceId);
    const readState = useChatReadState(workspaceId);
    const { pinnedIds, togglePin } = usePinnedChats(workspaceId);
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { model: savedModel, setModel: persistModel } = usePreferences();
    const { isMobile } = useBreakpoint();
    const keyboardHeight = useVisualViewport();
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

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
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [resuming, setResuming] = useState(false);
    const [model, setModel] = useState('');
    const [models, setModels] = useState<string[]>([]);
    const [readOnly, setReadOnly] = useState(false);
    const [useProjectRoot, setUseProjectRoot] = useState(false);
    const [skills, setSkills] = useState<SkillItem[]>([]);

    const initialImagePaste = useImagePaste();
    const followUpImagePaste = useImagePaste();
    const slashCommands = useSlashCommands(skills);

    const turnsRef = useRef<ClientConversationTurn[]>([]);
    const eventSourceRef = useRef<EventSource | null>(null);
    const autoSelectedRef = useRef(false);
    const currentChatTaskIdRef = useRef<string | null>(null);
    const loadSessionCounterRef = useRef(0);
    const conversationContainerRef = useRef<HTMLDivElement>(null);

    const processId = task?.processId ?? (chatTaskId ? `queue_${chatTaskId}` : null);
    const taskFinished = task?.status === 'completed' || task?.status === 'failed';

    // Build a process-like object for ConversationMetadataPopover from the queue task
    const metadataProcess = useMemo(() => {
        if (!task) return null;
        return {
            ...task,
            id: processId ?? task.id,
            metadata: {
                queueTaskId: task.id,
                model: task.config?.model,
                workspaceId,
                ...task.metadata,
            },
        };
    }, [task, processId, workspaceId]);

    // Sync streaming state to QueueContext for badge counts
    const streamingDispatchedRef = useRef(false);
    useEffect(() => {
        if (isStreaming && !streamingDispatchedRef.current) {
            streamingDispatchedRef.current = true;
            queueDispatch({ type: 'CHAT_STREAMING_STARTED', workspaceId });
        } else if (!isStreaming && streamingDispatchedRef.current) {
            streamingDispatchedRef.current = false;
            queueDispatch({ type: 'CHAT_STREAMING_STOPPED', workspaceId });
        }
    }, [isStreaming, workspaceId, queueDispatch]);

    // Cleanup on unmount: decrement if still streaming
    useEffect(() => {
        return () => {
            if (streamingDispatchedRef.current) {
                queueDispatch({ type: 'CHAT_STREAMING_STOPPED', workspaceId });
            }
        };
    }, [workspaceId, queueDispatch]);

    // Scroll to bottom when turns load or update
    useEffect(() => {
        if (!loading && turns.length > 0 && conversationContainerRef.current) {
            conversationContainerRef.current.scrollTop = conversationContainerRef.current.scrollHeight;
        }
    }, [turns, loading]);

    // Fetch available models on mount
    useEffect(() => {
        fetchApi('/queue/models')
            .then((data: any) => {
                if (Array.isArray(data)) setModels(data);
                else if (data?.models && Array.isArray(data.models)) setModels(data.models);
            })
            .catch(() => { /* ignore */ });
    }, []);

    // Fetch available skills when workspaceId changes
    useEffect(() => {
        if (!workspaceId) return;
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/skills`)
            .then((data: any) => {
                if (Array.isArray(data?.skills)) setSkills(data.skills);
            })
            .catch(() => { /* ignore */ });
    }, [workspaceId]);

    // Rehydrate model from saved preferences
    useEffect(() => {
        if (savedModel && !model) setModel(savedModel);
    }, [savedModel]);

    const handleModelChange = useCallback((value: string) => {
        setModel(value);
        persistModel(value);
    }, [persistModel]);

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
                            const turns = getConversationTurns(data);
                            setTurnsAndCache(turns);
                            readState.markRead(ownerChatTaskId, turns.length);
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
            es.addEventListener('suggestions', (event: Event) => {
                try {
                    const data = JSON.parse((event as MessageEvent).data);
                    if (Array.isArray(data.suggestions)) setSuggestions(data.suggestions);
                } catch { /* ignore */ }
            });
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
            // If task is queued and has no processId, show user prompt as placeholder
            if (!loadedTask?.processId && loadedTask?.status === 'queued') {
                const prompt = loadedTask?.payload?.prompt ?? '';
                if (prompt) {
                    setTurnsAndCache([{ role: 'user', content: prompt, timeline: [] }]);
                } else {
                    setTurnsAndCache([]);
                }
                return;
            }
            const pid = loadedTask?.processId ?? `queue_${taskId}`;
            const procData = await fetchApi(`/processes/${encodeURIComponent(pid)}`);
            if (loadSessionCounterRef.current !== loadId) return;
            const loadedTurns = getConversationTurns(procData, loadedTask);
            if (loadedTask?.status === 'running') {
                const lastTurn = loadedTurns[loadedTurns.length - 1];
                if (lastTurn?.role === 'assistant') {
                    setTurnsAndCache(loadedTurns.map((t, i) =>
                        i === loadedTurns.length - 1 ? { ...t, streaming: true } : t
                    ));
                } else {
                    setTurnsAndCache([...loadedTurns, { role: 'assistant', content: '', streaming: true, timeline: [] }]);
                }
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
            .some(t => t.type === 'chat' || t.type === 'readonly-chat');
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
                .then(data => {
                    const turns = getConversationTurns(data);
                    setTurnsAndCache(turns);
                    if (chatTaskId) readState.markRead(chatTaskId, turns.length);
                })
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
        es.addEventListener('suggestions', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (Array.isArray(data.suggestions)) setSuggestions(data.suggestions);
            } catch { /* ignore */ }
        });

        return () => {
            es.close();
            eventSourceRef.current = null;
        };
    }, [chatTaskId, task?.status, processId]);

    // --- poll for queued → running transition ---

    useEffect(() => {
        if (!chatTaskId || task?.status !== 'queued') return;
        const interval = setInterval(async () => {
            try {
                const data = await fetchApi(`/queue/${encodeURIComponent(chatTaskId)}`);
                const t = data?.task;
                if (t && t.status !== 'queued') {
                    setTask(t);
                    if (t.status === 'cancelled') {
                        handleNewChat();
                        sessionsHook.refresh();
                    } else if (t.processId || t.status === 'running') {
                        loadSession(chatTaskId);
                    }
                }
            } catch { /* ignore */ }
        }, 2000);
        return () => clearInterval(interval);
    }, [chatTaskId, task?.status, loadSession]);

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
        setSuggestions([]);
        loadSession(taskId);
        const session = sessionsHook.sessions.find(s => s.id === taskId);
        if (session?.turnCount != null) readState.markRead(taskId, session.turnCount);
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(taskId);
        setMobileSidebarOpen(false);
    }, [isStreaming, loadSession, workspaceId, sessionsHook.sessions, readState]);

    const handleNewChat = useCallback((initialReadOnly = false, initialUseProjectRoot = false) => {
        if (isStreaming) stopStreaming();
        currentChatTaskIdRef.current = null;
        setSelectedTaskId(null);
        setChatTaskId(null);
        setTask(null);
        setTurnsAndCache([]);
        setError(null);
        setSessionExpired(false);
        setSuggestions([]);
        setInputValue('');
        setReadOnly(initialReadOnly);
        setUseProjectRoot(initialUseProjectRoot);
        initialImagePaste.clearImages();
        followUpImagePaste.clearImages();
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat';
    }, [isStreaming, initialImagePaste, followUpImagePaste, workspaceId]);

    // Trigger new chat from external source (e.g. top-bar button)
    const localTriggerRef = useRef(0);
    const prevTriggerRef = newChatTriggerProcessedRef ?? localTriggerRef;
    useEffect(() => {
        if (newChatTrigger && newChatTrigger.count !== prevTriggerRef.current) {
            prevTriggerRef.current = newChatTrigger.count;
            handleNewChat(newChatTrigger.readOnly, newChatTrigger.useProjectRoot ?? false);
        }
    }, [newChatTrigger, handleNewChat]);

    const handleCancelChat = useCallback(async (taskId?: string) => {
        const targetId = taskId ?? chatTaskId;
        if (!targetId) return;
        try {
            const response = await fetch(`${getApiBase()}/queue/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error ?? `Cancel failed (${response.status})`);
            }
            if (targetId === chatTaskId) handleNewChat();
            sessionsHook.refresh();
        } catch (err: any) {
            setError(err?.message ?? 'Failed to cancel chat.');
        }
    }, [chatTaskId, handleNewChat, sessionsHook]);

    const handleStartChat = async () => {
        const raw = inputValue.trim();
        if (!raw) return;
        const { skills: parsedSkills, prompt } = slashCommands.parseAndExtract(raw);
        if (!prompt) return;
        setInputValue('');
        slashCommands.dismissMenu();
        setSending(true);
        setError(null);
        try {
            const response = await fetch(`${getApiBase()}/queue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: readOnly ? 'readonly-chat' : 'chat',
                    workspaceId,
                    workingDirectory: workspacePath,
                    prompt,
                    displayName: 'Chat',
                    images: initialImagePaste.images.length > 0
                        ? initialImagePaste.images
                        : undefined,
                    ...(parsedSkills.length > 0 ? { skillNames: parsedSkills } : {}),
                    ...(model ? { config: { model } } : {}),
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

    const sendFollowUp = async (overrideContent?: string) => {
        const raw = (overrideContent ?? inputValue).trim();
        if (!raw || !processId || sending || sessionExpired) return;
        const { skills: parsedSkills, prompt: cleanedContent } = slashCommands.parseAndExtract(raw);
        const content = cleanedContent || raw;
        setSuggestions([]);
        setInputValue('');
        slashCommands.dismissMenu();
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
                    ...(parsedSkills.length > 0 ? { skillNames: parsedSkills } : {}),
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
            followUpImagePaste.clearImages();
            await waitForFollowUpCompletion(processId);
            sessionsHook.refresh();
        } catch (err: any) {
            setError(err?.message ?? 'Failed to send follow-up message.');
            removeStreamingPlaceholder();
        } finally {
            setSending(false);
        }
    };

    const handleResumeChat = async () => {
        if (!chatTaskId || resuming) return;
        setResuming(true);
        setError(null);
        try {
            const response = await fetch(`${getApiBase()}/queue/${encodeURIComponent(chatTaskId)}/resume-chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error ?? `Resume failed (${response.status})`);
            }
            const body = await response.json();
            if (body.resumed) {
                // Warm path: session is alive again
                setSessionExpired(false);
            } else if (body.newTaskId) {
                // Cold path: navigate to new session
                const newTaskId = body.newTaskId;
                currentChatTaskIdRef.current = newTaskId;
                setSelectedTaskId(newTaskId);
                setChatTaskId(newTaskId);
                setTask(body.task ?? null);
                setSessionExpired(false);
                location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(newTaskId);
                // Load the new session (which will stream the initial response)
                loadSession(newTaskId);
                sessionsHook.refresh();
            }
        } catch (err: any) {
            setError(err?.message ?? 'Failed to resume chat.');
        } finally {
            setResuming(false);
        }
    };

    const handleResumeInTerminal = async () => {
        if (!processId) return;
        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/resume-cli`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error ?? `Resume in terminal failed (${response.status})`);
            }
        } catch (err: any) {
            setError(err?.message ?? 'Failed to resume in terminal.');
        }
    };

    // --- render helpers ---

    const renderStartScreen = () => (
        <div className="flex flex-col items-center justify-center h-full p-8 gap-4">
            {isMobile && (
                <button
                    className="self-start p-1 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] text-[#616161] dark:text-[#999] text-sm"
                    onClick={() => setMobileSidebarOpen(true)}
                    data-testid="chat-mobile-sessions-btn-start"
                    title="Show sessions"
                >
                    ☰ Sessions
                </button>
            )}
            <div className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">Chat with this repository</div>
            <div className="w-full max-w-md relative">
                <textarea
                    className="w-full border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                    rows={3}
                    placeholder="Ask anything… Type / for skills"
                    value={inputValue}
                    onChange={e => {
                        setInputValue(e.target.value);
                        slashCommands.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
                    }}
                    onKeyDown={e => {
                        if (slashCommands.handleKeyDown(e)) {
                            if (e.key === 'Enter' || e.key === 'Tab') {
                                const selected = slashCommands.filteredSkills[slashCommands.highlightIndex];
                                if (selected) slashCommands.selectSkill(selected.name, inputValue, setInputValue);
                            }
                            return;
                        }
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleStartChat(); }
                    }}
                    onPaste={initialImagePaste.addFromPaste}
                />
                <SlashCommandMenu
                    skills={skills}
                    filter={slashCommands.menuFilter}
                    onSelect={name => slashCommands.selectSkill(name, inputValue, setInputValue)}
                    onDismiss={slashCommands.dismissMenu}
                    visible={slashCommands.menuVisible}
                    highlightIndex={slashCommands.highlightIndex}
                />
            </div>
            <ImagePreviews images={initialImagePaste.images} onRemove={initialImagePaste.removeImage} />
            {error && <div className="text-xs text-red-500">{error}</div>}
            {isMobile ? (
                <div className="space-y-2 w-full max-w-md" data-testid="chat-start-controls">
                    <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs text-[#848484] cursor-pointer" data-testid="chat-readonly-toggle">
                            <input
                                type="checkbox"
                                checked={readOnly}
                                onChange={e => setReadOnly(e.target.checked)}
                                className="accent-blue-500"
                            />
                            Read-only
                        </label>
                        <select
                            value={model}
                            onChange={e => handleModelChange(e.target.value)}
                            className="flex-1 px-2 py-1.5 text-sm rounded border bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                            data-testid="chat-model-select"
                        >
                            <option value="">Default</option>
                            {models.map(m => (
                                <option key={m} value={m}>{m}</option>
                            ))}
                        </select>
                    </div>
                    <Button disabled={!inputValue.trim() || sending} onClick={() => void handleStartChat()} className="w-full justify-center">
                        {sending ? '...' : 'Start Chat'}
                    </Button>
                </div>
            ) : (
                <div className="flex items-center gap-2" data-testid="chat-start-controls">
                    <label className="flex items-center gap-1 text-xs text-[#848484] cursor-pointer" data-testid="chat-readonly-toggle">
                        <input
                            type="checkbox"
                            checked={readOnly}
                            onChange={e => setReadOnly(e.target.checked)}
                            className="accent-blue-500"
                        />
                        Read-only
                    </label>
                    <select
                        value={model}
                        onChange={e => handleModelChange(e.target.value)}
                        className="px-2 py-1.5 text-sm rounded border bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                        data-testid="chat-model-select"
                    >
                        <option value="">Default</option>
                        {models.map(m => (
                            <option key={m} value={m}>{m}</option>
                        ))}
                    </select>
                    <Button disabled={!inputValue.trim() || sending} onClick={() => void handleStartChat()}>
                        {sending ? '...' : 'Start Chat'}
                    </Button>
                </div>
            )}
        </div>
    );

    const renderConversation = () => (
        <div className="flex flex-col min-h-0 flex-1" style={isMobile && keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : undefined}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <div className="flex items-center gap-2">
                    {isMobile && (
                        <button
                            className="p-1 rounded hover:bg-[#e0e0e0] dark:hover:bg-[#3c3c3c] text-[#616161] dark:text-[#999]"
                            onClick={() => setMobileSidebarOpen(true)}
                            data-testid="chat-mobile-sessions-btn"
                            title="Show sessions"
                        >
                            ☰
                        </button>
                    )}
                    <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">Chat</span>
                    {task?.type === 'readonly-chat' && (
                        <span
                            className="text-xs px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 whitespace-nowrap"
                            data-testid="chat-readonly-badge"
                            title="This chat session is read-only — the AI will not modify files"
                        >
                            Read-only
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {isStreaming && <Button size="sm" variant="secondary" onClick={stopStreaming}>Stop</Button>}
                    {task?.status === 'queued' && (
                        <Button size="sm" variant="secondary" onClick={() => void handleCancelChat()} data-testid="cancel-chat-header-btn">
                            Cancel
                        </Button>
                    )}
                    {(sessionExpired || taskFinished) && !isStreaming && (
                        <>
                            <Button size="sm" variant="secondary" onClick={() => void handleResumeInTerminal()} disabled={!processId}>
                                Resume in Terminal
                            </Button>
                            <Button size="sm" variant="primary" onClick={() => void handleResumeChat()} disabled={resuming}>
                                {resuming ? '…' : '↻ Resume'}
                            </Button>
                        </>
                    )}
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
                            <ConversationTurnBubble turn={turn} />
                        </div>
                    );
                })}
                {!loading && task?.status === 'queued' && (
                    <div className="flex items-center gap-2 text-sm text-[#848484] py-4">
                        <Spinner /> Waiting to start…
                        <Button size="sm" variant="secondary" onClick={() => void handleCancelChat()} data-testid="cancel-chat-inline-btn">
                            Cancel
                        </Button>
                    </div>
                )}
                {!loading && error && turns.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-sm text-[#848484] gap-2">
                        <span>⚠️ {error}</span>
                        <Button size="sm" variant="secondary" onClick={() => loadSession(chatTaskId!)}>
                            Retry
                        </Button>
                    </div>
                )}
            </div>

            {/* Input area */}
            <div className={cn("border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2", isMobile && "pb-[calc(0.75rem+56px)]")}>
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
                                onSelect={(text) => { setSuggestions([]); void sendFollowUp(text); }}
                                disabled={sending || sessionExpired}
                            />
                        )}
                        <ImagePreviews images={followUpImagePaste.images} onRemove={followUpImagePaste.removeImage} />
                        <div className={isMobile ? "space-y-2" : "flex items-end gap-2 relative"}>
                            <div className={isMobile ? "w-full relative" : "flex-1 relative"}>
                                <textarea
                                    rows={1}
                                    value={inputValue}
                                    disabled={sending}
                                    placeholder="Follow up… Type / for skills"
                                    onChange={e => {
                                        setInputValue(e.target.value);
                                        slashCommands.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
                                        if (suggestions.length > 0) setSuggestions([]);
                                    }}
                                    onKeyDown={e => {
                                        if (slashCommands.handleKeyDown(e)) {
                                            if (e.key === 'Enter' || e.key === 'Tab') {
                                                const selected = slashCommands.filteredSkills[slashCommands.highlightIndex];
                                                if (selected) slashCommands.selectSkill(selected.name, inputValue, setInputValue);
                                            }
                                            return;
                                        }
                                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendFollowUp(); }
                                    }}
                                    onPaste={followUpImagePaste.addFromPaste}
                                    onFocus={isMobile ? e => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) : undefined}
                                    className="w-full border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                                />
                                <SlashCommandMenu
                                    skills={skills}
                                    filter={slashCommands.menuFilter}
                                    onSelect={name => slashCommands.selectSkill(name, inputValue, setInputValue)}
                                    onDismiss={slashCommands.dismissMenu}
                                    visible={slashCommands.menuVisible}
                                    highlightIndex={slashCommands.highlightIndex}
                                />
                            </div>
                            {isMobile ? (
                                <div className="flex items-center justify-between gap-2" data-testid="chat-followup-controls-row">
                                    {(task?.config?.model || task?.metadata?.model) && (
                                        <span
                                            className="text-xs px-2 py-1 rounded bg-[#e8e8e8] dark:bg-[#2d2d2d] text-[#848484] max-w-[40%] truncate"
                                            data-testid="chat-model-badge"
                                            title="Model used for this chat session"
                                        >
                                            {task.config?.model || task.metadata?.model}
                                        </span>
                                    )}
                                    <Button disabled={sending || !inputValue.trim()} onClick={() => void sendFollowUp()} className="ml-auto">
                                        {sending ? '...' : 'Send'}
                                    </Button>
                                </div>
                            ) : (
                                <>
                                    {(task?.config?.model || task?.metadata?.model) && (
                                        <span
                                            className="text-xs px-2 py-1 rounded bg-[#e8e8e8] dark:bg-[#2d2d2d] text-[#848484] whitespace-nowrap"
                                            data-testid="chat-model-badge"
                                            title="Model used for this chat session"
                                        >
                                            {task.config?.model || task.metadata?.model}
                                        </span>
                                    )}
                                    <Button disabled={sending || !inputValue.trim()} onClick={() => void sendFollowUp()}>
                                        {sending ? '...' : 'Send'}
                                    </Button>
                                </>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );

    // --- render ---

    const sidebarContent = (
        <ChatSessionSidebar
            className={isMobile ? 'h-full' : 'w-80 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c]'}
            workspaceId={workspaceId}
            sessions={sessionsHook.sessions}
            activeTaskId={selectedTaskId}
            onSelectSession={handleSelectSession}
            onNewChat={(readOnly, projectRoot) => handleNewChat(readOnly, projectRoot)}
            onCancelSession={(taskId) => void handleCancelChat(taskId)}
            loading={sessionsHook.loading}
            isUnread={readState.isUnread}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
        />
    );

    return (
        <div className="flex h-full overflow-hidden" data-testid="chat-split-panel">
            {/* Left sidebar — ResponsiveSidebar (drawer on mobile, fixed on desktop) */}
            {isMobile ? (
                <ResponsiveSidebar
                    isOpen={mobileSidebarOpen}
                    onClose={() => setMobileSidebarOpen(false)}
                >
                    {sidebarContent}
                </ResponsiveSidebar>
            ) : (
                sidebarContent
            )}
            {/* Right panel — grows to fill */}
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                {!chatTaskId ? renderStartScreen() : renderConversation()}
            </div>
        </div>
    );
}
