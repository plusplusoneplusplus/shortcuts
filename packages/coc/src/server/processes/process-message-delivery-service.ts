/**
 * Process Follow-Up Message Delivery Service
 *
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
    ProcessStore, AIProcess, AIProcessStatus, Attachment, PendingMessage,
} from '@plusplusoneplusplus/forge';
import { resolveModelForProvider, isQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import type { QueueExecutorBridge } from '../core/api-handler';
import type { ChatProvider } from '../tasks/task-types';
import { normalizeChatMode } from '../tasks/task-types';
import { truncateDisplayName } from '../shared/queue-utils';
import { cleanupTempDir } from '../core/image-utils';
import type { FileAttachmentMeta } from '../core/attachment-utils';

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
}

export type NormalizeFollowUpResult =
    | { ok: true; value: NormalizedFollowUpFields }
    | { ok: false; error: string };

/**
 * Normalize the optional scalar fields of a follow-up request body. Pure — the
 * only provider-aware step is model validation, which is itself pure. The single
 * client error (invalid `deliveryMode`) is returned rather than thrown so the
 * route owns the HTTP status.
 */
export function normalizeFollowUpInput(
    body: Record<string, unknown>,
    provider: ChatProvider,
): NormalizeFollowUpResult {
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
    const resolvedModelOverride = resolveModelForProvider(provider, rawModelOverride);

    // Per-turn reasoning-effort override; unknown values are silently dropped so
    // a stale client never breaks an otherwise-valid follow-up.
    const effort: ReasoningEffort | undefined =
        typeof body.reasoningEffort === 'string' && VALID_EFFORTS.has(body.reasoningEffort)
            ? (body.reasoningEffort as ReasoningEffort)
            : undefined;

    return {
        ok: true,
        value: {
            ...(mode ? { mode } : {}),
            deliveryMode,
            ...(selectedSkillNames ? { selectedSkillNames } : {}),
            ...(optimisticId !== undefined ? { optimisticId } : {}),
            ...(resolvedModelOverride.model ? { model: resolvedModelOverride.model } : {}),
            modelCoerced: resolvedModelOverride.coerced,
            ...(resolvedModelOverride.requestedModel ? { requestedModel: resolvedModelOverride.requestedModel } : {}),
            ...(effort ? { effort } : {}),
        },
    };
}

/**
 * Fully-resolved input for a single follow-up delivery: normalized scalar
 * fields plus the content/attachment values the route computed from the body.
 */
export interface FollowUpMessageInput {
    /** AI-facing content (skill tokens preserved). */
    content: string;
    /** Content as shown in the conversation bubble (skills directive prepended). */
    displayContent: string;
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
    /** Appended user-turn index, or -1 when the message was buffered. */
    turnIndex: number;
    pasteExternalized: boolean;
    events: DeliveryEvent[];
}

/** Thrown when the underlying enqueue/dispatch fails; the route maps it to 500. */
export class FollowUpDeliveryError extends Error {
    constructor(public readonly originalError?: unknown) {
        super('Failed to enqueue follow-up');
        this.name = 'FollowUpDeliveryError';
    }
}

export interface ProcessMessageDeliveryDeps {
    store: ProcessStore;
    bridge: QueueExecutorBridge;
    /** Clock provider — injectable for deterministic timestamps in tests. */
    now?: () => Date;
    /** ID provider — injectable for deterministic pending-message IDs in tests. */
    newId?: () => string;
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
    private readonly now: () => Date;
    private readonly newId: () => string;

    constructor(deps: ProcessMessageDeliveryDeps) {
        this.store = deps.store;
        this.bridge = deps.bridge;
        this.now = deps.now ?? (() => new Date());
        this.newId = deps.newId ?? (() => randomUUID());
    }

    async deliver(proc: AIProcess, input: FollowUpMessageInput): Promise<DeliveryResult> {
        const id = proc.id;
        const priorStatus = proc.status;
        const events: DeliveryEvent[] = [];

        let path: DeliveryPath = 'enqueued';
        let buffered = false;
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
                id: this.newId(),
                content: input.content,
                displayContent: input.displayContent,
                ...(input.images ? { images: input.images } : {}),
                ...(input.pasteExternalized ? { pasteExternalized: true } : {}),
                ...(input.model ? { model: input.model } : {}),
                ...(input.effort ? { reasoningEffort: input.effort } : {}),
                ...(input.mode ? { mode: input.mode } : {}),
                ...(input.attachments ? { attachments: input.attachments } : {}),
                ...(input.imageTempDir ? { imageTempDir: input.imageTempDir } : {}),
                ...(input.fileAttachmentMeta ? { fileAttachmentMeta: input.fileAttachmentMeta } : {}),
                ...(input.selectedSkillNames && input.selectedSkillNames.length > 0 ? { skillNames: input.selectedSkillNames } : {}),
                createdAt: this.now().toISOString(),
            };
            await this.store.appendPendingMessage(id, pendingMessage);
            events.push({ kind: 'pending-message-added', pendingMessage });
        };

        try {
            if (this.bridge.enqueue) {
                const displayName = truncateDisplayName(input.content.trim());
                const parentTask = this.bridge.findTaskByProcessId?.(id);
                if (parentTask && parentTask.status === 'running' && input.deliveryMode === 'immediate' && this.bridge.steerProcess) {
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
                    (!parentTask && NONTERMINAL_STATUSES.has(priorStatus))
                ) {
                    // Task running/queued, or task not found but process was non-terminal:
                    // buffer as pending message — server drains on task completion.
                    await bufferAsPendingMessage();
                } else {
                    // Terminal status (failed or resumable cancelled) or restart fallback → enqueue.
                    const enqueueWsId = (proc.metadata?.workspaceId as string) ?? undefined;
                    await this.bridge.enqueue({
                        ...(isQueueProcessId(id) ? { id: toTaskId(id) } : {}),
                        processId: id,
                        type: 'chat',
                        priority: 'normal',
                        payload: {
                            kind: 'chat',
                            prompt: input.contentWithContext ?? input.content,
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
                            ...(input.effort ? { reasoningEffort: input.effort } : {}),
                            deliveryMode: input.deliveryMode,
                        },
                        // Mirror the per-turn reasoning-effort into config so executors
                        // that inspect `task.config.reasoningEffort` also see it.
                        config: input.effort ? { reasoningEffort: input.effort } : {},
                        displayName,
                    });
                    path = 'enqueued';
                }
            } else {
                this.bridge.executeFollowUp(id, input.contentWithContext ?? input.content, input.attachments, input.mode, input.deliveryMode, input.images, input.selectedSkillNames, input.model, undefined, input.effort, input.resumeSessionId).catch(() => {
                }).finally(() => {
                    if (input.imageTempDir) { cleanupTempDir(input.imageTempDir); }
                });
                path = 'direct-executed';
            }
        } catch (err) {
            await this.store.updateProcess(id, { status: priorStatus as AIProcessStatus }).catch(() => {});
            throw new FollowUpDeliveryError(err);
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
                    timeline: [],
                    images: input.images,
                    ...(input.pasteExternalized ? { pasteExternalized: true } : {}),
                    ...(input.model ? { model: input.model } : {}),
                    ...(input.mode ? { mode: input.mode } : {}),
                }),
                { additionalUpdates: { status: 'running' } },
            );
            turnIndex = appendResult?.turn.turnIndex ?? (proc.conversationTurns?.length ?? 0);
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

        return { path, turnIndex, pasteExternalized: input.pasteExternalized, events };
    }
}
