/**
 * Owns the follow-up delivery state machine that decides — for a single
 * `POST /api/processes/:id/message` request — whether a message is steered into
 * a live SDK session, buffered as a pending message for server-side drain, or
 * enqueued as a fresh task. The HTTP route keeps request parsing, attachment
 * processing, and response formatting; this service keeps the decision tree and
 * the writes that follow from it (pending-message append, conversation-turn
 * append, and the realtime event intents the route emits).
 *
 * Extracted from `api-process-routes.ts` so the steer/buffer/enqueue semantics
 * can be reasoned about and unit-tested without the full HTTP stack.
 */

import { randomUUID } from 'crypto';
import type {
    ProcessStore, AIProcess, AIProcessStatus, Attachment, PendingMessage, GenericProcessMetadata,
} from '@plusplusoneplusplus/forge';
import { resolveModelForProvider, isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import { CHAT_STYLES, DEFAULT_CHAT_STYLE, isChatStyle, type ChatStyle } from '@plusplusoneplusplus/coc-client';
import type { QueueExecutorBridge } from '../core/api-handler';
import type { ChatProvider } from '../tasks/task-types';
import { normalizeChatMode, VALID_CHAT_PROVIDERS } from '../tasks/task-types';
import { readActiveProviderSession, turnProviderAttribution } from './active-provider-session';
import {
    ProcessOperationAdmission,
    processOperationAdmission,
} from './process-operation-admission';
import { pendingMessageTask } from './queued-pending-message';
import { truncateDisplayName } from '../shared/queue-utils';
import { resolveFollowUpMode } from '../executors/follow-up-mode';
import { emitMessageQueued, emitPendingMessageAdded, emitMessageSteering } from '../streaming/sse-handler';
import { cleanupTempDir } from '../core/image-utils';
import type { FileAttachmentMeta } from '../core/attachment-utils';
import type { SentinelMirrorService } from '../messaging/sentinel-mirror-service';
import type { SentinelMirrorEntry } from '../messaging/sentinel-mirror-outbox';
import type { MirrorUploadSource } from '../messaging/sentinel-mirror-attachments';

/** Non-terminal statuses where a task may still be executing (mirrors the route). */
const NONTERMINAL_STATUSES: Set<string> = new Set(['queued', 'running', 'cancelling', 'created']);

/** Reasoning-effort values accepted on a per-turn override. */
const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);

/** Delivery modes accepted from the client. */
const VALID_DELIVERY_MODES = ['immediate', 'enqueue'];

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Normalized scalar follow-up fields derived purely from the request body and
 * the conversation provider. Does not include content/attachments, which the
 * route assembles separately.
 */
export interface NormalizedFollowUpFields {
    /** Interaction mode override; legacy `plan` normalizes to Ask, `ralph` is dropped. */
    mode?: string;
    /** Delivery mode; defaults to `enqueue` when absent. */
    deliveryMode: 'immediate' | 'enqueue';
    /** De-duplicated, non-empty selected skill names. */
    selectedSkillNames?: string[];
    /** Client-provided optimistic ID echoed back on realtime events. */
    optimisticId?: string;
    /** Model override that is safe to send to the provider (provider default when undefined). */
    model?: string;
    /** True when the requested model was invalid for the provider and was dropped. */
    modelCoerced: boolean;
    /** Original requested model, when present (used for the coercion log line). */
    requestedModel?: string;
    /** Per-turn reasoning-effort override; unknown values are dropped. */
    effort?: ReasoningEffort;
    /**
     * Style selected for this turn. Unlike the effort override, an unknown
     * value is a client error (HTTP 400) rather than silently dropped, so a
     * style the user picked is never quietly ignored. An omitted field falls
     * back to the `defaultChatStyle` the caller passed in — the server-wide
     * `features.defaultChatStyle`, or `'default'` when the caller has no config
     * to read.
     */
    chatStyle: ChatStyle;
    /**
     * Concrete provider the caller asked to run this turn on, when it named one.
     * Undefined means "use the conversation's active provider" — what every
     * client that predates provider switching sends. This value travels with
     * the message from here on; nothing downstream re-reads the provider from
     * mutable process metadata, so a metadata change after the message was
     * accepted cannot retarget it.
     */
    requestedProvider?: ChatProvider;
    /** True when {@link requestedProvider} differs from the active provider. */
    isProviderSwitch: boolean;
}

