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
import { ToolCallView } from '../processes/ToolCallView';
import { MarkdownView } from '../processes/MarkdownView';
import { formatDuration, statusIcon, statusLabel } from '../utils/format';
import type { ClientConversationTurn } from '../types/dashboard';

const CACHE_TTL_MS = 60 * 60 * 1000;

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
    const [task, setTask] = useState<any>(null);
    const [fullTask, setFullTask] = useState<any>(null);
    const eventSourceRef = useRef<EventSource | null>(null);

    const isPending = task?.status === 'queued';
    const selectedProcessId = task?.processId || (selectedTaskId ? `queue_${selectedTaskId}` : null);

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
        if (!selectedTaskId || isPending) { setTurns([]); return; }

        // Check shared conversation cache
        const cached = appState.conversationCache[selectedTaskId];
        if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
            setTurns(cached.turns);
            setLoading(false);
        } else {
            setLoading(true);
            fetchApi(`/processes/${encodeURIComponent(selectedProcessId || `queue_${selectedTaskId}`)}`)
                .then((data: any) => {
                    const t = getConversationTurns(data);
                    appDispatch({ type: 'CACHE_CONVERSATION', processId: selectedTaskId, turns: t });
                    setTurns(t);
                })
                .catch(() => setTurns([]))
                .finally(() => setLoading(false));
        }
    }, [selectedTaskId, selectedProcessId, isPending, appDispatch]); // eslint-disable-line react-hooks/exhaustive-deps

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

    if (!selectedTaskId) return null;

    const handleCancel = async () => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(selectedTaskId), { method: 'DELETE' });
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null });
    };

    const handleMoveToTop = async () => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(selectedTaskId) + '/move-to-top', { method: 'POST' });
    };

    return (
        <div className="fixed inset-0 z-[10001] flex items-stretch justify-end bg-black/30 dark:bg-black/50"
             onClick={() => queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null })}>
            <div className="w-full max-w-2xl bg-white dark:bg-[#1e1e1e] border-l border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden"
                 onClick={e => e.stopPropagation()}>
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
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null })}
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
                <div className="flex-1 overflow-y-auto p-4">
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
                                <div key={i} className="space-y-1">
                                    {turn.content && <MarkdownView html={turn.content} />}
                                    {turn.toolCalls?.map((tc, j) => (
                                        <ToolCallView key={tc.id || j} toolCall={tc} />
                                    ))}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
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
