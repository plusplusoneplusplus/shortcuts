/**
 * WorkItemExecutionSession — read-only panel for a work item's queued-task execution.
 *
 * States:
 *   queued    — Shows queue position, metadata (model, priority, created, working dir),
 *               and the resolved prompt.
 *   running   — Automatically transitions to a live SSE stream via useChatSSE.
 *   completed / failed / cancelled — Final conversation in read-only mode.
 *
 * Input box and send button never appear at any point.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { getSpaCocClient } from '../../api/cocClient';
import { Badge, Spinner } from '../../ui';
import { ConversationArea } from '../chat/ConversationArea';
import { ConversationMiniMap } from '../chat/conversation/ConversationMiniMap';
import { useQueuedTaskPoll } from '../../queue/hooks/useQueuedTaskPoll';
import { useChatSSE } from '../chat/hooks/useChatSSE';
import { getConversationTurns } from '../chat/conversation/chatConversationUtils';
import { MetaRow, FilePathValue } from '../../queue/PendingTaskPayload';
import type { ClientConversationTurn } from '../../types/dashboard';
import type { ChatProvider } from '../chat/ProviderBadge';

export interface WorkItemExecutionSessionProps {
    taskId: string;
    workspaceId?: string;
    onBack: () => void;
}

export function WorkItemExecutionSession({ taskId, workspaceId, onBack }: WorkItemExecutionSessionProps) {
    const [task, setTask] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const turnsRef = useRef<ClientConversationTurn[]>([]);
    const [processDetails, setProcessDetails] = useState<any>(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const [resolvedPrompt, setResolvedPrompt] = useState<any>(null);
    const [queuePosition, setQueuePosition] = useState<number | null>(null);
    const [isScrolledUp, setIsScrolledUp] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const turnsContainerRef = useRef<HTMLDivElement | null>(null);
    const isInitialRef = useRef(true);

    const processId: string | null = task?.processId ?? (taskId ? `queue_${taskId}` : null);
    const isPending = task?.status === 'queued';
    const isRunning = task?.status === 'running';

    const setTurnsAndRef = useCallback((
        next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[]),
    ) => {
        const resolved = typeof next === 'function' ? next(turnsRef.current) : next;
        turnsRef.current = resolved;
        setTurns(resolved);
    }, []);

    const refreshConversation = useCallback(async (pid: string) => {
        try {
            const data = await getSpaCocClient().processes.get(pid);
            setProcessDetails(data?.process ?? null);
            const refreshedTurns = getConversationTurns(data);
            // Preserve client-only costTimeMs across server refresh
            setTurnsAndRef(prev => {
                const costTimeMap = new Map<number, number>();
                for (const t of prev) {
                    if (t.costTimeMs != null && t.turnIndex != null) {
                        costTimeMap.set(t.turnIndex, t.costTimeMs);
                    }
                }
                if (costTimeMap.size === 0) return refreshedTurns;
                return refreshedTurns.map(t => {
                    const ct = t.turnIndex != null ? costTimeMap.get(t.turnIndex) : undefined;
                    return ct != null ? { ...t, costTimeMs: ct } : t;
                });
            });
        } catch { /* keep current turns on error */ }
    }, [setTurnsAndRef]);

    // Load task and conversation on mount / taskId change
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setTask(null);
        setTurnsAndRef([]);
        setProcessDetails(null);
        setResolvedPrompt(null);
        setQueuePosition(null);
        isInitialRef.current = true;

        (async () => {
            try {
                const queueData = await getSpaCocClient().queue.getTask(taskId);
                if (cancelled) return;
                const loadedTask = queueData?.task ?? null;
                setTask(loadedTask);

                if (!loadedTask) return;

                // Queued with no process yet — show prompt as a user bubble
                if (loadedTask.status === 'queued' && !loadedTask.processId) {
                    if (loadedTask.payload?.prompt) {
                        setTurnsAndRef([{ role: 'user', content: loadedTask.payload.prompt, timeline: [] }]);
                    }
                    return;
                }

                const pid = loadedTask.processId ?? `queue_${taskId}`;
                const procData = await getSpaCocClient().processes.get(pid);
                if (cancelled) return;

                setProcessDetails(procData?.process ?? null);
                const loadedTurns = getConversationTurns(procData, loadedTask);

                if (loadedTask.status === 'running') {
                    const lastTurn = loadedTurns[loadedTurns.length - 1];
                    if (lastTurn?.role === 'assistant') {
                        setTurnsAndRef(loadedTurns.map((t: ClientConversationTurn, i: number) =>
                            i === loadedTurns.length - 1 ? { ...t, streaming: true } : t,
                        ));
                    } else {
                        const nextIdx = Math.max(0, ...loadedTurns.map((t: ClientConversationTurn) => t.turnIndex ?? -1)) + 1;
                        setTurnsAndRef([...loadedTurns, { role: 'assistant', content: '', streaming: true, timeline: [], turnIndex: nextIdx }]);
                    }
                } else {
                    setTurnsAndRef(loadedTurns);
                }
            } catch { /* ignore load errors */ } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [taskId, setTurnsAndRef]);

    // Fetch resolved prompt while task is queued
    useEffect(() => {
        if (!isPending || !taskId) return;
        getSpaCocClient().queue.resolvedPrompt(taskId)
            .then((data: any) => { if (data) setResolvedPrompt(data); })
            .catch(() => { /* non-fatal */ });
    }, [taskId, isPending]);

    // Derive queue position while task is queued
    useEffect(() => {
        if (!isPending) { setQueuePosition(null); return; }
        getSpaCocClient().queue.list()
            .then((data: any) => {
                const queued: any[] = data?.queued ?? [];
                const idx = queued.findIndex((t: any) => t.id === taskId);
                setQueuePosition(idx >= 0 ? idx + 1 : null);
            })
            .catch(() => { /* non-fatal */ });
    }, [taskId, isPending]);

    // Track scroll position for the "scroll to bottom" button
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onScroll = () => setIsScrolledUp(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
        el.addEventListener('scroll', onScroll);
        return () => el.removeEventListener('scroll', onScroll);
    }, [taskId]);

    // Auto-scroll to bottom on new turns (initial load snaps; subsequent appends only scroll when already near bottom)
    useEffect(() => {
        if (!loading && turns.length > 0 && scrollRef.current) {
            const el = scrollRef.current;
            if (isInitialRef.current) {
                isInitialRef.current = false;
                requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
            } else if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
                el.scrollTop = el.scrollHeight;
            }
        }
    }, [turns, loading]);

    // Poll every 2s while queued → transitions to running
    useQueuedTaskPoll({ taskId, task, setTask, setProcessDetails, setTurnsAndRef });

    // Live SSE stream while running → transitions to completed / failed
    useChatSSE({
        taskId,
        task,
        processId,
        setIsStreaming,
        setTask,
        setPendingQueue: () => {},
        setSuggestions: () => {},
        setSessionTokenLimit: () => {},
        setSessionCurrentTokens: () => {},
        setSessionSystemTokens: () => {},
        setSessionToolTokens: () => {},
        setSessionConversationTokens: () => {},
        setBackgroundTasks: () => {},
        setTurnsAndRef,
        refreshConversation,
        onSendComplete: () => {},
    });

    // ── Per-turn actions: delete, pin, archive ──
    const [undoDelete, setUndoDelete] = useState<{ turnIndex: number; timer: ReturnType<typeof setTimeout> } | null>(null);

    const handleDeleteTurn = useCallback((turnIndex: number) => {
        if (!processId) return;
        setTurns(prev => prev.map(t => t.turnIndex === turnIndex ? { ...t, deletedAt: new Date().toISOString() } : t));
        getSpaCocClient().request(`/processes/${encodeURIComponent(processId)}/turns/${turnIndex}`, { method: 'DELETE' }).catch(() => {
            setTurns(prev => prev.map(t => t.turnIndex === turnIndex ? { ...t, deletedAt: undefined } : t));
        });
        if (undoDelete) clearTimeout(undoDelete.timer);
        const timer = setTimeout(() => setUndoDelete(null), 5000);
        setUndoDelete({ turnIndex, timer });
    }, [processId, undoDelete]);

    const handleUndoDelete = useCallback(() => {
        if (!undoDelete || !processId) return;
        clearTimeout(undoDelete.timer);
        const { turnIndex } = undoDelete;
        setUndoDelete(null);
        setTurns(prev => prev.map(t => t.turnIndex === turnIndex ? { ...t, deletedAt: undefined } : t));
        getSpaCocClient().request(`/processes/${encodeURIComponent(processId)}/turns/${turnIndex}/restore`, {
            method: 'PATCH',
            body: {},
        }).catch(() => {});
    }, [undoDelete, processId]);

    const handlePinTurn = useCallback((turnIndex: number, pinned: boolean) => {
        if (!processId) return;
        setTurns(prev => prev.map(t =>
            t.turnIndex === turnIndex
                ? { ...t, pinnedAt: pinned ? new Date().toISOString() : undefined, archived: pinned ? false : t.archived }
                : t
        ));
        getSpaCocClient().request(`/processes/${encodeURIComponent(processId)}/turns/${turnIndex}/pin`, {
            method: 'PATCH',
            body: { pinned },
        }).catch(() => {
            setTurns(prev => prev.map(t =>
                t.turnIndex === turnIndex
                    ? { ...t, pinnedAt: pinned ? undefined : new Date().toISOString() }
                    : t
            ));
        });
    }, [processId]);

    const handleArchiveTurn = useCallback((turnIndex: number, archived: boolean) => {
        if (!processId) return;
        setTurns(prev => prev.map(t =>
            t.turnIndex === turnIndex ? { ...t, archived } : t
        ));
        getSpaCocClient().request(`/processes/${encodeURIComponent(processId)}/turns/${turnIndex}/archive`, {
            method: 'PATCH',
            body: { archived },
        }).catch(() => {
            setTurns(prev => prev.map(t =>
                t.turnIndex === turnIndex ? { ...t, archived: !archived } : t
            ));
        });
    }, [processId]);

    // ── Derived display values ──────────────────────────────────────────────
    const statusLabel =
        task?.status === 'queued'    ? 'Queued'    :
        task?.status === 'running'   ? 'Running'   :
        task?.status === 'completed' ? 'Completed' :
        task?.status === 'failed'    ? 'Failed'    :
        task?.status === 'cancelled' ? 'Cancelled' :
        (task?.status ?? '—');

    const badgeStatus =
        task?.status === 'running'   ? 'running'   :
        task?.status === 'completed' ? 'completed' :
        task?.status === 'failed'    ? 'failed'    :
        task?.status === 'cancelled' ? 'cancelled' :
        'queued';

    const displayName = task?.displayName || 'Execution Session';
    const model: string | undefined       = task?.config?.model;
    const priority: string | undefined    = task?.priority;
    const createdAt: string | undefined   = task?.createdAt;
    const workingDir: string | undefined  = task?.payload?.workingDirectory;

    const hasMetadata = !!(model || priority || createdAt || workingDir);

    // ── Loading splash ──────────────────────────────────────────────────────
    if (loading && !task) {
        return (
            <div className="flex items-center justify-center h-full gap-2 text-sm text-[#848484]" data-testid="work-item-execution-session-loading">
                <Spinner size="sm" />Loading session…
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full" data-testid="work-item-execution-session">
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#474749] flex items-center gap-2 shrink-0">
                <button
                    onClick={onBack}
                    className="text-sm text-[#848484] hover:text-[#333] dark:hover:text-[#ccc] shrink-0"
                    data-testid="execution-session-back-btn"
                    aria-label="Back to work item"
                >←</button>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">{displayName}</span>
                        <Badge status={badgeStatus}>{statusLabel}</Badge>
                        {isRunning && <Spinner size="sm" />}
                    </div>
                    {(model || (priority && priority !== 'normal')) && (
                        <div className="flex items-center gap-2 text-[10px] text-[#848484] dark:text-[#999] mt-0.5 flex-wrap">
                            {model && <span>Model: {model}</span>}
                            {priority && priority !== 'normal' && <span className="capitalize">Priority: {priority}</span>}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Body ───────────────────────────────────────────────────── */}
            {isPending ? (
                /* Queued — show position, metadata, and resolved prompt */
                <div className="flex-1 overflow-y-auto p-4 space-y-4" data-testid="execution-session-queued-body">
                    {/* Queue position */}
                    <div className="flex items-center gap-2 text-sm" data-testid="execution-session-queue-position">
                        <span className="text-lg select-none">⏳</span>
                        {queuePosition !== null
                            ? <span className="text-[#848484] dark:text-[#999]">
                                Position <strong className="text-[#3c3c3c] dark:text-[#cccccc]">#{queuePosition}</strong> in queue
                              </span>
                            : <span className="text-[#848484] dark:text-[#999]">Waiting in queue…</span>
                        }
                    </div>

                    {/* Metadata grid */}
                    {hasMetadata && (
                        <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1.5 text-sm bg-[#fafafa] dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded-md p-3" data-testid="execution-session-metadata">
                            {model     && <MetaRow label="Model"       value={model} />}
                            {priority  && <MetaRow label="Priority"    value={priority} />}
                            {createdAt && <MetaRow label="Created"     value={new Date(createdAt).toLocaleString()} />}
                            {workingDir && <FilePathValue label="Working Dir" value={workingDir} />}
                        </div>
                    )}

                    {/* Resolved prompt (async-loaded) */}
                    {resolvedPrompt && (resolvedPrompt.resolvedPrompt || resolvedPrompt.planFileContent || resolvedPrompt.promptFileContent) && (
                        <details open data-testid="execution-session-resolved-prompt">
                            <summary className="cursor-pointer text-xs font-semibold text-[#848484] dark:text-[#999] uppercase tracking-wide pb-2">
                                Resolved Prompt
                            </summary>
                            {resolvedPrompt.planFileContent && (
                                <pre className="max-h-64 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-1">
                                    {resolvedPrompt.planFileContent}
                                </pre>
                            )}
                            {resolvedPrompt.promptFileContent && (
                                <pre className="max-h-64 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-2">
                                    {resolvedPrompt.promptFileContent}
                                </pre>
                            )}
                            {resolvedPrompt.resolvedPrompt && !resolvedPrompt.planFileContent && !resolvedPrompt.promptFileContent && (
                                <pre className="max-h-64 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-1">
                                    {resolvedPrompt.resolvedPrompt}
                                </pre>
                            )}
                        </details>
                    )}

                    {/* Fallback: raw payload prompt while resolved prompt hasn't loaded */}
                    {!resolvedPrompt && task?.payload?.prompt && (
                        <details open>
                            <summary className="cursor-pointer text-xs font-semibold text-[#848484] dark:text-[#999] uppercase tracking-wide pb-2">
                                Prompt
                            </summary>
                            <pre className="max-h-64 overflow-auto p-3 rounded-md text-xs whitespace-pre-wrap break-words bg-[#f3f3f3] dark:bg-[#2d2d2d] border border-[#e0e0e0] dark:border-[#3c3c3c] mt-1">
                                {task.payload.prompt}
                            </pre>
                        </details>
                    )}
                </div>
            ) : (
                /* Running / completed / failed — conversation area */
                <div className="relative flex-1 min-h-0 flex overflow-x-hidden min-w-0">
                    <ConversationArea
                        loading={loading}
                        error={null}
                        turns={turns}
                        pendingQueue={[]}
                        isScrolledUp={isScrolledUp}
                        scrollRef={scrollRef}
                        turnsContainerRef={turnsContainerRef}
                        onScrollToBottom={() => {
                            if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                        }}
                        isPending={false}
                        task={task}
                        fullTask={null}
                        onCancel={() => {}}
                        onMoveToTop={() => {}}
                        variant="inline"
                        taskId={taskId}
                        processId={processId ?? undefined}
                        wsId={workspaceId}
                        onDeleteTurn={handleDeleteTurn}
                        onPinTurn={handlePinTurn}
                        onArchiveTurn={handleArchiveTurn}
                        undoDeleteTurnIndex={undoDelete?.turnIndex ?? null}
                        onUndoDelete={handleUndoDelete}
                        provider={(() => {
                            const raw = processDetails?.metadata?.provider ?? task?.metadata?.provider;
                            return raw === 'codex' || raw === 'claude' || raw === 'copilot'
                                ? (raw as ChatProvider)
                                : undefined;
                        })()}
                    />
                    <ConversationMiniMap
                        turns={turns}
                        scrollContainerRef={scrollRef}
                        turnsContainerRef={turnsContainerRef}
                        isStreaming={isRunning}
                    />
                </div>
            )}
            {/* No follow-up input — this panel is read-only */}
        </div>
    );
}
