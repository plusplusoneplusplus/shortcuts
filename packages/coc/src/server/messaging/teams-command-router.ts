/**
 * Parses inbound Teams messages into structured commands and dispatches them.
 * Manages per-user state (selected repo, selected chat topic).
 *
 * The command grammar comes from the shared coc-connector parser; repo/topic
 * selection, help and quota replies come from `messaging-commands.ts`. This
 * router keeps Teams threads, relay receipts and per-user state.
 */

import { isQueueProcessId, toQueueProcessId, type ProcessStore, type AIProcess } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import {
    ImageDownloadError, formatMessagingHelp, isMessagingControlCommand, parseMessagingCommand,
    type MessagingChatMode, type MessagingCommand, type MessagingControlCommand,
} from '@plusplusoneplusplus/coc-connector';
import { TeamsUserStateStore } from './teams-user-state';
import type { TeamsEventType } from './teams-attempt-store';
import { escapeTeamsMarkdown, teamsCodeSpan } from './teams-outbound-format';
import { resolveChatWorkspace, resolveWorkspace } from './chat-target';
import {
    compactChatReply, handleMessagingCommand, invalidCommandReply, NO_CHAT_WORKSPACE_REPLY, readQuotaReply,
    type MessagingCompactor, type MessagingQuotaSource,
} from './messaging-commands';
import { RemoteRefMemory, type MessagingRemoteDirectory } from './remote-browse';
import type { MessagingHandOff, MessagingHandOffTarget } from './job-handoff';
import type { MessagingJobOrigin } from './job-notices';
import { LocalTopicMemory, localTopicsReply, resolveLocalTopic } from './local-topics';
import { IncomingImagesError, MAX_MESSAGING_IMAGES } from './incoming-images';
import { PendingImages, PendingImagesError, PENDING_IMAGE_TTL_MS, type PendingImageContext, type PendingImageScope } from './pending-images';
import { createCache } from '../cache';

const EMPTY_CHAT_REPLY = 'Send a message to start a chat.';

interface ImageRootFrame {
    scope: PendingImageScope;
    roots: string[];
}

function createImageRootCache() {
    return createCache<ImageRootFrame>({ namespace: 'teams-pending-image-roots', maxSize: 2_000 });
}

function createInstructionCache() {
    return createCache<true>({
        namespace: 'teams-consumed-image-instructions', maxSize: 2_000, ttlMs: PENDING_IMAGE_TTL_MS,
    });
}

const TEAMS_FORMAT = {
    strong: (text: string) => `**${escapeTeamsMarkdown(text)}**`,
    code: teamsCodeSpan,
    escape: escapeTeamsMarkdown,
};

// ============================================================================
// Types
// ============================================================================

export interface TeamsCommandRouterDeps {
    /** ProcessStore for querying workspaces and processes. */
    store: ProcessStore;
    /** Enqueue a new chat message. Returns the enqueued task ID. */
    enqueueChat: (workspaceId: string, message: string, mode?: MessagingChatMode) => Promise<string>;
    /** Admit a relay-enabled new chat with its Teams receipt persisted before enqueue. */
    admitNewChat?: (msg: InboundTeamsMessage, workspaceId: string, message: string, mode?: MessagingChatMode) => Promise<{ taskId: string; duplicate: boolean }>;
    acknowledgeNewChat?: (taskId: string) => Promise<void>;
    admitFollowUp?: (msg: InboundTeamsMessage, process: AIProcess, message: string, mode?: MessagingChatMode) => Promise<{ duplicate: boolean }>;
    admitPendingFollowUp?: (msg: InboundTeamsMessage, taskId: string, message: string, mode?: MessagingChatMode) => Promise<{ duplicate: boolean } | null>;
    resolveThreadReply?: (msg: InboundTeamsMessage) => Promise<{ process?: AIProcess; taskId?: string; workspaceId: string } | null>;
    getThreadSelection?: (msg: InboundTeamsMessage) => { workspaceId: string } | null;
    /** Persist a shared selection for an already-bound channel thread. */
    selectThreadTarget?: (msg: InboundTeamsMessage, workspaceId: string, processId: string | null) => Promise<void>;
    hasThreadCommand?: (msg: InboundTeamsMessage) => boolean;
    recordThreadCommand?: (msg: InboundTeamsMessage) => void;
    admitThreadNew?: (msg: InboundTeamsMessage, workspaceId: string, message: string, mode?: MessagingChatMode) => Promise<{ taskId: string; duplicate: boolean }>;
    acknowledgeFollowUp?: (msg: InboundTeamsMessage) => Promise<void>;
    isAnswerRelayEnabled?: () => boolean;
    /** Send a follow-up message to an existing process. */
    executeFollowUp: (processId: string, message: string, mode?: MessagingChatMode) => Promise<void>;
    /** Provider quota for the `quota` command. */
    getQuota?: MessagingQuotaSource;
    /** Compacts a chat's provider context for the `compact` command. */
    compact?: MessagingCompactor;
    /** Local + remote repo directory for read-only `list remotes` / `list topics <ref>`. */
    remotes?: MessagingRemoteDirectory;
    /** Mode-prefixed messages to a sentinel start a separate handed-off job. */
    handOff?: MessagingHandOff;
    admitImageHandOff?: (msg: InboundTeamsMessage, target: MessagingHandOffTarget, message: string, origin: MessagingJobOrigin) => Promise<{ taskId: string; duplicate: boolean }>;
    resolvePendingImageTarget?: (processId: string) => { workspaceId: string; chatId: string } | null;
    validateImageTarget?: (msg: InboundTeamsMessage, workspaceId: string) => Promise<void>;
    bindImageRoot?: (msg: InboundTeamsMessage, workspaceId: string, processId: string | null) => Promise<void>;
    /** Where a job handed off from `msg` reports back; undefined while the channel is unknown. */
    handOffOrigin?: (msg: InboundTeamsMessage) => MessagingJobOrigin | undefined;
    /** Send a reply back to Teams. */
    sendReply: (text: string, replyToId?: string) => Promise<void>;
    /** Data directory for persisting user state. */
    dataDir: string;
}