export type NormalizeFollowUpResult =
    | { ok: true; value: NormalizedFollowUpFields }
    | { ok: false; error: string; code?: string };

/**
 * Normalize the optional scalar fields of a follow-up request body. Pure — the
 * only provider-aware step is model validation, which is itself pure. The single
 * client error (invalid `deliveryMode`) is returned rather than thrown so the
 * route owns the HTTP status.
 */
export function normalizeFollowUpInput(
    body: Record<string, unknown>,
    provider: ChatProvider,
    defaultChatStyle: ChatStyle = DEFAULT_CHAT_STYLE,
): NormalizeFollowUpResult {
    // Requested provider. Omitted keeps the active provider. `auto` is
    // deliberately rejected rather than resolved: a follow-up must name one
    // concrete provider so the message carries an unambiguous target through
    // queueing and retry.
    let requestedProvider: ChatProvider | undefined;
    if (body.provider !== undefined && body.provider !== null) {
        if (typeof body.provider !== 'string' || !VALID_CHAT_PROVIDERS.has(body.provider as ChatProvider)) {
            return {
                ok: false,
                code: 'INVALID_PROVIDER',
                error: `Invalid provider: must be one of ${[...VALID_CHAT_PROVIDERS].join(', ')}`,
            };
        }
        requestedProvider = body.provider as ChatProvider;
    }
    // The provider that will actually run the turn — what the model override
    // must be valid for. Validating against the conversation provider instead
    // would let a model belonging to the old provider reach the new one.
    const targetProvider: ChatProvider = requestedProvider ?? provider;

    // Mode: legacy `plan` is accepted as Ask; `ralph` is not a per-turn override.
    const normalizedMode = normalizeChatMode(body.mode);
    const mode: string | undefined = normalizedMode === 'ralph' ? undefined : normalizedMode;

    // Delivery mode (immediate | enqueue), default to 'enqueue'.
    if (body.deliveryMode !== undefined && body.deliveryMode !== null) {
        if (typeof body.deliveryMode !== 'string' || !VALID_DELIVERY_MODES.includes(body.deliveryMode)) {
            return { ok: false, error: `Invalid deliveryMode: must be one of ${VALID_DELIVERY_MODES.join(', ')}` };
        }
    }
    const deliveryMode: 'immediate' | 'enqueue' = body.deliveryMode === 'immediate' ? 'immediate' : 'enqueue';

    // Selected skills: de-dup non-empty strings.
    const requestedSkillNames = Array.isArray(body.skillNames) ? body.skillNames as unknown[] : undefined;
    const selectedSkillNames: string[] | undefined = requestedSkillNames
        ? [...new Set(requestedSkillNames.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
        : undefined;

    const optimisticId: string | undefined = typeof body.optimisticId === 'string' ? body.optimisticId : undefined;

    // Model override, validated against the conversation provider.
    const rawModelOverride: string | undefined = typeof body.model === 'string' && body.model.trim().length > 0 ? body.model.trim() : undefined;
    const resolvedModelOverride = resolveModelForProvider(targetProvider, rawModelOverride);

    // Per-turn reasoning-effort override; unknown values are silently dropped so
    // a stale client never breaks an otherwise-valid follow-up.
    const effort: ReasoningEffort | undefined =
        typeof body.reasoningEffort === 'string' && VALID_EFFORTS.has(body.reasoningEffort)
            ? (body.reasoningEffort as ReasoningEffort)
            : undefined;

    // Per-turn chat style. Omitted falls back to the server-wide default;
    // present-but-unknown is rejected so a client never silently gets a
    // different style than the one it asked for.
    if (body.chatStyle !== undefined && body.chatStyle !== null && !isChatStyle(body.chatStyle)) {
        return { ok: false, error: `Invalid chatStyle: must be one of ${CHAT_STYLES.join(', ')}` };
    }
    const chatStyle: ChatStyle = isChatStyle(body.chatStyle) ? body.chatStyle : defaultChatStyle;

    return {
        ok: true,
        value: {
            chatStyle,
            ...(mode ? { mode } : {}),
            deliveryMode,
            ...(selectedSkillNames ? { selectedSkillNames } : {}),
            ...(optimisticId !== undefined ? { optimisticId } : {}),
            ...(resolvedModelOverride.model ? { model: resolvedModelOverride.model } : {}),
            modelCoerced: resolvedModelOverride.coerced,
            ...(resolvedModelOverride.requestedModel ? { requestedModel: resolvedModelOverride.requestedModel } : {}),
            ...(effort ? { effort } : {}),
            ...(requestedProvider ? { requestedProvider } : {}),
            isProviderSwitch: requestedProvider !== undefined && requestedProvider !== provider,
        },
    };
}

/**
 * Whether a conversation is idle enough to accept a provider switch. A switch
 * starts a brand-new native session, so it can only happen between turns —
 * never steered into or buffered behind an in-flight one.
 *
 * `taskStatus` is the status of the queue task that owns this process, when one
 * exists; the process status is the fallback for the restart case where the
 * task is gone but the process never reached a terminal state.
 */
export function isIdleForProviderSwitch(
    proc: Pick<AIProcess, 'status'> & { pendingAskUser?: unknown },
    taskStatus?: string,
): boolean {
    if (taskStatus === 'running' || taskStatus === 'queued') return false;
    if (!taskStatus && NONTERMINAL_STATUSES.has(proc.status)) return false;
    // A waiting ask_user batch means the provider owns an open turn even though
    // nothing is streaming.
    if (Array.isArray(proc.pendingAskUser) && proc.pendingAskUser.length > 0) return false;
    return true;
}

/**
 * Fully-resolved input for a single follow-up delivery: normalized scalar
 * fields plus the content/attachment values the route computed from the body.
 */
export interface FollowUpMessageInput {
    /** Assigned by trusted dashboard HTTP paths only, never copied from a request body. */
    origin?: 'desktop';
    mirrorContent?: string;
    mirrorUploads?: MirrorUploadSource;
    /** AI-facing content (skill tokens preserved). */
    content: string;
    /** Content as shown in the conversation bubble (skills directive prepended). */
    displayContent: string;
    /** Opaque origin request identifier; not derived from sender or message content. */
    relayRequestId?: string;
    /** Content with appended text-attachment context, for the executor/enqueue prompt. */
    contentWithContext?: string;
    attachments?: Attachment[];
    /** Validated image data URLs for durable persistence. */
    images?: string[];
    imageTempDir?: string;
    fileAttachmentMeta?: FileAttachmentMeta[];
    selectedSkillNames?: string[];
    mode?: string;
    model?: string;
    effort?: ReasoningEffort;
    deliveryMode: 'immediate' | 'enqueue';
    /** Strict-resume SDK session ID for a cancelled-chat continuation. */
    resumeSessionId?: string;
    optimisticId?: string;
    /** True when the user's large paste was externalized to a temp-file reference. */
    pasteExternalized: boolean;
    /** Process metadata to persist only after this request wins admission. */
    metadataUpdate?: GenericProcessMetadata;
    /**
     * Concrete provider this message runs on, resolved once when the request
     * was accepted (the requested provider, or the conversation's active one
     * when the client named none). Every delivery path carries this value with
     * the message — the pending-message buffer, the queue payload, and the
     * drained replay — so nothing downstream has to re-read the provider from
     * process metadata that may since have changed.
     */
    provider?: ChatProvider;
}

/** Which delivery branch handled the message. */
export type DeliveryPath = 'steered' | 'buffered' | 'enqueued' | 'direct-executed';

/**
 * Realtime event intents the service produces; the route emits them once, in
 * order, so emission is not duplicated across the extraction boundary.
 */
export type DeliveryEvent =
    | { kind: 'pending-message-added'; pendingMessage: PendingMessage }
    | { kind: 'message-queued'; turnIndex: number; deliveryMode: 'immediate' | 'enqueue'; queuePosition: number; optimisticId?: string }
    | { kind: 'message-steering'; turnIndex: number; optimisticId?: string };

export interface DeliveryResult {
    path: DeliveryPath;
    /** A durable receipt already covers this server-owned message; no new events. */
    reused?: boolean;
    /** Appended user-turn index, or -1 when the message was buffered. */
    turnIndex: number;
    /** Pending message identifier when the follow-up was buffered. */
    pendingMessageId?: string;
    /** Queue task assigned to a newly enqueued follow-up, if available. */
    taskId?: string;
    pasteExternalized: boolean;
    events: DeliveryEvent[];
}

/** Emit accepted admission intents; reused receipts contain no intents. */
export function emitDeliveryEvents(store: ProcessStore, processId: string, events: DeliveryEvent[]): void {
    for (const event of events) {
        switch (event.kind) {
            case 'pending-message-added':
                emitPendingMessageAdded(store, processId, event.pendingMessage);
                break;
            case 'message-queued':
                emitMessageQueued(store, processId, event);
                break;
            case 'message-steering':
                emitMessageSteering(store, processId, event);
                break;
        }
    }
}

/** A permanent routing/admission rejection; transient storage errors remain retryable. */
export class ReviewDeliveryRejectedError extends Error {}

/** Thrown when the underlying enqueue/dispatch fails; the route maps it to 500. */
export class FollowUpDeliveryError extends Error {
    constructor(public readonly originalError?: unknown) {
        super('Failed to enqueue follow-up');
        this.name = 'FollowUpDeliveryError';
    }
}

/** Thrown when a cross-provider request loses the idle admission race. */
export class ProviderSwitchRequiresIdleError extends Error {
    constructor() {
        super('Cannot switch providers while this conversation is busy. Wait for the current response to finish, then try again.');
        this.name = 'ProviderSwitchRequiresIdleError';
    }
}

export interface ProcessMessageDeliveryDeps {
    store: ProcessStore;
    bridge: QueueExecutorBridge;
    admission?: ProcessOperationAdmission;
    /** Clock provider — injectable for deterministic timestamps in tests. */
    now?: () => Date;
    /** ID provider — injectable for deterministic pending-message IDs in tests. */
    newId?: () => string;
    sentinelMirror?: SentinelMirrorService;
}

/**
 * Owns the steer/buffer/enqueue decision for a single follow-up. The route
 * resolves the process, parses the body, processes attachments, and assembles a
 * {@link FollowUpMessageInput}; this service decides the path, performs the
 * store writes, and returns the turn index plus event intents to emit.
 */
export class ProcessMessageDeliveryService {
    private readonly store: ProcessStore;
    private readonly bridge: QueueExecutorBridge;
    private readonly admission: ProcessOperationAdmission;
    private readonly now: () => Date;
    private readonly newId: () => string;
    private readonly sentinelMirror?: SentinelMirrorService;

    constructor(deps: ProcessMessageDeliveryDeps) {
        this.store = deps.store;
        this.bridge = deps.bridge;
        this.admission = deps.admission ?? processOperationAdmission;
        this.now = deps.now ?? (() => new Date());
        this.newId = deps.newId ?? (() => randomUUID());
        this.sentinelMirror = deps.sentinelMirror;
    }

    async deliver(proc: AIProcess, input: FollowUpMessageInput): Promise<DeliveryResult> {
        return this.admission.runExclusive(proc.id, async (contended) => {
            const currentProc = await this.store.getProcess(proc.id, proc.metadata?.workspaceId) ?? proc;
            const currentBinding = readActiveProviderSession(currentProc);
            const isProviderSwitch = input.provider !== undefined
                && input.provider !== currentBinding.provider;
            if (isProviderSwitch && (
                contended
                || !isIdleForProviderSwitch(
                    currentProc,
                    this.bridge.findTaskByProcessId?.(currentProc.id)?.status,
                )
            )) {
                throw new ProviderSwitchRequiresIdleError();
            }
            const mirror = input.origin === 'desktop' && typeof currentProc.metadata?.workspaceId === 'string'
                ? await this.sentinelMirror?.capture(currentProc.metadata.workspaceId, currentProc.id, input.mirrorContent ?? input.displayContent,
                    input.mirrorUploads ?? input.fileAttachmentMeta?.length ?? input.attachments?.length ?? input.images?.length ?? 0)
                : undefined;
            const admittedInput = mirror ? { ...input, relayRequestId: mirror.requestId } : input;
            try {
                return await this.deliverAdmitted(currentProc, admittedInput, undefined, mirror);
            } catch (error) {
                if (mirror) await this.sentinelMirror!.rejected(mirror);
                throw error;
            }
        });
    }

    /**
     * Admit a server-owned review once, using a globally unique, stable receipt ID.
     * The existing request correlation persists through pending-message drain and
     * execution. This entry point always queues and never resumes a stopped parent.
     */
    async deliverOnce(
        workspaceId: string,
        processId: string,
        receiptId: string,
        input: Pick<FollowUpMessageInput, 'content' | 'displayContent'>,
    ): Promise<DeliveryResult> {
        if (!receiptId.trim()) throw new ReviewDeliveryRejectedError('A stable review receipt is required');
        if (!this.bridge.enqueue || !this.bridge.getTask) {
            throw new ReviewDeliveryRejectedError('Durable review delivery requires queue admission and lookup');
        }
        return this.admission.runExclusive(processId, async () => {
            const proc = await this.store.getProcess(processId, workspaceId);
            if (!proc || proc.metadata?.workspaceId !== workspaceId) {
                throw new ReviewDeliveryRejectedError('Review parent is unavailable in its originating workspace');
            }
            const pending = proc.pendingMessages?.find(message => message.relayRequestId === receiptId);
            const turn = proc.conversationTurns?.find(message => message.role === 'user'
                && message.relayRequestId === receiptId);
            const task = this.bridge.getTask!(receiptId);
            if (task && !this.isReviewTask(task, proc, receiptId)) {
                throw new ReviewDeliveryRejectedError('Review receipt conflicts with another queue task');
            }
            if (pending || turn || task) {
                return {
                    path: pending ? 'buffered' : 'enqueued', reused: true,
                    turnIndex: turn?.turnIndex ?? -1,
                    ...(pending ? { pendingMessageId: pending.id } : {}),
                    ...(task ? { taskId: task.id } : {}),
                    pasteExternalized: false, events: [],
                };
            }
            if (proc.status === 'cancelled' || proc.status === 'cancelling') {
                throw new ReviewDeliveryRejectedError('Review parent has been stopped');
            }
            return this.deliverAdmitted(proc, {
                ...input, relayRequestId: receiptId, deliveryMode: 'enqueue', pasteExternalized: false,
                mode: await resolveFollowUpMode(this.store, processId),
            }, receiptId);
        });
    }

    /** Persist a server notice without an AI request or any change to queue state. */
    async deliverNoticeOnce(
        workspaceId: string, processId: string, receiptId: string, content: string,
    ): Promise<'deferred' | 'delivered'> {
        if (!receiptId.trim()) throw new ReviewDeliveryRejectedError('A stable notice receipt is required');
        return this.admission.runExclusive(processId, async () => {
            const proc = await this.store.getProcess(processId, workspaceId);
            if (!proc || proc.metadata?.workspaceId !== workspaceId) {
                throw new ReviewDeliveryRejectedError('Notice parent is unavailable in its originating workspace');
            }
            const existing = proc.conversationTurns?.find(turn => turn.relayRequestId === receiptId);
            if (existing) {
                if (existing.role !== 'assistant' || !existing.displayOnly) {
                    throw new ReviewDeliveryRejectedError('Notice receipt conflicts with another conversation turn');
                }
                return 'delivered';
            }
            const task = this.bridge.findTaskByProcessId?.(processId);
            if (NONTERMINAL_STATUSES.has(proc.status) || (task && NONTERMINAL_STATUSES.has(task.status))
                || proc.pendingAskUser || proc.pendingAskUserAnswer) return 'deferred';
            const appended = await this.store.appendConversationTurn(processId, turnIndex => ({
                role: 'assistant', content, timestamp: this.now(), turnIndex,
                timeline: [], displayOnly: true, relayRequestId: receiptId,
            }));
            if (!appended) throw new ReviewDeliveryRejectedError('Notice parent is unavailable');
            return 'delivered';
        });
    }

    private isReviewTask(task: import('@plusplusoneplusplus/forge').QueuedTask, proc: AIProcess, receiptId: string): boolean {
        return task.type === 'chat' && task.processId === proc.id
            && task.payload.processId === proc.id
            && task.payload.workspaceId === proc.metadata?.workspaceId
            && task.payload.relayRequestId === receiptId;
    }

    private async deliverAdmitted(proc: AIProcess, input: FollowUpMessageInput, reviewReceiptId?: string, mirror?: SentinelMirrorEntry): Promise<DeliveryResult> {
        const id = proc.id;
        const priorStatus = proc.status;
        const compactionPending = proc.metadata?.compaction?.state === 'queued'
            || proc.metadata?.compaction?.state === 'running'
            || !!this.bridge.findCompactionTask?.(id);
        const activeBinding = readActiveProviderSession(proc);
        const events: DeliveryEvent[] = [];
        const requestCorrelation = input.relayRequestId !== undefined
            ? { relayRequestId: input.relayRequestId }
            : {};

        // Turn index this message will occupy — the cutoff a reconstructed
        // continuation quotes history strictly before. Captured before the
        // append so the executor can be told about the message it is running
        // even when the append has not landed yet, and read from the accepted
        // snapshot so it can never overshoot and quote the message back to the
        // provider as if it were history.
        const historyCutoffTurnIndex = proc.conversationTurns?.length ?? 0;

        let path: DeliveryPath = 'enqueued';
        let buffered = false;
        let pendingMessageId: string | undefined;
        let taskId: string | undefined;
        let steerSucceeded = false;

        // Buffer a follow-up as a pending message for server-side drain. The user
        // turn is NOT appended here — it is deferred until drainPendingMessages
        // appends it after the in-flight assistant response, preserving correct
        // [user, assistant, user, assistant] ordering. The append is atomic so
        // concurrent follow-ups cannot lose each other's pending messages.
        const bufferAsPendingMessage = async () => {
            buffered = true;
            path = 'buffered';
            const pendingMessage = {
                id: reviewReceiptId ?? mirror?.requestId ?? this.newId(),
                ...requestCorrelation,
                ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
                content: input.content,
                displayContent: input.displayContent,
                ...(input.images ? { images: input.images } : {}),
                ...(input.pasteExternalized ? { pasteExternalized: true } : {}),
                ...(input.model ? { model: input.model } : {}),
                ...(input.provider ? { provider: input.provider } : {}),
                ...(input.effort ? { reasoningEffort: input.effort } : {}),
                ...(input.mode ? { mode: input.mode } : {}),
                ...(input.attachments ? { attachments: input.attachments } : {}),
                ...(input.imageTempDir ? { imageTempDir: input.imageTempDir } : {}),
                ...(input.fileAttachmentMeta ? { fileAttachmentMeta: input.fileAttachmentMeta } : {}),
                ...(input.selectedSkillNames && input.selectedSkillNames.length > 0 ? { skillNames: input.selectedSkillNames } : {}),
                createdAt: this.now().toISOString(),
            };
            await this.store.appendPendingMessage(id, pendingMessage);
            if (mirror) this.sentinelMirror!.accepted(mirror);
            pendingMessageId = pendingMessage.id;
            events.push({ kind: 'pending-message-added', pendingMessage });
            if (compactionPending && this.bridge.enqueue) {
                taskId = await (this.bridge.enqueueAdmitted ?? this.bridge.enqueue).call(this.bridge, pendingMessageTask(proc, pendingMessage));
            }
        };

        try {
            if (input.metadataUpdate) {
                await this.store.updateProcess(id, { metadata: { ...input.metadataUpdate, ...(proc.metadata?.compaction ? { compaction: proc.metadata.compaction } : {}) } });
            }
            if (this.bridge.enqueue) {
                const displayName = truncateDisplayName(input.content.trim());
                const parentTask = this.bridge.findTaskByProcessId?.(id);
                if (compactionPending) {
                    await bufferAsPendingMessage();
                } else if (parentTask && parentTask.status === 'running' && input.deliveryMode === 'immediate' && this.bridge.steerProcess) {
                    const steered = await this.bridge.steerProcess(id, input.content);
                    if (!steered) {
                        // Steering failed (no active SDK session); buffer for server-side drain.
                        await bufferAsPendingMessage();
                    } else {
                        steerSucceeded = true;
                        path = 'steered';
                    }
                } else if (
                    (parentTask && (parentTask.status === 'running' || parentTask.status === 'queued')) ||
                    (reviewReceiptId && (proc.pendingAskUser?.length || proc.pendingMessages?.length)) ||
                    (!parentTask && NONTERMINAL_STATUSES.has(priorStatus))
                ) {
                    // Task running/queued, or task not found but process was non-terminal:
                    // buffer as pending message — server drains on task completion.
                    await bufferAsPendingMessage();
                } else {
                    // Terminal status (failed or resumable cancelled) or restart fallback → enqueue.
                    const enqueueWsId = (proc.metadata?.workspaceId as string) ?? undefined;
                    taskId = await (this.bridge.enqueueAdmitted ?? this.bridge.enqueue).call(this.bridge, {
                        ...(reviewReceiptId || mirror ? { id: reviewReceiptId ?? mirror!.requestId } : isQueueProcessId(id) ? { id: toTaskId(id) } : {}),
                        processId: id,
                        type: 'chat',
                        priority: 'normal',
                        payload: {
                            kind: 'chat',
                            prompt: input.contentWithContext ?? input.content,
                            ...requestCorrelation,
                            processId: id,
                            ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
                            attachments: input.attachments,
                            imageTempDir: input.imageTempDir,
                            images: input.images,
                            ...(input.fileAttachmentMeta ? { fileAttachmentMeta: input.fileAttachmentMeta } : {}),
                            workingDirectory: proc.workingDirectory,
                            ...(enqueueWsId ? { workspaceId: enqueueWsId } : {}),
                            readonly: (proc as { payload?: { readonly?: boolean } }).payload?.readonly,
                            ...(input.selectedSkillNames && input.selectedSkillNames.length > 0 ? { context: { skills: input.selectedSkillNames } } : {}),
                            ...(input.mode ? { mode: input.mode } : {}),
                            ...(input.model ? { model: input.model } : {}),
                            ...(input.provider ? { provider: input.provider } : {}),
                            historyCutoffTurnIndex,
                            ...(input.effort ? { reasoningEffort: input.effort } : {}),
                            deliveryMode: input.deliveryMode,
                        },
                        // Mirror the per-turn reasoning-effort into config so executors
                        // that inspect `task.config.reasoningEffort` also see it.
                        config: input.effort ? { reasoningEffort: input.effort } : {},
                        displayName,
                    });
                    if (mirror) this.sentinelMirror!.accepted(mirror);
                    path = 'enqueued';
                }
            } else {
                this.bridge.executeFollowUp(id, input.contentWithContext ?? input.content, input.attachments, input.mode, input.deliveryMode, input.images, input.selectedSkillNames, input.model, undefined, input.effort, input.resumeSessionId, { ...(input.provider ? { requestedProvider: input.provider } : {}), historyCutoffTurnIndex }).catch(() => {
                }).finally(() => {
                    if (input.imageTempDir) { cleanupTempDir(input.imageTempDir); }
                });
                path = 'direct-executed';
            }
        } catch (err) {
            // taskAdded observers may throw after durable admission. Retain that
            // exact receipt rather than rolling back accepted work or replaying it.
            const receiptId = reviewReceiptId ?? mirror?.requestId;
            const accepted = receiptId ? this.bridge.getTask?.(receiptId) : undefined;
            if (accepted && this.isReviewTask(accepted, proc, receiptId!)) {
                taskId = accepted.id;
                if (mirror) this.sentinelMirror!.accepted(mirror);
            } else if (mirror && !await this.sentinelMirror!.rejected(mirror)) {
                // Pending-message observers can fail after the canonical append, too.
                path = 'buffered';
            } else {
                await this.store.updateProcess(id, { status: priorStatus as AIProcessStatus }).catch(() => {});
                throw new FollowUpDeliveryError(err);
            }
        }

        // Persist the user turn and mark the process running atomically. Skipped
        // for the buffered path — the turn is deferred until drainPendingMessages
        // appends it after the current assistant response completes.
        let turnIndex = -1;
        if (!buffered) {
            const appendResult = await this.store.appendConversationTurn(
                id,
                (idx) => ({
                    role: 'user' as const,
                    content: input.displayContent,
                    timestamp: this.now(),
                    turnIndex: idx,
                    ...requestCorrelation,
                    timeline: [],
                    images: input.images,
                    ...(input.pasteExternalized ? { pasteExternalized: true } : {}),
                    ...(input.model ? { model: input.model } : {}),
                    ...(input.mode ? { mode: input.mode } : {}),
                    // The segment is only known when this message continues the
                    // active one. A cross-provider message has no segment until
                    // the target provider reports a session, so it stays
                    // unattributed rather than claiming the outgoing segment.
                    ...turnProviderAttribution(
                        input.provider,
                        input.provider === activeBinding.provider ? activeBinding.segmentId : undefined,
                    ),
                }),
                { additionalUpdates: { status: 'running' } },
            );
            turnIndex = appendResult?.turn.turnIndex ?? (proc.conversationTurns?.length ?? 0);
            if (mirror && appendResult) this.sentinelMirror!.accepted(mirror);
        }

        events.push({
            kind: 'message-queued',
            turnIndex,
            deliveryMode: input.deliveryMode,
            queuePosition: input.deliveryMode === 'immediate' ? 0 : 1,
            ...(input.optimisticId !== undefined ? { optimisticId: input.optimisticId } : {}),
        });

        if (steerSucceeded) {
            events.push({
                kind: 'message-steering',
                turnIndex,
                ...(input.optimisticId !== undefined ? { optimisticId: input.optimisticId } : {}),
            });
        }

        return { path, turnIndex, ...(pendingMessageId ? { pendingMessageId } : {}),
            ...(taskId ? { taskId } : {}), pasteExternalized: input.pasteExternalized, events };
    }
}
