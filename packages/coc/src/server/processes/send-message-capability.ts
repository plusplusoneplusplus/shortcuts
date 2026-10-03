/**
 * Post-mode delivery capability for `send_to_conversation`.
 *
 * Wraps the exact `ProcessMessageDeliveryService.deliver` path
 * `POST /api/processes/:id/message` uses, resolving the target process (with
 * the same queue_-prefix fallback) and returning the appended user-turn index.
 * The tool's `'steer'` delivery mode maps onto the service's `'immediate'`
 * mode — the service auto-steers a running process.
 */

import { isQueueProcessId, toTaskId, type ProcessStore } from '@plusplusoneplusplus/forge';
import type { QueueExecutorBridge } from '../core/api-handler';
import { buildFollowUpChatModeDisplayBlock, prependChatModeDirective } from '../executors/chat-mode-directive';
import { resolveFollowUpMode } from '../executors/follow-up-mode';
import type { SendMessageFn } from '../llm-tools/send-to-conversation-tool';
import { normalizeChatModeOrDefault } from '../tasks/task-types';
import { ProcessMessageDeliveryService, type FollowUpMessageInput } from './process-message-delivery-service';

export function createSendMessageCapability(store: ProcessStore, bridge: QueueExecutorBridge): SendMessageFn {
    return async (input) => {
        const { processId, content, mode, model, effort, deliveryMode } = input;
        let proc = await store.getProcess(processId);
        if (!proc && isQueueProcessId(processId)) {
            proc = await store.getProcess(toTaskId(processId));
        }
        if (!proc) {
            throw new Error(`Process '${processId}' not found.`);
        }
        const resolvedDeliveryMode: 'immediate' | 'enqueue' =
            deliveryMode === 'immediate' || deliveryMode === 'steer' ? 'immediate' : 'enqueue';
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
        };
        const result = await new ProcessMessageDeliveryService({ store, bridge }).deliver(proc, deliveryInput);
        return { turnIndex: result.turnIndex };
    };
}
