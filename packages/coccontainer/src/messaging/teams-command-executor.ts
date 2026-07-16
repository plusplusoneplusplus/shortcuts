/**
 * Teams Command Executor (Container-side)
 *
 * Handles slash commands (`/list agents`, `/select repo`, etc.) locally
 * in the container without forwarding to agents. Only non-command messages
 * are sent to agents for AI processing.
 *
 * Per-user state (selected repo, selected topic) is tracked in memory.
 */

import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import type { AgentManager, InboundAgent } from '../inbound/agent-manager';
import type { AgentStore, Agent } from '../store/agent-store';
import type { MessagingStore } from './messaging-store';

// ============================================================================
// Types
// ============================================================================

export interface TeamsCommandExecutorDeps {
    /** AgentManager for listing connected agents and their workspaces. */
    agentManager: AgentManager;
    /** AgentStore for listing registered agents. */
    agentStore: AgentStore;
    /** MessagingStore for listing chat topics (process bindings). */
    messagingStore: MessagingStore;
    /** Fetch a process detail from an agent. Returns process or null. */
    fetchProcess: (agentId: string, processId: string, workspaceId?: string) => Promise<ProcessInfo | null>;
    /** List recent processes from an agent. Returns array of lightweight process info. */
    listProcesses: (agentId: string, workspaceId?: string) => Promise<ProcessInfo[]>;
}

export interface ProcessInfo {
    id: string;
    status: string;
    title?: string;
    promptPreview?: string;
    startTime?: string;
    workspaceId?: string;
}

export interface UserState {
    selectedAgentId: string | null;
    selectedWorkspaceId: string | null;
    selectedTopicId: string | null;
    lastActiveTopicId: string | null;
    /** When true, next message should create a new chat instead of following up. */
    forceNewTopic: boolean;
}

interface CommandResult {
    handled: boolean;
    response?: string;
}

// ============================================================================
// Command patterns
// ============================================================================

const COMMAND_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
    { pattern: /^\/list\s+agents?\s*$/i, type: 'list-agents' },
    { pattern: /^\/list\s+repos?\s*$/i, type: 'list-repos' },
    { pattern: /^\/select\s+repos?\s+(.+)$/i, type: 'select-repo' },
    { pattern: /^\/list\s+(?:chat\s+)?topics?\s*$/i, type: 'list-topics' },
    { pattern: /^\/create\s+(?:chat\s+)?topic\s*$/i, type: 'create-topic' },
    { pattern: /^\/select\s+(?:chat\s+)?topic\s+(.+)$/i, type: 'select-topic' },
    { pattern: /^\/help\s*$/i, type: 'help' },
];

// ============================================================================
// Executor
// ============================================================================

export class TeamsCommandExecutor {
    private deps: TeamsCommandExecutorDeps;
    private userStates = new Map<string, UserState>();

    constructor(deps: TeamsCommandExecutorDeps) {
        this.deps = deps;
    }

    /**
     * Check if a message is a command and execute it.
     * Returns { handled: true, response } if it was a command.
     * Returns { handled: false } if the message should be forwarded to an agent.
     */
    async tryExecute(msg: InboundTeamsMessage): Promise<CommandResult> {
        const text = msg.text.trim();

        // Only messages starting with / are commands
        if (!text.startsWith('/')) {
            return { handled: false };
        }

        const userKey = msg.senderAadId ?? msg.senderName ?? 'anonymous';

        for (const { pattern, type } of COMMAND_PATTERNS) {
            const match = text.match(pattern);
            if (match) {
                const args = (match[1] ?? '').trim();
                console.log(`[teams-cmd] 🔧 Command: ${type}${args ? ` args="${args}"` : ''} (user=${userKey})`);
                try {
                    const response = await this.dispatch(type, args, userKey);
                    console.log(`[teams-cmd] ✅ Response (${response.length} chars): ${response.substring(0, 100)}`);
                    return { handled: true, response };
                } catch (err: any) {
                    const errorMsg = `❌ Error: ${err.message ?? 'Unknown error'}`;
                    console.error(`[teams-cmd] ❌ Command ${type} failed: ${err.message}`);
                    return { handled: true, response: errorMsg };
                }
            }
        }

        // Starts with / but doesn't match any known command
        console.log(`[teams-cmd] ⚠️ Unknown command: "${text.substring(0, 60)}" — forwarding to agent`);
        return { handled: false };
    }

