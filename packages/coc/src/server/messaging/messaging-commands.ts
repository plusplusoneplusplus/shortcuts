/**
 * Platform-independent messaging command handling shared by the Teams and
 * WhatsApp routers: repo/topic selection, help and quota. Each router supplies
 * its own selection state and text styling; transport, threads, quote-reply
 * bindings and enqueue wiring stay in the router.
 */

import type { AgentProvidersQuotaResponse } from '@plusplusoneplusplus/coc-client';
import { getQuotaPercent, getTightestFiniteQuotaType, getUnlimitedQuotaTypes } from '@plusplusoneplusplus/coc-client';
import { MESSAGING_HELP_TEXT, type MessagingControlCommand } from '@plusplusoneplusplus/coc-connector';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { listRecentTopics, resolveTopic, resolveWorkspace } from './chat-target';

export type MessagingQuotaSource = () => Promise<AgentProvidersQuotaResponse | null | undefined>;

export interface MessagingSelection {
    /** Selected repo (workspace id), if any. */
    repoId(): string | null | undefined;
    selectRepo(workspaceId: string): void;
    /** Selected topic, used to mark the current entry in `list topics`. */
    topicId(workspaceId: string | undefined): string | null | undefined;
    /** `processId: null` clears the topic so the next message starts a new chat. */
    selectTopic(workspaceId: string | undefined, processId: string | null): void;
}

export interface MessagingCommandContext {
    store: Pick<ProcessStore, 'getWorkspaces' | 'getAllProcesses' | 'getProcess'>;
    selection: MessagingSelection;
    /** Inline styling for names and ids; plain text by default. */
    strong?: (text: string) => string;
    code?: (text: string) => string;
    /** When false, topic commands without a selected repo span every repo. */
    requireRepoForTopics: boolean;
    getQuota?: MessagingQuotaSource;
}

const plain = (text: string) => text;

export function formatQuotaReply(data: AgentProvidersQuotaResponse | null | undefined): string {
    if (!data || data.providers.length === 0) return 'Quota data is unavailable.';
    return data.providers.map(provider => {
        if (provider.error) return `${provider.id}: unavailable`;
        const tightest = getTightestFiniteQuotaType(provider.quotaTypes);
        if (!tightest) {
            return getUnlimitedQuotaTypes(provider.quotaTypes).length
                ? `${provider.id}: unlimited`
                : `${provider.id}: no quota data`;
        }
        const reset = tightest.resetDate && !Number.isNaN(Date.parse(tightest.resetDate))
            ? `, resets ${new Date(tightest.resetDate).toISOString().slice(0, 10)}` : '';
        return `${provider.id}: ${getQuotaPercent(tightest.remainingPercentage)}% left (${tightest.type}${reset})`;
    }).join('\n');
}

export async function readQuotaReply(getQuota: MessagingQuotaSource | undefined): Promise<string> {
    if (!getQuota) return 'Quota data is unavailable.';
    try {
        return formatQuotaReply(await getQuota());
    } catch {
        return 'Quota data is unavailable.';
    }
}

/** Reply text for an unknown or malformed command. */
export function invalidCommandReply(): string {
    return `Unknown command or invalid argument.\n\n${MESSAGING_HELP_TEXT}`;
}

/** Handles a control command and returns the reply text. */
export async function handleMessagingCommand(command: MessagingControlCommand, ctx: MessagingCommandContext): Promise<string> {
    const strong = ctx.strong ?? plain;
    const code = ctx.code ?? plain;
    if (command.type === 'help') return MESSAGING_HELP_TEXT;
    if (command.type === 'quota') return readQuotaReply(ctx.getQuota);

    const workspaces = await ctx.store.getWorkspaces();
    if (command.type === 'list-repos') {
        return workspaces.length
            ? `Repos (${workspaces.length}):\n${workspaces.map((ws, i) =>
                `${i + 1}. ${strong(ws.name ?? ws.id)} — ${code(ws.rootPath ?? ws.id)}`).join('\n')}`
            : 'No repos registered.';
    }
    if (command.type === 'select-repo') {
        const selected = resolveWorkspace(workspaces, command.args);
        if (!selected) return '❌ Repo not found. Use `list repos` to see available repos.';
        ctx.selection.selectRepo(selected.id);
        return `✅ Selected repo: ${strong(selected.name ?? selected.id)}`;
    }

    const repoId = ctx.selection.repoId();
    const repo = workspaces.find(ws => ws.id === repoId);
    if (!repo && (ctx.requireRepoForTopics || command.type === 'create-topic')) {
        return '❌ No repo selected. Use `list repos`, then `select repo <n|name>`.';
    }
    const workspaceId = repo?.id;
    const scope = repo ? `repo: ${strong(repo.name ?? repo.id)}` : 'all repos';

    if (command.type === 'list-topics') {
        const topics = await listRecentTopics(ctx.store, workspaceId);
        if (!topics.length) return 'No chat topics found.';
        const current = ctx.selection.topicId(workspaceId);
        return `Chat topics (${scope}):\n${topics.map((topic, i) =>
            `${i + 1}. ${code(topic.id)} [${topic.status ?? 'unknown'}] ${topic.title ?? topic.customTitle ?? topic.promptPreview?.slice(0, 60) ?? ''}`.trimEnd()
            + (topic.id === current ? ' ⬅️' : '')).join('\n')}`;
    }
    if (command.type === 'create-topic') {
        ctx.selection.selectTopic(workspaceId, null);
        return '✅ Ready for a new topic. Send a message to start.';
    }
    const topic = await resolveTopic(ctx.store, workspaceId, command.args);
    if (!topic || (workspaceId && topic.metadata?.workspaceId !== workspaceId)) {
        return `❌ Topic not found${workspaceId ? ' in the selected repo' : ''}. Use \`list topics\`.`;
    }
    ctx.selection.selectTopic(workspaceId, topic.id);
    return `✅ Selected topic: ${strong(topic.title ?? topic.customTitle ?? topic.id)}`;
}
