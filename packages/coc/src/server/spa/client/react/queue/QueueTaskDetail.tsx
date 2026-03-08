/**
 * QueueTaskDetail — detail panel for a selected queue task.
 * Shows conversation turns with SSE streaming for running tasks.
 * Shows an info panel with metadata and prompt for pending (queued) tasks.
 */

import { useEffect, useRef, useState } from 'react';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { Badge, Spinner, Button, cn, ImageGallery, SuggestionChips, FilePathLink } from '../shared';
import { ConversationTurnBubble } from '../processes/ConversationTurnBubble';
import { ConversationMetadataPopover, getSessionIdFromProcess } from '../processes/ConversationMetadataPopover';
import { formatDuration, statusIcon, statusLabel } from '../utils/format';
import { useImagePaste } from '../hooks/useImagePaste';
import { ImagePreviews } from '../shared/ImagePreviews';
import { PendingTaskInfoPanel } from './PendingTaskInfoPanel';
import { PendingTaskPayload, MetaRow, FilePathValue } from './PendingTaskPayload';
import type { ClientConversationTurn } from '../types/dashboard';

const CACHE_TTL_MS = 60 * 60 * 1000;

function getInputPlaceholder(status: string | undefined, isStreaming: boolean, sessionExpired: boolean): string {
    if (sessionExpired) return 'Session expired. Start a new task to continue.';
    if (isStreaming) return 'Waiting for response...';
    if (status === 'completed') return 'Continue this conversation...';
    if (status === 'queued') return 'Follow-ups available once task starts...';
    if (status === 'failed') return 'Retry or ask a follow-up...';
    if (status === 'running') return 'Waiting for response...';
    if (status === 'cancelled') return 'Task was cancelled';
    return 'Send a message...';
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

    // Backward-compatible fallback for older persisted processes.
    if (process) {
        const synthetic: ClientConversationTurn[] = [];
        const userContent = process.fullPrompt || process.promptPreview;
        if (userContent) {
            synthetic.push({
                role: 'user',
                content: userContent,
                timestamp: process.startTime || undefined,
                timeline: [],
            });
        }
        if (process.result) {
            synthetic.push({
                role: 'assistant',
                content: process.result,
                timestamp: process.endTime || undefined,
                timeline: [],
            });
        }
        return synthetic;
    }

    return [];
}

