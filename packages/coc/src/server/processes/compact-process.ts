/**
 * Compacts (summarizes) a chat's live provider session to shrink the model's
 * context-window usage on the NEXT turn. Shared by `POST /api/processes/:id/compact`
 * and the Teams/WhatsApp `compact` command. Busy conversations admit a durable
 * task after existing buffered/queued turns; idle compaction returns its result.
 *
 * Non-destructive to CoC's stored transcript: the provider session's history is
 * summarized in place and a display-only result turn is appended.
 *
 * Failures throw `APIError`:
 *   - process has no SDK session               → 400
 *   - busy without a queue bridge              → 409 CONVERSATION_NOT_IDLE
 *   - provider does not support compaction     → 422 COMPACT_UNSUPPORTED
 *   - any other provider failure               → 500
 */

import type {
    AIProcess, AIProcessStatus, GenericProcessMetadata, ProcessCompactionState, ProcessStore,
} from '@plusplusoneplusplus/forge';
import { randomUUID } from 'crypto';
import type { QueueExecutorBridge } from '../core/api-handler';
import { processOperationAdmission } from './process-operation-admission';
import { pendingMessageTask } from './queued-pending-message';
import { APIError, badRequest, internalError } from '../errors';
import type { ChatProvider } from '../tasks/task-types';
import { readActiveProviderSession, turnProviderAttribution } from './active-provider-session';

/** Terminal statuses: the only ones idle enough to compact. */
const IDLE_STATUSES: Set<string> = new Set(['completed', 'failed', 'cancelled']);
const compactionAdmissions = new Map<string, Promise<CompactProcessOutcome>>();

export interface CompactProcessOutcome {
    /** The provider's raw compaction result (the route's JSON response). */
    result: any;
    /** Context tokens before compaction, when known. */
    tokensBefore?: number;
    /** Context tokens after compaction, when known. */
    tokensAfter?: number;
    /** Present when admitted for later execution. */
    taskId?: string;
}

/** A finite, non-negative number, or `undefined` for anything else. */
function usageNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Resolve the context-window fields to persist after a successful compaction.
 *
 * A provider-supplied `contextUsage` snapshot wins field-for-field. Anything the
 * provider did not supply is derived by subtraction: compaction summarizes the
 * conversation history and leaves the system prompt and tool definitions alone,
 * so a known total reduction is charged entirely to the conversation segment.
 * That keeps the segmented bar internally coherent, which it would not be if
 * only the total moved. Clamping at 0 is safe to persist — the stores skip only
 * `undefined`, so a `0` writes as `0`.
 *
 * Returns `undefined` (write nothing) when the compaction failed, or when there
 * is neither a snapshot nor a usable prior total to subtract from — a compaction
 * that freed nothing must not write a usage row.
 */
export function resolvePostCompactionUsage(
    proc: AIProcess,
    result: { success?: boolean; contextUsage?: Record<string, unknown> } | undefined,
    tokensRemoved: number,
): Partial<AIProcess> | undefined {
    if (!result?.success) return undefined;
    const snapshot = result.contextUsage;
    const hasSnapshot = Boolean(snapshot && Object.keys(snapshot).length > 0);
    const priorCurrent = usageNumber(proc.currentTokens);
    if (!hasSnapshot && (priorCurrent == null || tokensRemoved <= 0)) return undefined;

    const subtract = (prior: number | undefined): number | undefined =>
        prior == null ? undefined : Math.max(0, prior - tokensRemoved);

    const usage: Partial<AIProcess> = {};
    const currentTokens = usageNumber(snapshot?.currentTokens) ?? subtract(priorCurrent);
    if (currentTokens != null) usage.currentTokens = currentTokens;
    const conversationTokens = usageNumber(snapshot?.conversationTokens)
        ?? subtract(usageNumber(proc.conversationTokens));
    if (conversationTokens != null) usage.conversationTokens = conversationTokens;
    // The untouched segments are only written when the provider measured them;
    // otherwise the stored values already hold.
    const tokenLimit = usageNumber(snapshot?.tokenLimit);
    if (tokenLimit != null) usage.tokenLimit = tokenLimit;
    const systemTokens = usageNumber(snapshot?.systemTokens);
    if (systemTokens != null) usage.systemTokens = systemTokens;
    const toolDefinitionsTokens = usageNumber(snapshot?.toolDefinitionsTokens);
    if (toolDefinitionsTokens != null) usage.toolDefinitionsTokens = toolDefinitionsTokens;

    return Object.keys(usage).length > 0 ? usage : undefined;
}

