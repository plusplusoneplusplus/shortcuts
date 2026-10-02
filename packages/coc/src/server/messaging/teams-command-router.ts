/**
 * Parses inbound Teams messages into structured commands and dispatches them.
 * Manages per-user state (selected repo, selected chat topic).
 *
 * Supported commands:
 *   list agents       — list registered workspaces (agents)
 *   list repos        — alias for list agents
 *   select repo <n>   — set the target workspace for subsequent chats
 *   list topics       — list recent chat processes
 *   create topic      — start a new chat process
 *   select topic <id> — set the active topic for follow-up messages
 *   [chatid] <msg>    — send message to an explicit chat process
 *   <msg>             — send message to the selected/last-active topic
 */

import { toQueueProcessId, type ProcessStore, type AIProcess } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsUserStateStore } from './teams-user-state';
import type { TeamsEventType } from './teams-attempt-store';
import { escapeTeamsMarkdown, teamsCodeSpan } from './teams-outbound-format';
import { listRecentTopics, resolveTopic, resolveWorkspace } from './chat-target';

// ============================================================================
// Types
// ============================================================================

export interface TeamsCommandRouterDeps {
    /** ProcessStore for querying workspaces and processes. */
    store: ProcessStore;
    /** Enqueue a new chat message. Returns the enqueued task ID. */
    enqueueChat: (workspaceId: string, message: string) => Promise<string>;
    /** Admit a relay-enabled new chat with its Teams receipt persisted before enqueue. */
    admitNewChat?: (msg: InboundTeamsMessage, workspaceId: string, message: string) => Promise<{ taskId: string; duplicate: boolean }>;
    acknowledgeNewChat?: (taskId: string) => Promise<void>;
    admitFollowUp?: (msg: InboundTeamsMessage, process: AIProcess, message: string) => Promise<{ duplicate: boolean }>;
    admitPendingFollowUp?: (msg: InboundTeamsMessage, taskId: string, message: string) => Promise<{ duplicate: boolean } | null>;
    resolveThreadReply?: (msg: InboundTeamsMessage) => Promise<{ process?: AIProcess; taskId?: string; workspaceId: string } | null>;
    getThreadSelection?: (msg: InboundTeamsMessage) => { workspaceId: string } | null;
    /** Persist a shared selection for an already-bound channel thread. */
    selectThreadTarget?: (msg: InboundTeamsMessage, workspaceId: string, processId: string | null) => Promise<void>;
    hasThreadCommand?: (msg: InboundTeamsMessage) => boolean;
    recordThreadCommand?: (msg: InboundTeamsMessage) => void;
    admitThreadNew?: (msg: InboundTeamsMessage, workspaceId: string, message: string) => Promise<{ taskId: string; duplicate: boolean }>;
    acknowledgeFollowUp?: (msg: InboundTeamsMessage) => Promise<void>;
    isAnswerRelayEnabled?: () => boolean;
    /** Send a follow-up message to an existing process. */
    executeFollowUp: (processId: string, message: string) => Promise<void>;
    /** Send a reply back to Teams. */
    sendReply: (text: string, replyToId?: string) => Promise<void>;
    /** Data directory for persisting user state. */
    dataDir: string;
}

export interface ParsedCommand {
    type:
        | 'list-agents'
        | 'list-repos'
        | 'select-repo'
        | 'list-topics'
        | 'create-topic'
        | 'select-topic'
        | 'chat-explicit'
        | 'chat';
    args: string;
}

// ============================================================================
// Command Parser
// ============================================================================

const COMMAND_PATTERNS: Array<{ pattern: RegExp; type: ParsedCommand['type'] }> = [
    { pattern: /^\/list\s+agents?\s*$/i, type: 'list-agents' },
    { pattern: /^\/list\s+repos?\s*$/i, type: 'list-repos' },
    { pattern: /^\/select\s+repos?\s+(.+)$/i, type: 'select-repo' },
    { pattern: /^\/list\s+(?:chat\s+)?topics?\s*$/i, type: 'list-topics' },
    { pattern: /^\/create\s+(?:chat\s+)?topic\s*$/i, type: 'create-topic' },
    { pattern: /^\/select\s+(?:chat\s+)?topic\s+(.+)$/i, type: 'select-topic' },
];