// ============================================================================
// Router
// ============================================================================

export class TeamsCommandRouter {
    private readonly deps: TeamsCommandRouterDeps;
    private readonly userState: TeamsUserStateStore;
    private readonly hydratingRoots = new Set<string>();
    private readonly threadDispatches = new Map<string, Promise<void>>();
    private readonly localTopics = new LocalTopicMemory();
    private readonly remoteRefs = new RemoteRefMemory();
    private pendingImages = new PendingImages();
    private consumedImageInstructions = createInstructionCache();
    private stopped = false;
    private imageGeneration = 0;
    private imageRoots = createImageRootCache();

    private imageRootKey(channelId: string, rootId: string): string {
        return JSON.stringify(['root', channelId, rootId]);
    }

    private latestImageRootKey(msg: InboundTeamsMessage): string {
        return JSON.stringify(['latest', msg.channelId, msg.senderAadId]);
    }

    private rootFrame(msg: InboundTeamsMessage): ImageRootFrame | undefined {
        const frame = msg.replyToMessageId
            ? this.imageRoots.get(this.imageRootKey(msg.channelId, msg.replyToMessageId))
            : this.imageRoots.get(this.latestImageRootKey(msg));
        return frame?.scope.senderId === msg.senderAadId ? frame : undefined;
    }

    private clearRootFrame(frame: ImageRootFrame): void {
        for (const rootId of frame.roots) this.imageRoots.delete(this.imageRootKey(frame.scope.conversationId, rootId));
        const latestKey = JSON.stringify(['latest', frame.scope.conversationId, frame.scope.senderId]);
        if (this.imageRoots.get(latestKey) === frame) this.imageRoots.delete(latestKey);
    }

    private instructionKey(msg: InboundTeamsMessage): string {
        return JSON.stringify([msg.channelId, msg.replyToMessageId ?? null, msg.senderAadId, msg.messageId]);
    }

    private discardThreadImages(msg: InboundTeamsMessage): void {
        this.pendingImages.discardConversation({
            platform: 'teams', conversationId: msg.channelId, threadId: msg.replyToMessageId,
        });
        const frame = this.imageRoots.get(this.imageRootKey(msg.channelId, msg.replyToMessageId!));
        if (frame) {
            this.pendingImages.discard(frame.scope);
            this.clearRootFrame(frame);
        }
    }

    constructor(deps: TeamsCommandRouterDeps) {
        this.deps = deps;
        this.userState = new TeamsUserStateStore(deps.dataDir);
    }

    async handle(msg: InboundTeamsMessage, observe?: (type: TeamsEventType) => void): Promise<void> {
        if (this.stopped) return;
        const key = JSON.stringify([msg.channelId, msg.replyToMessageId ?? null,
            msg.replyToMessageId ? null : msg.senderAadId ?? msg.senderName]);
        const previous = this.threadDispatches.get(key);
        const generation = this.imageGeneration;
        const pending = (previous ?? Promise.resolve()).catch(() => undefined)
            .then(() => generation === this.imageGeneration ? this.handleMessage(msg, observe) : undefined);
        this.threadDispatches.set(key, pending);
        try {
            await pending;
        } finally {
            if (this.threadDispatches.get(key) === pending) this.threadDispatches.delete(key);
        }
    }