    /** Get the user state for routing decisions. */
    getUserState(userKey: string): UserState {
        if (!this.userStates.has(userKey)) {
            this.userStates.set(userKey, {
                selectedAgentId: null,
                selectedWorkspaceId: null,
                selectedTopicId: null,
                lastActiveTopicId: null,
                forceNewTopic: false,
            });
        }
        return this.userStates.get(userKey)!;
    }

    /** Update user state fields. */
    updateUserState(userKey: string, patch: Partial<UserState>): void {
        const state = this.getUserState(userKey);
        Object.assign(state, patch);
    }

    // ── Command Dispatch ────────────────────────────────────

    private async dispatch(type: string, args: string, userKey: string): Promise<string> {
        switch (type) {
            case 'list-agents': return this.handleListAgents();
            case 'list-repos': return this.handleListRepos();
            case 'select-repo': return this.handleSelectRepo(args, userKey);
            case 'list-topics': return this.handleListTopics(userKey);
            case 'create-topic': return this.handleCreateTopic(userKey);
            case 'select-topic': return this.handleSelectTopic(args, userKey);
            case 'help': return this.handleHelp();
            default: return `Unknown command: ${type}`;
        }
    }

    // ── Command Handlers ────────────────────────────────────

    private handleListAgents(): string {
        const agents = this.deps.agentManager.listAgents();
        const storeAgents = this.deps.agentStore.list();

        if (agents.length === 0 && storeAgents.length === 0) {
            return 'No agents registered or connected.';
        }

        const lines: string[] = [];
        let idx = 1;

        // Connected (inbound) agents
        for (const a of agents) {
            lines.push(`${idx++}. **${a.name}** (${a.id}) — 🟢 connected`);
        }

        // Registered but not connected (from agent store, not in inbound)
        const inboundIds = new Set(agents.map(a => a.id));
        for (const a of storeAgents) {
            if (inboundIds.has(a.id)) continue;
            const statusIcon = a.status === 'online' ? '🟢' : a.status === 'offline' ? '🔴' : '⚪';
            lines.push(`${idx++}. **${a.name}** (${a.id}) — ${statusIcon} ${a.status}`);
        }

        return `**Agents** (${lines.length}):<br>${lines.join('<br>')}`;
    }

    private handleListRepos(): string {
        const agents = this.deps.agentManager.listAgents();

        const repos: Array<{ agentName: string; agentId: string; workspace: { id: string; name: string; rootPath: string } }> = [];
        for (const agent of agents) {
            for (const ws of agent.workspaces ?? []) {
                repos.push({ agentName: agent.name, agentId: agent.id, workspace: ws });
            }
        }

        if (repos.length === 0) {
            return 'No repos available. Connect agents with registered workspaces first.';
        }

        const lines = repos.map((r, i) =>
            `${i + 1}. **${r.workspace.name}**, agent:${r.agentName}`,
        );
        return `**Repos** (${repos.length}):<br>${lines.join('<br>')}`;
    }

    private handleSelectRepo(nameOrIndex: string, userKey: string): string {
        const agents = this.deps.agentManager.listAgents();
        const allRepos: Array<{ agentId: string; workspace: { id: string; name: string; rootPath: string } }> = [];
        for (const agent of agents) {
            for (const ws of agent.workspaces ?? []) {
                allRepos.push({ agentId: agent.id, workspace: ws });
            }
        }

        // Try numeric index
        const idx = parseInt(nameOrIndex, 10);
        let match: typeof allRepos[0] | undefined;
        if (!isNaN(idx) && idx >= 1 && idx <= allRepos.length) {
            match = allRepos[idx - 1];
        }

        // Try name match
        if (!match) {
            const lower = nameOrIndex.toLowerCase();
            match = allRepos.find(r =>
                r.workspace.name.toLowerCase() === lower ||
                r.workspace.id.toLowerCase() === lower,
            );
        }

        if (!match) {
            return `❌ Repo "${nameOrIndex}" not found. Use \`/list repos\` to see available repos.`;
        }

        this.updateUserState(userKey, {
            selectedAgentId: match.agentId,
            selectedWorkspaceId: match.workspace.id,
        });

        return `✅ Selected repo: **${match.workspace.name}** (agent: ${match.agentId})`;
    }

