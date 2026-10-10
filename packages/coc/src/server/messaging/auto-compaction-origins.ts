/**
 * Destinations for automatic Sentinel compaction notices (`job-notices.ts`).
 *
 * Only the request whose response triggered the compaction decides: its own
 * WhatsApp request receipt, or its desktop-mirror capture while the mirror is
 * enabled. Never the selected group/topic, notice bindings, or a later
 * binding of the conversation. Each send rechecks that the captured binding is
 * still current, and waits until the triggering answer has been relayed so a
 * notice never lands ahead of it.
 */

import type { AIProcess } from '@plusplusoneplusplus/forge';
import type { QuestionRelayLocation } from './ask-user-relay';
import type { MessagingJobOrigin, MessagingOriginAuthority } from './job-notices';
import type { WhatsAppBindings } from './whatsapp-bindings';

export interface AutoCompactionOriginDeps {
    bindings: Pick<WhatsAppBindings, 'entries'>;
    /** Binding receipts restored. */
    ready?: () => Promise<void>;
    /** The enabled WhatsApp account's group, if any. */
    whatsappGroup: () => string | null | undefined;
    /** Whether the answer relay is sending this request's answer right now. */
    isDeliveringAnswer: (inboundId: string) => boolean;
    /** Desktop mirror captures; `locate` returns nothing while the mirror is disabled. */
    mirror?: {
        locate(request: QuestionRelayLocation): MessagingJobOrigin | undefined;
        authorize(origin: MessagingJobOrigin, owner: { workspaceId: string; processId: string }): Promise<MessagingOriginAuthority>;
    };
}

/** The connector request id of the user turn answered by the response at `turnIndex`. */
export function triggeringRequestId(proc: Pick<AIProcess, 'conversationTurns' | 'metadata'>, turnIndex: number): string | undefined {
    const turns = proc.conversationTurns ?? [];
    const response = turns.findIndex(turn => turn.turnIndex === turnIndex && turn.role === 'assistant');
    for (let i = response - 1; i >= 0; i--) {
        if (turns[i].role !== 'user') continue;
        if (turns[i].relayRequestId) return turns[i].relayRequestId;
        const queueTaskId = proc.metadata?.queueTaskId;
        return turns.findIndex(turn => turn.role === 'user') === i && typeof queueTaskId === 'string' ? queueTaskId : undefined;
    }
    return undefined;
}

export function createAutoCompactionOrigins(deps: AutoCompactionOriginDeps) {
    const receipt = (owner: { workspaceId: string; processId: string }, match: { taskId?: string; inboundId?: string }) => {
        const group = deps.whatsappGroup();
        return group ? deps.bindings.entries().find(row => row.groupJid === group
            && row.workspaceId === owner.workspaceId && row.processId === owner.processId
            && !row.notice && !row.admissionPending && row.releaseState === undefined
            && (match.taskId === undefined || row.taskId === match.taskId)
            && (match.inboundId === undefined || row.inboundId === match.inboundId)) : undefined;
    };
    return {
        async locate(proc: AIProcess, turnIndex: number): Promise<MessagingJobOrigin | undefined> {
            const workspaceId = proc.metadata?.workspaceId;
            const requestId = triggeringRequestId(proc, turnIndex);
            if (typeof workspaceId !== 'string' || !requestId) return undefined;
            await deps.ready?.();
            const binding = receipt({ workspaceId, processId: proc.id }, { taskId: requestId });
            if (binding) return { connector: 'whatsapp', chatKey: binding.groupJid, threadId: binding.inboundId };
            let captured: MessagingJobOrigin | undefined;
            try { captured = deps.mirror?.locate({ workspaceId, processId: proc.id, requestId }); }
            catch { return undefined; }
            return captured?.connector === 'whatsapp' ? captured : undefined;
        },
        async authorize(origin: MessagingJobOrigin, owner: { workspaceId: string; processId: string }): Promise<MessagingOriginAuthority> {
            if (origin.connector !== 'whatsapp') return 'suppress';
            if (origin.desktopMirror) return deps.mirror ? deps.mirror.authorize(origin, owner) : 'suppress';
            await deps.ready?.();
            const binding = receipt(owner, { inboundId: origin.threadId });
            if (!binding || !origin.threadId || binding.groupJid !== origin.chatKey) return 'suppress';
            return binding.status === 'queued' || (binding.status === 'sending' && deps.isDeliveringAnswer(binding.inboundId))
                ? 'wait' : 'ready';
        },
    };
}
