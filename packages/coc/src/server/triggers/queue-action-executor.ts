/**
 * Queue-backed Action Executor
 *
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
        const mode = await resolveFollowUpMode(this.deps.processStore, processId, action.mode);

        queueManager.enqueue({
            processId,
            type: 'chat',
            priority: 'normal',
            payload: {
                kind: 'chat',
                mode,
                prompt,
                processId,
                context: {
                    triggerId: trigger.id,
                    source: 'trigger',
                },
            },
            config: {},
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
            content: prompt,
            mode: action.mode,
            context: {
                triggerId: trigger.id,
                source: 'trigger',
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
