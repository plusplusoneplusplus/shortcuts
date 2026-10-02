import { randomUUID } from 'node:crypto';
import { toQueueProcessId, type ProcessStore } from '@plusplusoneplusplus/forge';
import { isMessagingControlCommand, parseMessagingCommand } from '@plusplusoneplusplus/coc-connector';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { WhatsAppBindings, type WhatsAppBinding } from './whatsapp-bindings';
import { handleMessagingCommand, invalidCommandReply, type MessagingQuotaSource } from './messaging-commands';

export interface WhatsAppRouterDeps {
    store: Pick<ProcessStore, 'getWorkspaces' | 'getAllProcesses' | 'getProcess'>;
    bindings: WhatsAppBindings;
    groupJid: () => string | undefined;
    enqueue: (workspaceId: string, message: string, mode: 'ask' | 'autopilot', processId: string, taskId: string) => Promise<string>;
    send: (text: string, quotedId: string) => Promise<string>;
    react: (messageId: string) => Promise<void>;
    queued?: (binding: WhatsAppBinding) => void;
    getQuota?: MessagingQuotaSource;
}

export class WhatsAppCommandRouter {
    constructor(private readonly deps: WhatsAppRouterDeps) {}

    async handle(msg: InboundWAMessage): Promise<void> {
        if (!msg.fromMe || !this.deps.groupJid() || msg.chatJid !== this.deps.groupJid()
            || !msg.messageId || this.deps.bindings.isKnownMessage(msg.messageId)) return;
        const command = parseMessagingCommand(msg.text);
        const reply = async (text: string) => {
            const id = await this.deps.send(text, msg.messageId);
            this.deps.bindings.recordOutbound(id);
        };
        try {
            if (command.type === 'invalid') { await reply(invalidCommandReply()); return; }
            if (isMessagingControlCommand(command)) {
                const bindings = this.deps.bindings;
                await reply(await handleMessagingCommand(command, {
                    store: this.deps.store,
                    requireRepoForTopics: true,
                    getQuota: this.deps.getQuota,
                    selection: {
                        repoId: () => bindings.selectedRepo,
                        selectRepo: id => bindings.selectRepo(id),
                        topicId: id => id ? bindings.topic(id) : null,
                        selectTopic: (id, processId) => { if (id) bindings.selectTopic(id, processId); },
                    },
                }));
                return;
            }
            const workspaces = await this.deps.store.getWorkspaces();
            let workspaceId = workspaces.find(workspace => workspace.id === this.deps.bindings.selectedRepo)?.id;
            let targetId = workspaceId ? this.deps.bindings.topic(workspaceId) : null;
            if (command.type === 'chat-explicit') {
                const process = await this.deps.store.getProcess(command.chatId);
                const owner = process?.metadata?.workspaceId;
                if (!process || typeof owner !== 'string' || !workspaces.some(ws => ws.id === owner)) {
                    await reply(`Chat "${command.chatId}" not found.`); return;
                }
                workspaceId = owner;
                targetId = process.id;
            } else if (msg.quotedMessageId) {
                const quoted = this.deps.bindings.findMessage(msg.quotedMessageId);
                if (quoted) {
                    workspaceId = quoted.workspaceId;
                    targetId = quoted.processId;
                }
            }
            if (!workspaceId || !workspaces.some(ws => ws.id === workspaceId)) {
                await reply('No repo selected. Run `list repos`, then `select repo <n|name>`.');
                return;
            }
            if (!command.args) { await reply('Send a message to start a chat.'); return; }
            if (targetId) {
                const process = await this.deps.store.getProcess(targetId, workspaceId);
                if (process?.metadata?.workspaceId !== workspaceId
                    && !this.deps.bindings.entries().some(row => row.processId === targetId && row.workspaceId === workspaceId)) {
                    await reply('Selected topic is unavailable. Run `list topics` or `create topic`.'); return;
                }
            }
            const taskId = randomUUID();
            const processId = targetId ?? toQueueProcessId(taskId);
            const binding: WhatsAppBinding = {
                groupJid: msg.chatJid, workspaceId, processId, taskId, inboundId: msg.messageId,
                outboundIds: [], nextPart: 0, status: 'queued',
            };
            if (!this.deps.bindings.add(binding)) return;
            try {
                await this.deps.enqueue(workspaceId, command.args, command.mode, processId, taskId);
            } catch (error) {
                this.deps.bindings.remove(binding);
                throw error;
            }
            this.deps.bindings.selectTopic(workspaceId, processId);
            this.deps.queued?.(binding);
            try {
                await this.deps.react(msg.messageId);
            } catch (error) {
                console.error('[whatsapp-messaging] Reaction failed:', error);
            }
        } catch (error) {
            console.error('[whatsapp-messaging] Unable to handle inbound message:', error);
            await reply('Could not queue the request. Please try again.');
        }
    }
}
