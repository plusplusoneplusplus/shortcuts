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
import { ConversationTurnBubble } from '../processes/ConversationTurnBubble';
import { ConversationMetadataPopover } from '../processes/ConversationMetadataPopover';
import { useImagePaste } from '../hooks/useImagePaste';
import { ImagePreviews } from '../shared/ImagePreviews';
import { ChatSessionSidebar } from '../chat/ChatSessionSidebar';
import { useChatSessions } from '../chat/useChatSessions';
import { useChatReadState } from '../chat/useChatReadState';
import { usePinnedChats } from '../chat/usePinnedChats';
import { useArchivedChats } from '../chat/useArchivedChats';
import { getConversationTurns } from '../chat/chatConversationUtils';
import { ChatStartPane } from '../chat/ChatStartPane';
import { ChatConversationPane } from '../chat/ChatConversationPane';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { cn } from '../shared/cn';
import { useQueue } from '../context/QueueContext';
import { usePreferences } from '../hooks/usePreferences';
import { SlashCommandMenu } from './SlashCommandMenu';
import { useSlashCommands } from './useSlashCommands';
import type { SkillItem } from './SlashCommandMenu';
import type { ClientConversationTurn } from '../types/dashboard';
import { copyToClipboard, formatConversationAsText } from '../utils/format';

interface RepoChatTabProps {
    workspaceId: string;
    workspacePath?: string;
    initialSessionId?: string | null;
    newChatTrigger?: { count: number; readOnly: boolean };
    newChatTriggerProcessedRef?: React.MutableRefObject<number>;
    /** When provided, sidebar "New Chat" opens the floating dialog instead of inline start screen. */
    onOpenNewChatDialog?: (readOnly: boolean) => void;
}

