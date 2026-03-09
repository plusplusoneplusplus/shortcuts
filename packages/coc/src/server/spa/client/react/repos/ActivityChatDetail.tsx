/**
 * ActivityChatDetail — unified detail surface for the Activity tab.
 *
 * Renders a chat conversation for any queue task (chat, run-workflow,
 * run-script, etc.) without navigating away from the Activity tab.
 * Derives the process ID from the queue task and reuses the existing
 * queue/process/SSE APIs.
 *
 * This component unifies the former ActivityChatDetail and QueueTaskDetail
 * into a single surface with all features: rich SSE streaming (chunk,
 * tool-start/complete/failed, conversation-snapshot), retry-on-error,
 * cancel/move-to-top for pending tasks, conversation caching, mode
 * selector, slash commands, and copy conversation.
 */

import { useEffect, useRef, useState, useMemo, useCallback, useContext } from 'react';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { Button, Spinner, SuggestionChips } from '../shared';
import { ConversationTurnBubble } from '../processes/ConversationTurnBubble';
import { ConversationMetadataPopover, getSessionIdFromProcess } from '../processes/ConversationMetadataPopover';
import { getConversationTurns } from '../chat/chatConversationUtils';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { usePopOut } from '../context/PopOutContext';
import { ToastContext } from '../context/ToastContext';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useImagePaste } from '../hooks/useImagePaste';
import { ImagePreviews } from '../shared/ImagePreviews';
import { cn } from '../shared/cn';
import { useSlashCommands } from './useSlashCommands';
import { SlashCommandMenu } from './SlashCommandMenu';
import type { SkillItem } from './SlashCommandMenu';
import { copyToClipboard, formatConversationAsText, formatDuration, statusIcon, statusLabel } from '../utils/format';
import { Badge } from '../shared';
import { MetaRow, FilePathValue } from '../queue/PendingTaskPayload';
import { PendingTaskInfoPanel } from '../queue/PendingTaskInfoPanel';
import type { ClientConversationTurn } from '../types/dashboard';

const CACHE_TTL_MS = 60 * 60 * 1000;

const MODE_BORDER_COLORS: Record<'ask' | 'plan' | 'autopilot', { border: string; ring: string }> = {
    autopilot: { border: 'border-green-500 dark:border-green-400', ring: 'focus:ring-green-500/50' },
    ask: { border: 'border-yellow-500 dark:border-yellow-400', ring: 'focus:ring-yellow-500/50' },
    plan: { border: 'border-blue-500 dark:border-blue-400', ring: 'focus:ring-blue-500/50' },
};

export interface ActivityChatDetailProps {
    taskId: string;
    onBack?: () => void;
    workspaceId?: string;
    /** When true (i.e., rendered inside a pop-out window), hides the pop-out button. */
    isPopOut?: boolean;
}

