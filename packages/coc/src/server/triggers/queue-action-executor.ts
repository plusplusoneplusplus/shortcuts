/**
 * The default `ActionExecutor` for the trigger framework. It delivers a
 * trigger's `send-message` action into its target conversation by REUSING the
 * existing follow-up plumbing rather than inventing new delivery:
 *
 *  - Idle/terminal target → enqueue a chat follow-up via `TaskQueueManager`,
 *    tagged `context = { triggerId, source: 'trigger' }`. The lifecycle runner
 *    turns that into a `turnSource: { source: 'trigger', triggerId }` turn and,
 *    on completion, calls back into `TriggerManager.onActionComplete` (clearing
 *    the in-flight guard).
 *  - Mid-turn target (a turn is already running/queued) → buffer the message via
 *    the existing pending-messages mechanism instead of double-enqueuing. The
 *    server drains pending messages when the running task completes. The trigger
 *    context is carried on the pending message so the drained follow-up still
 *    tags the `trigger` turnSource.
 *
 * This is a thin adapter over `TaskQueueManager` / `FollowUpExecutor`; no new
 * queue or timer plumbing is added.
 */

import * as crypto from 'crypto';
import type { ProcessStore, TaskQueueManager, PendingMessage } from '@plusplusoneplusplus/forge';
import { toTaskId, isQueueProcessId, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { ActionExecutor } from './trigger-manager';
import type { Trigger, TriggerAction } from './trigger-types';
import { resolveFollowUpMode } from '../executors/follow-up-mode';
import { emitDeliveryEvents, ReviewDeliveryRejectedError, type ProcessMessageDeliveryService } from '../processes/process-message-delivery-service';

// ============================================================================
// Types
// ============================================================================

export interface QueueActionExecutorDeps {
    /** Process store used to inspect target status and buffer pending messages. */
    processStore: ProcessStore;
    /** Queue used to enqueue follow-ups (and to detect in-flight turns). */
    queueManager: TaskQueueManager | null;
    /** Resolve processId → workspaceId for multi-repo routing. */
    resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
    /** Shared serialized, durable admission for one-shot Sentinel wakes. */
    messageDelivery?: Pick<ProcessMessageDeliveryService, 'deliverOnce'> & Partial<Pick<ProcessMessageDeliveryService, 'deliverPrRepairOnce' | 'deliverSentinelPrOutcomeOnce'>>;
    recoverPendingMessages?: (workspaceId: string, processId: string) => Promise<void>;
    validatePrOwner?: (workspaceId: string, processId: string, originId: string, prId: string) => Promise<void>;
}

/** Process statuses that mean a turn is in flight (buffer instead of enqueue). */
const NONTERMINAL_PROCESS_STATUSES = new Set(['queued', 'running', 'cancelling']);

// ============================================================================
// QueueActionExecutor
// ============================================================================

export class QueueActionExecutor implements ActionExecutor {
    private readonly deps: QueueActionExecutorDeps;

    constructor(deps: QueueActionExecutorDeps) {
        this.deps = deps;
    }

    async execute(trigger: Trigger, action: TriggerAction, prompt: string): Promise<void> {
        if (!this.deps.queueManager) {
            throw new Error('TaskQueueManager not available');
        }

        const processId = action.processId;
        if (!trigger.binding && trigger.event.monitor === 'ci-failure') {
            if (await this.deps.resolveWorkspaceId(processId) !== trigger.workspaceId) {
                throw new Error('PR repair owner workspace is missing or changed');
            }
            await this.deps.validatePrOwner?.(trigger.workspaceId, processId, trigger.event.originId, trigger.event.prId);
            if (trigger.event.repairScope === 'ci-and-conflicts'
                && (!this.deps.messageDelivery?.deliverPrRepairOnce || !trigger.event.repairDelivery)) {
                throw new Error('Conflict repair requires durable owner-scoped admission');
            }
            if (this.deps.messageDelivery?.deliverPrRepairOnce && trigger.event.repairDelivery) {
                const result = await this.deps.messageDelivery.deliverPrRepairOnce(
                    trigger.workspaceId, processId, trigger.event.repairDelivery.id, {
                        content: prompt, displayContent: prompt,
                        turnSource: { source: 'trigger', triggerId: trigger.id, deliveryId: trigger.event.repairDelivery.id },
                    });
                emitDeliveryEvents(this.deps.processStore, processId, result.events);
                if (result.path === 'buffered') await this.deps.recoverPendingMessages?.(trigger.workspaceId, processId);
                return;
            }
        }
        if (trigger.binding) {
            if (!this.deps.messageDelivery || !trigger.delivery || processId !== trigger.processId) {
                throw new Error('Sentinel wake requires durable message admission');
            }
            const deliver = trigger.binding.delegatedPr
                ? this.deps.messageDelivery.deliverSentinelPrOutcomeOnce
                : this.deps.messageDelivery.deliverOnce;
            if (!deliver) throw new ReviewDeliveryRejectedError('Native PR outcome admission is unavailable');
            const result = await deliver.call(this.deps.messageDelivery,
                trigger.workspaceId, processId, trigger.delivery.deliveryId, {
                    content: prompt, displayContent: prompt,
                    turnSource: { source: 'trigger', triggerId: trigger.id, deliveryId: trigger.delivery.deliveryId },
                });
            emitDeliveryEvents(this.deps.processStore, processId, result.events);
            if (result.path === 'buffered') {
                await this.deps.recoverPendingMessages?.(trigger.workspaceId, processId);
            }
            return;
        }
        if (await this.isProcessMidTurn(processId)) {
            await this.bufferPendingMessage(trigger, action, prompt);
            return;
        }
        await this.enqueueFollowUp(trigger, action, prompt);
    }

    // ========================================================================
    // Internal
    // ========================================================================

    /**
     * Whether the target conversation currently has a turn in flight. Prefers
     * the queue task status (most precise) and falls back to the persisted
     * process status.
     */
    private async isProcessMidTurn(processId: string): Promise<boolean> {
        const queueManager = this.deps.queueManager;
        if (queueManager && isQueueProcessId(processId)) {
            const task = queueManager.getTask(toTaskId(processId));
            if (task && (task.status === 'running' || task.status === 'queued')) {
                return true;
            }
        }
        try {
            const proc = await this.deps.processStore.getProcess(processId);
            if (proc && NONTERMINAL_PROCESS_STATUSES.has(proc.status)) {
                return true;
            }
        } catch {
            // Treat lookup failures as idle — enqueueing is the safe default.
        }
        return false;
    }

    /** Enqueue a brand-new chat follow-up tagged with the trigger context. */
    private async enqueueFollowUp(trigger: Trigger, action: TriggerAction, prompt: string): Promise<void> {
        const queueManager = this.deps.queueManager!;
        const processId = action.processId;
        const workspaceId = await this.deps.resolveWorkspaceId(processId);
        // Explicit action mode (autopilot) wins; otherwise inherit the process default.
        const mode = await resolveFollowUpMode(this.deps.processStore, processId,
            action.mode === 'inherit' ? undefined : action.mode);

        queueManager.enqueue({
            processId,
            type: 'chat',
            priority: trigger.event.monitor === 'ci-failure' ? 'high' : 'normal',
            payload: {
                kind: 'chat',
                mode,
                prompt,
                processId,
                context: {
                    triggerId: trigger.id,
                    source: 'trigger',
                    ...(trigger.delivery ? { deliveryId: trigger.delivery.deliveryId } : {}),
                },
            },
            config: trigger.event.monitor === 'ci-failure' ? { respectQueueBarriers: true } : {},
            displayName: `[Trigger] ${prompt.substring(0, 40)}`,
            ...(workspaceId ? { repoId: workspaceId } : {}),
        });

        getLogger().info(
            LogCategory.AI,
            `[QueueActionExecutor] Enqueued trigger follow-up for ${trigger.id} → process ${processId}`,
        );
    }

    /**
     * Buffer the message as a pending message so the server drains it when the
     * in-flight turn completes. The trigger context rides along so the drained
     * follow-up still carries the `trigger` turnSource.
     */
    private async bufferPendingMessage(trigger: Trigger, action: TriggerAction, prompt: string): Promise<void> {
        const processId = action.processId;
        const pendingMsg: PendingMessage = {
            id: crypto.randomUUID(),
            ...(trigger.event.monitor === 'ci-failure' ? { queuePriority: 'high' as const, respectQueueBarriers: true } : {}),
            content: prompt,
            mode: await resolveFollowUpMode(this.deps.processStore, processId,
                action.mode === 'inherit' ? undefined : action.mode),
            context: {
                triggerId: trigger.id,
                source: 'trigger',
                ...(trigger.delivery ? { deliveryId: trigger.delivery.deliveryId } : {}),
            },
            createdAt: new Date().toISOString(),
        };
        const current = await this.deps.processStore.getProcess(processId);
        const existing = current?.pendingMessages ?? [];
        await this.deps.processStore.updateProcess(processId, {
            pendingMessages: [...existing, pendingMsg],
        });

        getLogger().info(
            LogCategory.AI,
            `[QueueActionExecutor] Buffered trigger follow-up for ${trigger.id} (process ${processId} mid-turn)`,
        );
    }
}
