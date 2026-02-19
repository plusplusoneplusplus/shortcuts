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
import { Badge, Spinner, Button } from '../shared';
import { ConversationTurnBubble } from '../processes/ConversationTurnBubble';
import { ConversationMetadataPopover } from '../processes/ConversationMetadataPopover';
import { formatDuration, statusIcon, statusLabel } from '../utils/format';
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

export function QueueTaskDetail() {
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

    const isPending = task?.status === 'queued';
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
            appDispatch({ type: 'CACHE_CONVERSATION', processId: selectedTaskId, turns: refreshedTurns });
            setTurns(refreshedTurns);
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
        });
    };

    const sendFollowUp = async () => {
        const content = followUpInput.trim();
        if (!content || !selectedProcessId || followUpInputDisabled) return;

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
                body: JSON.stringify({ content }),
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

    // Determine task object from queue state
    useEffect(() => {
        if (!selectedTaskId) { setTask(null); return; }
        const found = [...queueState.running, ...queueState.queued, ...queueState.history]
            .find(t => t.id === selectedTaskId);
        setTask(found || null);
    }, [selectedTaskId, queueState.running, queueState.queued, queueState.history]);

    // Fetch full task data for pending tasks (metadata + payload)
    useEffect(() => {
        if (!selectedTaskId || !isPending) { setFullTask(null); return; }
        fetchApi(`/queue/${encodeURIComponent(selectedTaskId)}`)
            .then((data: any) => setFullTask(data?.task || null))
            .catch(() => setFullTask(null));
    }, [selectedTaskId, isPending]);

    // Fetch conversation on task selection (only for non-pending tasks)
    useEffect(() => {
        if (!selectedTaskId || isPending) {
            setTurns([]);
            setProcessDetails(null);
            return;
        }

        // Check shared conversation cache
        const cached = appState.conversationCache[selectedTaskId];
        if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
            setTurns(cached.turns);
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
                    appDispatch({ type: 'CACHE_CONVERSATION', processId: selectedTaskId, turns: t });
                    setTurns(t);
                })
                .catch(() => setTurns([]))
                .finally(() => setLoading(false));
        }
    }, [selectedTaskId, selectedProcessId, isPending, appDispatch]); // eslint-disable-line react-hooks/exhaustive-deps

    // Reset follow-up state when switching tasks.
    useEffect(() => {
        setFollowUpInput('');
        setFollowUpError(null);
        setFollowUpSending(false);
        setFollowUpSessionExpired(false);
        setProcessDetails(null);
        closeFollowUpStream();
        queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTaskId]);

    // SSE streaming for running tasks
    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        if (!selectedTaskId || task?.status !== 'running') return;

        const processId = selectedProcessId || `queue_${selectedTaskId}`;
        const es = new EventSource(`/api/processes/${encodeURIComponent(processId)}/stream`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
            try {
                const turn = JSON.parse(event.data);
                appDispatch({ type: 'APPEND_TURN', processId: selectedTaskId, turn });
                setTurns(prev => [...prev, turn]);
            } catch { /* ignore */ }
        };

        es.onerror = () => {
            es.close();
            eventSourceRef.current = null;
        };

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
    const metadataProcess = processDetails || fullTask || task;

    return (
        <div className="flex-1 flex flex-col min-h-0">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <div className="flex items-center gap-2">
                    {task && (
                        <Badge status={task.status}>
                            {statusIcon(task.status)} {statusLabel(task.status)}
                        </Badge>
                    )}
                    {task?.duration != null && (
                        <span className="text-xs text-[#848484]">{formatDuration(task.duration)}</span>
                    )}
                    {!isPending && (
                        <ConversationMetadataPopover process={metadataProcess} turnsCount={turns.length} />
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
            <div id="queue-task-conversation" className="flex-1 min-h-0 overflow-y-auto p-4">
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
                        {turns.map((turn, i) => (
                            <ConversationTurnBubble key={i} turn={turn} />
                        ))}
                    </div>
                )}
            </div>

            {!isPending && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">
                    {followUpError && (
                        <div className="text-xs text-[#f14c4c]">
                            {followUpError}
                        </div>
                    )}
                    <div className="flex items-end gap-2">
                        <textarea
                            id="chat-input"
                            rows={1}
                            value={followUpInput}
                            disabled={followUpInputDisabled}
                            placeholder={followUpPlaceholder}
                            className="flex-1 min-h-[34px] max-h-28 resize-y rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 disabled:opacity-60"
                            onChange={(event) => setFollowUpInput(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.shiftKey) {
                                    event.preventDefault();
                                    void sendFollowUp();
                                }
                            }}
                        />
                        <button
                            id="chat-send-btn"
                            type="button"
                            disabled={followUpInputDisabled || !followUpInput.trim()}
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

/** Info panel for a pending (queued) task — shows metadata and prompt content. */
function PendingTaskInfoPanel({ task, onCancel, onMoveToTop }: {
    task: any;
    onCancel: () => void;
    onMoveToTop: () => void;
}) {
    if (!task) {
        return (
            <div className="flex items-center gap-2 text-[#848484] text-sm">
                <Spinner size="sm" /> Loading task info...
            </div>
        );
    }

    const name = task.displayName || task.type || 'Pending Task';
    const priorityIcons: Record<string, string> = { high: '🔥', normal: '➖', low: '🔽' };
    const priorityLabel = task.priority || 'normal';
    const created = task.createdAt ? new Date(task.createdAt).toLocaleString() : '';
    const model = task.config?.model || '';
    const workingDir = task.payload?.workingDirectory || '';
    const repoId = task.repoId || '';

    return (
        <div className="pending-task-info space-y-5">
            {/* Name */}
            <div className="flex items-center gap-2">
                <span className="text-2xl">⏳</span>
                <h2 className="text-lg font-semibold text-[#1e1e1e] dark:text-[#cccccc] m-0">{name}</h2>
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
                <MetaRow label="Task ID" value={task.id} />
                <MetaRow label="Type" value={task.type || 'unknown'} />
                <MetaRow label="Priority" value={`${priorityIcons[priorityLabel] || ''} ${priorityLabel}`} />
                {created && <MetaRow label="Created" value={created} />}
                {model && <MetaRow label="Model" value={model} />}
                {workingDir && <MetaRow label="Working Directory" value={workingDir} breakAll />}
                {repoId && <MetaRow label="Repo ID" value={repoId} breakAll />}
            </div>

            {/* Prompt / Payload */}
            <PendingTaskPayload task={task} />

            {/* Action buttons */}
            <div className="flex gap-2 pt-2">
                <Button variant="danger" size="sm" onClick={onCancel}>Cancel Task</Button>
                <Button variant="secondary" size="sm" onClick={onMoveToTop}>Move to Top</Button>
            </div>
        </div>
    );
}

function MetaRow({ label, value, breakAll }: { label: string; value: string; breakAll?: boolean }) {
    return (
        <>
            <span className="text-[#848484]">{label}</span>
            <span className={`text-[#1e1e1e] dark:text-[#cccccc] ${breakAll ? 'break-all' : ''}`}>{value}</span>
        </>
    );
}

function PendingTaskPayload({ task }: { task: any }) {
    const payload = task.payload || {};
    const type = task.type || '';

    if (type === 'follow-prompt') {
        return (
            <div>
                {payload.promptFilePath && (
                    <div className="text-xs text-[#848484] mb-2">
                        Prompt file: {payload.promptFilePath}
                    </div>
                )}
                {payload.promptContent && (
                    <>
                        <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Prompt</h3>
                        <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                            {payload.promptContent}
                        </pre>
                    </>
                )}
            </div>
        );
    }

    if (type === 'ai-clarification') {
        return (
            <div>
                {payload.filePath && (
                    <div className="text-xs text-[#848484] mb-1">File: {payload.filePath}</div>
                )}
                {payload.selectedText && (
                    <div className="text-xs text-[#848484] mb-2">
                        Selected: <code className="bg-[#f3f3f3] dark:bg-[#252526] px-1 rounded">
                            {payload.selectedText.length > 200 ? payload.selectedText.substring(0, 200) + '...' : payload.selectedText}
                        </code>
                    </div>
                )}
                {payload.prompt && (
                    <>
                        <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Prompt</h3>
                        <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                            {payload.prompt}
                        </pre>
                    </>
                )}
            </div>
        );
    }

    if (type === 'code-review') {
        return (
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Code Review Details</h3>
                <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2 text-sm">
                    {payload.commitSha && <MetaRow label="Commit SHA" value={payload.commitSha} />}
                    {payload.diffType && <MetaRow label="Diff Type" value={payload.diffType} />}
                    {payload.rulesFolder && <MetaRow label="Rules Folder" value={payload.rulesFolder} />}
                </div>
            </div>
        );
    }

    if (type === 'custom' && payload.data) {
        return (
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Payload</h3>
                <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {JSON.stringify(payload.data, null, 2)}
                </pre>
            </div>
        );
    }

    if (Object.keys(payload).length > 0) {
        return (
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Payload</h3>
                <pre className="max-h-96 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {JSON.stringify(payload, null, 2)}
                </pre>
            </div>
        );
    }

    return null;
}
