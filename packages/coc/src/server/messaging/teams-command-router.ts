/**
 * Parses inbound Teams messages into structured commands and dispatches them.
 * Manages per-user state (selected repo, selected chat topic).
 *
 * The command grammar comes from the shared coc-connector parser; repo/topic
 * selection, help and quota replies come from `messaging-commands.ts`. This
 * router keeps Teams threads, relay receipts and per-user state.
 */

import { toQueueProcessId, type ProcessStore, type AIProcess } from '@plusplusoneplusplus/forge';
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
import { IncomingImagesError } from './incoming-images';

const EMPTY_CHAT_REPLY = 'Send a message to start a chat.';

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

    constructor(deps: TeamsCommandRouterDeps) {
        this.deps = deps;
        this.userState = new TeamsUserStateStore(deps.dataDir);
    }

    async handle(msg: InboundTeamsMessage, observe?: (type: TeamsEventType) => void): Promise<void> {
        if (!msg.replyToMessageId || this.deps.isAnswerRelayEnabled?.() !== true) {
            await this.handleMessage(msg, observe);
            return;
        }
        const key = `${msg.channelId}\0${msg.replyToMessageId}`;
        const previous = this.threadDispatches.get(key);
        const pending = (previous ?? Promise.resolve()).catch(() => undefined)
            .then(() => this.handleMessage(msg, observe));
        this.threadDispatches.set(key, pending);
        try {
            await pending;
        } finally {
            if (this.threadDispatches.get(key) === pending) this.threadDispatches.delete(key);
        }
    }

    private async handleMessage(msg: InboundTeamsMessage, observe?: (type: TeamsEventType) => void): Promise<void> {
        let command: MessagingCommand | undefined;
        let boundThread = false;

        try {
            if (msg.images?.length && (msg.botAuthored || msg.initializationReplay || msg.historicalSelectionReplay)) return;
            if (msg.images?.length) {
                const mediaCommand = parseMessagingCommand(msg.text);
                if (mediaCommand.type === 'invalid' || isMessagingControlCommand(mediaCommand)) {
                    await this.deps.sendReply('Send the images with chat instructions, separately from control commands.', msg.replyToMessageId || msg.messageId);
                    return;
                }
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
                await this.deps.sendReply(await this.handleControlCommand(userKey, command, `${msg.channelId}\0${userKey}`, this.deps.handOffOrigin?.(msg) ? { ...this.deps.handOffOrigin(msg)!, threadId: msg.messageId } : undefined), msg.messageId);
            }
        } catch (err: any) {
            observe?.('dispatch-failed');
            if (err instanceof ImageDownloadError || err instanceof IncomingImagesError) {
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
            } else if (msg.images?.length || (this.deps.isAnswerRelayEnabled?.() === true && (msg.replyToMessageId || command?.type === 'chat' || command?.type === 'chat-explicit'))) {
                await this.deps.sendReply('❌ Unable to accept the request. Please try again later.', msg.replyToMessageId || msg.messageId);
            } else {
                await this.deps.sendReply(`❌ Error: ${err.message ?? 'Unknown error'}`, msg.messageId);
            }
        }
    }

    /** `chatKey` scopes the `list remotes` numbering: a bound thread, or a user in a channel. */
    private handleControlCommand(userKey: string, command: MessagingControlCommand, chatKey: string, compactOrigin?: MessagingJobOrigin): Promise<string> {
        return handleMessagingCommand(command, {
            store: this.deps.store,
            getQuota: this.deps.getQuota,
            ...TEAMS_FORMAT,
            helpFormat: TEAMS_FORMAT,
            compact: this.deps.compact,
            compactOrigin,
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
                selectRepo: workspaceId => this.userState.update(userKey, { selectedRepo: workspaceId }),
                topicId: () => this.userState.get(userKey).selectedTopic,
                selectTopic: (_workspaceId, processId) => this.userState.update(userKey, processId
                    ? { selectedTopic: processId }
                    : { selectedTopic: null, lastActiveTopic: null }),
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
