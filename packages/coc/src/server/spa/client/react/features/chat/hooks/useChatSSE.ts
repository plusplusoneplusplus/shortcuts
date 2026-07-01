import { useEffect, useRef, useCallback } from 'react';
import { cloneApiBase } from '../../../repos/cloneRegistry';
import type { ClientConversationTurn } from '../../../types/dashboard';
import type { QueuedMessage } from '../../../utils/chatUtils';

type SetTurnsAndRef = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => void;
type SetPendingQueue = (updater: ((prev: QueuedMessage[]) => QueuedMessage[]) | QueuedMessage[]) => void;

/** Snapshot of active background tasks relayed from the SDK via SSE. */
export interface BackgroundTasksState {
    backgroundAgents: Array<{ id: string; type?: string; description?: string }>;
    backgroundShells: Array<{ id: string; type?: string; description?: string }>;
    backgroundTotalActive: number;
    backgroundWaitingForDrain: boolean;
}

export interface RalphGrillPlanningProgress {
    status: 'running' | 'completed';
    depth: string;
    round: number;
    maxRounds: number;
    agentCount: number;
    agents: Array<{
        role: string;
        roleLabel: string;
        provenanceLabel: string;
        status: 'running' | 'completed' | 'empty' | 'failed';
        candidateCount: number;
    }>;
    message: string;
    warnings: string[];
}

/** Data for a pending ask-user question from the AI. */
export interface AskUserQuestion {
    batchId: string;
    questionId: string;
    question: string;
    type: 'select' | 'multi-select' | 'yes-no' | 'confirm' | 'text';
    options?: Array<{ value: string; label: string; description?: string }>;
    defaultValue?: string | string[];
    turnIndex: number;
    index: number;
    batchSize: number;
    ralphGrill?: {
        sources?: Array<{
            role: string;
            roleLabel: string;
            provider?: string;
            model?: string;
            provenanceLabel: string;
        }>;
        consolidation?: {
            kind: string;
            mergedCandidateCount: number;
        };
        planning?: {
            depth: string;
            round: number;
            maxRounds: number;
            agentOutcomes: Array<{
                role: string;
                roleLabel: string;
                provenanceLabel: string;
                status: 'completed' | 'empty' | 'failed';
                candidateCount: number;
            }>;
            consolidation: {
                rawCandidateCount: number;
                selectedQuestionCount: number;
                exactDuplicatesMerged: number;
                semanticDuplicatesMerged: number;
                conflictsConverted: number;
                duplicateOnlyAgents: string[];
            };
            warnings: string[];
        };
    };
}

export interface AskUserBatch {
    batchId: string;
    questions: AskUserQuestion[];
}

/** Live canvas create/update notification for the canvas side panel. */
export interface CanvasUpdatedEvent {
    canvasId: string;
    title: string;
    revision: number;
    editor: 'ai' | 'user';
}

/** Data for an MCP OAuth prompt from the server. */
export interface McpOAuthPromptData {
    requestId: string;
    serverName: string;
    serverUrl: string;
    authorizationUrl?: string;
}

export interface UseChatSSEOptions {
    taskId: string;
    task: any;
    processId: string | null;
    /**
     * Workspace owning this chat. When it is a remote clone, the process-event
     * SSE stream is opened against that clone's server (AC-07); local/undefined
     * keeps the default page-origin stream.
     */
    workspaceId?: string;
    setIsStreaming: (v: boolean) => void;
    setTask: (updater: (prev: any) => any) => void;
    /**
     * Optional setter for the locally-cached process details. When provided,
     * `finish()` updates `processDetails.status` synchronously so that
     * `effectiveStatus = processDetails?.status ?? task?.status` no longer
     * lags behind reality during the brief window between SSE termination
     * and the async `refreshConversation()` HTTP refresh. Without this, a
     * follow-up sent immediately after a task completes can be misrouted
     * through the active-generation path and skip the optimistic user bubble.
     */
    setProcessDetails?: (updater: (prev: any) => any) => void;
    setPendingQueue: SetPendingQueue;
    setSuggestions: (v: string[]) => void;
    setSessionTokenLimit: (v: number | undefined) => void;
    setSessionCurrentTokens: (v: number | undefined) => void;
    setSessionSystemTokens: (v: number | undefined) => void;
    setSessionToolTokens: (v: number | undefined) => void;
    setSessionConversationTokens: (v: number | undefined) => void;
    setBackgroundTasks: (v: BackgroundTasksState | null) => void;
    setRalphGrillPlanningProgress?: (v: RalphGrillPlanningProgress | null) => void;
    setTurnsAndRef: SetTurnsAndRef;
    refreshConversation: (pid: string) => Promise<void>;
    onSendComplete: () => void;
    /** Called when the server emits all `ask-user` SSE events for a batch. */
    onAskUserBatch?: (batch: AskUserBatch) => void;
    /** Called when an MCP server requires OAuth authentication. */
    onMcpOAuthRequired?: (data: McpOAuthPromptData) => void;
    /** Called when MCP OAuth completes (for auto-dismiss of prompt). */
    onMcpOAuthCompleted?: (data: McpOAuthPromptData) => void;
    /** Called when the AI creates or updates a canvas linked to this process. */
    onCanvasUpdated?: (data: CanvasUpdatedEvent) => void;
}