export function QueueTaskDetail({ onBack }: { onBack?: () => void } = {}) {
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { state: appState, dispatch: appDispatch } = useApp();
    const { selectedTaskId } = queueState;
    const [loading, setLoading] = useState(false);
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const turnsRef = useRef<ClientConversationTurn[]>([]);
    const [task, setTask] = useState<any>(null);
    const [fullTask, setFullTask] = useState<any>(null);
    const [processDetails, setProcessDetails] = useState<any>(null);
    const eventSourceRef = useRef<EventSource | null>(null);
    const followUpEventSourceRef = useRef<EventSource | null>(null);
    const [followUpInput, setFollowUpInput] = useState('');
    const [followUpSending, setFollowUpSending] = useState(false);
    const [followUpError, setFollowUpError] = useState<string | null>(null);
    const [followUpSessionExpired, setFollowUpSessionExpired] = useState(false);
    const lastFailedMessageRef = useRef<string>('');
    const lastFetchedRefreshVersionRef = useRef(0);
    const [isScrolledUp, setIsScrolledUp] = useState(false);
    const [resumeLaunching, setResumeLaunching] = useState(false);
    const [resumeFeedback, setResumeFeedback] = useState<{ type: 'success' | 'error'; message: string; command?: string } | null>(null);
    const [suggestions, setSuggestions] = useState<string[]>([]);

    const { images, addFromPaste, removeImage, clearImages } = useImagePaste();

    const isPending= task?.status === 'queued';
    const selectedProcessId = task?.processId || (selectedTaskId ? `queue_${selectedTaskId}` : null);
    const followUpInputDisabled = isPending || task?.status === 'cancelled' || followUpSending || followUpSessionExpired;
    const followUpPlaceholder = getInputPlaceholder(task?.status, followUpSending, followUpSessionExpired);

    const closeFollowUpStream = () => {
        if (followUpEventSourceRef.current) {
            followUpEventSourceRef.current.close();
            followUpEventSourceRef.current = null;
        }
    };

    const setTurnsAndCache = (nextTurns: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => {
        const prev = turnsRef.current;
        const resolved = typeof nextTurns === 'function'
            ? (nextTurns as (value: ClientConversationTurn[]) => ClientConversationTurn[])(prev)
            : nextTurns;
        turnsRef.current = resolved;
        setTurns(resolved);
        if (selectedTaskId) {
            appDispatch({ type: 'CACHE_CONVERSATION', processId: selectedTaskId, turns: resolved });
        }
    };

    const refreshConversation = async () => {
        if (!selectedTaskId || !selectedProcessId) return;
        try {
            const data = await fetchApi(`/processes/${encodeURIComponent(selectedProcessId)}`);
            setProcessDetails(data?.process || null);
            const refreshedTurns = getConversationTurns(data);
            setTurnsAndCache(refreshedTurns);
        } catch {
            // Keep currently rendered turns if refresh fails.
        }
    };

    const removeStreamingAssistantPlaceholder = () => {
        setTurnsAndCache((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last.role === 'assistant' && last.streaming) {
                return prev.slice(0, -1);
            }
            return prev;
        });
    };

    const waitForFollowUpCompletion = async (processId: string) => {
        if (typeof EventSource === 'undefined') {
            await refreshConversation();
            return;
        }

        closeFollowUpStream();

        await new Promise<void>((resolve) => {
            const es = new EventSource(`/api/processes/${encodeURIComponent(processId)}/stream`);
            followUpEventSourceRef.current = es;
            let finished = false;

            const finish = () => {
                if (finished) return;
                finished = true;
                es.close();
                if (followUpEventSourceRef.current === es) {
                    followUpEventSourceRef.current = null;
                }
                void refreshConversation().finally(() => resolve());
            };

            const timeoutId = setTimeout(() => finish(), 90_000);
            const finishAndClearTimeout = () => {
                clearTimeout(timeoutId);
                finish();
            };

            es.addEventListener('done', () => finishAndClearTimeout());
            es.addEventListener('status', (event: Event) => {
                try {
                    const status = JSON.parse((event as MessageEvent).data || '{}')?.status;
                    if (status && status !== 'running' && status !== 'queued') {
                        finishAndClearTimeout();
                    }
                } catch {
                    // Ignore malformed status events.
                }
            });
            es.onerror = () => finishAndClearTimeout();
            es.addEventListener('suggestions', (event: Event) => {
                try {
                    const data = JSON.parse((event as MessageEvent).data);
                    if (Array.isArray(data.suggestions)) setSuggestions(data.suggestions);
                } catch { /* ignore */ }
            });
        });
    };

    const sendFollowUp = async (overrideContent?: string) => {
        const content = (overrideContent ?? followUpInput).trim();
        if (!content || !selectedProcessId || followUpInputDisabled) return;

        setSuggestions([]);
        lastFailedMessageRef.current = content;
        setFollowUpInput('');
        setFollowUpError(null);
        setFollowUpSending(true);
        queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: true, turnIndex: null });

        const timestamp = new Date().toISOString();
        setTurnsAndCache((prev) => ([
            ...prev,
            {
                role: 'user',
                content,
                timestamp,
                timeline: [],
            },
            {
                role: 'assistant',
                content: '',
                timestamp,
                streaming: true,
                timeline: [],
            },
        ]));

        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(selectedProcessId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    images: images.length > 0
                        ? images
                        : undefined,
                }),
            });

            if (response.status === 410) {
                setFollowUpSessionExpired(true);
                setFollowUpError('Session expired. Start a new task to continue.');
                removeStreamingAssistantPlaceholder();
                return;
            }

            if (!response.ok) {
                const body = await response.json().catch(() => null);
                setFollowUpError(body?.error || body?.message || `Failed to send message (${response.status})`);
                removeStreamingAssistantPlaceholder();
                return;
            }

            clearImages();
            await waitForFollowUpCompletion(selectedProcessId);
        } catch (error: any) {
            setFollowUpError(error?.message || 'Failed to send follow-up message.');
            removeStreamingAssistantPlaceholder();
        } finally {
            setFollowUpSending(false);
            queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
        }
    };

    // Keep a ref for side-effect-safe optimistic updates.
    useEffect(() => {
        turnsRef.current = turns;
    }, [turns]);

    // Auto-scroll on new turns (only when near bottom).
    useEffect(() => {
        const el = document.getElementById('queue-task-conversation');
        if (!el) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distFromBottom < 100) {
            el.scrollTop = el.scrollHeight;
        }
    }, [turns]);

    // Scroll to bottom when a new task is selected (after loading completes).
    useEffect(() => {
        if (!selectedTaskId || loading) return;
        const el = document.getElementById('queue-task-conversation');
        if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    }, [selectedTaskId, loading]);

    // Track scroll position for scroll-to-bottom button.
    useEffect(() => {
        const el = document.getElementById('queue-task-conversation');
        if (!el) return;
        const onScroll = () => {
            const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
            setIsScrolledUp(distFromBottom > 100);
        };
        el.addEventListener('scroll', onScroll);
        return () => el.removeEventListener('scroll', onScroll);
    }, [selectedTaskId]);

    // Determine task object from queue state (global + per-repo maps)
    useEffect(() => {
        if (!selectedTaskId) { setTask(null); return; }
        const globalTasks = [...queueState.running, ...queueState.queued, ...queueState.history];
        let found = globalTasks.find(t => t.id === selectedTaskId);
        if (!found) {
            for (const repo of Object.values(queueState.repoQueueMap)) {
                found = [...repo.running, ...repo.queued, ...repo.history].find(t => t.id === selectedTaskId);
                if (found) break;
            }
        }
        setTask(found || null);
    }, [selectedTaskId, queueState.running, queueState.queued, queueState.history, queueState.repoQueueMap]);

    // Fetch full task data for pending tasks (metadata + payload)
    useEffect(() => {
        if (!selectedTaskId || !isPending) { setFullTask(null); return; }
        fetchApi(`/queue/${encodeURIComponent(selectedTaskId)}`)
            .then((data: any) => setFullTask(data?.task || null))
            .catch(() => setFullTask(null));
    }, [selectedTaskId, isPending, queueState.refreshVersion]);

    // Fetch conversation on task selection (only for non-pending tasks)
    useEffect(() => {
        if (!selectedTaskId || isPending) {
            turnsRef.current = [];
            setTurns([]);
            setProcessDetails(null);
            return;
        }

        const isRefresh = queueState.refreshVersion > 0 &&
            lastFetchedRefreshVersionRef.current !== queueState.refreshVersion;
        lastFetchedRefreshVersionRef.current = queueState.refreshVersion;

        // Check shared conversation cache (bypassed on explicit refresh)
        const cached = appState.conversationCache[selectedTaskId];
        if (!isRefresh && cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
            setTurnsAndCache(cached.turns);
            setLoading(false);
            fetchApi(`/processes/${encodeURIComponent(selectedProcessId || `queue_${selectedTaskId}`)}`)
                .then((data: any) => {
                    setProcessDetails(data?.process || null);
                })
                .catch(() => { /* metadata refresh is best-effort */ });
        } else {
            setLoading(true);
            fetchApi(`/processes/${encodeURIComponent(selectedProcessId || `queue_${selectedTaskId}`)}`)
                .then((data: any) => {
                    setProcessDetails(data?.process || null);
                    const t = getConversationTurns(data);
                    setTurnsAndCache(t);
                })
                .catch(() => setTurnsAndCache([]))
                .finally(() => setLoading(false));
        }
    }, [selectedTaskId, selectedProcessId, isPending, appDispatch, queueState.refreshVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    // Reset follow-up state when switching tasks.
    useEffect(() => {
        setFollowUpInput('');
        setFollowUpError(null);
        setFollowUpSending(false);
        setFollowUpSessionExpired(false);
        setResumeLaunching(false);
        setResumeFeedback(null);
        setProcessDetails(null);
        setSuggestions([]);
        clearImages();
        closeFollowUpStream();
        queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTaskId]);

    // SSE streaming for running tasks — listen for named events
    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        if (!selectedTaskId || task?.status !== 'running') return;

        const processId = selectedProcessId || `queue_${selectedTaskId}`;
        const es = new EventSource(`/api/processes/${encodeURIComponent(processId)}/stream`);
        eventSourceRef.current = es;

        const ensureAssistantTurn = (prev: ClientConversationTurn[]): ClientConversationTurn[] => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') return prev;
            return [...prev, { role: 'assistant', content: '', streaming: true, timeline: [] }];
        };

        es.addEventListener('conversation-snapshot', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (data.turns) {
                    setTurnsAndCache(data.turns);
                }
            } catch { /* ignore */ }
        });

        es.addEventListener('chunk', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                const chunk = data.content || '';
                setTurnsAndCache((prev) => {
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
                setTurnsAndCache((prev) => {
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

        const handleDone = () => {
            es.close();
            eventSourceRef.current = null;
            void refreshConversation();
        };

        es.addEventListener('done', handleDone);
        es.addEventListener('status', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
                    handleDone();
                }
            } catch { handleDone(); }
        });

        es.onerror = () => {
            es.close();
            eventSourceRef.current = null;
        };

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
    }, [selectedTaskId, selectedProcessId, task?.status, appDispatch]);

    useEffect(() => {
        return () => {
            closeFollowUpStream();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!selectedTaskId) return null;

    const handleCancel = async () => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(selectedTaskId), { method: 'DELETE' });
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
    };

    const handleMoveToTop = async () => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(selectedTaskId) + '/move-to-top', { method: 'POST' });
    };

    const retryLastMessage = () => {
        if (!lastFailedMessageRef.current) return;
        void sendFollowUp(lastFailedMessageRef.current);
    };

    const scrollToBottom = () => {
        const el = document.getElementById('queue-task-conversation');
        if (el) el.scrollTop = el.scrollHeight;
    };
    const metadataProcess = processDetails || fullTask || task;
    const resumeSessionId = getSessionIdFromProcess(metadataProcess);
    const isTerminal = task?.status === 'completed' || task?.status === 'failed';
    const noSessionForFollowUp = isTerminal && processDetails !== null && !resumeSessionId;

    const launchInteractiveResume = async () => {
        if (!selectedProcessId || !resumeSessionId) return;
        setResumeLaunching(true);
        setResumeFeedback(null);
        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(selectedProcessId)}/resume-cli`, {
                method: 'POST',
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(body?.error || `Failed to launch resume command (${response.status})`);
            }

            const launched = body?.launched !== false;
            if (launched) {
                setResumeFeedback({
                    type: 'success',
                    message: 'Opened Terminal with Copilot resume command.',
                });
            } else {
                setResumeFeedback({
                    type: 'success',
                    message: 'Auto-launch unavailable. Run this command manually.',
                    command: typeof body?.command === 'string' ? body.command : undefined,
                });
            }
        } catch (error: any) {
            setResumeFeedback({
                type: 'error',
                message: error?.message || 'Failed to launch Copilot resume command.',
            });
        } finally {
            setResumeLaunching(false);
        }
    };

    return (
        <div id="detail-panel" className="chat-layout flex-1 flex flex-col min-h-0">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <div className="flex items-center gap-2">
                    {onBack && (
                        <button
                            className="text-sm text-[#0078d4] hover:text-[#005a9e] dark:text-[#3794ff] dark:hover:text-[#60aeff] mr-1"
                            onClick={onBack}
                            data-testid="queue-detail-back-btn"
                        >
                            ← Back
                        </button>
                    )}
                    {task && (
                        <Badge status={task.status}>
                            {statusIcon(task.status)} {statusLabel(task.status)}
                        </Badge>
                    )}
                    {task?.duration != null && (
                        <span className="text-xs text-[#848484]">{formatDuration(task.duration)}</span>
                    )}
                    {!isPending && (
                        <>
                            {resumeSessionId && (
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
                            <ConversationMetadataPopover process={metadataProcess} turnsCount={turns.length} />
                        </>
                    )}
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        if (location.hash !== '#processes') {
                            location.hash = '#processes';
                        } else {
                            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
                        }
                    }}
                >
                    ✕
                </Button>
            </div>

            {/* Prompt (non-pending tasks) */}
            {!isPending && task?.prompt && (
                <div className="px-4 py-2 text-sm text-[#1e1e1e] dark:text-[#cccccc] border-b border-[#e0e0e0] dark:border-[#3c3c3c] break-words">
                    {task.prompt}
                </div>
            )}

            {/* Content area */}
            <div className="relative flex-1 min-h-0">
                <div id="queue-task-conversation" className="flex-1 min-h-0 overflow-y-auto p-4 h-full">
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
                                    <ConversationTurnBubble key={i} turn={turn} taskId={selectedTaskId} />
                                ));
                            })()}
                        </div>
                    )}
                </div>
                <button
                    id="scroll-to-bottom-btn"
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
                    {followUpError && (
                        <div className="chat-error-bubble bubble-error text-xs text-[#f14c4c]">
                            {followUpError}
                        </div>
                    )}
                    {followUpError && lastFailedMessageRef.current && (
                        <button
                            className="retry-btn text-xs underline text-[#f14c4c]"
                            onClick={() => retryLastMessage()}
                        >
                            Retry
                        </button>
                    )}
                    {suggestions.length > 0 && !followUpSending && task?.status !== 'running' && (
                        <SuggestionChips
                            suggestions={suggestions}
                            onSelect={(text) => { setSuggestions([]); void sendFollowUp(text); }}
                            disabled={followUpInputDisabled}
                        />
                    )}
                    <ImagePreviews images={images} onRemove={removeImage} />
                    <div className="flex items-end gap-2">
                        <textarea
                            id="chat-input"
                            rows={1}
                            value={followUpInput}
                            disabled={followUpInputDisabled}
                            placeholder={followUpPlaceholder}
                            className="flex-1 min-h-[34px] max-h-28 resize-y rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 disabled:opacity-60"
                            onChange={(event) => {
                                setFollowUpInput(event.target.value);
                                if (suggestions.length > 0) setSuggestions([]);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault();
                                    void sendFollowUp();
                                }
                            }}
                            onPaste={addFromPaste}
                        />
                        <button
                            id="chat-send-btn"
                            type="button"
                            disabled={followUpInputDisabled}
                            className="h-[34px] px-3 rounded bg-[#0078d4] text-white text-sm font-medium hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => { void sendFollowUp(); }}
                        >
                            {followUpSending ? '...' : 'Send'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

// PendingTaskInfoPanel, PendingTaskPayload, MetaRow, and FilePathValue are
// now imported from their standalone modules above.