/** Matches `[chatid] message` syntax. */
const EXPLICIT_CHAT_PATTERN = /^\[([^\]]+)\]\s*(.+)$/s;

export function parseCommand(text: string): ParsedCommand {
    const trimmed = text.trim();

    for (const { pattern, type } of COMMAND_PATTERNS) {
        const match = trimmed.match(pattern);
        if (match) {
            return { type, args: (match[1] ?? '').trim() };
        }
    }

    // Check for explicit chat ID syntax: [chatid] message
    const explicitMatch = trimmed.match(EXPLICIT_CHAT_PATTERN);
    if (explicitMatch) {
        return { type: 'chat-explicit', args: `${explicitMatch[1].trim()}\0${explicitMatch[2].trim()}` };
    }

    // Default: plain chat message
    return { type: 'chat', args: trimmed };
}

// ============================================================================
// Router
// ============================================================================

export class TeamsCommandRouter {
    private readonly deps: TeamsCommandRouterDeps;
    private readonly userState: TeamsUserStateStore;
    private readonly hydratingRoots = new Set<string>();
    private readonly threadDispatches = new Map<string, Promise<void>>();

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
        let command: ParsedCommand | undefined;
        let boundThread = false;

        try {
            if (msg.replyToMessageId && this.deps.resolveThreadReply
                && this.deps.isAnswerRelayEnabled?.() !== true) {
                await this.deps.sendReply('❌ Teams thread follow-ups are unavailable.', msg.replyToMessageId);
                return;
            }
            if (msg.replyToMessageId && this.deps.isAnswerRelayEnabled?.() === true) {
                boundThread = true;
                command = parseCommand(msg.text);
                if ('historicalSelectionReplay' in msg && msg.historicalSelectionReplay === true) {
                    if (!this.isControlCommand(command) || this.deps.hasThreadCommand?.(msg)) return;
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
                if (command.type === 'chat' && /^\/(?:list|select|create)\b/i.test(command.args)) {
                    if (this.deps.hasThreadCommand?.(msg)) return;
                    this.deps.recordThreadCommand?.(msg);
                    await this.deps.sendReply('❌ Invalid command. Use `/list repos`, `/select repo <name>`, `/list topics`, `/select topic <id>`, or `/create topic`.', msg.replyToMessageId);
                    return;
                }
                if (this.isControlCommand(command)) {
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
                const message = msg.text.trim();
                if (!message) {
                    return;
                }
                const newChat = !binding.process && !binding.taskId;
                const admission: { duplicate: boolean; taskId?: string } | null | undefined = binding.process
                    ? await this.deps.admitFollowUp?.(msg, binding.process, message)
                    : binding.taskId
                        ? await this.deps.admitPendingFollowUp?.(msg, binding.taskId, message)
                        : this.deps.admitThreadNew
                            ? await this.deps.admitThreadNew(msg, binding.workspaceId, message)
                            : null;
                if (!admission) {
                    throw new Error('Teams thread target is unavailable');
                }
                if (admission.duplicate) {
                    return;
                }
                observe?.(newChat ? 'dispatch-queued' : 'dispatch-follow-up');
                await this.sendAcceptance(!newChat
                    ? '💬 Message sent to thread'
                    : '💬 New chat started in the selected repo. Your next question continues it.',
                    msg, () => newChat && admission.taskId
                        ? this.deps.acknowledgeNewChat?.(admission.taskId)
                        : this.deps.acknowledgeFollowUp?.(msg));
                return;
            }

            command = parseCommand(msg.text);
            const userKey = msg.senderAadId ?? msg.senderName ?? 'anonymous';
            if (command.type !== 'chat' && command.type !== 'chat-explicit') observe?.('dispatch-command');
            switch (command.type) {
                case 'list-agents':
                case 'list-repos':
                    await this.handleListAgents(msg);
                    break;
                case 'select-repo':
                    await this.handleSelectRepo(userKey, command.args, msg);
                    break;
                case 'list-topics':
                    await this.handleListTopics(userKey, msg);
                    break;
                case 'create-topic':
                    await this.handleCreateTopic(userKey, msg);
                    break;
                case 'select-topic':
                    await this.handleSelectTopic(userKey, command.args, msg);
                    break;
                case 'chat-explicit':
                    await this.handleExplicitChat(userKey, command.args, msg, observe);
                    break;
                case 'chat':
                    await this.handleChat(userKey, command.args, msg, observe);
                    break;
            }
        } catch (err: any) {
            observe?.('dispatch-failed');
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
            } else if (this.deps.isAnswerRelayEnabled?.() === true && (msg.replyToMessageId || command?.type === 'chat' || command?.type === 'chat-explicit')) {
                await this.deps.sendReply('❌ Unable to accept the request. Please try again later.', msg.replyToMessageId || msg.messageId);
            } else {
                await this.deps.sendReply(`❌ Error: ${err.message ?? 'Unknown error'}`, msg.messageId);
            }
        }
    }