/** The guard error that prevents compacting `proc` right now, if any. */
export function compactGuardError(proc: AIProcess): APIError | undefined {
    if (!readActiveProviderSession(proc).sessionId) {
        return badRequest('Process has no SDK session to compact');
    }
    // Idle guard: a running/queued/cancelling status — or any buffered
    // pending message — would race the compaction. Mirror the rewind guard.
    if (!IDLE_STATUSES.has(proc.status) || (proc.pendingMessages?.length ?? 0) > 0) {
        return new APIError(409, 'Conversation must be idle (not running, queued, or streaming) to compact.', 'CONVERSATION_NOT_IDLE');
    }
    return undefined;
}

export async function compactProcess(
    store: Pick<ProcessStore, 'updateProcess' | 'emitProcessEvent' | 'appendConversationTurn'>,
    proc: AIProcess,
    customInstructions?: string,
    bridge?: QueueExecutorBridge,
    onQueued?: (taskId: string) => void,
): Promise<CompactProcessOutcome> {
    if (bridge) {
        const fullStore = store as ProcessStore;
        const key = `${proc.metadata?.workspaceId ?? ''}\0${proc.id}`;
        const existingAdmission = compactionAdmissions.get(key);
        if (existingAdmission) return existingAdmission;
        const operation = processOperationAdmission.runExclusive(proc.id, async () => {
            const current = await fullStore.getProcess(proc.id, proc.metadata?.workspaceId) ?? proc;
            const pending = current.metadata?.compaction;
            const task = bridge.findCompactionTask?.(current.id)
                ?? (pending?.taskId ? bridge.getTask?.(pending.taskId) : undefined);
            if (task?.status === 'queued' || task?.status === 'running') {
                return { taskId: task.id, result: { state: task.status, taskId: task.id } };
            }
            const owningTask = bridge.findTaskByProcessId?.(current.id);
            const busy = !IDLE_STATUSES.has(current.status) || !!current.pendingMessages?.length
                || owningTask?.status === 'queued' || owningTask?.status === 'running';
            if (!busy) return compactProcess(store, current, customInstructions);
            if (!bridge.enqueue) throw compactGuardError(current) ?? internalError('Queue unavailable');
            // An admitted first turn may not have reported its session yet. Execution validates its latest binding.
            if (!readActiveProviderSession(current).sessionId && !owningTask) {
                throw badRequest('Process has no SDK session to compact');
            }
            for (const message of current.pendingMessages ?? []) {
                const input = pendingMessageTask(current, message);
                if (!bridge.getTask?.(input.id!)) await (bridge.enqueueAdmitted ?? bridge.enqueue).call(bridge, input);
            }
            const taskId = randomUUID();
            try {
                await (bridge.enqueueAdmitted ?? bridge.enqueue).call(bridge, {
                    id: taskId, processId: current.id, type: 'chat', priority: 'normal',
                    payload: { kind: 'compact', processId: current.id,
                        workspaceId: current.metadata?.workspaceId, workingDirectory: current.workingDirectory,
                        customInstructions },
                    config: { retryOnFailure: false, retryAttempts: 0, pauseOnFailure: false, timeoutMs: 0, cancelRunning: false },
                    displayName: 'Compact conversation',
                });
                await fullStore.updateProcess(current.id, { metadata: {
                    ...current.metadata, type: current.metadata?.type ?? 'chat',
                    compaction: { state: 'queued', taskId, priorStatus: current.status,
                        startedAt: new Date().toISOString(), ...(customInstructions ? { customInstructions } : {}) },
                } });
                onQueued?.(taskId);
            } catch (error) {
                bridge.cancelQueuedTask?.(taskId);
                await fullStore.updateProcess(current.id, { metadata: current.metadata }).catch(() => {});
                throw error;
            }
            return { taskId, result: { state: 'queued', taskId } };
        });
        compactionAdmissions.set(key, operation);
        try { return await operation; }
        finally { if (compactionAdmissions.get(key) === operation) compactionAdmissions.delete(key); }
    }
    const guard = compactGuardError(proc);
    if (guard) throw guard;
    const id = proc.id;
    const instructions = customInstructions?.trim() ? customInstructions : undefined;
    const activeBinding = readActiveProviderSession(proc);
    const provider = activeBinding.provider as ChatProvider;

    // ── Persist in-progress compacting state (AC-01) ──
    // Mark the process running and record compaction metadata BEFORE the
    // SDK call so the chat list, other browser tabs, and reloads all show
    // the conversation as compacting — not only the originating tab's
    // local React state. `store.updateProcess` fires a 'process-updated'
    // event through `store.onProcessChange`, so no manual broadcast is
    // needed. `proc.status` is guaranteed terminal here (idle guard
    // above), so it is the correct state to restore on settle.
    const priorStatus = proc.status;
    const startedAt = new Date().toISOString();
    // Both stores REPLACE `metadata` on update rather than deep-merging,
    // so spread the existing metadata wholesale and only own `compaction`.
    const baseMeta = (proc.metadata ?? { type: proc.type ?? 'chat' }) as GenericProcessMetadata;
    const writeCompaction = async (status: AIProcessStatus, compaction: ProcessCompactionState, fields?: Partial<AIProcess>) => {
        const current = 'getProcess' in store ? await (store as ProcessStore).getProcess(id) : undefined;
        return store.updateProcess(id, { status, metadata: { ...(current?.metadata ?? baseMeta),
            compaction: { ...(baseMeta.compaction?.taskId && ['queued', 'running'].includes(baseMeta.compaction.state) ? { taskId: baseMeta.compaction.taskId } : {}), ...compaction } }, ...(fields ?? {}) });
    };

    await writeCompaction('running', {
        state: 'running',
        priorStatus,
        startedAt,
        ...(instructions ? { customInstructions: instructions } : {}),
    });

    const { sdkServiceRegistry, isCompactUnsupportedError } = await import('@plusplusoneplusplus/forge');
    try {
        const sdkService = sdkServiceRegistry.getOrThrow(provider);
        const result = await sdkService.compactSession(activeBinding.sessionId!, instructions);
        const messagesRemoved = result?.messagesRemoved ?? 0;
        const tokensRemoved = result?.tokensRemoved ?? 0;
        // Summary text the provider generated for this compaction, kept
        // verbatim (no truncation) so the chat can reveal it behind the
        // "Show summary" disclosure. Providers that produce none (Codex
        // keeps its summary in the rewritten rollout) leave it undefined
        // and the disclosure is simply not rendered.
        const summaryContent = typeof result?.summaryContent === 'string' && result.summaryContent.trim()
            ? result.summaryContent
            : undefined;
        // ── Refresh the stored context-window usage (AC-05) ──
        // Without this the meter stays frozen at the pre-compaction
        // number until the next turn ends, contradicting the "freed ~N
        // tokens" result turn we are about to append.
        const usage = resolvePostCompactionUsage(proc, result, tokensRemoved);
        // Best-effort multi-tab nicety only: a terminal-status process
        // has no SSE subscriber, so the durable delivery is the store
        // write above plus the client's post-compaction refresh. Emitted
        // BEFORE the terminal-status restore so a tab still streaming the
        // compacting window can receive it. Session fields only — no
        // turnIndex, no tokenUsage — so it can never rewrite a turn.
        if (usage) {
            try {
                store.emitProcessEvent(id, {
                    type: 'token-usage',
                    ...(usage.tokenLimit != null ? { sessionTokenLimit: usage.tokenLimit } : {}),
                    ...(usage.currentTokens != null ? { sessionCurrentTokens: usage.currentTokens } : {}),
                    ...(usage.systemTokens != null ? { sessionSystemTokens: usage.systemTokens } : {}),
                    ...(usage.toolDefinitionsTokens != null ? { sessionToolTokens: usage.toolDefinitionsTokens } : {}),
                    ...(usage.conversationTokens != null ? { sessionConversationTokens: usage.conversationTokens } : {}),
                });
            } catch { /* the store write below is the durable path */ }
        }
        // Restore the prior terminal status and record the completed
        // result so the UI can drop the in-progress bubble.
        await writeCompaction(priorStatus, {
            state: 'completed',
            priorStatus,
            startedAt,
            completedAt: new Date().toISOString(),
            ...(instructions ? { customInstructions: instructions } : {}),
            messagesRemoved,
            tokensRemoved,
            ...(summaryContent ? { summary: summaryContent } : {}),
        }, usage);
        // ── Persist a display-only result turn (AC-03) ──
        // Append (never rewrite/remove) a visible assistant-style turn so
        // completion is recorded in the transcript itself, not only as a
        // transient toast. `displayOnly` keeps it out of the provider
        // model's prompt history on future follow-ups (see
        // buildConversationHandoff); appendConversationTurn
        // broadcasts the change via the store's process-updated path.
        await store.appendConversationTurn(id, (turnIndex) => ({
            role: 'assistant' as const,
            content: `Context compacted — removed ${messagesRemoved} message${messagesRemoved === 1 ? '' : 's'}, freed ~${tokensRemoved} tokens`,
            timestamp: new Date(),
            turnIndex,
            timeline: [],
            displayOnly: true,
            ...turnProviderAttribution(provider, activeBinding.segmentId),
            // Stored per-turn (not only in `metadata.compaction`) so a
            // second `/compact` cannot erase the first summary.
            ...(summaryContent ? { compactionSummary: summaryContent } : {}),
        }));
        return { result, tokensBefore: usageNumber(proc.currentTokens), tokensAfter: usage?.currentTokens };
    } catch (err: any) {
        // Failure also restores the prior terminal status and clears the
        // in-progress marker (recorded as failed for the UI).
        await writeCompaction(priorStatus, {
            state: 'failed',
            priorStatus,
            startedAt,
            completedAt: new Date().toISOString(),
            ...(instructions ? { customInstructions: instructions } : {}),
            error: err?.message ? String(err.message) : String(err),
        });
        if (isCompactUnsupportedError(err)) {
            throw new APIError(422, err?.message || `Compaction is not supported for provider '${provider}'.`, 'COMPACT_UNSUPPORTED');
        }
        throw internalError(`Failed to compact SDK session: ${err?.message || err}`);
    }
}

/** Cancels the queued operation only. A running turn or compaction is never aborted here. */
export async function cancelQueuedCompaction(store: ProcessStore, proc: AIProcess, bridge: QueueExecutorBridge): Promise<boolean> {
    return processOperationAdmission.runExclusive(proc.id, async () => {
        const current = await store.getProcess(proc.id, proc.metadata?.workspaceId);
        const compaction = current?.metadata?.compaction;
        if (!current || compaction?.state !== 'queued' || !compaction.taskId) return false;
        if (!bridge.cancelQueuedTask?.(compaction.taskId)) return false;
        await store.updateProcess(proc.id, { metadata: { ...current.metadata!, compaction: {
            ...compaction, state: 'cancelled', completedAt: new Date().toISOString(),
        } } });
        return true;
    });
}