    stop(): void {
        this.stopped = true;
        this.imageGeneration++;
        this.threadDispatches.clear();
        this.pendingImages.dispose();
        this.consumedImageInstructions.dispose();
        this.imageRoots.dispose();
    }

    start(): void {
        this.pendingImages.dispose();
        this.pendingImages = new PendingImages();
        this.imageGeneration++;
        this.threadDispatches.clear();
        this.consumedImageInstructions.dispose();
        this.consumedImageInstructions = createInstructionCache();
        this.imageRoots.dispose();
        this.imageRoots = createImageRootCache();
        this.stopped = false;
    }

    private imageContext(msg: InboundTeamsMessage): PendingImageContext {
        if (msg.replyToMessageId) {
            const frame = this.rootFrame(msg);
            if (frame) return frame.scope;
        }
        return { platform: 'teams', conversationId: msg.channelId, threadId: msg.replyToMessageId,
            senderId: msg.senderAadId ?? '' };
    }

    hasPendingImageInstructions(msg: InboundTeamsMessage): boolean {
        if (this.stopped || !msg.senderAadId || msg.botAuthored || msg.initializationReplay || msg.historicalSelectionReplay) return false;
        const command = parseMessagingCommand(msg.text);
        return (command.type === 'chat' || command.type === 'chat-explicit')
            && !!command.args && (this.pendingImages.has(this.rootFrame(msg)?.scope ?? this.imageContext(msg))
                || this.consumedImageInstructions.has(this.instructionKey(msg)));
    }

    private async imageScope(msg: InboundTeamsMessage, command: MessagingCommand): Promise<PendingImageScope> {
        const generation = this.imageGeneration;
        let workspaceId: string | undefined;
        let chatId: string | null = null;
        if (msg.replyToMessageId) {
            if (this.deps.isAnswerRelayEnabled?.() !== true) throw new Error('Teams thread target is unavailable');
            const binding = await this.deps.resolveThreadReply?.(msg);
            if (!binding) throw new Error('Teams thread target is unavailable');
            workspaceId = binding.workspaceId;
            chatId = binding.process?.id ?? (binding.taskId ? toQueueProcessId(binding.taskId) : null);
        } else {
            const state = this.userState.get(msg.senderAadId ?? msg.senderName ?? 'anonymous');
            const targetId = command.type === 'chat-explicit' ? command.chatId : state.selectedTopic ?? state.lastActiveTopic;
            if (targetId) {
                const process = await this.deps.store.getProcess(targetId)
                    ?? (!isQueueProcessId(targetId) ? await this.deps.store.getProcess(toQueueProcessId(targetId)) : undefined);
                if (process) {
                    workspaceId = typeof process.metadata?.workspaceId === 'string' ? process.metadata.workspaceId : undefined;
                    chatId = process.id;
                } else {
                    const queued = this.deps.resolvePendingImageTarget?.(targetId);
                    if (!queued) throw new Error('Teams conversation target is unavailable');
                    workspaceId = queued.workspaceId;
                    chatId = queued.chatId;
                }
            } else {
                workspaceId = resolveChatWorkspace(await this.deps.store.getWorkspaces(), state.selectedRepo)?.id;
            }
        }
        if (!workspaceId || !(await this.deps.store.getWorkspaces()).some(ws => ws.id === workspaceId)) throw new IncomingImagesError('workspace');
        if (!this.deps.validateImageTarget) throw new IncomingImagesError('storage');
        await this.deps.validateImageTarget(msg, workspaceId);
        if (this.stopped || generation !== this.imageGeneration) throw new PendingImagesError('cancelled');
        const frame = this.rootFrame(msg);
        const context = !msg.replyToMessageId && frame && this.pendingImages.has(frame.scope) ? frame.scope : this.imageContext(msg);
        return { ...context, workspaceId, chatId };
    }

