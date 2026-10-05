/**
 * Platform-independent messaging command handling shared by the Teams and
 * WhatsApp routers: repo/topic selection, help, quota, compact and read-only
 * remote browsing. Each router supplies
 * its own selection state and text styling; transport, threads, quote-reply
 * bindings and enqueue wiring stay in the router.
 */

import type { AgentProvidersQuotaResponse } from '@plusplusoneplusplus/coc-client';
import { getQuotaPercent, getTightestFiniteQuotaType, getUnlimitedQuotaTypes } from '@plusplusoneplusplus/coc-client';
import { formatMessagingHelp, type MessagingHelpFormat, type MessagingControlCommand } from '@plusplusoneplusplus/coc-connector';
import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
import { isQueueProcessId, toQueueProcessId, toTaskId } from '@plusplusoneplusplus/forge';
import { APIError } from '../errors';
import type { MessagingJobOrigin } from './job-notices';
import type { CompactProcessOutcome } from '../processes/compact-process';
import { listRecentTopics, resolveChatWorkspace, resolveTopic, resolveWorkspace } from './chat-target';
import { formatTopicList, listRemotesReply, localTopicListFooter, listRemoteTopicsReply, type MessagingRemoteDirectory, type RemoteRefSlot } from './remote-browse';

export type MessagingQuotaSource = () => Promise<AgentProvidersQuotaResponse | null | undefined>;
/** Compacts a chat's provider session; throws `APIError` on guard failures. */
export type MessagingCompactor = (process: AIProcess, customInstructions?: string, origin?: MessagingJobOrigin) => Promise<CompactProcessOutcome>;

/** The chat a `compact` command acts on. */
export interface MessagingCompactTarget {
    processId: string;
    /** When set, the chat must belong to this repo. */
    workspaceId?: string;
}

export interface MessagingSelection {
    /** Selected repo (workspace id), if any; unset or stale falls back to Global. */
    repoId(): string | null | undefined;
    selectRepo(workspaceId: string): void;
    /** Selected topic, used to mark the current entry in `list topics`. */
    topicId(workspaceId: string): string | null | undefined;
    /** `processId: null` clears the topic so the next message starts a new chat. */
    selectTopic(workspaceId: string, processId: string | null): void;
}

