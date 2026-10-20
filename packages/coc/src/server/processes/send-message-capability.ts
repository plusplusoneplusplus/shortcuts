/**
 * Post-mode delivery capability for `send_to_conversation`.
 *
 * Wraps the exact `ProcessMessageDeliveryService.deliver` path
 * `POST /api/processes/:id/message` uses, resolving the target process (with
 * the same queue_-prefix fallback) and returning the appended user-turn index.
 * The tool's `'steer'` delivery mode maps onto the service's `'immediate'`
 * mode — the service auto-steers a running process.
 *
 * With result tracking enabled, a post from a local Sentinel into another
 * non-Sentinel chat reserves a per-request delegated job before delivery, so
 * the turn's result returns to the Sentinel like a create-mode handoff.
 */

import { randomUUID } from 'node:crypto';
import { isQueueProcessId, toTaskId, type AIProcess, type ProcessStore } from '@plusplusoneplusplus/forge';
import type { QueueExecutorBridge } from '../core/api-handler';
import type { DelegatedJob, DelegatedJobStore } from '../delegation/delegated-job-store';
import { buildFollowUpChatModeDisplayBlock, prependChatModeDirective } from '../executors/chat-mode-directive';
import { resolveFollowUpMode } from '../executors/follow-up-mode';
import type { SendMessageFn } from '../llm-tools/send-to-conversation-tool';
import { isMessagingJobOrigin } from '../messaging/job-notices';
import { normalizeChatMode, normalizeChatModeOrDefault } from '../tasks/task-types';
import { ProcessMessageDeliveryService, type FollowUpMessageInput } from './process-message-delivery-service';

/** Per-request result return for Sentinel post-mode sends. */
export interface SendMessageResultTracking {
    jobs: Pick<DelegatedJobStore, 'register' | 'recordResult'>;
    /** Live `features.sentinelFollowUpResults` gate. */
    enabled: () => boolean;
    /** Startup result recovery must finish before a new registration, like create mode. */
    ready?: Promise<unknown>;
}

const STEER_DOWNGRADE_REASON = 'Tracked Sentinel posts are queued, not steered, so the turn has its own result.';

export function createSendMessageCapability(
    store: ProcessStore, bridge: QueueExecutorBridge, tracking?: SendMessageResultTracking,
): SendMessageFn {
    return async (input) => {
        const { processId, content, mode, model, effort, deliveryMode } = input;
        let proc = await store.getProcess(processId);
        if (!proc && isQueueProcessId(processId)) {
            proc = await store.getProcess(toTaskId(processId));
        }
        if (!proc) {
            throw new Error(`Process '${processId}' not found.`);
        }
        const job = await reserveTrackedRequest(store, bridge, tracking, proc, input);
        const requestedImmediate = deliveryMode === 'immediate' || deliveryMode === 'steer';
        // A steered message joins the running turn and has no result of its own.
        const resolvedDeliveryMode: 'immediate' | 'enqueue' = requestedImmediate && !job ? 'immediate' : 'enqueue';
        const previousMode = normalizeChatModeOrDefault(proc.metadata?.mode);
        // An omitted mode keeps the conversation's current mode.
        const followUpMode = await resolveFollowUpMode(store, proc.id, mode);
        const deliveryInput: FollowUpMessageInput = {
            content,
            // Mirrors the decision FollowUpExecutor makes for this turn, so the
            // stored turn discloses the directive exactly when the turn carries
            // one — same as the POST /message route.
            displayContent: prependChatModeDirective(
                content,
                buildFollowUpChatModeDisplayBlock({
                    mode: followUpMode,
                    previousMode,
                    process: proc,
                }),
            ),
            deliveryMode: resolvedDeliveryMode,
            pasteExternalized: false,
            // Always populated — FollowUpExecutor treats a missing mode as an
            // enqueue-site bug.
            mode: followUpMode,
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
            ...(job ? { requestReceiptId: job.child.requestId } : {}),
        };
        let result;
        try {
            result = await new ProcessMessageDeliveryService({ store, bridge }).deliver(proc, deliveryInput);
        } catch (error) {
            if (job && !await requestAdmitted(store, bridge, proc.id, job.child.requestId!)) {
                // Rejected sends must not become pending result reviews after recovery.
                tracking!.jobs.recordResult(job.parent.workspaceId, job.id, {
                    terminalEventId: `admission-rejected:${job.child.requestId}`,
                    outcome: 'failed', summary: 'The follow-up message was not delivered.', links: [],
                }, { state: 'failed', reason: 'Delivery rejected; the originating tool reports the error.' });
            }
            throw error;
        }
        return {
            turnIndex: result.turnIndex,
            ...(job ? { resultDelivery: {
                status: 'tracked' as const, jobId: job.id,
                ...(requestedImmediate ? { reason: STEER_DOWNGRADE_REASON } : {}),
            } } : {}),
        };
    };
}

/** Register the request before delivery so an early terminal event stays bound. */
async function reserveTrackedRequest(
    store: ProcessStore, bridge: QueueExecutorBridge, tracking: SendMessageResultTracking | undefined,
    target: AIProcess, input: Parameters<SendMessageFn>[0],
): Promise<DelegatedJob | undefined> {
    const parentId = input.parentProcessId;
    // Direct execution carries no request identity; nothing could be matched later.
    if (!tracking?.enabled() || !parentId || !bridge.enqueue) return undefined;
    const childWorkspaceId = target.metadata?.workspaceId;
    // Self-posts and Sentinel targets would loop review turns between dispatchers.
    if (parentId === target.id || (isQueueProcessId(parentId) && toTaskId(parentId) === target.id)
        || typeof childWorkspaceId !== 'string' || !childWorkspaceId
        || normalizeChatMode(target.metadata?.mode) === 'sentinel') return undefined;
    const parent = await store.getProcess(parentId);
    const task = !parent && isQueueProcessId(parentId) ? bridge.getTask?.(toTaskId(parentId)) : undefined;
    const liveParent = task?.type === 'chat' && (task.status === 'queued' || task.status === 'running') ? task : undefined;
    if (normalizeChatMode(parent ? parent.metadata?.mode : liveParent?.payload.mode) !== 'sentinel') return undefined;
    const parentWorkspaceId = parent ? parent.metadata?.workspaceId : liveParent?.repoId;
    if (typeof parentWorkspaceId !== 'string' || !parentWorkspaceId) return undefined;
    await tracking.ready;
    const requestId = randomUUID();
    return tracking.jobs.register({
        id: `request:${requestId}`,
        parent: { workspaceId: parentWorkspaceId, processId: parentId },
        child: { workspaceId: childWorkspaceId, processId: target.id, requestId },
        ...(isMessagingJobOrigin(input.messagingOrigin) ? { messagingOrigin: input.messagingOrigin } : {}),
        title: (input.content.trim() || 'Follow-up message').slice(0, 80),
    });
}

/** Delivery can fail after durable admission; retain tracking for accepted requests. */
async function requestAdmitted(store: ProcessStore, bridge: QueueExecutorBridge, processId: string, requestId: string): Promise<boolean> {
    if (bridge.getTask?.(requestId)) return true;
    const proc = await store.getProcess(processId).catch(() => undefined);
    return !!proc && (!!proc.pendingMessages?.some(message => message.id === requestId)
        || !!proc.conversationTurns?.some(turn => turn.role === 'user' && turn.relayRequestId === requestId));
}