    private async handleMessage(msg: InboundTeamsMessage, observe?: (type: TeamsEventType) => void): Promise<void> {
        let command: MessagingCommand | undefined;
        let boundThread = false;
        const imageRequest = !!msg.images?.length || this.hasPendingImageInstructions(msg);
        const generation = this.imageGeneration;
        let consumedRoots: ImageRootFrame | undefined;

        try {
            if (this.stopped) return;
            const instructionKey = this.instructionKey(msg);
            if (this.consumedImageInstructions.has(instructionKey)) return;
            if (msg.botAuthored) return;
            if ((msg.images?.length || (msg.senderAadId && this.pendingImages.has(this.imageContext(msg))))
                && (msg.initializationReplay || msg.historicalSelectionReplay)) return;
            if (msg.images?.length) {
                const mediaCommand = parseMessagingCommand(msg.text);
                if (mediaCommand.type === 'invalid' || isMessagingControlCommand(mediaCommand)) {
                    await this.deps.sendReply('Send the images with chat instructions, separately from control commands.', msg.replyToMessageId || msg.messageId);
                    return;
                }
            }
            const parsedImageCommand = parseMessagingCommand(msg.text);
            const explicit = msg.images?.length && !msg.replyToMessageId && parsedImageCommand.type === 'chat'
                ? /^\[([^\]]+)\]$/.exec(parsedImageCommand.args) : null;
            const imageCommand = explicit && parsedImageCommand.type === 'chat'
                ? { type: 'chat-explicit' as const, chatId: explicit[1].trim(), args: '', mode: parsedImageCommand.mode }
                : parsedImageCommand;
            if (msg.images?.length && (imageCommand.type === 'chat' || imageCommand.type === 'chat-explicit') && !imageCommand.args) {
                if (!msg.replyToMessageId && this.deps.hasThreadCommand?.({ ...msg, replyToMessageId: msg.messageId })) return;
                let scope = await this.imageScope(msg, imageCommand);
                let frame = this.rootFrame(msg);
                if (!msg.replyToMessageId && (!frame || frame.scope.workspaceId !== scope.workspaceId || frame.scope.chatId !== scope.chatId)) {
                    scope = { ...scope, threadId: msg.messageId };
                    frame = { scope, roots: [] };
                }
                if (!this.pendingImages.add(scope, msg.messageId, msg.images).duplicate) {
                    if (!msg.replyToMessageId && frame) {
                        frame.roots.push(msg.messageId);
                        this.imageRoots.set(this.latestImageRootKey(msg), frame);
                        this.imageRoots.set(this.imageRootKey(msg.channelId, msg.messageId), frame);
                        await this.deps.bindImageRoot?.(msg, scope.workspaceId, scope.chatId);
                    }
                    await this.deps.sendReply('Images received. Send instructions here within 30 minutes.', msg.replyToMessageId || msg.messageId);
                }
                return;
            }
            if (this.hasPendingImageInstructions(msg)) {
                const scope = await this.imageScope(msg, imageCommand);
                if (this.pendingImages.count(scope) + (msg.images?.length ?? 0) > MAX_MESSAGING_IMAGES) throw new PendingImagesError('batch-limit');
                this.consumedImageInstructions.set(instructionKey, true);
                consumedRoots = this.rootFrame(msg);
                const pending = this.pendingImages.take(scope) ?? [];
                if (consumedRoots) this.clearRootFrame(consumedRoots);
                msg = { ...msg, images: [...pending, ...(msg.images ?? [])] };
            }
            if (msg.replyToMessageId && this.deps.resolveThreadReply
                && this.deps.isAnswerRelayEnabled?.() !== true) {
                await this.deps.sendReply('❌ Teams thread follow-ups are unavailable.', msg.replyToMessageId);
                return;
            }
            if (msg.replyToMessageId && this.deps.isAnswerRelayEnabled?.() === true) {
                boundThread = true;
                command = parseMessagingCommand(msg.text);
                if ('historicalSelectionReplay' in msg && msg.historicalSelectionReplay === true) {
                    if (!isMessagingControlCommand(command) || this.deps.hasThreadCommand?.(msg)) return;
                    const key = `${msg.channelId}\0${msg.replyToMessageId}`;
                    if (!this.hydratingRoots.has(key)) {
                        if (this.deps.getThreadSelection?.(msg)) return;
                        if (command.type !== 'select-repo') return;
                        this.hydratingRoots.add(key);
                    }
                    if (command.type === 'select-topic' && /^[1-9]\d*$/.test(command.args)) return;
                    await this.handleThreadCommand(msg, command, true);
                    return;
                }
                if (command.type === 'invalid') {
                    if (this.deps.hasThreadCommand?.(msg)) return;
                    this.deps.recordThreadCommand?.(msg);
                    await this.deps.sendReply(`❌ ${invalidCommandReply(TEAMS_FORMAT)}`, msg.replyToMessageId);
                    return;
                }
                if (isMessagingControlCommand(command)) {
                    if (this.deps.hasThreadCommand?.(msg)) return;
                    observe?.('dispatch-command');
                    await this.handleThreadCommand(msg, command);
                    return;
                }
                const binding = await this.deps.resolveThreadReply?.(msg);
                if (!binding) {
                    await this.deps.sendReply('❌ Choose a repo in this thread: `/list repos`, then `/select repo <name>`.', msg.replyToMessageId);
                    return;
                }
                // A thread is already bound to its target, so `[id]` text is part of the question.
                const mode = command.mode;
                const message = command.type === 'chat' ? command.args
                    : msg.text.trim().replace(/^\/(?:autopilot|ask|ralph|sentinel)\s+/i, '');
                if (!message) {
                    if (mode && !this.deps.hasThreadCommand?.(msg)) {
                        this.deps.recordThreadCommand?.(msg);
                        await this.deps.sendReply(`❌ ${EMPTY_CHAT_REPLY}`, msg.replyToMessageId);
                    }
                    return;
                }
                const threadTarget = binding.process?.id ?? (binding.taskId ? toQueueProcessId(binding.taskId) : undefined);
                if (await this.tryHandOff(msg, threadTarget, message, mode, observe)) return;
                const newChat = !binding.process && !binding.taskId;
                const admission: { duplicate: boolean; taskId?: string } | null | undefined = binding.process
                    ? await this.deps.admitFollowUp?.(msg, binding.process, message, mode)
                    : binding.taskId
                        ? await this.deps.admitPendingFollowUp?.(msg, binding.taskId, message, mode)
                        : this.deps.admitThreadNew
                            ? await this.deps.admitThreadNew(msg, binding.workspaceId, message, mode)
                            : null;
                if (!admission) {
                    throw new Error('Teams thread target is unavailable');
                }
                if (admission.duplicate) {
                    return;
                }
                if (consumedRoots) {
                    const processId = binding.process?.id ?? (binding.taskId ? toQueueProcessId(binding.taskId)
                        : admission.taskId ? toQueueProcessId(admission.taskId) : null);
                    for (const root of consumedRoots.roots) {
                        await this.deps.bindImageRoot?.({ ...msg, messageId: root }, binding.workspaceId, processId);
                    }
                }
                observe?.(newChat ? 'dispatch-queued' : 'dispatch-follow-up');
                if (newChat) {
                    await this.sendAcceptance(
                        '💬 New chat started in the selected repo. Your next question continues it.',
                        msg, () => admission.taskId
                            ? this.deps.acknowledgeNewChat?.(admission.taskId)
                            : this.deps.acknowledgeFollowUp?.(msg));
                } else {
                    await this.deps.acknowledgeFollowUp?.(msg);
                }
                return;
            }

            command = parseMessagingCommand(msg.text);
            const userKey = msg.senderAadId ?? msg.senderName ?? 'anonymous';
            if (command.type !== 'chat' && command.type !== 'chat-explicit') observe?.('dispatch-command');
            if (command.type === 'invalid') {
                await this.deps.sendReply(`❌ ${invalidCommandReply(TEAMS_FORMAT)}`, msg.messageId);
            } else if (command.type === 'chat-explicit') {
                await this.handleExplicitChat(userKey, command, msg, observe);
            } else if (command.type === 'chat') {
                await this.handleChat(userKey, command.args, command.mode, msg, observe);
            } else {
                await this.deps.sendReply(await this.handleControlCommand(userKey, command, `${msg.channelId}\0${userKey}`, msg), msg.messageId);
            }
            if (consumedRoots && !msg.replyToMessageId) {
                const state = this.userState.get(userKey);
                const processId = consumedRoots.scope.chatId ?? state.selectedTopic ?? state.lastActiveTopic;
                for (const root of consumedRoots.roots) {
                    await this.deps.bindImageRoot?.({ ...msg, messageId: root }, consumedRoots.scope.workspaceId, processId);
                }
            }
        } catch (err: any) {
            if (consumedRoots) this.clearRootFrame(consumedRoots);
            if (this.stopped || generation !== this.imageGeneration) return;
            observe?.('dispatch-failed');
            if (err instanceof ImageDownloadError || err instanceof IncomingImagesError || err instanceof PendingImagesError) {
                await this.deps.sendReply(err.message, msg.replyToMessageId || msg.messageId);
                return;
            }
            if ('historicalSelectionReplay' in msg && msg.historicalSelectionReplay === true) {
                console.error('[teams-messaging] Historical thread selection could not be restored');
                return;
            }
            if (boundThread || (msg.replyToMessageId && !command && this.deps.isAnswerRelayEnabled?.() === true)) {
                const text = err instanceof Error && err.message === 'Teams thread workspace is unavailable'
                    ? '❌ Selected repo is unavailable. Use `/select repo <name>` here.'
                    : err instanceof Error && err.message === 'Teams thread chat is unavailable'
                        ? '❌ This chat is unavailable. Use `/select topic <id>` or `/create topic` here.'
                        : '❌ Teams thread target is unavailable. Retry the command or question shortly.';
                await this.deps.sendReply(text, msg.replyToMessageId);
            } else if (imageRequest || (this.deps.isAnswerRelayEnabled?.() === true && (msg.replyToMessageId || command?.type === 'chat' || command?.type === 'chat-explicit'))) {
                await this.deps.sendReply('❌ Unable to accept the request. Please try again later.', msg.replyToMessageId || msg.messageId);
            } else {
                await this.deps.sendReply(`❌ Error: ${err.message ?? 'Unknown error'}`, msg.messageId);
            }
        }
    }

    /** `chatKey` scopes the `list remotes` numbering: a bound thread, or a user in a channel. */
    private handleControlCommand(userKey: string, command: MessagingControlCommand, chatKey: string, msg?: InboundTeamsMessage): Promise<string> {
        const discard = () => {
            if (msg?.senderAadId) this.pendingImages.discard(this.imageContext(msg));
            if (msg) this.imageRoots.delete(this.latestImageRootKey(msg));
        };
        return handleMessagingCommand(command, {
            store: this.deps.store,
            getQuota: this.deps.getQuota,
            ...TEAMS_FORMAT,
            helpFormat: TEAMS_FORMAT,
            compact: this.deps.compact,
            compactOrigin: msg && this.deps.handOffOrigin?.(msg) ? { ...this.deps.handOffOrigin(msg)!, threadId: msg.replyToMessageId ?? msg.messageId } : undefined,
            remotes: this.deps.remotes,
            remoteRefs: this.remoteRefs.slot(chatKey),
            localTopics: this.localTopics.slot(`user\0${chatKey}`),
            // Compact the chat plain messages currently continue.
            compactTarget: () => {
                const state = this.userState.get(userKey);
                const processId = state.selectedTopic ?? state.lastActiveTopic;
                return processId ? { processId } : null;
            },
            selection: {
                repoId: () => this.userState.get(userKey).selectedRepo,
                selectRepo: workspaceId => { discard(); this.userState.update(userKey, { selectedRepo: workspaceId }); },
                topicId: () => this.userState.get(userKey).selectedTopic,
                selectTopic: (_workspaceId, processId) => { discard(); this.userState.update(userKey, processId
                    ? { selectedTopic: processId }
                    : { selectedTopic: null, lastActiveTopic: null }); },
            },
        });
    }

    private async handleThreadCommand(msg: InboundTeamsMessage, command: MessagingControlCommand, silent = false): Promise<void> {
        const root = msg.replyToMessageId!;
        if (silent && (command.type === 'list-repos' || command.type === 'list-topics' || command.type === 'list-remotes'
            || command.type === 'help' || command.type === 'quota')) return;
        // Remote browsing is read-only and never touches the thread's selection.
        const remoteBrowse = command.type === 'list-remotes' || (command.type === 'list-topics' && !!command.args);
        if (command.type === 'list-repos' || command.type === 'help' || command.type === 'quota' || remoteBrowse) {
            this.deps.recordThreadCommand?.(msg);
            await this.deps.sendReply(command.type === 'help' ? formatMessagingHelp(TEAMS_FORMAT)
                : command.type === 'quota' ? await readQuotaReply(this.deps.getQuota)
                    : await this.handleControlCommand('', command, `${msg.channelId}\0${root}`), root);
            return;
        }
        if (command.type === 'compact') {
            if (silent) return;
            this.deps.recordThreadCommand?.(msg);
            // A bound thread compacts its own chat.
            const binding = await this.deps.resolveThreadReply?.(msg);
            const processId = binding?.process?.id ?? (binding?.taskId ? toQueueProcessId(binding.taskId) : undefined);
            await this.deps.sendReply(processId
                ? await compactChatReply(this.deps.store, this.deps.compact,
                    { processId, workspaceId: binding!.workspaceId }, command.args, escapeTeamsMarkdown, this.deps.handOffOrigin?.(msg) ? { ...this.deps.handOffOrigin(msg)!, threadId: root } : undefined)
                : '❌ No topic selected in this thread. Use `/list topics`, then `/select topic <n>` here.', root);
            return;
        }
        if (!this.deps.selectThreadTarget) throw new Error('Teams thread selection is unavailable');
        const selection = this.deps.getThreadSelection?.(msg) ?? await this.deps.resolveThreadReply?.(msg);
        const reply = (text: string) => silent ? Promise.resolve() : this.deps.sendReply(text, root);
        if (command.type === 'select-repo') {
            const workspaces = await this.deps.store.getWorkspaces();
            const workspace = resolveWorkspace(workspaces, command.args);
            if (!workspace) {
                this.deps.recordThreadCommand?.(msg);
                await reply('❌ Repo not found. Use `/list repos` to see available repos.');
                return;
            }
            await this.deps.selectThreadTarget(msg, workspace.id, null);
            if (!silent) this.discardThreadImages(msg);
            await reply(`✅ Selected repo: **${escapeTeamsMarkdown(workspace.name ?? workspace.id)}**. Your next question starts a new chat.`);
            return;
        }
        const workspaces = await this.deps.store.getWorkspaces();
        const slot = this.localTopics.slot(`thread\0${msg.channelId}\0${root}`);
        if (command.type === 'list-topics') {
            this.deps.recordThreadCommand?.(msg);
            await reply(await localTopicsReply(this.deps.store, workspaces, slot, TEAMS_FORMAT,
                id => id === selection?.workspaceId ? (selection as { process?: AIProcess })?.process?.id : null,
                Date.now(), command.verbose, '/'));
            return;
        }
        if (command.type === 'select-topic') {
            const process = await resolveLocalTopic(this.deps.store, workspaces, slot, command.args, Date.now());
            if (!process || ['failed', 'cancelled'].includes(process.status)) {
                this.deps.recordThreadCommand?.(msg);
                await reply('❌ Topic not found or unavailable. Use `/list topics -v` here.');
                return;
            }
            const workspace = workspaces.find(w => w.id === process.metadata?.workspaceId)!;
            await this.deps.selectThreadTarget(msg, workspace.id, process.id);
            if (!silent) this.discardThreadImages(msg);
            const title = process.title ?? process.customTitle ?? process.id;
            await reply(`✅ Selected topic: **${escapeTeamsMarkdown(title)}** in **${escapeTeamsMarkdown(workspace.name ?? workspace.id)}**. Your next question continues this chat.`);
            return;
        }
        const workspace = workspaces.find(w => w.id === selection?.workspaceId);
        if (!workspace) {
            this.deps.recordThreadCommand?.(msg);
            await reply('❌ Selected repo is unavailable. Use `/select repo <name>` here.');
            return;
        }
        if (command.type === 'create-topic') {
            await this.deps.selectThreadTarget(msg, workspace.id, null);
            if (!silent) this.discardThreadImages(msg);
            await reply(`✅ Ready for a new topic in **${escapeTeamsMarkdown(workspace.name ?? workspace.id)}**. Your next question starts a new chat.`);
            return;
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Command Handlers
    // ────────────────────────────────────────────────────────────────────────

    private async handleExplicitChat(
        userKey: string,
        { chatId, args: message, mode }: Extract<MessagingCommand, { type: 'chat-explicit' }>,
        msg: InboundTeamsMessage,
        observe?: (type: TeamsEventType) => void,
    ): Promise<void> {

        if (!message) {
            await this.deps.sendReply('❌ Message content is required.', msg.messageId);
            return;
        }

        const process = await this.deps.store.getProcess(chatId);
        if (!process) {
            await this.deps.sendReply(`❌ Chat "${chatId}" not found.`, msg.messageId);
            return;
        }
        if (await this.tryHandOff(msg, process.id, message, mode, observe)) return;

        if (this.deps.admitFollowUp) {
            const admission = await this.deps.admitFollowUp(msg, process, message, mode);
            if (admission.duplicate) return;
        } else {
            if (msg.images?.length) throw new IncomingImagesError('storage');
            await this.deps.executeFollowUp(chatId, message, mode);
        }
        observe?.('dispatch-follow-up');
        this.userState.update(userKey, { lastActiveTopic: chatId });

        await this.sendAcceptance(`💬 Message sent to \`${chatId.slice(0, 8)}\``, msg, () =>
            this.deps.acknowledgeFollowUp?.(msg));
    }

    private async handleChat(userKey: string, message: string, mode: MessagingChatMode | undefined, msg: InboundTeamsMessage, observe?: (type: TeamsEventType) => void): Promise<void> {
        if (!message) {
            if (mode) await this.deps.sendReply(`❌ ${EMPTY_CHAT_REPLY}`, msg.messageId);
            return;
        }

        const state = this.userState.get(userKey);

        // Determine target: selected topic > last active > create new
        let targetId = state.selectedTopic ?? state.lastActiveTopic;

        let targetProcess: AIProcess | undefined;
        if (targetId) {
            // Verify the process still exists
            targetProcess = await this.deps.store.getProcess(targetId)
                ?? (!targetId.startsWith('queue_')
                    ? await this.deps.store.getProcess(toQueueProcessId(targetId)) : undefined);
            const handOffTarget = targetProcess?.id ?? (targetId.startsWith('queue_') ? targetId : toQueueProcessId(targetId));
            if (await this.tryHandOff(msg, handOffTarget, message, mode, observe)) return;
            if (targetProcess) {
                targetId = targetProcess.id;
            } else {
                const pending = await this.deps.admitPendingFollowUp?.(msg, targetId, message, mode);
                if (pending) {
                    if (pending.duplicate) return;
                    observe?.('dispatch-follow-up');
                    await this.sendAcceptance(`💬 Message sent to topic \`${targetId.slice(0, 8)}\``, msg, () =>
                        this.deps.acknowledgeFollowUp?.(msg));
                    return;
                }
                if (msg.images?.length) throw new Error('Teams conversation target is unavailable');
                targetId = null;
            }
        }

        if (targetId) {
            if (this.deps.admitFollowUp && targetProcess) {
                const admission = await this.deps.admitFollowUp(msg, targetProcess, message, mode);
                if (admission.duplicate) return;
            } else {
                if (msg.images?.length) throw new IncomingImagesError('storage');
                await this.deps.executeFollowUp(targetId, message, mode);
            }
            observe?.('dispatch-follow-up');
            this.userState.update(userKey, { lastActiveTopic: targetId });
            await this.sendAcceptance(`💬 Message sent to topic \`${targetId.slice(0, 8)}\``, msg, () =>
                this.deps.acknowledgeFollowUp?.(msg));
        } else {
            // No active topic — start a new chat in the selected repo, else Global.
            const repo = resolveChatWorkspace(await this.deps.store.getWorkspaces(), state.selectedRepo);
            if (!repo) {
                await this.deps.sendReply(NO_CHAT_WORKSPACE_REPLY, msg.messageId);
                return;
            }
            if (msg.images?.length && !this.deps.admitNewChat) throw new IncomingImagesError('storage');
            const admission = this.deps.admitNewChat
                ? await this.deps.admitNewChat(msg, repo.id, message, mode)
                : { taskId: await this.deps.enqueueChat(repo.id, message, mode), duplicate: false };
            const { taskId } = admission;
            if (admission.duplicate) return;
            observe?.('dispatch-queued');
            this.userState.update(userKey, {
                lastActiveTopic: this.deps.isAnswerRelayEnabled?.() === true ? toQueueProcessId(taskId) : taskId,
            });
            await this.sendAcceptance(
                `💬 New topic created in **${escapeTeamsMarkdown(repo.name ?? repo.id)}**: \`${taskId.slice(0, 8)}\``,
                msg, () => this.deps.acknowledgeNewChat?.(taskId),
            );
        }
    }

    /**
     * A mode-prefixed message to a sentinel starts a separate job instead of a
     * sentinel turn; true when it did. The thread's selection is unchanged.
     */
    private async tryHandOff(
        msg: InboundTeamsMessage, targetProcessId: string | undefined, message: string,
        mode: MessagingChatMode | undefined, observe?: (type: TeamsEventType) => void,
    ): Promise<boolean> {
        const target = await this.deps.handOff?.resolve(targetProcessId, mode);
        if (!target) return false;
        const origin = this.deps.handOffOrigin?.(msg);
        if (!origin) throw new Error('Teams hand-off origin is unavailable');
        if (msg.images?.length) {
            if (!this.deps.admitImageHandOff) throw new IncomingImagesError('storage');
            const admission = await this.deps.admitImageHandOff(msg, target, message, origin);
            if (admission.duplicate) return true;
        } else {
            // Bound-thread replies are deduplicated by message id, like thread commands.
            if (msg.replyToMessageId && this.deps.isAnswerRelayEnabled?.() === true) {
                if (this.deps.hasThreadCommand?.(msg)) return true;
                this.deps.recordThreadCommand?.(msg);
            }
            await this.deps.handOff!.start(target, message, origin);
        }
        observe?.('dispatch-queued');
        await this.sendAcceptance(`🚀 Started a separate ${target.mode} job. A notice follows when it finishes.`, msg, () => undefined);
        return true;
    }

    private async sendAcceptance(text: string, msg: InboundTeamsMessage, settle: () => Promise<void> | undefined): Promise<void> {
        try {
            await this.deps.sendReply(text,
                this.deps.isAnswerRelayEnabled?.() === true ? msg.replyToMessageId || msg.messageId : msg.messageId);
        } finally {
            await settle();
        }
    }
}