export interface MessagingCommandContext {
    helpFormat?: MessagingHelpFormat;
    store: Pick<ProcessStore, 'getWorkspaces' | 'getAllProcesses' | 'getProcess'>;
    selection: MessagingSelection;
    /** Inline styling for names and ids; plain text by default. */
    strong?: (text: string) => string;
    code?: (text: string) => string;
    getQuota?: MessagingQuotaSource;
    compact?: MessagingCompactor;
    compactOrigin?: MessagingJobOrigin;
    /**
     * Chat that `compact` acts on before the selected topic, e.g. the quoted
     * answer's chat. Returning nothing falls back to the selected topic.
     */
    compactTarget?: () => Promise<MessagingCompactTarget | null | undefined> | MessagingCompactTarget | null | undefined;
    /** Escapes plain text such as chat titles; identity by default. */
    escape?: (text: string) => string;
    /** Local + remote repo directory for `list remotes` / `list topics <ref>`. */
    remotes?: MessagingRemoteDirectory;
    /** This chat's last `list remotes` numbering, so `n.m` refs resolve. */
    remoteRefs?: RemoteRefSlot;
    /** Clock for topic ages; `Date.now` by default. */
    now?: () => number;
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
export function invalidCommandReply(format?: MessagingHelpFormat): string {
    return `Unknown command or invalid argument.\n\n${formatMessagingHelp(format)}`;
}

function formatTokens(value: number): string {
    return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}

/** Reply when neither the selected repo nor the Global workspace exists. */
export const NO_CHAT_WORKSPACE_REPLY = '❌ The Global workspace is unavailable. Use `list repos`, then `select repo <n|name>`.';

export const COMPACT_NO_TARGET_REPLY = '❌ No topic selected. Use `list topics`, then `select topic <n>`.';

/** Compacts `target` and returns the reply text. Never enqueues a turn or changes the selection. */
export async function compactChatReply(
    store: Pick<ProcessStore, 'getProcess'>,
    compact: MessagingCompactor | undefined,
    target: MessagingCompactTarget,
    customInstructions: string,
    escape: (text: string) => string = plain,
    origin?: MessagingJobOrigin,
): Promise<string> {
    if (!compact) return 'Compaction is unavailable.';
    const { processId: id, workspaceId } = target;
    try {
        const process = await store.getProcess(id, workspaceId)
            ?? await store.getProcess(isQueueProcessId(id) ? toTaskId(id) : toQueueProcessId(id), workspaceId);
        if (!process || (workspaceId && process.metadata?.workspaceId !== workspaceId)) {
            return 'Chat not found. Use `list topics` to pick one.';
        }
        const outcome = origin ? await compact(process, customInstructions || undefined, origin)
            : await compact(process, customInstructions || undefined);
        const title = process.title ?? process.customTitle ?? process.id;
        if (outcome.taskId) return `🗜️ Compaction ${outcome.result.state === 'running' ? 'already running' : 'queued'} for "${escape(title)}". Completion will be reported here.`;
        const tokens = outcome.tokensBefore != null && outcome.tokensAfter != null
            ? ` — context ${formatTokens(outcome.tokensBefore)} → ${formatTokens(outcome.tokensAfter)} tokens` : '';
        return `🗜️ Compacted "${escape(title)}"${tokens}`;
    } catch (error) {
        if (error instanceof APIError) {
            if (error.statusCode === 409) return 'Chat is busy — try compact again when the current turn finishes.';
            if (error.statusCode === 422) return "This chat's provider doesn't support compaction.";
            if (error.statusCode === 400) return 'This chat has no active session to compact yet.';
        }
        console.error('[messaging] Compact failed:', error);
        return 'Could not compact this chat. Please try again later.';
    }
}

/** Handles a control command and returns the reply text. */
export async function handleMessagingCommand(command: MessagingControlCommand, ctx: MessagingCommandContext): Promise<string> {
    const strong = ctx.strong ?? plain;
    const code = ctx.code ?? plain;
    if (command.type === 'help') return formatMessagingHelp(ctx.helpFormat);
    if (command.type === 'quota') return readQuotaReply(ctx.getQuota);
    // Remote browsing is read-only and independent of the selected repo.
    const format = { strong, code, escape: ctx.escape ?? plain };
    if (command.type === 'list-remotes') return listRemotesReply(ctx.remotes, ctx.remoteRefs, format);
    const now = ctx.now?.() ?? Date.now();
    if (command.type === 'list-topics' && command.args) {
        return listRemoteTopicsReply(ctx.remotes, ctx.remoteRefs, command.args, format, { verbose: command.verbose, now });
    }

    const workspaces = await ctx.store.getWorkspaces();
    if (command.type === 'compact') {
        let target = await ctx.compactTarget?.();
        if (!target) {
            const repo = resolveChatWorkspace(workspaces, ctx.selection.repoId());
            const processId = repo ? ctx.selection.topicId(repo.id) : null;
            if (!repo || !processId) return COMPACT_NO_TARGET_REPLY;
            target = { processId, workspaceId: repo.id };
        }
        return compactChatReply(ctx.store, ctx.compact, target, command.args, ctx.escape, ctx.compactOrigin);
    }
    if (command.type === 'list-repos') {
        return workspaces.length
            ? `Repos (${workspaces.length}):\n${workspaces.map((ws, i) =>
                `${i + 1}. ${strong(ws.name ?? ws.id)} — ${code(ws.rootPath ?? ws.id)}`).join('\n')}`
            : 'No repos registered.';
    }
    if (command.type === 'select-repo') {
        const selected = resolveWorkspace(workspaces, command.args);
        if (!selected) return '❌ Repo not found. Use `list repos` to see available repos.';
        // Selecting a repo (even the current one) always starts a fresh chat there.
        ctx.selection.selectRepo(selected.id);
        ctx.selection.selectTopic(selected.id, null);
        return `✅ Selected repo: ${strong(selected.name ?? selected.id)}. Your next message starts a new chat.`;
    }

    const repo = resolveChatWorkspace(workspaces, ctx.selection.repoId());
    if (!repo) return NO_CHAT_WORKSPACE_REPLY;
    const workspaceId = repo.id;
    const repoName = repo.name ?? repo.id;

    if (command.type === 'list-topics') {
        const topics = await listRecentTopics(ctx.store, workspaceId);
        if (!topics.length) return 'No chat topics found.';
        return formatTopicList(topics, {
            ...format,
            header: `${strong('Topics')} · ${format.escape(repoName)}`,
            footer: localTopicListFooter(code, command.verbose),
            currentId: ctx.selection.topicId(workspaceId),
            verbose: command.verbose,
            now,
        });
    }
    if (command.type === 'create-topic') {
        ctx.selection.selectTopic(workspaceId, null);
        return '✅ Ready for a new topic. Send a message to start.';
    }
    const topic = await resolveTopic(ctx.store, workspaceId, command.args);
    if (!topic || topic.metadata?.workspaceId !== workspaceId) {
        return `❌ Topic not found in ${strong(repoName)}. Use \`list topics\`.`;
    }
    ctx.selection.selectTopic(workspaceId, topic.id);
    return `✅ Selected topic: ${strong(topic.title ?? topic.customTitle ?? topic.id)}`;
}
