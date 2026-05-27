/**
 * Teams Command Router
 *
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

import type { ProcessStore, AIProcess, ProcessFilter } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/teams-bot';
import { TeamsUserStateStore } from './teams-user-state';

// ============================================================================
// Types
// ============================================================================

export interface TeamsCommandRouterDeps {
    /** ProcessStore for querying workspaces and processes. */
    store: ProcessStore;
    /** Enqueue a new chat message. Returns the enqueued task ID. */
    enqueueChat: (workspaceId: string, message: string) => Promise<string>;
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

/**
 * Parse raw message text into a structured command.
 */
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

    constructor(deps: TeamsCommandRouterDeps) {
        this.deps = deps;
        this.userState = new TeamsUserStateStore(deps.dataDir);
    }

    /**
     * Handle an inbound Teams message.
     */
    async handle(msg: InboundTeamsMessage): Promise<void> {
        const command = parseCommand(msg.text);
        const userKey = msg.senderAadId ?? msg.senderName ?? 'anonymous';

        try {
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
                    await this.handleExplicitChat(userKey, command.args, msg);
                    break;
                case 'chat':
                    await this.handleChat(userKey, command.args, msg);
                    break;
            }
        } catch (err: any) {
            await this.deps.sendReply(`❌ Error: ${err.message ?? 'Unknown error'}`, msg.messageId);
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
            `${i + 1}. **${w.name ?? w.id}** — \`${w.rootPath ?? 'N/A'}\``,
        );
        await this.deps.sendReply(`**Agents / Repos** (${workspaces.length}):\n${lines.join('\n')}`, msg.messageId);
    }

    private async handleSelectRepo(userKey: string, repoNameOrIndex: string, msg: InboundTeamsMessage): Promise<void> {
        const workspaces = await this.deps.store.getWorkspaces();
        const workspace = resolveWorkspace(workspaces, repoNameOrIndex);

        if (!workspace) {
            await this.deps.sendReply(
                `❌ Repo "${repoNameOrIndex}" not found. Use \`list repos\` to see available repos.`,
                msg.messageId,
            );
            return;
        }

        this.userState.update(userKey, { selectedRepo: workspace.id });
        await this.deps.sendReply(
            `✅ Selected repo: **${workspace.name ?? workspace.id}**`,
            msg.messageId,
        );
    }

    private async handleListTopics(userKey: string, msg: InboundTeamsMessage): Promise<void> {
        const state = this.userState.get(userKey);
        const filter: ProcessFilter = {};
        if (state.selectedRepo) {
            filter.workspaceId = state.selectedRepo;
        }

        const processes = await this.deps.store.getAllProcesses(filter);
        // Show most recent 10
        const recent = processes
            .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
            .slice(0, 10);

        if (recent.length === 0) {
            await this.deps.sendReply('No chat topics found.', msg.messageId);
            return;
        }

        const lines = recent.map(p => {
            const title = p.title ?? p.customTitle ?? p.promptPreview?.slice(0, 60) ?? p.id;
            const status = p.status ?? 'unknown';
            const selected = state.selectedTopic === p.id ? ' ⬅️' : '';
            return `• \`${p.id.slice(0, 8)}\` [${status}] ${title}${selected}`;
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
                '❌ No repo selected. Use `select repo <name>` first.',
                msg.messageId,
            );
            return;
        }

        const taskId = await this.deps.enqueueChat(repoId, '(New topic created from Teams)');
        this.userState.update(userKey, { selectedTopic: taskId, lastActiveTopic: taskId });

        await this.deps.sendReply(
            `✅ Created new chat topic: \`${taskId.slice(0, 8)}\`\nSend your first message to continue.`,
            msg.messageId,
        );
    }

    private async handleSelectTopic(userKey: string, topicId: string, msg: InboundTeamsMessage): Promise<void> {
        // Verify the process exists
        const process = await this.deps.store.getProcess(topicId.trim());
        if (!process) {
            await this.deps.sendReply(
                `❌ Topic "${topicId}" not found. Use \`list topics\` to see available topics.`,
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

    private async handleExplicitChat(userKey: string, args: string, msg: InboundTeamsMessage): Promise<void> {
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

        await this.deps.executeFollowUp(chatId, message);
        this.userState.update(userKey, { lastActiveTopic: chatId });

        await this.deps.sendReply(
            `💬 Message sent to \`${chatId.slice(0, 8)}\``,
            msg.messageId,
        );
    }

    private async handleChat(userKey: string, message: string, msg: InboundTeamsMessage): Promise<void> {
        if (!message) return;

        const state = this.userState.get(userKey);

        // Determine target: selected topic > last active > create new
        let targetId = state.selectedTopic ?? state.lastActiveTopic;

        if (targetId) {
            // Verify the process still exists
            const process = await this.deps.store.getProcess(targetId);
            if (!process) {
                targetId = null;
            }
        }

        if (targetId) {
            // Follow-up on existing topic
            await this.deps.executeFollowUp(targetId, message);
            this.userState.update(userKey, { lastActiveTopic: targetId });
            await this.deps.sendReply(
                `💬 Message sent to topic \`${targetId.slice(0, 8)}\``,
                msg.messageId,
            );
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
                const taskId = await this.deps.enqueueChat(firstRepo.id, message);
                this.userState.update(userKey, {
                    selectedRepo: firstRepo.id,
                    lastActiveTopic: taskId,
                });
                await this.deps.sendReply(
                    `💬 New topic created in **${firstRepo.name ?? firstRepo.id}**: \`${taskId.slice(0, 8)}\``,
                    msg.messageId,
                );
            } else {
                const taskId = await this.deps.enqueueChat(repoId, message);
                this.userState.update(userKey, { lastActiveTopic: taskId });
                await this.deps.sendReply(
                    `💬 New topic created: \`${taskId.slice(0, 8)}\``,
                    msg.messageId,
                );
            }
        }
    }
}

// ============================================================================
// Helpers
// ============================================================================

function resolveWorkspace(
    workspaces: Array<{ id: string; name?: string; rootPath?: string }>,
    nameOrIndex: string,
): { id: string; name?: string; rootPath?: string } | undefined {
    // Try numeric index (1-based)
    const idx = parseInt(nameOrIndex, 10);
    if (!isNaN(idx) && idx >= 1 && idx <= workspaces.length) {
        return workspaces[idx - 1];
    }

    // Try exact ID match
    const byId = workspaces.find(w => w.id === nameOrIndex);
    if (byId) return byId;

    // Try case-insensitive name match
    const lower = nameOrIndex.toLowerCase();
    return workspaces.find(w =>
        (w.name ?? '').toLowerCase() === lower ||
        (w.id ?? '').toLowerCase() === lower,
    );
}