/** Manages the SSE EventSource for a running process and drives all streaming state updates. */
export function useChatSSE({
    taskId,
    task,
    processId,
    workspaceId,
    setIsStreaming,
    setTask,
    setProcessDetails,
    setPendingQueue,
    setSuggestions,
    setSessionTokenLimit,
    setSessionCurrentTokens,
    setSessionSystemTokens,
    setSessionToolTokens,
    setSessionConversationTokens,
    setBackgroundTasks,
    setRalphGrillPlanningProgress,
    setTurnsAndRef,
    refreshConversation,
    onSendComplete,
    onAskUserBatch,
    onMcpOAuthRequired,
    onMcpOAuthCompleted,
    onCanvasUpdated,
}: UseChatSSEOptions): { stopStreaming: () => void } {
    const eventSourceRef = useRef<EventSource | null>(null);
    const askUserBatchesRef = useRef<Map<string, Map<number, AskUserQuestion>>>(new Map());

    const stopStreaming = useCallback(() => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        setIsStreaming(false);
    }, [setIsStreaming]);

    useEffect(() => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (!taskId || task?.status !== 'running' || !processId) return;
        if (typeof EventSource === 'undefined') return;

        const es = new EventSource(`${cloneApiBase(workspaceId)}/processes/${encodeURIComponent(processId)}/stream`);
        eventSourceRef.current = es;
        setIsStreaming(true);
        const sseStartTime = Date.now();

        const ensureAssistantTurn = (prev: ClientConversationTurn[]): ClientConversationTurn[] => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') return prev;
            const nextIdx = Math.max(0, ...prev.map(t => t.turnIndex ?? -1)) + 1;
            return [...prev, { role: 'assistant', content: '', streaming: true, timeline: [], turnIndex: nextIdx }];
        };

        es.addEventListener('conversation-snapshot', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (data.turns) setTurnsAndRef(data.turns);
                if (typeof data.sessionTokenLimit === 'number') setSessionTokenLimit(data.sessionTokenLimit);
                if (typeof data.sessionCurrentTokens === 'number') setSessionCurrentTokens(data.sessionCurrentTokens);
                if (typeof data.sessionSystemTokens === 'number') setSessionSystemTokens(data.sessionSystemTokens);
                if (typeof data.sessionToolTokens === 'number') setSessionToolTokens(data.sessionToolTokens);
                if (typeof data.sessionConversationTokens === 'number') setSessionConversationTokens(data.sessionConversationTokens);
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
                            const tl = last.timeline || [];
                            const lastItem = tl[tl.length - 1];
                            if (lastItem && lastItem.type === 'content') {
                                return [...tl.slice(0, -1), { ...lastItem, content: (lastItem.content || '') + chunk }];
                            }
                            return [...tl, { type: 'content' as const, timestamp: new Date().toISOString(), content: chunk }];
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

        es.addEventListener('message-queued', (_event: Event) => {
            // Acknowledged — the server has committed the user turn.
            // No client-side queue reconciliation needed; pending follow-ups
            // arrive via the 'pending-message-added' event instead.
        });

        es.addEventListener('message-steering', (_event: Event) => {
            // Acknowledged — steering succeeded. The message content is being
            // injected into the live session. No queue item to update since
            // immediate-steer messages don't create local pending entries.
        });

        es.addEventListener('pending-message-added', (event: Event) => {
            try {
                const { pendingMessage } = JSON.parse((event as MessageEvent).data);
                if (pendingMessage?.id) {
                    setPendingQueue(prev => {
                        // Avoid duplicates — another tab may have already added this entry
                        if (prev.some(m => m.id === pendingMessage.id)) return prev;
                        return [...prev, {
                            id: pendingMessage.id,
                            content: pendingMessage.content,
                            status: 'queued' as const,
                            ...(Array.isArray(pendingMessage.images) && pendingMessage.images.length > 0
                                ? { images: pendingMessage.images }
                                : {}),
                        }];
                    });
                }
            } catch { /* ignore */ }
        });

        const closeSSE = () => {
            es.close();
            eventSourceRef.current = null;
            setIsStreaming(false);
        };

        const finish = (finalStatus: 'completed' | 'failed' | 'cancelled' = 'completed') => {
            const costTimeMs = Date.now() - sseStartTime;
            closeSSE();
            setBackgroundTasks(null);
            setRalphGrillPlanningProgress?.(null);
            // Flip non-terminal status (running OR a stale synthesised `queued`
            // from the queue route fallback) to terminal so the UI doesn't lag
            // behind the SSE close event.
            const NON_TERMINAL = new Set(['running', 'queued', 'cancelling']);
            setTask(prev => prev && NON_TERMINAL.has(prev.status) ? { ...prev, status: finalStatus } : prev);
            // Mirror the terminal status onto the locally-cached processDetails so
            // `effectiveStatus = processDetails?.status ?? task?.status` flips to
            // terminal in the same render. Without this, a follow-up sent in the
            // window before refreshConversation() resolves is misrouted through
            // the active-generation enqueue path and the optimistic user bubble
            // is skipped, leaving the new message invisible until the user
            // re-selects the chat.
            setProcessDetails?.(prev => prev && NON_TERMINAL.has(prev.status)
                ? { ...prev, status: finalStatus, endTime: prev.endTime ?? new Date().toISOString() }
                : prev);
            // Stamp costTimeMs on the last assistant turn before server refresh
            setTurnsAndRef(prev => {
                for (let i = prev.length - 1; i >= 0; i--) {
                    if (prev[i].role === 'assistant') {
                        const updated = [...prev];
                        updated[i] = { ...updated[i], costTimeMs };
                        return updated;
                    }
                }
                return prev;
            });
            void refreshConversation(processId);
            // Server drains one pending message on task completion; sync
            // the queued section from the refreshed process data.
            setPendingQueue([]);
            onSendComplete();
        };

        es.addEventListener('done', () => finish('completed'));
        es.addEventListener('status', (e: Event) => {
            try {
                const status = JSON.parse((e as MessageEvent).data)?.status;
                if (status && !['running', 'queued'].includes(status))
                    finish(status as 'completed' | 'failed' | 'cancelled');
            } catch { /* ignore */ }
        });

        // SSE auto-reconnects natively on transient errors. Only close
        // permanently when the task reaches a terminal status (handled by
        // finish()) or the component unmounts (handled by cleanup return).
        // Track consecutive errors and fall back to a full refresh if the
        // connection keeps failing.
        let consecutiveErrors = 0;
        const MAX_SSE_ERRORS = 5;

        es.onerror = () => {
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_SSE_ERRORS) {
                // Too many consecutive errors — give up and refresh
                closeSSE();
                void refreshConversation(processId);
            }
            // Otherwise let EventSource auto-reconnect
        };

        // Reset error count on successful reconnection
        es.onopen = () => {
            consecutiveErrors = 0;
        };

        es.addEventListener('suggestions', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (Array.isArray(data.suggestions)) setSuggestions(data.suggestions);
            } catch { /* ignore */ }
        });

        es.addEventListener('token-usage', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (typeof data.sessionTokenLimit === 'number') setSessionTokenLimit(data.sessionTokenLimit);
                if (typeof data.sessionCurrentTokens === 'number') setSessionCurrentTokens(data.sessionCurrentTokens);
                if (typeof data.sessionSystemTokens === 'number') setSessionSystemTokens(data.sessionSystemTokens);
                if (typeof data.sessionToolTokens === 'number') setSessionToolTokens(data.sessionToolTokens);
                if (typeof data.sessionConversationTokens === 'number') setSessionConversationTokens(data.sessionConversationTokens);
                if (data.tokenUsage && typeof data.turnIndex === 'number') {
                    setTurnsAndRef(prev => prev.map(t =>
                        t.turnIndex === data.turnIndex && t.role === 'assistant'
                            ? { ...t, tokenUsage: data.tokenUsage }
                            : t
                    ));
                }
                const processUpdates: Record<string, unknown> = {};
                if (data.cumulativeTokenUsage && typeof data.cumulativeTokenUsage === 'object') {
                    processUpdates.cumulativeTokenUsage = data.cumulativeTokenUsage;
                }
                if (data.conversationCostEstimate && typeof data.conversationCostEstimate === 'object') {
                    processUpdates.conversationCostEstimate = data.conversationCostEstimate;
                }
                if (Object.keys(processUpdates).length > 0) {
                    setProcessDetails?.(prev => prev ? { ...prev, ...processUpdates } : prev);
                }
            } catch { /* ignore */ }
        });

        es.addEventListener('background-tasks', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                setBackgroundTasks({
                    backgroundAgents: data.backgroundAgents ?? [],
                    backgroundShells: data.backgroundShells ?? [],
                    backgroundTotalActive: data.backgroundTotalActive ?? 0,
                    backgroundWaitingForDrain: data.backgroundWaitingForDrain ?? false,
                });
            } catch { /* ignore */ }
        });

        es.addEventListener('ralph-grill-planning', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if ((data?.status === 'running' || data?.status === 'completed') && Array.isArray(data.agents)) {
                    setRalphGrillPlanningProgress?.({
                        status: data.status,
                        depth: typeof data.depth === 'string' ? data.depth : 'standard',
                        round: typeof data.round === 'number' ? data.round : 1,
                        maxRounds: typeof data.maxRounds === 'number'
                            ? data.maxRounds
                            : (typeof data.round === 'number' ? data.round : 1),
                        agentCount: typeof data.agentCount === 'number' ? data.agentCount : data.agents.length,
                        agents: data.agents.map((agent: any) => ({
                            role: typeof agent.role === 'string' ? agent.role : 'unknown',
                            roleLabel: typeof agent.roleLabel === 'string' ? agent.roleLabel : 'Unknown Agent',
                            provenanceLabel: typeof agent.provenanceLabel === 'string' ? agent.provenanceLabel : 'Unknown Agent · model unavailable',
                            status: ['running', 'completed', 'empty', 'failed'].includes(agent.status) ? agent.status : 'running',
                            candidateCount: typeof agent.candidateCount === 'number' ? agent.candidateCount : 0,
                        })),
                        message: typeof data.message === 'string' ? data.message : 'Planning Ralph grill questions.',
                        warnings: Array.isArray(data.warnings) ? data.warnings.filter((warning: unknown): warning is string => typeof warning === 'string') : [],
                    });
                }
            } catch { /* ignore */ }
        });

        es.addEventListener('ask-user', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (data.batchId && data.questionId && data.question && typeof data.index === 'number' && typeof data.batchSize === 'number') {
                    const question = data as AskUserQuestion;
                    const batch = askUserBatchesRef.current.get(question.batchId) ?? new Map<number, AskUserQuestion>();
                    batch.set(question.index, question);
                    askUserBatchesRef.current.set(question.batchId, batch);
                    if (batch.size >= question.batchSize) {
                        askUserBatchesRef.current.delete(question.batchId);
                        setRalphGrillPlanningProgress?.(null);
                        onAskUserBatch?.({
                            batchId: question.batchId,
                            questions: Array.from(batch.values()).sort((a, b) => a.index - b.index),
                        });
                    }
                }
            } catch { /* ignore */ }
        });

        es.addEventListener('mcp-oauth-required', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data) as McpOAuthPromptData;
                onMcpOAuthRequired?.(data);
            } catch { /* ignore */ }
        });

        es.addEventListener('mcp-oauth-completed', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data) as McpOAuthPromptData;
                onMcpOAuthCompleted?.(data);
            } catch { /* ignore */ }
        });

        es.addEventListener('canvas-updated', (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                if (typeof data?.canvasId === 'string' && typeof data?.revision === 'number') {
                    onCanvasUpdated?.({
                        canvasId: data.canvasId,
                        title: typeof data.title === 'string' ? data.title : '',
                        revision: data.revision,
                        editor: data.editor === 'user' ? 'user' : 'ai',
                    });
                }
            } catch { /* ignore */ }
        });

        return () => { es.close(); eventSourceRef.current = null; setIsStreaming(false); };
    }, [taskId, task?.status, processId, workspaceId, refreshConversation]); // eslint-disable-line react-hooks/exhaustive-deps

    return { stopStreaming };
}
