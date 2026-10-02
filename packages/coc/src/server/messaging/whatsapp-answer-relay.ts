import { createHash } from 'node:crypto';
import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { chunkWhatsAppText } from '@plusplusoneplusplus/coc-connector/whatsapp';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { WhatsAppBindings, type WhatsAppBinding } from './whatsapp-bindings';
import { WhatsAppNotConnectedError } from './whatsapp-messaging-manager';
import { onTaskTerminal } from './chat-target';
import { RELAY_ANSWER_TEXT, findRequestAnswer, findRequestTurn, isTerminalStatus } from './relay-answer';

export interface WhatsAppRelayDeps {
    bindings: WhatsAppBindings;
    store: Pick<ProcessStore, 'getProcess' | 'getWorkspaces'>;
    queue: Pick<ScheduleQueueEventBus, 'on' | 'off' | 'getTask'>;
    connected: () => boolean;
    groupJid: () => string | null;
    send: (text: string, quotedId: string) => Promise<string>;
}

export class WhatsAppAnswerRelay {
    private readonly active = new Set<string>();
    private readonly onTerminal = (task: QueuedTask) => {
        void this.reconcileTask(task.id).catch(error => {
            console.error('[whatsapp-answer-relay] Failed to deliver answer:', error);
        });
    };

    private readonly unsubscribeTerminal: () => void;

    constructor(private readonly deps: WhatsAppRelayDeps) {
        this.unsubscribeTerminal = onTaskTerminal(deps.queue, this.onTerminal);
    }

    dispose(): void {
        this.unsubscribeTerminal();
    }

    async reconnected(): Promise<void> {
        for (const binding of this.deps.bindings.entries()) await this.reconcileTask(binding.taskId);
    }

    async reconcileTask(taskId: string): Promise<void> {
        if (!this.deps.connected()) return;
        for (const binding of this.deps.bindings.entries()) {
            if (binding.taskId !== taskId || binding.status !== 'queued'
                || binding.groupJid !== this.deps.groupJid() || this.active.has(binding.inboundId)) continue;
            this.active.add(binding.inboundId);
            try {
                await this.deliver(binding);
            } finally {
                this.active.delete(binding.inboundId);
            }
        }
    }

    private async deliver(binding: WhatsAppBinding): Promise<void> {
        const task = this.deps.queue.getTask(binding.taskId);
        if (task && (task.repoId !== binding.workspaceId || (task.processId && task.processId !== binding.processId)
            || (task.payload?.relayRequestId && task.payload.relayRequestId !== binding.taskId))) return;
        const process = await this.deps.store.getProcess(binding.processId, binding.workspaceId);
        if (process && process.metadata?.workspaceId && process.metadata.workspaceId !== binding.workspaceId) return;
        const status = task?.status ?? process?.status;
        if (!isTerminalStatus(status)) return;
        const turns = process?.conversationTurns ?? [];
        const userIndex = findRequestTurn(turns, binding.taskId);
        const start = userIndex >= 0 ? userIndex
            : process?.metadata?.queueTaskId === binding.taskId && turns[0]?.role === 'user' ? 0 : -1;
        if (start < 0 && status === 'completed') return;
        const { answer } = findRequestAnswer(turns, start);
        const text = status === 'failed' ? RELAY_ANSWER_TEXT.failed
            : status === 'cancelled' ? RELAY_ANSWER_TEXT.cancelled
                : answer?.content?.trim() || RELAY_ANSWER_TEXT.empty;
        if (status === 'completed' && !answer) return;
        const workspace = (await this.deps.store.getWorkspaces()).find(ws => ws.id === binding.workspaceId);
        const header = binding.header
            ?? `${workspace?.name ?? binding.workspaceId} · ${process?.title ?? process?.customTitle ?? binding.processId.slice(0, 8)}`.slice(0, 140);
        const parts = chunkWhatsAppText(`${header}\n\n${text}`);
        const hash = createHash('sha256').update(parts.join('')).digest('hex');
        if (binding.answerHash && binding.answerHash !== hash) {
            console.error('[whatsapp-answer-relay] Answer changed during delivery');
            return;
        }
        binding.answerHash = hash;
        binding.header = header;
        this.deps.bindings.update(binding);
        for (let i = binding.nextPart; i < parts.length; i++) {
            if (!this.deps.connected() || this.deps.groupJid() !== binding.groupJid) return;
            // A crash between the send and receipt has an unknown outcome; never blindly resend it.
            binding.status = 'sending';
            this.deps.bindings.update(binding);
            let sentId: string;
            try {
                sentId = await this.deps.send(parts[i], binding.inboundId);
            } catch (error) {
                if (error instanceof WhatsAppNotConnectedError) {
                    binding.status = 'queued';
                    this.deps.bindings.update(binding);
                    return;
                }
                throw error;
            }
            if (!sentId) {
                console.error('[whatsapp-answer-relay] Send confirmation missing; manual reconciliation required');
                return;
            }
            binding.outboundIds.push(sentId);
            binding.nextPart = i + 1;
            binding.status = i + 1 === parts.length ? 'delivered' : 'queued';
            this.deps.bindings.update(binding);
        }
    }
}