    private isControlCommand(command: ParsedCommand): boolean {
        return command.type !== 'chat' && command.type !== 'chat-explicit';
    }

    private async handleThreadCommand(msg: InboundTeamsMessage, command: ParsedCommand, silent = false): Promise<void> {
        const root = msg.replyToMessageId!;
        if (silent && (command.type === 'list-agents' || command.type === 'list-repos' || command.type === 'list-topics')) return;
        if (command.type === 'list-agents' || command.type === 'list-repos') {
            this.deps.recordThreadCommand?.(msg);
            await this.handleListAgents({ ...msg, messageId: root });
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
        const workspace = workspaces.find(w => w.id === selection?.workspaceId);
        if (!workspace) {
            this.deps.recordThreadCommand?.(msg);
            await reply('❌ Selected repo is unavailable. Use `/select repo <name>` here.');
            return;
        }
        if (command.type === 'list-topics') {
            const recent = await listRecentTopics(this.deps.store, workspace.id);
            this.deps.recordThreadCommand?.(msg);
            await reply(recent.length
                ? `**Chat Topics** (repo: ${escapeTeamsMarkdown(workspace.name ?? workspace.id)}):\n${recent.map((p, i) =>
                    `${i + 1}. ${teamsCodeSpan(p.id.slice(0, 8))} ${escapeTeamsMarkdown(p.title ?? p.customTitle ?? p.id)}`).join('\n')}`
                : 'No chat topics found.');
            return;
        }
        if (command.type === 'create-topic') {
            await this.deps.selectThreadTarget(msg, workspace.id, null);
            await reply(`✅ Ready for a new topic in **${escapeTeamsMarkdown(workspace.name ?? workspace.id)}**. Your next question starts a new chat.`);
            return;
        }
        if (command.type === 'select-topic') {
            const process = await resolveTopic(this.deps.store, workspace.id, command.args);
            if (!process || process.metadata?.workspaceId !== workspace.id
                || ['failed', 'cancelled'].includes(process.status)) {
                this.deps.recordThreadCommand?.(msg);
                await reply('❌ Topic not found in the selected repo. Use `/list topics` here.');
                return;
            }
            await this.deps.selectThreadTarget(msg, workspace.id, process.id);
            const title = process.title ?? process.customTitle ?? process.id;
            await reply(`✅ Selected topic: **${escapeTeamsMarkdown(title)}** in **${escapeTeamsMarkdown(workspace.name ?? workspace.id)}**. Your next question continues this chat.`);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Command Handlers
    // ────────────────────────────────────────────────────────────────────────

    private async handleListAgents(msg: InboundTeamsMessage): Promise<void> {
        const workspaces = await this.deps.store.getWorkspaces();
        if (workspaces.length === 0) {
            await this.deps.sendReply('No agents/repos registered.', msg.messageId);
            return;
        }

        const lines = workspaces.map((w, i) =>
            `${i + 1}. **${escapeTeamsMarkdown(w.name ?? w.id)}** — ${teamsCodeSpan(w.rootPath ?? 'N/A')}`,
        );
        await this.deps.sendReply(`**Agents / Repos** (${workspaces.length}):\n${lines.join('\n')}`, msg.messageId);
    }

    private async handleSelectRepo(userKey: string, repoNameOrIndex: string, msg: InboundTeamsMessage): Promise<void> {
        const workspaces = await this.deps.store.getWorkspaces();
        const workspace = resolveWorkspace(workspaces, repoNameOrIndex, false);

        if (!workspace) {
            await this.deps.sendReply(
                `❌ Repo "${repoNameOrIndex}" not found. Use \`list repos\` to see available repos.`,
                msg.messageId,
            );
            return;
        }

        this.userState.update(userKey, { selectedRepo: workspace.id });
        await this.deps.sendReply(
            `✅ Selected repo: **${escapeTeamsMarkdown(workspace.name ?? workspace.id)}**`,
            msg.messageId,
        );
    }

    private async handleListTopics(userKey: string, msg: InboundTeamsMessage): Promise<void> {
        const state = this.userState.get(userKey);
        const recent = await listRecentTopics(this.deps.store, state.selectedRepo ?? undefined);

        if (recent.length === 0) {
            await this.deps.sendReply('No chat topics found.', msg.messageId);
            return;
        }

        const lines = recent.map((p, i) => {
            const title = p.title ?? p.customTitle ?? p.promptPreview?.slice(0, 60) ?? p.id;
            const status = p.status ?? 'unknown';
            const selected = state.selectedTopic === p.id ? ' ⬅️' : '';
            return `${i + 1}. \`${p.id.slice(0, 8)}\` [${status}] ${title}${selected}`;
        });

        const header = state.selectedRepo
            ? `**Chat Topics** (repo: ${state.selectedRepo})`
            : '**Chat Topics** (all repos)';
        await this.deps.sendReply(`${header}:\n${lines.join('\n')}`, msg.messageId);
    }

    private async handleCreateTopic(userKey: string, msg: InboundTeamsMessage): Promise<void> {
        const state = this.userState.get(userKey);
        const repoId = state.selectedRepo;

        if (!repoId) {
            await this.deps.sendReply(
                '❌ No repo selected. Use `/select repo <name>` first.',
                msg.messageId,
            );
            return;
        }

        // Clear topic selection — the next message will auto-create a new chat
        this.userState.update(userKey, { selectedTopic: null, lastActiveTopic: null });

        await this.deps.sendReply(
            '✅ Ready for a new topic. Send your first message to start.',
            msg.messageId,
        );
    }

    private async handleSelectTopic(userKey: string, topicIdOrIndex: string, msg: InboundTeamsMessage): Promise<void> {
        const trimmed = topicIdOrIndex.trim();
        // Resolves against the same list as /list topics, then falls back to a direct ID lookup.
        const process = await resolveTopic(this.deps.store, this.userState.get(userKey).selectedRepo ?? undefined, trimmed, false);

        if (!process) {
            await this.deps.sendReply(
                `❌ Topic "${trimmed}" not found. Use \`/list topics\` to see available topics.`,
                msg.messageId,
            );
            return;
        }

        this.userState.update(userKey, { selectedTopic: process.id });
        const title = process.title ?? process.customTitle ?? process.promptPreview?.slice(0, 60) ?? process.id;
        await this.deps.sendReply(
            `✅ Selected topic: **${title}** (\`${process.id.slice(0, 8)}\`)`,
            msg.messageId,
        );
    }

    private async handleExplicitChat(userKey: string, args: string, msg: InboundTeamsMessage, observe?: (type: TeamsEventType) => void): Promise<void> {
        const separatorIdx = args.indexOf('\0');
        const chatId = args.slice(0, separatorIdx).trim();
        const message = args.slice(separatorIdx + 1).trim();

        if (!message) {
            await this.deps.sendReply('❌ Message content is required.', msg.messageId);
            return;
        }

        const process = await this.deps.store.getProcess(chatId);
        if (!process) {
            await this.deps.sendReply(`❌ Chat "${chatId}" not found.`, msg.messageId);
            return;
        }

        if (this.deps.admitFollowUp) {
            const admission = await this.deps.admitFollowUp(msg, process, message);
            if (admission.duplicate) return;
        } else {
            await this.deps.executeFollowUp(chatId, message);
        }
        observe?.('dispatch-follow-up');
        this.userState.update(userKey, { lastActiveTopic: chatId });

        await this.sendAcceptance(`💬 Message sent to \`${chatId.slice(0, 8)}\``, msg, () =>
            this.deps.acknowledgeFollowUp?.(msg));
    }

    private async handleChat(userKey: string, message: string, msg: InboundTeamsMessage, observe?: (type: TeamsEventType) => void): Promise<void> {
        if (!message) return;

        const state = this.userState.get(userKey);

        // Determine target: selected topic > last active > create new
        let targetId = state.selectedTopic ?? state.lastActiveTopic;

        let targetProcess: AIProcess | undefined;
        if (targetId) {
            // Verify the process still exists
            targetProcess = await this.deps.store.getProcess(targetId)
                ?? (this.deps.isAnswerRelayEnabled?.() === true && !targetId.startsWith('queue_')
                    ? await this.deps.store.getProcess(toQueueProcessId(targetId)) : undefined);
            if (targetProcess) {
                targetId = targetProcess.id;
            } else {
                const pending = await this.deps.admitPendingFollowUp?.(msg, targetId, message);
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
                const admission = await this.deps.admitFollowUp(msg, targetProcess, message);
                if (admission.duplicate) return;
            } else {
                await this.deps.executeFollowUp(targetId, message);
            }
            observe?.('dispatch-follow-up');
            this.userState.update(userKey, { lastActiveTopic: targetId });
            await this.sendAcceptance(`💬 Message sent to topic \`${targetId.slice(0, 8)}\``, msg, () =>
                this.deps.acknowledgeFollowUp?.(msg));
        } else {
            // No active topic — create new if repo is selected
            const repoId = state.selectedRepo;
            if (!repoId) {
                // Try to use the first available workspace
                const workspaces = await this.deps.store.getWorkspaces();
                if (workspaces.length === 0) {
                    await this.deps.sendReply(
                        '❌ No repo available. Register a workspace first.',
                        msg.messageId,
                    );
                    return;
                }
                const firstRepo = workspaces[0];
                const admission = this.deps.admitNewChat
                    ? await this.deps.admitNewChat(msg, firstRepo.id, message)
                    : { taskId: await this.deps.enqueueChat(firstRepo.id, message), duplicate: false };
                const { taskId } = admission;
                if (admission.duplicate) return;
                observe?.('dispatch-queued');
                this.userState.update(userKey, {
                    selectedRepo: firstRepo.id,
                    lastActiveTopic: this.deps.isAnswerRelayEnabled?.() === true ? toQueueProcessId(taskId) : taskId,
                });
                await this.sendAcceptance(
                    `💬 New topic created in **${escapeTeamsMarkdown(firstRepo.name ?? firstRepo.id)}**: \`${taskId.slice(0, 8)}\``,
                    msg, () => this.deps.acknowledgeNewChat?.(taskId),
                );
            } else {
                const admission = this.deps.admitNewChat
                    ? await this.deps.admitNewChat(msg, repoId, message)
                    : { taskId: await this.deps.enqueueChat(repoId, message), duplicate: false };
                const { taskId } = admission;
                if (admission.duplicate) return;
                observe?.('dispatch-queued');
                this.userState.update(userKey, {
                    lastActiveTopic: this.deps.isAnswerRelayEnabled?.() === true ? toQueueProcessId(taskId) : taskId,
                });
                await this.sendAcceptance(`💬 New topic created: \`${taskId.slice(0, 8)}\``, msg, () =>
                    this.deps.acknowledgeNewChat?.(taskId));
            }

        }
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
