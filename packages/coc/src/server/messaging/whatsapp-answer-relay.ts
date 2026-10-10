import { createHash } from 'node:crypto';
import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { chunkWhatsAppText, formatWhatsAppQuestion } from '@plusplusoneplusplus/coc-connector/whatsapp';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { WhatsAppBindings, type WhatsAppBinding } from './whatsapp-bindings';
import { WhatsAppNotConnectedError } from './whatsapp-messaging-manager';
import { formatWhatsAppAnswer } from './whatsapp-answer-format';
import { onTaskTerminal } from './chat-target';
import type { QuestionTransport, QuestionRelayLocation } from './ask-user-relay';
import { formatJobNotice, type JobNoticeTransport } from './job-notices';
import { RELAY_ANSWER_TEXT, findRequestFailureText, findRequestAnswer, findRequestTurn, isTerminalStatus } from './relay-answer';

export interface WhatsAppRelayDeps {
    bindings: WhatsAppBindings;
    store: Pick<ProcessStore, 'getProcess' | 'getWorkspaces'>;
    queue: Pick<ScheduleQueueEventBus, 'on' | 'off' | 'getTask'>;
    connected: () => boolean;
    groupJid: () => string | null;
    send: (text: string, quotedId: string) => Promise<string>;
    /** After an answer delivery attempt settles; held notices may now follow it. */
    onSettled?: () => void;
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

    /** Whether the answer for this request receipt is being sent right now. */
    isDelivering(inboundId: string): boolean {
        return this.active.has(inboundId);
    }

    async reconnected(): Promise<void> {
        for (const binding of this.deps.bindings.entries()) await this.reconcileTask(binding.taskId);
    }

    async reconcileTask(taskId: string): Promise<void> {
        if (!this.deps.connected()) return;
        for (const binding of this.deps.bindings.entries()) {
            if (binding.releaseState !== undefined || binding.taskId !== taskId || binding.status !== 'queued'
                || binding.groupJid !== this.deps.groupJid() || this.active.has(binding.inboundId)) continue;
            if (!await this.deps.bindings.reconcileAdmission(binding, id => this.deps.queue.getTask(id), this.deps.store)) continue;
            this.active.add(binding.inboundId);
            try {
                await this.deliver(binding);
            } finally {
                this.active.delete(binding.inboundId);
                this.deps.onSettled?.();
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
        const text = status === 'failed' ? findRequestFailureText(turns, start,
            process?.status === 'failed' ? process.error : undefined)
            : status === 'cancelled' ? RELAY_ANSWER_TEXT.cancelled
                : answer?.content?.trim() || RELAY_ANSWER_TEXT.empty;
        if (status === 'completed' && !answer) return;
        const workspace = (await this.deps.store.getWorkspaces()).find(ws => ws.id === binding.workspaceId);
        const header = binding.header
            ?? `${workspace?.name ?? binding.workspaceId} · ${process?.title ?? process?.customTitle ?? binding.processId.slice(0, 8)}`.slice(0, 140);
        const parts = chunkWhatsAppText(`${header}\n\n${formatWhatsAppAnswer(text)}`);
        const hash = createHash('sha256').update(parts.join('')).digest('hex');
        if (binding.answerHash && binding.answerHash !== hash) {
            console.error('[whatsapp-answer-relay] Answer changed during delivery');
            return;
        }
        binding.answerHash = hash;
        binding.header = header;
        this.deps.bindings.update(binding);
        for (let i = binding.nextPart; i < parts.length; i++) {
            if (binding.releaseState !== undefined || !this.deps.connected() || this.deps.groupJid() !== binding.groupJid) return;
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

/** Posts relayed ask_user questions quoted under the WhatsApp request that started the turn. */
export function createWhatsAppQuestionTransport(
    deps: Pick<WhatsAppRelayDeps, 'bindings' | 'connected' | 'groupJid'> & { send: (text: string, quotedId?: string) => Promise<string> },
): QuestionTransport {
    const find = (request: { processId: string; requestId: string }) => deps.bindings.entries()
        .find(binding => binding.releaseState === undefined
            && binding.processId === request.processId && binding.taskId === request.requestId);
    const locate = (request: QuestionRelayLocation) => {
        if (request.origin) return deps.connected() && deps.groupJid() === request.origin.chatKey
            ? { chatKey: request.origin.chatKey } : undefined;
        const binding = find(request);
        return binding ? { chatKey: binding.groupJid } : undefined;
    };
    return {
        platform: 'whatsapp',
        locate,
        post: async (target, layout, request) => {
            const binding = request.origin ? undefined : find(request);
            if ((!request.origin && !binding) || !deps.connected() || deps.groupJid() !== target.chatKey) {
                throw new WhatsAppNotConnectedError();
            }
            const id = await deps.send(formatWhatsAppQuestion(layout), binding?.inboundId);
            if (id && binding) deps.bindings.recordQuestion(binding, id);
            else if (id) deps.bindings.recordOutbound(id);
            return id;
        },
        isPastQuestion: messageId => deps.bindings.isQuestionMessage(messageId),
    };
}

/** Posts job completion notices to the group and binds them, so a quote-reply continues the job. */
export function createWhatsAppNoticeTransport(
    deps: Pick<WhatsAppRelayDeps, 'bindings' | 'connected' | 'groupJid'> & { send: (text: string, quotedId?: string) => Promise<string> },
): JobNoticeTransport {
    const connected = (chatKey: string) => deps.connected() && deps.groupJid() === chatKey;
    return {
        platform: 'whatsapp',
        connected,
        post: async (chatKey, notice) => {
            if (!connected(chatKey)) return undefined;
            const { line, detail } = formatJobNotice(notice);
            const text = notice.body !== undefined ? `${line}\n\n${formatWhatsAppAnswer(notice.body)}`
                : detail ? `${line}\n${detail}` : line;
            let id: string | undefined;
            for (const [index, part] of (notice.desktopResult?.chunks ?? chunkWhatsAppText(text)).entries()) {
                if (!connected(chatKey) || (notice.desktopResult
                    ? !await notice.desktopResult.beforePart(index) : notice.beforeSend && !await notice.beforeSend())) {
                    if (!id) return undefined;
                    throw new WhatsAppNotConnectedError();
                }
                try {
                    const sent = notice.desktopResult ? await deps.send(part, notice.threadId) : await deps.send(part);
                    if (!sent) throw new Error('WhatsApp send confirmation missing');
                    id = sent;
                    deps.bindings.recordNotice({ groupJid: chatKey, workspaceId: notice.workspaceId, processId: notice.processId }, sent);
                } catch (error) {
                    // A later rejection cannot retry already posted parts.
                    if (!id && error instanceof WhatsAppNotConnectedError) return undefined;
                    throw error;
                }
            }
            return id;
        },
    };
}
