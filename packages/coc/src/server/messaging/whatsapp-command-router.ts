import { randomUUID } from 'node:crypto';
import { toQueueProcessId, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { BotControlMetadata } from '@plusplusoneplusplus/forge/ai';
import { isMessagingControlCommand, parseMessagingCommand, type MessagingChatMode } from '@plusplusoneplusplus/coc-connector';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { WhatsAppBindings, type WhatsAppBinding } from './whatsapp-bindings';
import type { AskUserQuestionRelayHub } from './ask-user-relay';
import { resolveChatWorkspace } from './chat-target';
import { handleMessagingCommand, invalidCommandReply, NO_CHAT_WORKSPACE_REPLY, type MessagingCompactor, type MessagingQuotaSource } from './messaging-commands';
import { RemoteRefMemory, type MessagingRemoteDirectory } from './remote-browse';
import { admitBotControlledFollowUp } from './bot-control-admission';
import { createBotControlMetadata, validateBotControlMetadata } from './bot-control-metadata';
import type { MessagingHandOff } from './job-handoff';

const WHATSAPP_HELP_FORMAT = { strong: (text: string) => `*${text}*` };

export interface WhatsAppRouterDeps {
    store: Pick<ProcessStore, 'getWorkspaces' | 'getAllProcesses' | 'getProcess' | 'updateProcess'>;
    bindings: WhatsAppBindings;
    groupJid: () => string | undefined;
    /** `mode` is undefined for plain text; follow-ups then keep the chat's mode. */
    enqueue: (workspaceId: string, message: string, mode: MessagingChatMode | undefined, processId: string, taskId: string, botControl?: BotControlMetadata, admissionHeld?: boolean) => Promise<string>;
    getTask: (taskId: string) => QueuedTask | undefined;
    send: (text: string, quotedId: string) => Promise<string>;
    react: (messageId: string) => Promise<void>;
    queued?: (binding: WhatsAppBinding) => void;
    getQuota?: MessagingQuotaSource;
    compact?: MessagingCompactor;
    /** Local + remote repo directory for read-only `list remotes` / `list topics <ref>`. */
    remotes?: MessagingRemoteDirectory;
    /** Relayed ask_user questions; a matching reply is an answer, not a request. */
    questions?: Pick<AskUserQuestionRelayHub, 'tryAnswer'>;
    getBotManagedConversationsEnabled?: () => boolean;
    /** Mode-prefixed messages to a sentinel start a separate handed-off job. */
    handOff?: MessagingHandOff;
}

function matchesBinding(task: QueuedTask | undefined, binding: WhatsAppBinding): task is QueuedTask {
    return !!task && task.id === binding.taskId && task.type === 'chat'
        && task.repoId === binding.workspaceId && task.processId === binding.processId
        && task.payload.kind === 'chat' && task.payload.workspaceId === binding.workspaceId
        && task.payload.relayRequestId === binding.taskId
        && (task.payload.processId === undefined || task.payload.processId === binding.processId);
}

export class WhatsAppCommandRouter {
    private readonly remoteRefs = new RemoteRefMemory();

    constructor(private readonly deps: WhatsAppRouterDeps) {}

    async handle(msg: InboundWAMessage): Promise<void> {
        if (!msg.fromMe || !this.deps.groupJid() || msg.chatJid !== this.deps.groupJid()
            || !msg.messageId || this.deps.bindings.isKnownMessage(msg.messageId)) return;
        const command = parseMessagingCommand(msg.text);
        const reply = async (text: string) => {
            const id = await this.deps.send(text, msg.messageId);
            this.deps.bindings.recordOutbound(id);
        };
        let admitted = false;
        try {
            if (await this.deps.questions?.tryAnswer('whatsapp', {
                chatKey: msg.chatJid, messageId: msg.messageId, replyToId: msg.quotedMessageId, text: msg.text,
                reply, acknowledge: () => this.deps.react(msg.messageId),
            })) return;
            if (command.type === 'invalid') { await reply(invalidCommandReply(WHATSAPP_HELP_FORMAT)); return; }
            if (isMessagingControlCommand(command)) {
                const bindings = this.deps.bindings;
                await reply(await handleMessagingCommand(command, {
                    store: this.deps.store,
                    helpFormat: WHATSAPP_HELP_FORMAT,
                    getQuota: this.deps.getQuota,
                    compact: this.deps.compact,
                    compactOrigin: { connector: 'whatsapp', chatKey: msg.chatJid },
                    remotes: this.deps.remotes,
                    remoteRefs: this.remoteRefs.slot(msg.chatJid),
                    // A quote-reply to an answer compacts that answer's chat.
                    compactTarget: () => msg.quotedMessageId ? bindings.findMessage(msg.quotedMessageId) : undefined,
                    selection: {
                        repoId: () => bindings.selectedRepo,
                        selectRepo: id => bindings.selectRepo(id),
                        topicId: id => bindings.topic(id),
                        selectTopic: (id, processId) => bindings.selectTopic(id, processId),
                    },
                }));
                return;
            }
            const workspaces = await this.deps.store.getWorkspaces();
            let workspaceId = resolveChatWorkspace(workspaces, this.deps.bindings.selectedRepo)?.id;
            let targetId = workspaceId ? this.deps.bindings.topic(workspaceId) : null;
            // A reply to a job notice continues that job; the dispatcher stays selected.
            let keepSelection = false;
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
                    if (quoted.releaseState !== undefined) {
                        await reply('Quoted topic binding is unavailable. Select a topic or create a new one.');
                        return;
                    }
                    workspaceId = quoted.workspaceId;
                    targetId = quoted.processId;
                    keepSelection = quoted.notice === true;
                }
            }
            if (!workspaceId || !workspaces.some(ws => ws.id === workspaceId)) {
                await reply(NO_CHAT_WORKSPACE_REPLY);
                return;
            }
            if (!command.args) { await reply('Send a message to start a chat.'); return; }
            const targetProcess = targetId ? await this.deps.store.getProcess(targetId, workspaceId) : undefined;
            const enabled = this.deps.getBotManagedConversationsEnabled?.() === true;
            if (targetId) {
                const pending = !targetProcess && this.deps.bindings.entries().find(row => {
                    if (row.releaseState !== undefined || row.processId !== targetId || row.workspaceId !== workspaceId) return false;
                    const task = this.deps.getTask(row.taskId);
                    return matchesBinding(task, row) && ['queued', 'running'].includes(task.status);
                });
                if (targetProcess ? targetProcess.metadata?.workspaceId !== workspaceId : !pending) {
                    await reply('Selected topic is unavailable. Run `list topics` or `create topic`.'); return;
                }
                if (pending && enabled) {
                    const control = this.deps.getTask(pending.taskId)?.botControl;
                    if (control !== undefined && validateBotControlMetadata(control).source !== 'whatsapp') {
                        throw new Error('Conversation is already controlled by another integration');
                    }
                }
            }
            const react = async () => {
                try {
                    await this.deps.react(msg.messageId);
                } catch (error) {
                    console.error('[whatsapp-messaging] Reaction failed:', error);
                }
            };
            const handOff = await this.deps.handOff?.resolve(targetId, command.mode);
            if (handOff) {
                await this.deps.handOff!.start(handOff, command.args, { connector: 'whatsapp', chatKey: msg.chatJid });
                admitted = true;
                // No receipt: the job reports through notices. Remember the inbound id so a redelivery is ignored.
                this.deps.bindings.recordOutbound(msg.messageId);
                await react();
                return;
            }
            const taskId = randomUUID();
            const processId = targetId ?? toQueueProcessId(taskId);
            const binding: WhatsAppBinding = {
                groupJid: msg.chatJid, workspaceId, processId, taskId, inboundId: msg.messageId,
                outboundIds: [], nextPart: 0, status: 'queued',
            };
            if (!await this.deps.bindings.admit(binding, async () => {
                const enqueue = async (admissionHeld = false) => {
                    try {
                        return await this.deps.enqueue(
                            workspaceId, command.args, command.mode, processId, taskId,
                            !targetId && enabled ? createBotControlMetadata('whatsapp') : undefined,
                            ...(admissionHeld ? [true] : []),
                        );
                    } catch (error) {
                        // taskAdded observers run after durable admission; keep accepted work and its receipt.
                        if (!matchesBinding(this.deps.getTask(taskId), binding)) throw error;
                        console.error('[whatsapp-messaging] Request admitted but queue notification failed:', error);
                        return taskId;
                    }
                };
                if (targetProcess && enabled) {
                    await admitBotControlledFollowUp(this.deps.store, workspaceId, processId, 'whatsapp', enqueue);
                } else {
                    await enqueue();
                }
            })) return;
            admitted = true;
            if (!keepSelection) this.deps.bindings.selectTopic(workspaceId, processId);
            this.deps.queued?.(binding);
            await react();
        } catch (error) {
            console.error('[whatsapp-messaging] Unable to handle inbound message:', error);
            await reply(admitted
                ? 'Request was queued, but its confirmation could not be completed.'
                : 'Could not queue the request. Please try again.');
        }
    }
}