export function ActivityChatDetail({ taskId, onBack, workspaceId, isPopOut = false }: ActivityChatDetailProps) {
    const [task, setTask] = useState<any>(null);
    const [fullTask, setFullTask] = useState<any>(null);
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const turnsRef = useRef<ClientConversationTurn[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [isScrolledUp, setIsScrolledUp] = useState(false);
    const [followUpInput, setFollowUpInput] = useState('');
    const [resumeLaunching, setResumeLaunching] = useState(false);
    const [resumeFeedback, setResumeFeedback] = useState<{ type: 'success' | 'error'; message: string; command?: string } | null>(null);
    const [processDetails, setProcessDetails] = useState<any>(null);
    const [copied, setCopied] = useState(false);
    const [selectedMode, setSelectedMode] = useState<'ask' | 'plan' | 'autopilot'>('autopilot');
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const lastFailedMessageRef = useRef<string>('');

    const eventSourceRef = useRef<EventSource | null>(null);
    const followUpEventSourceRef = useRef<EventSource | null>(null);
    const loadCounterRef = useRef(0);
    const conversationContainerRef = useRef<HTMLDivElement>(null);
    const lastRefreshVersionRef = useRef(0);
    const isInitialLoadRef = useRef(true);

    const { images, addFromPaste, removeImage, clearImages } = useImagePaste();
    const { isMobile } = useBreakpoint();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { state: appState, dispatch: appDispatch } = useApp();
    const { markPoppedOut } = usePopOut();
    const toastCtx = useContext(ToastContext);
    const slashCommands = useSlashCommands(skills);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const processId = task?.processId ?? (taskId ? `queue_${taskId}` : null);
    const isPending = task?.status === 'queued';
    const isTerminal = task?.status === 'completed' || task?.status === 'failed' || task?.status === 'cancelled';
    const inputDisabled = isPending || task?.status === 'cancelled' || sending || sessionExpired;
    const resumeSessionId = getSessionIdFromProcess(processDetails || task);
    const noSessionForFollowUp = isTerminal && processDetails !== null && !resumeSessionId;

    const metadataProcess = useMemo(() => {
        if (!task) return null;
        return {
            ...task,
            ...(processDetails || {}),
            id: processId ?? task.id,
            metadata: { queueTaskId: task.id, model: task.config?.model, mode: (task as any)?.payload?.mode, ...task.metadata, ...(processDetails?.metadata || {}) },
        };
    }, [task, processId, processDetails]);

    const setTurnsAndRef = useCallback((next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => {
        const resolved = typeof next === 'function' ? next(turnsRef.current) : next;
        turnsRef.current = resolved;
        setTurns(resolved);
        if (taskId) {
            appDispatch({ type: 'CACHE_CONVERSATION', processId: taskId, turns: resolved });
        }
    }, [taskId, appDispatch]);

    const stopStreaming = useCallback(() => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setIsStreaming(false);
    }, []);

    const removeStreamingPlaceholder = useCallback(() => {
        setTurnsAndRef(prev => {
            const last = prev[prev.length - 1];
            return last?.role === 'assistant' && last.streaming ? prev.slice(0, -1) : prev;
        });
    }, [setTurnsAndRef]);

    const closeFollowUpStream = useCallback(() => {
        if (followUpEventSourceRef.current) {
            followUpEventSourceRef.current.close();
            followUpEventSourceRef.current = null;
        }
    }, []);

    const refreshConversation = useCallback(async (pid: string) => {
        try {
            const data = await fetchApi(`/processes/${encodeURIComponent(pid)}`);
            setProcessDetails(data?.process || null);
            const refreshedTurns = getConversationTurns(data);
            setTurnsAndRef(refreshedTurns);
        } catch { /* keep current turns */ }
    }, [setTurnsAndRef]);

    // Fetch skills when workspaceId changes
    useEffect(() => {
        setSkills([]);
        if (!workspaceId) return;
        fetchApi('/workspaces/' + encodeURIComponent(workspaceId) + '/skills/all')
            .then((data: any) => {
                if (data?.merged && Array.isArray(data.merged)) {
                    setSkills(data.merged);
                } else if (data?.skills && Array.isArray(data.skills)) {
                    setSkills(data.skills);
                }
            })
            .catch(() => { /* ignore */ });
    }, [workspaceId]);

    // Fetch full task data for pending tasks (metadata + payload)
    useEffect(() => {
        if (!taskId || !isPending) { setFullTask(null); return; }
        fetchApi(`/queue/${encodeURIComponent(taskId)}`)
            .then((data: any) => setFullTask(data?.task || null))
            .catch(() => setFullTask(null));
    }, [taskId, isPending, queueState.refreshVersion]);

    // Load task + conversation on mount / taskId change
    useEffect(() => {
        isInitialLoadRef.current = true;
        const loadId = ++loadCounterRef.current;
        setLoading(true);
        setError(null);
        setSessionExpired(false);
        setTask(null);
        setFullTask(null);
        setTurnsAndRef([]);
        setProcessDetails(null);
        setSuggestions([]);
        setFollowUpInput('');
        setResumeFeedback(null);
        clearImages();
        stopStreaming();
        closeFollowUpStream();
        queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });

        (async () => {
            try {
                const queueData = await fetchApi(`/queue/${encodeURIComponent(taskId)}`);
                if (loadCounterRef.current !== loadId) return;
                const loadedTask = queueData?.task ?? null;
                setTask(loadedTask);
                if (loadedTask?.payload?.mode && ['ask', 'plan', 'autopilot'].includes(loadedTask.payload.mode)) {
                    setSelectedMode(loadedTask.payload.mode);
                }

                if (!loadedTask?.processId && loadedTask?.status === 'queued') {
                    const prompt = loadedTask?.payload?.prompt ?? '';
                    if (prompt) {
                        setTurnsAndRef([{ role: 'user', content: prompt, timeline: [] }]);
                    }
                    return;
                }

                const pid = loadedTask?.processId ?? `queue_${taskId}`;

                // Check shared conversation cache
                const cached = appState.conversationCache[taskId];
                if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
                    setTurnsAndRef(cached.turns);
                    // Background-refresh metadata
                    fetchApi(`/processes/${encodeURIComponent(pid)}`)
                        .then((data: any) => {
                            setProcessDetails(data?.process || null);
                            const processMode = data?.process?.metadata?.mode;
                            if (processMode && ['ask', 'plan', 'autopilot'].includes(processMode)) {
                                setSelectedMode(processMode);
                            }
                        })
                        .catch(() => { /* metadata refresh is best-effort */ });
                } else {
                    const procData = await fetchApi(`/processes/${encodeURIComponent(pid)}`);
                    if (loadCounterRef.current !== loadId) return;
                    setProcessDetails(procData?.process || null);
                    const processMode = procData?.process?.metadata?.mode;
                    if (processMode && ['ask', 'plan', 'autopilot'].includes(processMode)) {
                        setSelectedMode(processMode);
                    }
                    const loadedTurns = getConversationTurns(procData, loadedTask);
                    if (loadedTask?.status === 'running') {
                        const lastTurn = loadedTurns[loadedTurns.length - 1];
                        if (lastTurn?.role === 'assistant') {
                            setTurnsAndRef(loadedTurns.map((t, i) =>
                                i === loadedTurns.length - 1 ? { ...t, streaming: true } : t
                            ));
                        } else {
                            setTurnsAndRef([...loadedTurns, { role: 'assistant', content: '', streaming: true, timeline: [] }]);
                        }
                    } else {
                        setTurnsAndRef(loadedTurns);
                    }
                }
            } catch (err: any) {
                if (loadCounterRef.current !== loadId) return;
                setError(err?.message ?? 'Failed to load chat');
            } finally {
                if (loadCounterRef.current === loadId) setLoading(false);
            }
        })();

        return () => { stopStreaming(); closeFollowUpStream(); };
    }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-fetch conversation when user re-clicks the already-selected task
    useEffect(() => {
        const isRefresh = queueState.refreshVersion > 0 &&
            lastRefreshVersionRef.current !== queueState.refreshVersion;
        lastRefreshVersionRef.current = queueState.refreshVersion;
        if (!isRefresh || !taskId) return;

        (async () => {
            try {
                const queueData = await fetchApi(`/queue/${encodeURIComponent(taskId)}`);
                const refreshedTask = queueData?.task ?? null;
                setTask(refreshedTask);

                const pid = refreshedTask?.processId ?? `queue_${taskId}`;
                if (!refreshedTask?.processId && refreshedTask?.status === 'queued') return;

                const procData = await fetchApi(`/processes/${encodeURIComponent(pid)}`);
                setProcessDetails(procData?.process || null);
                const refreshedTurns = getConversationTurns(procData, refreshedTask);
                setTurnsAndRef(refreshedTurns);
            } catch { /* keep current state */ }
        })();
    }, [taskId, queueState.refreshVersion, setTurnsAndRef]);

    // SSE for running tasks — rich streaming with chunk/tool events
    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (!taskId || task?.status !== 'running' || !processId) return;

        const es = new EventSource(`${getApiBase()}/processes/${encodeURIComponent(processId)}/stream`);
        eventSourceRef.current = es;
        setIsStreaming(true);

        const ensureAssistantTurn = (prev: ClientConversationTurn[]): ClientConversationTurn[] => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') return prev;
            return [...prev, { role: 'assistant', content: '', streaming: true, timeline: [] }];
        };

        es.addEventListener('conversation-snapshot', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (data.turns) {
                    setTurnsAndRef(data.turns);
                }
            } catch { /* ignore */ }
        });

        es.addEventListener('chunk', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                const chunk = data.content || '';
                setTurnsAndRef((prev) => {
                    const turns = ensureAssistantTurn(prev);
                    const last = turns[turns.length - 1];
                    turns[turns.length - 1] = {
                        ...last,
                        content: (last.content || '') + chunk,
                        streaming: true,
                        timeline: (() => {
                            const prev = last.timeline || [];
                            const lastItem = prev[prev.length - 1];
                            if (lastItem && lastItem.type === 'content') {
                                return [...prev.slice(0, -1), { ...lastItem, content: (lastItem.content || '') + chunk }];
                            }
                            return [...prev, { type: 'content' as const, timestamp: new Date().toISOString(), content: chunk }];
                        })(),
                    };
                    return [...turns];
                });
            } catch { /* ignore */ }
        });

        const handleToolSSE = (eventType: 'tool-start' | 'tool-complete' | 'tool-failed') => (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                setTurnsAndRef((prev) => {
                    const turns = ensureAssistantTurn(prev);
                    const last = turns[turns.length - 1];
                    const toolCall: any = {
                        id: data.toolCallId,
                        toolName: data.toolName || 'unknown',
                        args: data.parameters || {},
                        status: eventType === 'tool-start' ? 'running' : eventType === 'tool-complete' ? 'completed' : 'failed',
                        startTime: new Date().toISOString(),
                        ...(eventType !== 'tool-start' ? { endTime: new Date().toISOString(), result: data.result, error: data.error } : {}),
                        ...(data.parentToolCallId ? { parentToolCallId: data.parentToolCallId } : {}),
                    };
                    turns[turns.length - 1] = {
                        ...last,
                        streaming: true,
                        timeline: [...(last.timeline || []), { type: eventType, timestamp: new Date().toISOString(), toolCall }],
                    };
                    return [...turns];
                });
            } catch { /* ignore */ }
        };

        es.addEventListener('tool-start', handleToolSSE('tool-start'));
        es.addEventListener('tool-complete', handleToolSSE('tool-complete'));
        es.addEventListener('tool-failed', handleToolSSE('tool-failed'));

        const finish = () => {
            es.close();
            eventSourceRef.current = null;
            setIsStreaming(false);
            void refreshConversation(processId);
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

        return () => { es.close(); eventSourceRef.current = null; setIsStreaming(false); };
    }, [taskId, task?.status, processId, refreshConversation]);

    // Poll queued → running transition
    useEffect(() => {
        if (!taskId || task?.status !== 'queued') return;
        const interval = setInterval(async () => {
            try {
                const data = await fetchApi(`/queue/${encodeURIComponent(taskId)}`);
                const t = data?.task;
                if (t && t.status !== 'queued') {
                    setTask(t);
                    if (t.processId || t.status === 'running') {
                        const pid = t.processId ?? `queue_${taskId}`;
                        const procData = await fetchApi(`/processes/${encodeURIComponent(pid)}`);
                        setProcessDetails(procData?.process || null);
                        const loadedTurns = getConversationTurns(procData, t);
                        if (t.status === 'running') {
                            const lastTurn = loadedTurns[loadedTurns.length - 1];
                            if (lastTurn?.role === 'assistant') {
                                setTurnsAndRef(loadedTurns.map((turn, i) =>
                                    i === loadedTurns.length - 1 ? { ...turn, streaming: true } : turn
                                ));
                            } else {
                                setTurnsAndRef([...loadedTurns, { role: 'assistant', content: '', streaming: true, timeline: [] }]);
                            }
                        } else {
                            setTurnsAndRef(loadedTurns);
                        }
                    }
                }
            } catch { /* ignore */ }
        }, 2000);
        return () => clearInterval(interval);
    }, [taskId, task?.status, setTurnsAndRef]);

    // Scroll to bottom on new turns
    useEffect(() => {
        if (!loading && turns.length > 0 && conversationContainerRef.current) {
            const el = conversationContainerRef.current;
            if (isInitialLoadRef.current) {
                // Force scroll to bottom when a task is first selected
                isInitialLoadRef.current = false;
                requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
            } else {
                const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
                if (dist < 100) el.scrollTop = el.scrollHeight;
            }
        }
    }, [turns, loading]);

    // Track scroll position
    useEffect(() => {
        const el = conversationContainerRef.current;
        if (!el) return;
        const onScroll = () => {
            const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
            setIsScrolledUp(dist > 100);
        };
        el.addEventListener('scroll', onScroll);
        return () => el.removeEventListener('scroll', onScroll);
    }, [taskId]);

    // Cleanup on unmount
    useEffect(() => () => { stopStreaming(); closeFollowUpStream(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const waitForFollowUpCompletion = async (pid: string) => {
        if (typeof EventSource === 'undefined') {
            await refreshConversation(pid);
            return;
        }
        closeFollowUpStream();
        await new Promise<void>(resolve => {
            const es = new EventSource(`${getApiBase()}/processes/${encodeURIComponent(pid)}/stream`);
            followUpEventSourceRef.current = es;
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                es.close();
                if (followUpEventSourceRef.current === es) followUpEventSourceRef.current = null;
                void refreshConversation(pid).finally(() => resolve());
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
    };

    const sendFollowUp = async (overrideContent?: string) => {
        const rawContent = (overrideContent ?? followUpInput).trim();
        if (!rawContent || !processId || inputDisabled) return;

        // Extract slash-command skills from the message text
        const { skills: extractedSkills, prompt: cleanedPrompt } = slashCommands.parseAndExtract(rawContent);
        const content = cleanedPrompt || rawContent;

        setSuggestions([]);
        lastFailedMessageRef.current = content;
        setFollowUpInput('');
        slashCommands.dismissMenu();
        setError(null);
        setSending(true);
        queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: true, turnIndex: null });

        const timestamp = new Date().toISOString();
        setTurnsAndRef(prev => ([
            ...prev,
            { role: 'user' as const, content, timestamp, timeline: [] },
            { role: 'assistant' as const, content: '', timestamp, streaming: true, timeline: [] },
        ]));

        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    images: images.length > 0 ? images : undefined,
                    mode: selectedMode,
                    ...(extractedSkills.length > 0 ? { skillNames: extractedSkills } : {}),
                }),
            });

            if (response.status === 410) {
                setSessionExpired(true);
                setError('Session expired.');
                removeStreamingPlaceholder();
                return;
            }
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                setError(body?.error || `Failed to send message (${response.status})`);
                removeStreamingPlaceholder();
                return;
            }

            clearImages();
            await waitForFollowUpCompletion(processId);
        } catch (err: any) {
            setError(err?.message || 'Failed to send follow-up message.');
            removeStreamingPlaceholder();
        } finally {
            setSending(false);
            queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
        }
    };

    const handleCancel = async () => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId), { method: 'DELETE' });
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
        onBack?.();
    };

    const handleMoveToTop = async () => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/move-to-top', { method: 'POST' });
        queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
    };

    const retryLastMessage = () => {
        if (!lastFailedMessageRef.current) return;
        void sendFollowUp(lastFailedMessageRef.current);
    };

    const launchInteractiveResume = async () => {
        if (!processId || !resumeSessionId) return;
        setResumeLaunching(true);
        setResumeFeedback(null);
        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/resume-cli`, { method: 'POST' });
            const body = await response.json().catch(() => null);
            if (!response.ok) throw new Error(body?.error || `Failed to launch resume command (${response.status})`);
            const launched = body?.launched !== false;
            setResumeFeedback({
                type: 'success',
                message: launched ? 'Opened Terminal with Copilot resume command.' : 'Auto-launch unavailable. Run this command manually.',
                command: !launched && typeof body?.command === 'string' ? body.command : undefined,
            });
        } catch (err: any) {
            setResumeFeedback({ type: 'error', message: err?.message || 'Failed to launch Copilot resume command.' });
        } finally {
            setResumeLaunching(false);
        }
    };

    const scrollToBottom = () => {
        if (conversationContainerRef.current) {
            conversationContainerRef.current.scrollTop = conversationContainerRef.current.scrollHeight;
        }
    };

    const handlePopOut = useCallback(() => {
        const base = window.location.origin + window.location.pathname;
        const wsParam = workspaceId ? `?workspace=${encodeURIComponent(workspaceId)}` : '';
        const url = `${base}${wsParam}#popout/activity/${encodeURIComponent(taskId)}`;
        const popup = window.open(url, `coc-popout-${taskId}`, 'width=800,height=900');
        if (!popup) {
            toastCtx?.addToast('Pop-out blocked. Allow popups for this site and try again.', 'error');
        } else {
            markPoppedOut(taskId);
        }
    }, [taskId, workspaceId, markPoppedOut, toastCtx]);

    return (
        <div className="flex-1 flex flex-col min-h-0" data-testid="activity-chat-detail">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <div className="flex items-center gap-2">
                    {onBack && (
                        <button
                            className="text-sm text-[#0078d4] hover:text-[#005a9e] dark:text-[#3794ff] dark:hover:text-[#60aeff] mr-1"
                            onClick={onBack}
                            data-testid="activity-chat-back-btn"
                        >
                            ← Back
                        </button>
                    )}
                    <span className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">Chat</span>
                    {task && (
                        <Badge status={task.status}>
                            {statusIcon(task.status)} {statusLabel(task.status)}
                        </Badge>
                    )}
                    {task?.duration != null && (
                        <span className="text-xs text-[#848484]">{formatDuration(task.duration)}</span>
                    )}
                    {!isPending && resumeSessionId && (
                        <Button
                            variant="secondary"
                            size="sm"
                            className="hidden sm:inline-flex"
                            loading={resumeLaunching}
                            onClick={() => { void launchInteractiveResume(); }}
                        >
                            Resume CLI
                        </Button>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {!isPopOut && !isMobile && (
                        <button
                            title="Pop out to new window"
                            data-testid="activity-chat-popout-btn"
                            onClick={handlePopOut}
                            className="p-1 rounded text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d] transition-colors flex-shrink-0"
                        >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M10 2h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M14 2L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                            </svg>
                        </button>
                    )}
                    <button
                        title="Copy conversation"
                        data-testid="copy-conversation-btn"
                        disabled={loading || turns.length === 0}
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
                    {!isPending && metadataProcess && (
                        <ConversationMetadataPopover process={metadataProcess} turnsCount={turns.length} />
                    )}
                </div>
            </div>

            {/* Conversation area */}
            <div className="relative flex-1 min-h-0">
                <div ref={conversationContainerRef} className="flex-1 min-h-0 overflow-y-auto p-4 h-full space-y-3">
                    {isPending ? (
                        <PendingTaskInfoPanel task={fullTask || task} onCancel={handleCancel} onMoveToTop={handleMoveToTop} />
                    ) : loading ? (
                        <div className="flex items-center gap-2 text-[#848484] text-sm">
                            <Spinner size="sm" /> Loading conversation...
                        </div>
                    ) : turns.length === 0 ? (
                        <div className="text-[#848484] text-sm">No conversation data available.</div>
                    ) : (
                        <div className="space-y-3">
                            {(() => {
                                const hasStreaming = turns.some(t => t.streaming);
                                const renderTurns =
                                    task?.status === 'running' && !hasStreaming && turns.length > 0
                                        ? [...turns, { role: 'assistant' as const, content: '', streaming: true, timeline: [] }]
                                        : turns;
                                return renderTurns.map((turn, i) => (
                                    <ConversationTurnBubble key={i} turn={turn} taskId={taskId} />
                                ));
                            })()}
                        </div>
                    )}
                </div>
                <button
                    className={cn(
                        "absolute bottom-4 right-4 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-[#0078d4] text-white shadow-md hover:bg-[#106ebe] text-sm pointer-events-none opacity-0 transition-opacity",
                        isScrolledUp && "visible pointer-events-auto opacity-100"
                    )}
                    onClick={scrollToBottom}
                    title="Scroll to bottom"
                >
                    ↓
                </button>
            </div>

            {/* Follow-up input */}
            {!isPending && noSessionForFollowUp && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3">
                    <div className="text-[#848484] text-sm text-center">
                        Follow-up chat is not available for this process type.
                    </div>
                </div>
            )}
            {!isPending && !noSessionForFollowUp && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">
                    {resumeFeedback && (
                        <div className={`text-xs ${resumeFeedback.type === 'error' ? 'text-[#f14c4c]' : 'text-[#6a9955] dark:text-[#89d185]'}`}>
                            {resumeFeedback.message}
                            {resumeFeedback.command && (
                                <div className="mt-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] px-2 py-1 font-mono text-[11px] break-all text-[#1e1e1e] dark:text-[#cccccc]">
                                    {resumeFeedback.command}
                                </div>
                            )}
                        </div>
                    )}
                    {error && <div className="chat-error-bubble bubble-error text-xs text-[#f14c4c]">{error}</div>}
                    {error && lastFailedMessageRef.current && (
                        <button
                            className="retry-btn text-xs underline text-[#f14c4c]"
                            onClick={() => retryLastMessage()}
                        >
                            Retry
                        </button>
                    )}
                    {suggestions.length > 0 && !sending && task?.status !== 'running' && (
                        <SuggestionChips
                            suggestions={suggestions}
                            onSelect={(text) => { setSuggestions([]); void sendFollowUp(text); }}
                            disabled={inputDisabled}
                        />
                    )}
                    <ImagePreviews images={images} onRemove={removeImage} />
                    <div className="flex items-center gap-2">
                        <div className="shrink-0" data-testid="mode-selector">
                            <select
                                value={selectedMode}
                                onChange={e => setSelectedMode(e.target.value as 'ask' | 'plan' | 'autopilot')}
                                className="px-2 py-1 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 cursor-pointer"
                                data-testid="mode-dropdown"
                            >
                                {([['ask', '💡 Ask'], ['plan', '📋 Plan'], ['autopilot', '🤖 Autopilot']] as const).map(([mode, label]) => (
                                    <option key={mode} value={mode}>{label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="relative flex-1">
                            <textarea
                                ref={textareaRef}
                                rows={1}
                                value={followUpInput}
                                disabled={inputDisabled}
                                placeholder={sessionExpired ? 'Session expired.' : sending ? 'Waiting for response...' : 'Send a message... (type / for skills)'}
                                className={cn('w-full min-h-[34px] max-h-28 resize-y rounded border bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 disabled:opacity-60', MODE_BORDER_COLORS[selectedMode].border, MODE_BORDER_COLORS[selectedMode].ring)}
                                onChange={e => {
                                    const val = e.target.value;
                                    setFollowUpInput(val);
                                    slashCommands.handleInputChange(val, e.target.selectionStart ?? val.length);
                                }}
                                onKeyDown={e => {
                                    if (slashCommands.handleKeyDown(e)) {
                                        // If menu consumed the key (arrow nav, enter/tab for selection, escape)
                                        if (e.key === 'Enter' || e.key === 'Tab') {
                                            const skill = slashCommands.filteredSkills[slashCommands.highlightIndex];
                                            if (skill) {
                                                slashCommands.selectSkill(skill.name, followUpInput, setFollowUpInput);
                                            }
                                        }
                                        return;
                                    }
                                    // Shift+Tab cycles through modes (ask → plan → autopilot → ask)
                                    if (e.key === 'Tab' && e.shiftKey) {
                                        e.preventDefault();
                                        setSelectedMode(prev => {
                                            const modes: Array<'ask' | 'plan' | 'autopilot'> = ['ask', 'plan', 'autopilot'];
                                            return modes[(modes.indexOf(prev) + 1) % modes.length];
                                        });
                                        return;
                                    }
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        void sendFollowUp();
                                    }
                                }}
                                onPaste={addFromPaste}
                                data-testid="activity-chat-input"
                            />
                            <SlashCommandMenu
                                skills={skills}
                                filter={slashCommands.menuFilter}
                                onSelect={(name) => {
                                    slashCommands.selectSkill(name, followUpInput, setFollowUpInput);
                                    textareaRef.current?.focus();
                                }}
                                onDismiss={slashCommands.dismissMenu}
                                visible={slashCommands.menuVisible}
                                highlightIndex={slashCommands.highlightIndex}
                            />
                        </div>
                        <button
                            type="button"
                            disabled={inputDisabled}
                            className="h-[34px] px-3 rounded bg-[#0078d4] text-white text-sm font-medium hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => { void sendFollowUp(); }}
                            data-testid="activity-chat-send-btn"
                        >
                            {sending ? '...' : 'Send'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