    private async handleListTopics(userKey: string): Promise<string> {
        const state = this.getUserState(userKey);
        const agentId = state.selectedAgentId;

        if (!agentId) {
            // List all topics from messaging store if no agent selected
            return 'No agent selected. Use `/select repo <name>` to target a specific agent, then `/list topics`.';
        }

        try {
            const processes = await this.deps.listProcesses(agentId, state.selectedWorkspaceId ?? undefined);
            if (processes.length === 0) {
                return 'No chat topics found.';
            }

            const lines = processes.slice(0, 10).map((p, i) => {
                const title = p.title ?? p.promptPreview?.slice(0, 60) ?? p.id;
                const selected = state.selectedTopicId === p.id ? ' ⬅️' : '';
                return `${i + 1}. \`${p.id.slice(0, 12)}\` [${p.status}] ${title}${selected}`;
            });

            return `**Chat Topics** (agent: ${agentId}):<br>${lines.join('<br>')}`;
        } catch (err: any) {
            return `❌ Failed to list topics: ${err.message}`;
        }
    }

    private handleCreateTopic(userKey: string): string {
        const state = this.getUserState(userKey);

        if (!state.selectedAgentId || !state.selectedWorkspaceId) {
            return '❌ No repo selected. Use `/select repo <name>` first.';
        }

        // Clear topic selection and force next message to create a new chat
        this.updateUserState(userKey, { selectedTopicId: null, lastActiveTopicId: null, forceNewTopic: true });
        return '✅ Ready for a new topic. Send your next message to start a new chat.';
    }

    private async handleSelectTopic(topicIdOrIndex: string, userKey: string): Promise<string> {
        const state = this.getUserState(userKey);
        const agentId = state.selectedAgentId;

        if (!agentId) {
            return '❌ No agent selected. Use `/select repo <name>` first.';
        }

        // Try numeric index
        const idx = parseInt(topicIdOrIndex, 10);
        if (!isNaN(idx) && idx >= 1) {
            try {
                const processes = await this.deps.listProcesses(agentId, state.selectedWorkspaceId ?? undefined);
                if (idx <= processes.length) {
                    const process = processes[idx - 1];
                    this.updateUserState(userKey, { selectedTopicId: process.id });
                    const title = process.title ?? process.promptPreview?.slice(0, 60) ?? process.id;
                    return `✅ Selected topic: **${title}** (\`${process.id.slice(0, 12)}\`)`;
                }
            } catch { /* fall through to direct ID lookup */ }
        }

        // Try direct process ID
        try {
            const process = await this.deps.fetchProcess(agentId, topicIdOrIndex.trim(), state.selectedWorkspaceId ?? undefined);
            if (process) {
                this.updateUserState(userKey, { selectedTopicId: process.id });
                const title = process.title ?? process.promptPreview?.slice(0, 60) ?? process.id;
                return `✅ Selected topic: **${title}** (\`${process.id.slice(0, 12)}\`)`;
            }
        } catch { /* not found */ }

        return `❌ Topic "${topicIdOrIndex}" not found. Use \`/list topics\` to see available topics.`;
    }

    private handleHelp(): string {
        return [
            '**Available Commands:**',
            '`/list agents` — list connected agents',
            '`/list repos` — list repos across all agents',
            '`/select repo <name|#>` — set target repo for chats',
            '`/list topics` — list recent chat sessions',
            '`/create topic` — start a new chat (next message creates it)',
            '`/select topic <id|#>` — resume an existing chat',
            '`/help` — show this help',
            '',
            '**Chat:**',
            'Any message without `/` is sent to the selected topic (or creates a new one).',
            'Use `[processId] message` to target a specific chat.',
        ].join('<br>');
    }
}
