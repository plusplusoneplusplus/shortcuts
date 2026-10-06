import { randomUUID } from 'node:crypto';
import { toQueueProcessId, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { BotControlMetadata } from '@plusplusoneplusplus/forge/ai';
import { ImageDownloadError, isMessagingControlCommand, parseMessagingCommand, type MessagingChatMode } from '@plusplusoneplusplus/coc-connector';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { WhatsAppBindings, type WhatsAppBinding } from './whatsapp-bindings';
import type { AskUserQuestionRelayHub } from './ask-user-relay';
import { resolveChatWorkspace } from './chat-target';
import { handleMessagingCommand, invalidCommandReply, NO_CHAT_WORKSPACE_REPLY, type MessagingCompactor, type MessagingQuotaSource } from './messaging-commands';
import { RemoteRefMemory, type MessagingRemoteDirectory } from './remote-browse';
import { admitBotControlledFollowUp } from './bot-control-admission';
import { createBotControlMetadata, validateBotControlMetadata } from './bot-control-metadata';
import type { MessagingHandOff } from './job-handoff';
import { IncomingImagesError, MAX_MESSAGING_IMAGES, prepareIncomingImages, type PreparedIncomingImages } from './incoming-images';
import { cleanupTempDir } from '../core/image-utils';
import { PendingImages, PendingImagesError, type PendingImageScope } from './pending-images';
import { createCache } from '../cache';

import { LocalTopicMemory } from './local-topics';

const WHATSAPP_HELP_FORMAT = { strong: (text: string) => `*${text}*` };

interface PendingImageReference {
    scope: PendingImageScope;
    keepSelection: boolean;
    ids: string[];
}

export interface WhatsAppRouterDeps {
    store: Pick<ProcessStore, 'getWorkspaces' | 'getAllProcesses' | 'getProcess' | 'updateProcess'>;
    bindings: WhatsAppBindings;
    /** Enables admitted image preparation for the main server. */
    dataDir?: string;
    groupJid: () => string | undefined;
    /** `mode` is undefined for plain text; follow-ups then keep the chat's mode. */
    enqueue: (workspaceId: string, message: string, mode: MessagingChatMode | undefined, processId: string, taskId: string, botControl?: BotControlMetadata, images?: PreparedIncomingImages, admissionHeld?: boolean) => Promise<string>;
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
    private readonly localTopics = new LocalTopicMemory();
    private readonly remoteRefs = new RemoteRefMemory();
    private pendingImages = new PendingImages();
    private generation = 0;
    private selectionVersion = 0;
    private disposed = false;
    private dispatch: Promise<void> | undefined;
    private readonly imageReferences = createCache<PendingImageReference>({
        namespace: 'whatsapp-image-references', maxSize: 2_000,
    });
    private pendingSources: PendingImageReference | undefined;

    private clearImageReferences(): void {
        for (const id of this.pendingSources?.ids ?? []) this.imageReferences.delete(id);
        this.pendingSources = undefined;
    }

    constructor(private readonly deps: WhatsAppRouterDeps) {}

    resetPendingImages(): void {
        this.generation++;
        this.dispatch = undefined;
        this.pendingImages.dispose();
        this.imageReferences.clear();
        this.pendingSources = undefined;
        if (!this.disposed) this.pendingImages = new PendingImages();
    }

    dispose(): void {
        this.disposed = true;
        this.resetPendingImages();
        this.imageReferences.dispose();
    }

    async handle(msg: InboundWAMessage, signal?: AbortSignal): Promise<void> {
        const command = parseMessagingCommand(msg.text);
        if (command.type === 'invalid' || isMessagingControlCommand(command)) {
            await this.handleMessage(msg, signal);
            return;
        }
        const generation = this.generation;
        const pending = (this.dispatch ?? Promise.resolve()).catch(() => undefined).then(() =>
            generation === this.generation ? this.handleMessage(msg, signal) : undefined);
        this.dispatch = pending;
        try {
            await pending;
        } finally {
            if (this.dispatch === pending) this.dispatch = undefined;
        }
    }

    private async handleMessage(msg: InboundWAMessage, signal?: AbortSignal): Promise<void> {
        if (this.disposed || signal?.aborted || !msg.fromMe || !this.deps.groupJid() || msg.chatJid !== this.deps.groupJid()
            || !msg.messageId || this.deps.bindings.isKnownMessage(msg.messageId)) return;
        const generation = this.generation;
        const checkConnection = () => {
            if (this.disposed || signal?.aborted || generation !== this.generation) throw new PendingImagesError('cancelled');
        };
        // Existing admission permits only the paired account, whose participant metadata may be absent.
        const context = { platform: 'whatsapp' as const, conversationId: msg.chatJid, senderId: 'paired-account' };
        const selectionVersion = this.selectionVersion;
        const hadPendingImages = this.pendingImages.has(context);
        const hasImages = !!msg.images?.length;
        const parsed = parseMessagingCommand(msg.text);
        const explicit = hasImages && parsed.type === 'chat' ? /^\[([^\]]+)\]$/.exec(parsed.args) : null;
        const command = explicit && parsed.type === 'chat'
            ? { type: 'chat-explicit' as const, chatId: explicit[1].trim(), args: '', mode: parsed.mode } : parsed;
        const checkImageSelection = () => {
            if ((hasImages || hadPendingImages) && selectionVersion !== this.selectionVersion) {
                throw new PendingImagesError('binding-changed');
            }
        };
        const reply = async (text: string) => {
            checkConnection();
            const id = await this.deps.send(text, msg.messageId);
            this.deps.bindings.recordOutbound(id);
            return id;
        };
        let admitted = false;
        const react = async () => {
            try {
                await this.deps.react(msg.messageId);
            } catch (error) {
                console.error('[whatsapp-messaging] Reaction failed:', error);
            }
        };
        let consumedPendingImages = false;
        let images: PreparedIncomingImages | undefined;
        let sourceMessageIds: string[] | undefined;
        try {
            if (!hasImages && !hadPendingImages && await this.deps.questions?.tryAnswer('whatsapp', {
                chatKey: msg.chatJid, messageId: msg.messageId, replyToId: msg.quotedMessageId, text: msg.text,
                reply: async text => { await reply(text); }, acknowledge: () => this.deps.react(msg.messageId),
            })) return;
            if (hasImages && (command.type === 'invalid' || isMessagingControlCommand(command))) {
                await reply('Send the images with chat instructions, separately from control commands.');
                return;
            }
            if (command.type === 'invalid') { await reply(invalidCommandReply(WHATSAPP_HELP_FORMAT)); return; }
            if (isMessagingControlCommand(command)) {
                const bindings = this.deps.bindings;
                // Reserve the command before awaiting transport or dispatch, including concurrent redelivery.
                if (bindings.isKnownMessage(msg.messageId)) return;
                bindings.recordOutbound(msg.messageId);
                await react();
                await reply(await handleMessagingCommand(command, {
                    store: this.deps.store,
                    helpFormat: WHATSAPP_HELP_FORMAT,
                    getQuota: this.deps.getQuota,
                    compact: this.deps.compact,
                    compactOrigin: { connector: 'whatsapp', chatKey: msg.chatJid },
                    remotes: this.deps.remotes,
                    remoteRefs: this.remoteRefs.slot(msg.chatJid),
                    localTopics: this.localTopics.slot(msg.chatJid),
                    // A quote-reply to an answer compacts that answer's chat.
                    compactTarget: () => msg.quotedMessageId ? bindings.findMessage(msg.quotedMessageId) : undefined,
                    selection: {
                        repoId: () => bindings.selectedRepo,
                        selectRepo: id => {
                            checkConnection();
                            this.selectionVersion++;
                            this.pendingImages.discard(context);
                            this.clearImageReferences();
                            bindings.selectRepo(id);
                        },
                        topicId: id => bindings.topic(id),
                        selectTopic: (id, processId) => {
                            checkConnection();
                            this.selectionVersion++;
                            this.pendingImages.discard(context);
                            this.clearImageReferences();
                            bindings.selectTopic(id, processId);
                        },
                    },
                }));
                return;
            }
            const workspaces = await this.deps.store.getWorkspaces();
            checkConnection();
            let workspaceId = resolveChatWorkspace(workspaces, this.deps.bindings.selectedRepo)?.id;
            let targetId = workspaceId ? this.deps.bindings.topic(workspaceId) : null;
            // A reply to a job notice continues that job; the dispatcher stays selected.
            let keepSelection = false;
            if (command.type === 'chat-explicit') {
                const process = await this.deps.store.getProcess(command.chatId);
                checkConnection();
                const owner = process?.metadata?.workspaceId;
                if (!process || typeof owner !== 'string' || !workspaces.some(ws => ws.id === owner)) {
                    await reply(`Chat "${command.chatId}" not found.`); return;
                }
                workspaceId = owner;
                targetId = process.id;
            } else if (msg.quotedMessageId) {
                const quoted = this.deps.bindings.findMessage(msg.quotedMessageId);
                const imageReference = this.imageReferences.get(msg.quotedMessageId);
                if (quoted) {
                    if (quoted.releaseState !== undefined) {
                        await reply('Quoted topic binding is unavailable. Select a topic or create a new one.');
                        return;
                    }
                    workspaceId = quoted.workspaceId;
                    targetId = quoted.processId;
                    keepSelection = quoted.notice === true;
                } else if (imageReference) {
                    workspaceId = imageReference.scope.workspaceId;
                    targetId = imageReference.scope.chatId;
                    keepSelection = imageReference.keepSelection;
                }
            }
            if (!workspaceId || !workspaces.some(ws => ws.id === workspaceId)) {
                await reply(NO_CHAT_WORKSPACE_REPLY);
                return;
            }
            if (!command.args && !hasImages) { await reply('Send a message to start a chat.'); return; }
            const targetProcess = targetId ? await this.deps.store.getProcess(targetId, workspaceId) : undefined;
            checkConnection();
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
            checkImageSelection();
            const scope = { ...context, workspaceId, chatId: targetId };
            if (!command.args) {
                if (!this.deps.dataDir) throw new IncomingImagesError('storage');
                if (!this.pendingImages.add(scope, msg.messageId, msg.images!).duplicate) {
                    if (!this.pendingSources || this.pendingSources.scope.workspaceId !== workspaceId || this.pendingSources.scope.chatId !== targetId) {
                        this.clearImageReferences();
                        this.pendingSources = { scope, keepSelection, ids: [] };
                    }
                    const sources = this.pendingSources!;
                    sources.ids.push(msg.messageId);
                    this.imageReferences.set(msg.messageId, sources);
                    this.deps.bindings.recordOutbound(msg.messageId);
                    const ackId = await reply('Images received. Send instructions in your next message (within 30 minutes).');
                    checkConnection();
                    checkImageSelection();
                    sources.ids.push(ackId);
                    this.imageReferences.set(ackId, sources);
                }
                return;
            }
            const handOff = await this.deps.handOff?.resolve(targetId, command.mode);
            checkConnection();
            checkImageSelection();
            if (this.pendingImages.count(scope) + (msg.images?.length ?? 0) > MAX_MESSAGING_IMAGES) {
                throw new PendingImagesError('batch-limit');
            }
            const pendingImages = this.pendingImages.take(scope);
            consumedPendingImages = !!pendingImages?.length;
            if (consumedPendingImages) {
                sourceMessageIds = this.pendingSources?.ids;
                this.clearImageReferences();
            }
            const turnImages = [...(pendingImages ?? []), ...(msg.images ?? [])];
            if (handOff && turnImages.length) {
                const taskId = randomUUID();
                const binding: WhatsAppBinding = {
                    groupJid: msg.chatJid, workspaceId: handOff.workspaceId,
                    processId: toQueueProcessId(taskId), taskId, inboundId: msg.messageId,
                    outboundIds: [], nextPart: 0, status: 'delivered', notice: true,
                    ...(sourceMessageIds ? { sourceMessageIds } : {}),
                };
                if (!await this.deps.bindings.admit(binding, async () => {
                    if (!this.deps.dataDir) throw new IncomingImagesError('storage');
                    images = await prepareIncomingImages(this.deps.dataDir, handOff.workspaceId, turnImages, signal);
                    checkConnection();
                    await this.deps.handOff!.start(handOff, command.args,
                        { connector: 'whatsapp', chatKey: msg.chatJid }, { taskId, images });
                })) return;
                admitted = true;
                await react();
                return;
            }
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
                ...(sourceMessageIds ? { sourceMessageIds } : {}),
            };
            if (!await this.deps.bindings.admit(binding, async () => {
                checkConnection();
                if (turnImages.length) {
                    if (!this.deps.dataDir) throw new IncomingImagesError('storage');
                    images = await prepareIncomingImages(this.deps.dataDir, workspaceId, turnImages, signal);
                    checkConnection();
                }
                const enqueue = async (admissionHeld = false) => {
                    checkConnection();
                    try {
                        return await this.deps.enqueue(
                            workspaceId, command.args, command.mode, processId, taskId,
                            !targetId && enabled ? createBotControlMetadata('whatsapp') : undefined,
                            ...(images || admissionHeld ? [images, admissionHeld] : []),
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
            if (!admitted && images?.imageTempDir) cleanupTempDir(images.imageTempDir);
            const discardedPendingInstruction = hadPendingImages && !!command.args
                && error instanceof PendingImagesError && (error.code === 'expired' || error.code === 'binding-changed');
            if (discardedPendingInstruction) this.clearImageReferences();
            if (!admitted && (consumedPendingImages || discardedPendingInstruction)) this.deps.bindings.recordOutbound(msg.messageId);
            if (this.disposed || signal?.aborted || generation !== this.generation) return;
            if (error instanceof ImageDownloadError || error instanceof IncomingImagesError || error instanceof PendingImagesError) {
                await reply(error.message);
                return;
            }
            console.error('[whatsapp-messaging] Unable to handle inbound message:', error);
            await reply(admitted
                ? 'Request was queued, but its confirmation could not be completed.'
                : consumedPendingImages ? 'Could not queue the request. Send the images again with instructions.'
                    : 'Could not queue the request. Please try again.');
        }
    }
}