export function RepoChatTab({ workspaceId, workspacePath, initialSessionId, newChatTrigger, newChatTriggerProcessedRef, onOpenNewChatDialog }: RepoChatTabProps) {
    const sessionsHook = useChatSessions(workspaceId);
    const readState = useChatReadState(workspaceId);
    const { pinnedIds, isPinned, togglePin } = usePinnedChats(workspaceId);
    const { archiveSet, toggleArchive } = useArchivedChats(workspaceId, togglePin, isPinned);
    const [showArchived, setShowArchived] = useState(false);
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { model: savedModel, setModel: persistModel } = usePreferences(workspaceId);
    const { isMobile } = useBreakpoint();
    const keyboardHeight = useVisualViewport();
    const [mobileShowDetail, setMobileShowDetail] = useState(false);

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
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const inputDrafts = useRef<Map<string | null, string>>(new Map());

    const processId = task?.processId ?? (chatTaskId ? `queue_${chatTaskId}` : null);
    const taskFinished =
        task?.status === 'completed' || task?.status === 'failed' || task?.status === 'cancelled';
    const inputDisabled = sending || isStreaming || task?.status === 'queued';

    // Safety net: reset streaming/sending state whenever the task reaches a terminal status.
    // This handles cases where the SSE connection closes before the final status event fires.
    useEffect(() => {
        if (taskFinished) {
            setIsStreaming(false);
            setSending(false);
        }
    }, [taskFinished]);

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

    const markLastTurnAsError = (errorMessage?: string) => {
        setTurnsAndCache(prev => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last.streaming) {
                return [
                    ...prev.slice(0, -1),
                    { ...last, streaming: false, isError: true, content: errorMessage || last.content || '' }
                ];
            }
            return prev;
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
            if (isMobile) setMobileShowDetail(true);
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
        setMobileShowDetail(false);
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
            .some(t => t.type === 'chat' && (!t.workspaceId || t.workspaceId === workspaceId));
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
            setIsStreaming(false);
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
        setInputValue(inputDrafts.current.get(taskId) ?? '');
        slashCommands.dismissMenu();
        loadSession(taskId);
        const session = sessionsHook.sessions.find(s => s.id === taskId);
        if (session?.turnCount != null) readState.markRead(taskId, session.turnCount);
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat/' + encodeURIComponent(taskId);
        if (isMobile) setMobileShowDetail(true);
    }, [isStreaming, loadSession, workspaceId, sessionsHook.sessions, readState, isMobile]);

    const handleNewChat = useCallback((initialReadOnly = false) => {
        if (isStreaming) stopStreaming();
        autoSelectedRef.current = true;
        currentChatTaskIdRef.current = null;
        setSelectedTaskId(null);
        setChatTaskId(null);
        setTask(null);
        setTurnsAndCache([]);
        setError(null);
        setSessionExpired(false);
        setSuggestions([]);
        setInputValue('');
        inputDrafts.current.delete(null);
        slashCommands.dismissMenu();
        setReadOnly(initialReadOnly);
        initialImagePaste.clearImages();
        followUpImagePaste.clearImages();
        if (isMobile) setMobileShowDetail(true);
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/chat';
    }, [isStreaming, initialImagePaste, followUpImagePaste, workspaceId, isMobile]);

    // Trigger new chat from external source (e.g. top-bar button)
    const localTriggerRef = useRef(0);
    const prevTriggerRef = newChatTriggerProcessedRef ?? localTriggerRef;
    useEffect(() => {
        if (newChatTrigger && newChatTrigger.count !== prevTriggerRef.current) {
            prevTriggerRef.current = newChatTrigger.count;
            handleNewChat(newChatTrigger.readOnly);
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
        inputDrafts.current.delete(selectedTaskId ?? null);
        slashCommands.dismissMenu();
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
                    payload: { readonly: readOnly },
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
                ...(parsedSkills.length > 0 ? { skillNames: parsedSkills } : {}),
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
            setTimeout(() => sessionsHook.refresh(), 5000);
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
        inputDrafts.current.delete(selectedTaskId ?? null);
        slashCommands.dismissMenu();
        setSending(true);
        setError(null);

        const timestamp = new Date().toISOString();
        const sentFollowUpImages = followUpImagePaste.images.length > 0
            ? [...followUpImagePaste.images]
            : undefined;
        setTurnsAndCache(prev => ([
            ...prev,
            { role: 'user', content, timestamp, timeline: [], images: sentFollowUpImages, ...(parsedSkills.length > 0 ? { skillNames: parsedSkills } : {}) },
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
                markLastTurnAsError(body?.error ?? `Failed to send message (${response.status})`);
                return;
            }
            if (chatTaskId) sessionsHook.updateSessionStatus(chatTaskId, 'running');
            followUpImagePaste.clearImages();
            await waitForFollowUpCompletion(processId);
            sessionsHook.refresh();
        } catch (err: any) {
            markLastTurnAsError(err?.message ?? 'Failed to send follow-up message.');
        } finally {
            setSending(false);
        }
    };

    const retryLastMessage = useCallback(async () => {
        let lastUserContent: string | undefined;
        for (let i = turnsRef.current.length - 1; i >= 0; i--) {
            if (turnsRef.current[i].role === 'user') {
                lastUserContent = turnsRef.current[i].content;
                break;
            }
        }
        if (!lastUserContent || !processId || sending || sessionExpired) return;

        setSending(true);
        setError(null);
        const timestamp = new Date().toISOString();
        // Replace error bubble with a fresh streaming placeholder
        setTurnsAndCache(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last.isError) {
                return [...prev.slice(0, -1), { role: 'assistant' as const, content: '', timestamp, streaming: true, timeline: [] }];
            }
            return prev;
        });

        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: lastUserContent }),
            });
            if (response.status === 410) {
                setSessionExpired(true);
                setError('Session expired. Start a new chat.');
                removeStreamingPlaceholder();
                return;
            }
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                markLastTurnAsError(body?.error ?? `Failed to send message (${response.status})`);
                return;
            }
            if (chatTaskId) sessionsHook.updateSessionStatus(chatTaskId, 'running');
            await waitForFollowUpCompletion(processId);
            sessionsHook.refresh();
        } catch (err: any) {
            markLastTurnAsError(err?.message ?? 'Failed to retry message.');
        } finally {
            setSending(false);
        }
    }, [processId, sending, sessionExpired, chatTaskId, sessionsHook, waitForFollowUpCompletion]);

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

    const handleStartInputChange = useCallback((value: string, selectionStart: number) => {
        setInputValue(value);
        inputDrafts.current.set(selectedTaskId ?? null, value);
        slashCommands.handleInputChange(value, selectionStart);
    }, [selectedTaskId, slashCommands]);

    const handleFollowUpInputChange = useCallback((value: string, selectionStart: number) => {
        setInputValue(value);
        inputDrafts.current.set(selectedTaskId ?? null, value);
        slashCommands.handleInputChange(value, selectionStart);
    }, [selectedTaskId, slashCommands]);

    const renderStartScreen = () => (
        <ChatStartPane
            isMobile={isMobile}
            inputValue={inputValue}
            onInputChange={handleStartInputChange}
            onStartChat={handleStartChat}
            sending={sending}
            error={error}
            readOnly={readOnly}
            onReadOnlyChange={setReadOnly}
            model={model}
            models={models}
            onModelChange={handleModelChange}
            images={initialImagePaste.images}
            onRemoveImage={initialImagePaste.removeImage}
            onPaste={initialImagePaste.addFromPaste}
            skills={skills}
            slashCommands={slashCommands}
            onSetInputValue={setInputValue}
            onMobileBack={isMobile ? () => setMobileShowDetail(false) : undefined}
        />
    );

    const renderConversation = () => (
        <ChatConversationPane
            isMobile={isMobile}
            keyboardHeight={keyboardHeight}
            turns={turns}
            loading={loading}
            task={task}
            isStreaming={isStreaming}
            sending={sending}
            sessionExpired={sessionExpired}
            error={error}
            inputValue={inputValue}
            suggestions={suggestions}
            readOnly={readOnly}
            resuming={resuming}
            metadataProcess={metadataProcess}
            processId={processId}
            chatTaskId={chatTaskId}
            inputDisabled={inputDisabled}
            taskFinished={taskFinished}
            onInputChange={handleFollowUpInputChange}
            onSetInputValue={setInputValue}
            onStopStreaming={stopStreaming}
            onCancelChat={() => void handleCancelChat()}
            onResumeChat={() => void handleResumeChat()}
            onResumeInTerminal={() => void handleResumeInTerminal()}
            onSendFollowUp={() => void sendFollowUp()}
            onRetryLastMessage={retryLastMessage}
            onLoadSession={loadSession}
            onMobileBack={isMobile ? () => setMobileShowDetail(false) : undefined}
            followUpImages={followUpImagePaste.images}
            onRemoveFollowUpImage={followUpImagePaste.removeImage}
            onFollowUpPaste={followUpImagePaste.addFromPaste}
            skills={skills}
            slashCommands={slashCommands}
            conversationContainerRef={conversationContainerRef}
            textareaRef={textareaRef}
        />
    );

    // --- render ---

    const sidebarContent = (
        <ChatSessionSidebar
            className={isMobile ? 'h-full' : 'w-80 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c]'}
            workspaceId={workspaceId}
            sessions={sessionsHook.sessions}
            activeTaskId={selectedTaskId}
            onSelectSession={handleSelectSession}
            onNewChat={(readOnly) => onOpenNewChatDialog ? onOpenNewChatDialog(readOnly) : handleNewChat(readOnly)}
            onCancelSession={(taskId) => void handleCancelChat(taskId)}
            loading={sessionsHook.loading}
            isUnread={readState.isUnread}
            pinnedIds={pinnedIds}
            onTogglePin={togglePin}
            archiveSet={archiveSet}
            onToggleArchive={toggleArchive}
            showArchived={showArchived}
            onToggleShowArchived={() => setShowArchived(prev => !prev)}
            onRefresh={() => void sessionsHook.refresh()}
            isRefreshing={sessionsHook.loading}
        />
    );

    if (isMobile) {
        return (
            <div className="flex flex-col h-full overflow-hidden" data-testid="chat-split-panel">
                {mobileShowDetail ? (
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {!chatTaskId ? renderStartScreen() : renderConversation()}
                    </div>
                ) : (
                    <div className="flex-1 flex flex-col overflow-hidden" data-testid="chat-mobile-list">
                        {sidebarContent}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex h-full overflow-hidden" data-testid="chat-split-panel">
            {/* Left sidebar */}
            {sidebarContent}
            {/* Right panel — grows to fill */}
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                {!chatTaskId ? renderStartScreen() : renderConversation()}
            </div>
        </div>
    );
}
