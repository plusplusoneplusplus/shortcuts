import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isQueueProcessId, toTaskId, toQueueProcessId, type AIProcess, type ProcessStore, type QueuedTask, type TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsMcpSendRejectedError, TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { formatTeamsAnswerChunks } from './teams-answer-format';
import { TeamsMessageNotSentError } from './teams-messaging-manager';
import { escapeTeamsHtml, formatTeamsQuestion } from './teams-outbound-format';
import type { QuestionTransport } from './ask-user-relay';
import { formatJobNotice, type JobNoticeTransport } from './job-notices';
import { onTaskTerminal } from './chat-target';
import { RELAY_ANSWER_TEXT, findRequestFailureText, findRequestAnswer, findRequestTurn, isTerminalStatus, type RelayTerminalStatus } from './relay-answer';
import { validateBotControlMetadata } from './bot-control-metadata';
import { ProcessOperationAdmission } from '../processes/process-operation-admission';
import { releaseBotControlledConversation } from './bot-control-admission';

type BindingStatus = 'admitting' | 'awaiting' | 'retryable' | 'sending' | 'delivered' | 'ambiguous' | 'failed';

interface AnswerBinding {
    version: 1;
    workspaceId: string;
    teamId: string;
    channelId: string;
    messageId: string;
    rootId: string;
    taskId: string;
    processId: string;
    selectedWorkspaceId?: string;
    selectedProcessId?: string | null;
    selectedTaskId?: string;
    commandIds?: string[];
    requestId?: string;
    /** Inbound admission receipt; later flag changes cannot opt this request into answers. */
    admissionOnly?: true;
    releaseState?: 'releasing' | 'released';
    partCount?: number;
    nextPart?: number;
    answerHash?: string;
    attribution?: 'compact';
    answerContext?: string;
    sourceContext?: string;
    continuationNoticeSent?: boolean;
    acceptedMessageId?: string;
    sentMessageIds?: string[];
    lastReplyAt?: string;
    lastReplyIds?: string[];
    retryCount?: number;
    nextAttemptAt?: string;
    terminalStatus?: RelayTerminalStatus;
    status: BindingStatus;
    createdAt: string;
}

interface ThreadSelection {
    version: 1;
    teamId: string;
    channelId: string;
    rootId: string;
    workspaceId: string;
    processId: string | null;
    taskId?: string;
    commandIds?: string[];
    updatedAt?: string;
}

interface DiscoveredRoot {
    teamId: string;
    channelId: string;
    rootId: string;
    commandIds?: string[];
}

export interface TeamsAnswerRelayDeps {
    dataDir: string;
    store: ProcessStore;
    queue: Pick<ScheduleQueueEventBus, 'on' | 'off' | 'getTask'>
        & Partial<Pick<TaskQueueManager, 'replaceBotControl'>> & { getAll?: () => QueuedTask[] };
    isEnabled: () => boolean;
    isBotManagedConversationsEnabled?: () => boolean;
    target: () => { connected: boolean; teamId?: string; channelId?: string };
    /** Reply in `rootId`'s thread, or post a new top-level message when it is omitted. */
    send: (text: string, rootId?: string) => Promise<string>;
    /** Called after reconnect reconciliation (e.g. to post pending job notices). */
    onReconnected?: () => Promise<void>;
}

export function teamsQuestionChatKey(teamId: string, channelId: string): string {
    return `${teamId}\0${channelId}`;
}

export class TeamsBindingReleaseError extends Error {
    constructor(readonly failures: { workspaceId: string; processId: string; error: unknown }[]) {
        super('Teams binding release reconciliation failed');
        this.name = 'TeamsBindingReleaseError';
    }
}

function bindingName(teamId: string, channelId: string, messageId: string): string {
    return createHash('sha256').update(JSON.stringify([teamId, channelId, messageId])).digest('hex') + '.json';
}

function bindingPath(dataDir: string, workspaceId: string, name: string): string {
    return getRepoDataPath(dataDir, workspaceId, path.join('teams-answer-relay', name));
}

function answerLabel(binding: AnswerBinding): string {
    return bindingName(binding.teamId, binding.channelId, binding.messageId).slice(0, 10);
}

function isRelayAnswer(text: string, label: string): boolean {
    return new RegExp(`(?:^|>)(?:CoC \u00b7 |AI: )?Request ${label} \u00b7 Part [1-9]\\d*/[1-9]\\d*(?:<|\\s|$)`).test(text);
}

function readBinding(file: string): AnswerBinding | undefined {
    if (!fs.existsSync(file)) return undefined;
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Teams answer binding');
    const row = raw as Record<string, unknown>;
    if (row.version !== 1 || !['admitting', 'awaiting', 'retryable', 'sending', 'delivered', 'ambiguous', 'failed'].includes(String(row.status))
        || ['workspaceId', 'teamId', 'channelId', 'messageId', 'rootId', 'taskId', 'processId', 'createdAt']
            .some(key => typeof row[key] !== 'string' || !row[key])
        || !Number.isFinite(Date.parse(row.createdAt as string))
        || (row.requestId !== undefined && (typeof row.requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.requestId)))
        || (row.admissionOnly !== undefined && row.admissionOnly !== true)
        || (row.releaseState !== undefined && !['releasing', 'released'].includes(String(row.releaseState)))
        || (row.selectedWorkspaceId !== undefined && (typeof row.selectedWorkspaceId !== 'string' || !row.selectedWorkspaceId))
        || (row.selectedProcessId !== undefined && row.selectedProcessId !== null
            && (typeof row.selectedProcessId !== 'string' || !row.selectedProcessId))
        || (row.selectedTaskId !== undefined && (typeof row.selectedTaskId !== 'string' || !row.selectedTaskId))
        || (row.commandIds !== undefined && (!Array.isArray(row.commandIds)
            || row.commandIds.some(id => typeof id !== 'string' || !id)))
        || (row.answerHash !== undefined && (typeof row.answerHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.answerHash)))
        || (row.attribution !== undefined && row.attribution !== 'compact')
        || (row.answerContext !== undefined && (typeof row.answerContext !== 'string' || row.answerContext.length > 140))
        || (row.sourceContext !== undefined && (typeof row.sourceContext !== 'string' || row.sourceContext.length > 140))
        || (row.continuationNoticeSent !== undefined && typeof row.continuationNoticeSent !== 'boolean')
        || (row.acceptedMessageId !== undefined && (typeof row.acceptedMessageId !== 'string'
            || !/^[A-Za-z0-9:_@.-]{1,256}$/.test(row.acceptedMessageId)))
        || (row.sentMessageIds !== undefined && (!Array.isArray(row.sentMessageIds)
            || row.sentMessageIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9:_@.-]{1,256}$/.test(id))))
        || (row.lastReplyAt !== undefined && (typeof row.lastReplyAt !== 'string'
            || !Number.isFinite(Date.parse(row.lastReplyAt))))
        || (row.lastReplyIds !== undefined && (!Array.isArray(row.lastReplyIds)
            || row.lastReplyIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9:_@.-]{1,256}$/.test(id))))
        || (row.partCount !== undefined && (!Number.isSafeInteger(row.partCount) || (row.partCount as number) < 1))
        || (row.nextPart !== undefined && (row.partCount === undefined || !Number.isSafeInteger(row.nextPart)
            || (row.nextPart as number) < 0 || (row.nextPart as number) > (row.partCount as number)))
        || (row.retryCount !== undefined && (!Number.isSafeInteger(row.retryCount)
            || (row.retryCount as number) < 0 || (row.retryCount as number) > 5))
        || (row.terminalStatus !== undefined && !isTerminalStatus(String(row.terminalStatus)))
        || (row.nextAttemptAt !== undefined && (typeof row.nextAttemptAt !== 'string' || !Number.isFinite(Date.parse(row.nextAttemptAt))))) {
        throw new Error('Invalid Teams answer binding');
    }
    return row as unknown as AnswerBinding;
}

/** Workspace-scoped receipts for new Ask chats and their correlated follow-ups. */
export class TeamsAnswerRelay {
    private readonly bindings = new Map<string, { file: string; value: AnswerBinding }>();
    private readonly threadSelections = new Map<string, { file: string; value: ThreadSelection }>();
    private readonly discoveredRoots = new Map<string, DiscoveredRoot>();
    private readonly admittingThreads = new Map<string, Promise<{ taskId: string; duplicate: boolean }>>();
    private readonly ownerAdmission = new ProcessOperationAdmission();
    private readonly active = new Set<string>();

    /** Detached authoritative receipts; a selection alone is not conversation ownership. */
    sentinelMirrorBindings(workspaceId: string, processId: string): {
        teamId: string; channelId: string; rootId: string; bindingId: string;
    }[] {
        const target = this.deps.target();
        const destinations = new Map<string, { teamId: string; channelId: string; rootId: string; bindingId: string }>();
        for (const { value: row } of this.bindings.values()) {
            if (row.workspaceId !== workspaceId || row.processId !== processId || row.releaseState
                || row.status === 'admitting' || row.teamId !== target.teamId || row.channelId !== target.channelId) continue;
            const name = bindingName(row.teamId, row.channelId, row.rootId);
            const selected = this.threadSelections.get(name)?.value;
            const root = [...this.bindings.values()].find(entry =>
                entry.value.teamId === row.teamId && entry.value.channelId === row.channelId
                && entry.value.messageId === row.rootId)?.value;
            const selectedWorkspaceId = selected?.workspaceId ?? root?.selectedWorkspaceId ?? root?.workspaceId ?? row.workspaceId;
            const selectedProcessId = selected ? selected.processId
                : root?.selectedProcessId !== undefined ? root.selectedProcessId : root?.processId ?? row.processId;
            if (selectedWorkspaceId !== workspaceId || selectedProcessId !== processId || destinations.has(name)) continue;
            destinations.set(name, {
                teamId: row.teamId, channelId: row.channelId, rootId: row.rootId,
                bindingId: bindingName(row.teamId, row.channelId, row.messageId),
            });
        }
        return [...destinations.values()];
    }
    private disposed = false;
    private retryTimer: NodeJS.Timeout | undefined;
    private readonly onTerminal = (task: QueuedTask) => {
        try {
            if (typeof task.payload?.relayRequestId === 'string'
                && isTerminalStatus(task.status)) {
                for (const [file, { value }] of this.bindings) {
                    if (value.requestId !== task.payload.relayRequestId) continue;
                    if (value.workspaceId !== task.repoId || value.processId !== task.processId) continue;
                    this.update(file, value.admissionOnly ? 'delivered' : value.status, {
                        taskId: task.id,
                        terminalStatus: task.status,
                    });
                }
            } else if (isTerminalStatus(task.status)) {
                for (const [file, { value }] of this.bindings) {
                    if (value.requestId || value.taskId !== task.id
                        || value.workspaceId !== task.repoId
                        || (task.processId && value.processId !== task.processId)) continue;
                    this.update(file, value.admissionOnly ? 'delivered' : value.status, {
                        terminalStatus: task.status,
                    });
                }
            }
        } catch {
            console.error('[teams-answer-relay] Failed to persist terminal receipt');
        }
        void this.reconcileProcess(task.processId, task.id).catch(() => {
            console.error('[teams-answer-relay] Failed to reconcile terminal task');
        });
    };

    private readonly unsubscribeTerminal: () => void;

    constructor(private readonly deps: TeamsAnswerRelayDeps) {
        this.unsubscribeTerminal = onTaskTerminal(deps.queue, this.onTerminal);
    }

    hasInbound(msg: InboundTeamsMessage, includeAnswers = true): boolean {
        const target = this.deps.target();
        return [...this.bindings.values()].some(({ value }) =>
            value.teamId === target.teamId && value.channelId === msg.channelId
            && value.messageId === msg.messageId && (includeAnswers || value.admissionOnly === true || value.releaseState !== undefined));
    }

    threadRoots(teamId: string, channelId: string): string[] {
        return [...new Set([...this.bindings.values()]
            .filter(({ value }) => value.teamId === teamId && value.channelId === channelId
                && !value.releaseState && value.messageId === value.rootId)
            .map(({ value }) => value.rootId)
            .concat([...this.threadSelections.values()]
                .filter(({ value }) => value.teamId === teamId && value.channelId === channelId)
                .map(({ value }) => value.rootId))
            .concat([...this.discoveredRoots.values()]
                .filter(value => value.teamId === teamId && value.channelId === channelId)
                .map(value => value.rootId)))].sort();
    }

    recordDiscoveredRoot(teamId: string, msg: InboundTeamsMessage): void {
        if (!this.deps.isEnabled() || !teamId || !msg.channelId || !msg.messageId) return;
        const name = bindingName(teamId, msg.channelId, msg.messageId);
        if (this.discoveredRoots.has(name)) return;
        const value: DiscoveredRoot = { teamId, channelId: msg.channelId, rootId: msg.messageId };
        atomicWriteJsonUnique(path.join(this.deps.dataDir, 'teams-thread-discovery', name), value);
        this.discoveredRoots.set(name, value);
    }

    private rootEntry(msg: InboundTeamsMessage): [string, { file: string; value: AnswerBinding }] | undefined {
        const target = this.deps.target();
        return [...this.bindings.entries()].find(([, { value }]) =>
            value.teamId === target.teamId && value.channelId === msg.channelId
            && value.messageId === value.rootId && value.messageId === msg.replyToMessageId);
    }

    getThreadSelection(msg: InboundTeamsMessage): { workspaceId: string } | null {
        const target = this.deps.target();
        if (!msg.replyToMessageId || !target.teamId || target.channelId !== msg.channelId) return null;
        const root = this.rootEntry(msg)?.[1].value;
        const state = this.threadSelections.get(bindingName(target.teamId, msg.channelId, msg.replyToMessageId))?.value;
        if (root?.releaseState && (!state || state.processId === root.processId)) return null;
        return state ? { workspaceId: state.workspaceId }
            : root ? { workspaceId: root.selectedWorkspaceId ?? root.workspaceId } : null;
    }

    async resolveThread(msg: InboundTeamsMessage): Promise<{
        process?: AIProcess; taskId?: string; workspaceId: string;
    } | null> {
        const target = this.deps.target();
        if (!msg.replyToMessageId || !target.teamId || target.channelId !== msg.channelId) return null;
        const root = this.rootEntry(msg)?.[1].value;
        const state = this.threadSelections.get(bindingName(target.teamId, msg.channelId, msg.replyToMessageId))?.value;
        if (root?.releaseState && (!state || state.processId === root.processId)) {
            throw new Error('Teams thread binding is unavailable');
        }
        if (!root && !state) return null;
        const workspaceId = state?.workspaceId ?? root?.selectedWorkspaceId ?? root!.workspaceId;
        if (!(await this.deps.store.getWorkspaces()).some(ws => ws.id === workspaceId)) {
            throw new Error('Teams thread workspace is unavailable');
        }
        if (state?.processId === null || (!state && root?.selectedProcessId === null)) return { workspaceId };
        const processId = state?.processId ?? root?.selectedProcessId ?? root?.processId;
        if (!processId) return { workspaceId };
        const receipts = [...this.bindings.values()].map(entry => entry.value)
            .filter(value => value.workspaceId === workspaceId && value.processId === processId);
        if (receipts.length && receipts.every(value => value.releaseState !== undefined)) {
            throw new Error('Teams thread binding is unavailable');
        }
        const process = await this.deps.store.getProcess(processId, workspaceId);
        if (process) {
            if (process.id !== processId || process.metadata?.workspaceId !== workspaceId
                || ['failed', 'cancelled'].includes(process.status)) {
                throw new Error('Teams thread chat is unavailable');
            }
            return { process, workspaceId };
        }
        const taskId = state?.taskId ?? (!state ? root?.selectedTaskId ?? root?.taskId : undefined);
        if (!taskId) throw new Error('Teams thread chat is unavailable');
        const task = this.deps.queue.getTask(taskId!);
        if (!task || task.repoId !== workspaceId || task.processId !== processId
            || !['queued', 'running'].includes(task.status)) {
            throw new Error('Teams thread chat is unavailable');
        }
        return { taskId: taskId!, workspaceId };
    }

    async selectThreadTarget(msg: InboundTeamsMessage, workspaceId: string, processId: string | null, allowQueued = false): Promise<void> {
        if (this.disposed || !this.deps.isEnabled()) throw new Error('Teams thread selection is unavailable');
        const target = this.deps.target();
        if (!target.connected || !target.teamId || target.channelId !== msg.channelId || !msg.replyToMessageId) {
            throw new Error('Teams thread target is unavailable');
        }
        if (!(await this.deps.store.getWorkspaces()).some(ws => ws.id === workspaceId)) {
            throw new Error('Teams thread workspace is unavailable');
        }
        let taskId: string | undefined;
        if (processId) {
            const process = await this.deps.store.getProcess(processId, workspaceId);
            const queued = !process && allowQueued && isQueueProcessId(processId)
                ? this.deps.queue.getTask(toTaskId(processId)) : undefined;
            if (queued?.repoId === workspaceId && queued.processId === processId
                && queued.type === 'chat' && queued.payload.kind === 'chat'
                && queued.payload.workspaceId === workspaceId && !queued.payload.processId
                && ['queued', 'running'].includes(queued.status)) {
                taskId = queued.id;
            } else if (!process || process.id !== processId || process.metadata?.workspaceId !== workspaceId
                || ['failed', 'cancelled'].includes(process.status)) {
                throw new Error('Teams thread chat is unavailable');
            }
        }
        this.saveThreadSelection(msg.channelId, msg.replyToMessageId!, workspaceId, processId, taskId, msg.messageId);
    }

    private saveThreadSelection(channelId: string, rootId: string, workspaceId: string, processId: string | null, taskId?: string, commandId?: string): void {
        const teamId = this.deps.target().teamId!;
        const name = bindingName(teamId, channelId, rootId);
        const existing = this.threadSelections.get(name);
        const file = getRepoDataPath(this.deps.dataDir, workspaceId, path.join('teams-thread-roots', name));
        const value: ThreadSelection = {
            version: 1, teamId, channelId, rootId,
            workspaceId, processId, ...(taskId ? { taskId } : {}),
            updatedAt: new Date().toISOString(),
            ...(existing?.value.commandIds || commandId
                ? { commandIds: [...new Set([...(existing?.value.commandIds ?? []), ...(commandId ? [commandId] : [])])].slice(-500) }
                : {}),
        };
        atomicWriteJsonUnique(file, value);
        if (existing && existing.file !== file) fs.unlinkSync(existing.file);
        this.threadSelections.set(name, { file, value });
    }

    async admitThreadNew(
        msg: InboundTeamsMessage, workspaceId: string, enqueue: (taskId: string) => Promise<string>,
    ): Promise<{ taskId: string; duplicate: boolean }> {
        const target = this.deps.target();
        if (!target.teamId || !msg.replyToMessageId) throw new Error('Teams thread target is unavailable');
        const key = bindingName(target.teamId, msg.channelId, msg.replyToMessageId);
        const pending = this.admittingThreads.get(key);
        if (pending) {
            const prior = await pending;
            if (this.hasInbound(msg)) return { taskId: prior.taskId, duplicate: true };
            throw new Error('Teams thread chat is starting. Retry your question shortly.');
        }
        const admission = this.startThreadChat(msg, workspaceId, enqueue);
        this.admittingThreads.set(key, admission);
        try {
            return await admission;
        } finally {
            this.admittingThreads.delete(key);
        }
    }

    private async startThreadChat(
        msg: InboundTeamsMessage, workspaceId: string, enqueue: (taskId: string) => Promise<string>,
    ): Promise<{ taskId: string; duplicate: boolean }> {
        const prior = [...this.bindings.values()].find(({ value }) =>
            value.teamId === this.deps.target().teamId && value.channelId === msg.channelId
            && value.messageId === msg.messageId)?.value;
        if (prior) return { taskId: prior.taskId, duplicate: true };
        const selected = this.getThreadSelection(msg);
        const bound = await this.resolveThread(msg);
        if (!selected || selected.workspaceId !== workspaceId || bound?.process || bound?.taskId) {
            throw new Error('Teams thread is not ready for a new chat');
        }
        const taskId = `${Date.now()}-${randomUUID()}`;
        this.saveThreadSelection(msg.channelId, msg.replyToMessageId!, workspaceId, toQueueProcessId(taskId), taskId);
        try {
            return await this.admitNew(msg, workspaceId, enqueue, taskId);
        } catch (error) {
            if (!this.hasInbound(msg)) {
                try {
                    this.saveThreadSelection(msg.channelId, msg.replyToMessageId!, workspaceId, null);
                } catch (rollbackError) {
                    throw Object.assign(new Error('Teams thread admission rollback failed'), {
                        errors: [error, rollbackError],
                    });
                }
            }
            throw error;
        }
    }

    hasCommand(msg: InboundTeamsMessage): boolean {
        const target = this.deps.target();
        if (!target.teamId || !msg.replyToMessageId) return false;
        const root = this.rootEntry(msg)?.[1].value;
        const state = this.threadSelections.get(bindingName(target.teamId, msg.channelId, msg.replyToMessageId))?.value;
        const discovery = this.discoveredRoots.get(bindingName(target.teamId, msg.channelId, msg.replyToMessageId));
        return !!root?.commandIds?.includes(msg.messageId) || !!state?.commandIds?.includes(msg.messageId)
            || !!discovery?.commandIds?.includes(msg.messageId);
    }

    recordCommand(msg: InboundTeamsMessage): void {
        const target = this.deps.target();
        if (!target.teamId || !msg.replyToMessageId) throw new Error('Teams thread target is unavailable');
        const name = bindingName(target.teamId, msg.channelId, msg.replyToMessageId);
        const state = this.threadSelections.get(name);
        if (state) {
            const value = { ...state.value, commandIds: [...new Set([...(state.value.commandIds ?? []), msg.messageId])].slice(-500) };
            atomicWriteJsonUnique(state.file, value);
            this.threadSelections.set(name, { file: state.file, value });
            return;
        }
        const root = this.rootEntry(msg);
        if (root) {
            this.update(root[0], root[1].value.status, {
                commandIds: [...new Set([...(root[1].value.commandIds ?? []), msg.messageId])].slice(-500),
            });
            return;
        }
        const existing = this.discoveredRoots.get(name);
        const value: DiscoveredRoot = {
            teamId: target.teamId, channelId: msg.channelId, rootId: msg.replyToMessageId,
            commandIds: [...new Set([...(existing?.commandIds ?? []), msg.messageId])].slice(-500),
        };
        atomicWriteJsonUnique(path.join(this.deps.dataDir, 'teams-thread-discovery', name), value);
        this.discoveredRoots.set(name, value);
    }

    isOwnReply(teamId: string, msg: InboundTeamsMessage): boolean {
        if (!msg.replyToMessageId) return false;
        return [...this.bindings.values()].some(({ value }) =>
            value.teamId === teamId && value.channelId === msg.channelId
            && value.rootId === msg.replyToMessageId && (
                value.sentMessageIds?.includes(msg.messageId)
                || (value.answerHash && isRelayAnswer(msg.text, answerLabel(value)))
            ));
    }

    hasSeenReply(teamId: string, msg: InboundTeamsMessage): boolean {
        if (this.hasInbound(msg)) return true;
        if (!msg.replyToMessageId || !msg.createdDateTime) return false;
        const root = [...this.bindings.values()].find(({ value }) =>
            value.messageId === value.rootId && value.messageId === msg.replyToMessageId
            && value.teamId === teamId && value.channelId === msg.channelId)?.value;
        if (!root?.lastReplyAt) return false;
        const time = Date.parse(msg.createdDateTime);
        if (!Number.isFinite(time)) return false;
        return time < Date.parse(root.lastReplyAt)
            || (time === Date.parse(root.lastReplyAt) && !!root.lastReplyIds?.includes(msg.messageId));
    }

    recordSeenReply(teamId: string, msg: InboundTeamsMessage): void {
        if (!msg.replyToMessageId || !msg.createdDateTime) return;
        const time = Date.parse(msg.createdDateTime);
        if (!Number.isFinite(time)) return;
        for (const [file, { value }] of this.bindings) {
            if (value.messageId !== value.rootId || value.messageId !== msg.replyToMessageId
                || value.teamId !== teamId || value.channelId !== msg.channelId) continue;
            const previous = value.lastReplyAt ? Date.parse(value.lastReplyAt) : -Infinity;
            if (time < previous || (time === previous && value.lastReplyIds?.includes(msg.messageId))) return;
            this.update(file, value.status, {
                lastReplyAt: new Date(time).toISOString(),
                lastReplyIds: time === previous ? [...(value.lastReplyIds ?? []), msg.messageId] : [msg.messageId],
            });
            return;
        }
    }

    recordOutbound(teamId: string, channelId: string, rootId: string, messageId: string): void {
        if (!/^[A-Za-z0-9:_@.-]{1,256}$/.test(messageId)) return;
        for (const [file, { value }] of this.bindings) {
            if (value.messageId !== value.rootId || value.teamId !== teamId || value.channelId !== channelId
                || value.rootId !== rootId || value.sentMessageIds?.includes(messageId)) continue;
            this.update(file, value.status, { sentMessageIds: [...(value.sentMessageIds ?? []), messageId] });
            break;
        }
    }

    async restore(): Promise<void> {
        const seen = new Map<string, string>();
        const discovery = path.join(this.deps.dataDir, 'teams-thread-discovery');
        if (fs.existsSync(discovery)) {
            for (const name of fs.readdirSync(discovery).filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
                const row: unknown = JSON.parse(fs.readFileSync(path.join(discovery, name), 'utf8'));
                if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid Teams root');
                const root = row as Record<string, unknown>;
                if (typeof root.teamId !== 'string' || typeof root.channelId !== 'string'
                    || typeof root.rootId !== 'string'
                    || (root.commandIds !== undefined && (!Array.isArray(root.commandIds)
                        || root.commandIds.some(id => typeof id !== 'string' || !id)))
                    || bindingName(root.teamId, root.channelId, root.rootId) !== name) {
                    throw new Error('Invalid Teams root identity');
                }
                this.discoveredRoots.set(name, {
                    teamId: root.teamId, channelId: root.channelId, rootId: root.rootId,
                    ...(Array.isArray(root.commandIds) ? { commandIds: root.commandIds } : {}),
                });
            }
        }
        const workspaces = await this.deps.store.getWorkspaces();
        const repoFolder = path.join(this.deps.dataDir, 'repos');
        const scopeIds = new Set(workspaces.map(workspace => workspace.id));
        if (fs.existsSync(repoFolder)) {
            for (const entry of fs.readdirSync(repoFolder, { withFileTypes: true })) {
                if (entry.isDirectory()) scopeIds.add(entry.name);
            }
        }
        for (const workspaceId of scopeIds) {
            const rootsFolder = getRepoDataPath(this.deps.dataDir, workspaceId, 'teams-thread-roots');
            if (fs.existsSync(rootsFolder)) {
                for (const name of fs.readdirSync(rootsFolder).filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
                    const file = path.join(rootsFolder, name);
                    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
                    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Teams thread root');
                    const state = value as Record<string, unknown>;
                    if (state.version !== 1 || typeof state.teamId !== 'string' || !state.teamId
                        || typeof state.channelId !== 'string' || !state.channelId
                        || typeof state.rootId !== 'string' || !state.rootId
                        || typeof state.workspaceId !== 'string' || !state.workspaceId
                        || state.workspaceId !== workspaceId
                        || (state.processId !== null && (typeof state.processId !== 'string' || !state.processId))
                        || (state.taskId !== undefined && (typeof state.taskId !== 'string' || !state.taskId))
                        || (state.updatedAt !== undefined && (typeof state.updatedAt !== 'string'
                            || !Number.isFinite(Date.parse(state.updatedAt))))
                        || (state.commandIds !== undefined && (!Array.isArray(state.commandIds)
                            || state.commandIds.some(id => typeof id !== 'string' || !id)))
                        || bindingName(state.teamId, state.channelId, state.rootId) !== name) {
                        throw new Error('Invalid Teams thread root');
                    }
                    const prior = this.threadSelections.get(name);
                    if (prior && (Date.parse(prior.value.updatedAt ?? '') || 0) >= (
                        Date.parse(typeof state.updatedAt === 'string' ? state.updatedAt : '') || 0)) continue;
                    this.threadSelections.set(name, {
                        file,
                        value: {
                            version: 1, teamId: state.teamId, channelId: state.channelId,
                            rootId: state.rootId, workspaceId: state.workspaceId,
                            processId: state.processId,
                            ...(state.taskId ? { taskId: state.taskId } : {}),
                            ...(Array.isArray(state.commandIds) ? { commandIds: state.commandIds } : {}),
                            ...(state.updatedAt ? { updatedAt: state.updatedAt } : {}),
                        } as ThreadSelection,
                    });
                }
            }
        }
        for (const workspace of workspaces) {
            const folder = getRepoDataPath(this.deps.dataDir, workspace.id, 'teams-answer-relay');
            if (!fs.existsSync(folder)) continue;
            for (const name of fs.readdirSync(folder).filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
                const file = path.join(folder, name);
                const value = readBinding(file);
                if (value?.workspaceId !== workspace.id
                    || bindingName(value.teamId, value.channelId, value.messageId) !== name) {
                    throw new Error('Teams answer binding identity mismatch');
                }
                if (seen.has(name)) throw new Error('Conflicting Teams workspace bindings require reconciliation');
                seen.set(name, file);
                this.bindings.set(file, { file, value });
            }
        }
        this.compact();
        for (const [file, { value }] of this.bindings) {
            if (value.releaseState) continue;
            if (value.status === 'admitting') {
                const process = await this.deps.store.getProcess(value.processId, value.workspaceId);
                const matchingTurn = process?.conversationTurns?.some(turn =>
                    turn.role === 'user' && turn.relayRequestId === value.requestId);
                const admittedTask = this.deps.queue.getTask(value.taskId);
                const taskMatches = admittedTask?.repoId === value.workspaceId
                    && admittedTask.processId === value.processId
                    && (value.requestId ? admittedTask.payload?.relayRequestId === value.requestId
                        : admittedTask.id === value.taskId);
                const queued = this.deps.queue.getAll?.().some(task => task.repoId === value.workspaceId
                    && task.processId === value.processId
                    && (value.requestId ? task.payload?.relayRequestId === value.requestId : task.id === value.taskId));
                if (taskMatches || queued || value.terminalStatus
                    || (!value.requestId && process?.metadata?.queueTaskId === value.taskId)
                    || (value.requestId && matchingTurn)) {
                    this.update(file, 'awaiting');
                } else {
                    this.update(file, 'ambiguous');
                    console.error('[teams-answer-relay] Admission outcome ambiguous; manual reconciliation required');
                }
            } else if (value.status === 'sending') {
                this.update(file, 'ambiguous');
            }
        }
        await this.reconcile();
        this.scheduleRetry();
    }

    async admitNew(
        msg: InboundTeamsMessage,
        workspaceId: string,
        enqueue: (taskId: string) => Promise<string>,
        reservedTaskId?: string,
        admission?: { admissionOnly: true; prompt: string; handOffParentProcessId?: string },
    ): Promise<{ taskId: string; duplicate: boolean }> {
        const taskId = reservedTaskId ?? `${Date.now()}-${randomUUID()}`;
        return this.withOwnerAdmission(workspaceId, toQueueProcessId(taskId), () =>
            this.startNew(msg, workspaceId, enqueue, taskId, admission));
    }

    private async startNew(
        msg: InboundTeamsMessage, workspaceId: string, enqueue: (taskId: string) => Promise<string>,
        reservedTaskId: string, admission?: { admissionOnly: true; prompt: string; handOffParentProcessId?: string },
    ): Promise<{ taskId: string; duplicate: boolean }> {
        if (this.disposed || !(admission
            ? !!msg.images?.length || this.deps.isBotManagedConversationsEnabled?.() === true : this.deps.isEnabled())) {
            throw new Error('Teams conversation admission is unavailable');
        }
        const target = this.deps.target();
        if (!target.connected || !target.teamId || target.channelId !== msg.channelId || !msg.messageId) {
            throw new Error('Teams target is unavailable');
        }
        if (!(await this.deps.store.getWorkspaces()).some(ws => ws.id === workspaceId)) {
            throw new Error('Teams workspace is unavailable');
        }
        const name = bindingName(target.teamId, msg.channelId, msg.messageId);
        const file = bindingPath(this.deps.dataDir, workspaceId, name);
        const existing = [...this.bindings.values()]
            .find(entry => bindingName(entry.value.teamId, entry.value.channelId, entry.value.messageId) === name)?.value
            ?? readBinding(file);
        if (existing) {
            if (existing.teamId !== target.teamId || existing.channelId !== msg.channelId || existing.messageId !== msg.messageId) {
                throw new Error('Teams answer binding identity mismatch');
            }
            return { taskId: existing.taskId, duplicate: true };
        }
        this.ensureCapacity(workspaceId);
        const taskId = reservedTaskId ?? `${Date.now()}-${randomUUID()}`;
        const value: AnswerBinding = {
            version: 1, workspaceId, teamId: target.teamId, channelId: msg.channelId,
            messageId: msg.messageId, rootId: msg.replyToMessageId || msg.messageId,
            taskId, processId: toQueueProcessId(taskId), status: 'admitting',
            ...(admission ? { admissionOnly: true as const } : {}),
            ...(admission?.handOffParentProcessId ? {
                selectedProcessId: admission.handOffParentProcessId,
                ...(isQueueProcessId(admission.handOffParentProcessId)
                    ? { selectedTaskId: toTaskId(admission.handOffParentProcessId) } : {}),
            } : {}),
            createdAt: new Date().toISOString(),
        };
        atomicWriteJsonUnique(file, value);
        this.bindings.set(file, { file, value });
        try {
            if (await enqueue(taskId) !== taskId) throw new Error('Queue returned a different task ID');
            return { taskId, duplicate: false };
        } catch (error) {
            const task = this.deps.queue.getTask(taskId);
            if (task?.id === taskId && task.repoId === workspaceId
                && task.processId === value.processId && task.type === 'chat'
                && task.payload?.kind === 'chat' && task.payload.workspaceId === workspaceId
                && !task.payload.processId
                && (!admission || (task.payload.prompt === admission.prompt
                    && !task.payload.relayRequestId && (!!msg.images?.length || task.botControl !== undefined)))) {
                if (task.botControl !== undefined && validateBotControlMetadata(task.botControl).source !== 'teams') {
                    throw new Error('Teams admission has competing bot control');
                }
                console.error('[teams-answer-relay] Queued request observer failed; admission retained');
                return { taskId, duplicate: false };
            }
            if (!task) {
                // Rejected durable admission leaves no executable task; permit the same delivery to retry.
                this.discardRejected(file, error);
            } else {
                console.error('[teams-answer-relay] Admission identity mismatch requires reconciliation');
            }
            throw error;
        }
    }

    async acknowledged(taskId: string): Promise<void> {
        for (const [file, { value }] of this.bindings) {
            if (value.taskId !== taskId || value.status !== 'admitting') continue;
            this.update(file, 'awaiting');
        }
        await this.reconcileTask(taskId);
    }

    async admitFollowUp(
        msg: InboundTeamsMessage,
        process: AIProcess,
        admit: (requestId: string) => Promise<{ taskId?: string }>,
        reservedTaskId?: string,
        admissionOnly = false,
    ): Promise<{ duplicate: boolean; taskId: string }> {
        const workspaceId = process.metadata?.workspaceId;
        if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('Teams follow-up target is unavailable');
        return this.withOwnerAdmission(workspaceId, process.id, () =>
            this.startFollowUp(msg, process, admit, reservedTaskId, admissionOnly));
    }

    private async startFollowUp(
        msg: InboundTeamsMessage, process: AIProcess,
        admit: (requestId: string) => Promise<{ taskId?: string }>,
        reservedTaskId?: string, admissionOnly = false,
    ): Promise<{ duplicate: boolean; taskId: string }> {
        if (this.disposed || !(admissionOnly
            ? !!msg.images?.length || this.deps.isBotManagedConversationsEnabled?.() === true : this.deps.isEnabled())) {
            throw new Error('Teams conversation admission is unavailable');
        }
        const target = this.deps.target();
        const workspaceId = process.metadata?.workspaceId;
        if (msg.replyToMessageId) {
            const bound = await this.resolveThread(msg);
            if (!bound?.process || bound.process.id !== process.id
                || bound.workspaceId !== workspaceId) {
                throw new Error('Teams thread chat is unavailable');
            }
        }
        if (typeof workspaceId !== 'string' || !workspaceId || !target.connected
            || !target.teamId || target.channelId !== msg.channelId || !msg.messageId
            || !(await this.deps.store.getWorkspaces()).some(ws => ws.id === workspaceId)) {
            throw new Error('Teams follow-up target is unavailable');
        }
        const name = bindingName(target.teamId, msg.channelId, msg.messageId);
        const prior = [...this.bindings.values()]
            .find(entry => bindingName(entry.value.teamId, entry.value.channelId, entry.value.messageId) === name)?.value;
        if (prior) {
            if (prior.workspaceId !== workspaceId || prior.processId !== process.id) {
                throw new Error('Teams follow-up binding identity mismatch');
            }
            return { duplicate: true, taskId: prior.taskId };
        }
        this.ensureCapacity(workspaceId);
        const file = bindingPath(this.deps.dataDir, workspaceId, name);
        const taskId = process.metadata?.queueTaskId;
        const value: AnswerBinding = {
            version: 1, workspaceId, teamId: target.teamId, channelId: msg.channelId,
            messageId: msg.messageId, rootId: msg.replyToMessageId || msg.messageId,
            taskId: reservedTaskId ?? (typeof taskId === 'string' ? taskId : process.id),
            processId: process.id, requestId: randomUUID(), status: 'admitting',
            ...(admissionOnly ? { admissionOnly: true as const } : {}),
            createdAt: new Date().toISOString(),
        };
        atomicWriteJsonUnique(file, value);
        this.bindings.set(file, { file, value });
        try {
            const result = await admit(value.requestId!);
            if (result.taskId) this.update(file, 'admitting', { taskId: result.taskId });
            return { duplicate: false, taskId: value.taskId };
        } catch (error) {
            if (reservedTaskId && !this.deps.queue.getTask(reservedTaskId)) {
                this.discardRejected(file, error);
            } else {
                console.error('[teams-answer-relay] Follow-up admission outcome requires reconciliation');
            }
            throw error;
        }
    }

    async admitPendingFollowUp(
        msg: InboundTeamsMessage,
        selectedTaskId: string,
        enqueue: (workspaceId: string, processId: string, requestId: string, taskId: string) => Promise<string>,
        message = msg.text.trim(),
        admissionOnly = false,
    ): Promise<{ duplicate: boolean } | null> {
        if (this.disposed || (!this.deps.isEnabled() && !admissionOnly)) return null;
        const target = this.deps.target();
        if (!target.connected || !target.teamId || target.channelId !== msg.channelId || !msg.messageId) {
            throw new Error('Teams topic is unavailable');
        }
        const parent = [...this.bindings.values()].find(({ value }) =>
            !value.requestId && (value.taskId === selectedTaskId || value.processId === selectedTaskId)
            && value.teamId === this.deps.target().teamId && value.channelId === msg.channelId)?.value;
        if (!parent) return null;
        return this.withOwnerAdmission(parent.workspaceId, parent.processId, () =>
            this.startPendingFollowUp(msg, selectedTaskId, enqueue, message, admissionOnly));
    }

    private async startPendingFollowUp(
        msg: InboundTeamsMessage, selectedTaskId: string,
        enqueue: (workspaceId: string, processId: string, requestId: string, taskId: string) => Promise<string>,
        message: string, admissionOnly: boolean,
    ): Promise<{ duplicate: boolean } | null> {
        if (this.disposed || (!this.deps.isEnabled() && !admissionOnly)) return null;
        const target = this.deps.target();
        if (!target.connected || !target.teamId || target.channelId !== msg.channelId || !msg.messageId) {
            throw new Error('Teams topic is unavailable');
        }
        if (msg.replyToMessageId) {
            const bound = await this.resolveThread(msg);
            if (!bound?.taskId || bound.taskId !== selectedTaskId) {
                throw new Error('Teams thread chat is unavailable');
            }
        }
        const parent = [...this.bindings.values()].find(({ value }) =>
            !value.requestId && (value.taskId === selectedTaskId || value.processId === selectedTaskId)
            && value.teamId === target.teamId && value.channelId === msg.channelId)?.value;
        if (!parent) return null;
        if (parent.releaseState) throw new Error('Teams topic binding is unavailable');
        const task = this.deps.queue.getTask(parent.taskId);
        if (!task || task.id !== parent.taskId || !['queued', 'running'].includes(task.status)
            || task.repoId !== parent.workspaceId || task.processId !== parent.processId
            || parent.processId !== toQueueProcessId(parent.taskId)
            || task.type !== 'chat' || task.payload?.kind !== 'chat'
            || task.payload.workspaceId !== parent.workspaceId
            || task.payload.processId || task.payload.relayRequestId
            || !(await this.deps.store.getWorkspaces()).some(ws => ws.id === parent.workspaceId)) {
            throw new Error('Teams topic is unavailable');
        }
        if (task.botControl !== undefined && validateBotControlMetadata(task.botControl).source !== 'teams') {
            throw new Error('Teams topic has competing bot control');
        }
        const process = await this.deps.store.getProcess(parent.processId, parent.workspaceId);
        if (process && (process.id !== parent.processId || process.metadata?.workspaceId !== parent.workspaceId
            || ['failed', 'cancelled'].includes(process.status))) {
            throw new Error('Teams topic is unavailable');
        }
        if (process?.metadata?.botControl !== undefined
            && validateBotControlMetadata({ ...process.metadata.botControl, externalThreadUrl: undefined }).source !== 'teams') {
            throw new Error('Teams topic has competing bot control');
        }
        const name = bindingName(parent.teamId, msg.channelId, msg.messageId);
        const prior = [...this.bindings.values()].find(({ value }) =>
            value.teamId === parent.teamId && value.channelId === msg.channelId && value.messageId === msg.messageId)?.value;
        if (prior) {
            if (prior.workspaceId !== parent.workspaceId || prior.processId !== parent.processId || !prior.requestId) {
                throw new Error('Teams follow-up binding identity mismatch');
            }
            return { duplicate: true };
        }
        this.ensureCapacity(parent.workspaceId);
        const file = bindingPath(this.deps.dataDir, parent.workspaceId, name);
        const requestId = randomUUID();
        const taskId = randomUUID();
        const value: AnswerBinding = {
            version: 1, workspaceId: parent.workspaceId, teamId: parent.teamId,
            channelId: parent.channelId, messageId: msg.messageId,
            rootId: msg.replyToMessageId || msg.messageId, processId: parent.processId,
            taskId, requestId, status: 'admitting', createdAt: new Date().toISOString(),
            ...(admissionOnly ? { admissionOnly: true as const } : {}),
        };
        atomicWriteJsonUnique(file, value);
        this.bindings.set(file, { file, value });
        try {
            if (await enqueue(parent.workspaceId, parent.processId, requestId, taskId) !== taskId) {
                throw new Error('Queue returned a different task ID');
            }
            return { duplicate: false };
        } catch (error) {
            const admitted = this.deps.queue.getTask(taskId);
            if (admitted?.id === taskId && admitted.repoId === parent.workspaceId
                && admitted.processId === parent.processId && admitted.type === 'chat'
                && admitted.payload?.kind === 'chat' && admitted.payload.workspaceId === parent.workspaceId
                && admitted.payload.processId === parent.processId && admitted.payload.prompt === message
                && admitted.payload.relayRequestId === requestId && admitted.botControl === undefined) {
                console.error('[teams-answer-relay] Pending follow-up observer failed; admission retained');
                return { duplicate: false };
            }
            if (!admitted) {
                this.discardRejected(file, error);
            }
            console.error('[teams-answer-relay] Pending follow-up admission requires reconciliation');
            throw error;
        }
    }

    async acknowledgedMessage(msg: InboundTeamsMessage): Promise<void> {
        const target = this.deps.target();
        const taskIds: string[] = [];
        for (const [file, { value }] of this.bindings) {
            if (value.messageId !== msg.messageId || value.channelId !== msg.channelId
                || value.teamId !== target.teamId || value.status !== 'admitting') continue;
            this.update(file, 'awaiting');
            taskIds.push(value.taskId);
        }
        for (const taskId of taskIds) await this.reconcileTask(taskId);
    }

    async reconcile(): Promise<void> {
        let failure: TeamsBindingReleaseError | undefined;
        try {
            await this.reconcileReleases();
        } catch (error) {
            if (!(error instanceof TeamsBindingReleaseError)) throw error;
            failure = error;
        }
        for (const { value } of this.bindings.values()) await this.reconcileTask(value.taskId);
        if (failure) throw failure;
    }

    async reconcileReleases(): Promise<void> {
        const failures: TeamsBindingReleaseError['failures'] = [];
        const attempted = new Set<string>();
        for (const { value } of this.bindings.values()) {
            if (value.releaseState !== 'releasing') continue;
            const key = JSON.stringify([value.workspaceId, value.processId]);
            if (attempted.has(key)) continue;
            attempted.add(key);
            try {
                await this.removeBinding(value.workspaceId, value.teamId, value.channelId, value.messageId);
            } catch (error) {
                failures.push({ workspaceId: value.workspaceId, processId: value.processId, error });
            }
        }
        if (failures.length) throw new TeamsBindingReleaseError(failures);
    }

    /** Explicit owner removal; delivery compaction and selection never invoke release. */
    async removeBinding(workspaceId: string, teamId: string, channelId: string, messageId: string): Promise<void> {
        const file = bindingPath(this.deps.dataDir, workspaceId, bindingName(teamId, channelId, messageId));
        const entry = this.bindings.get(file);
        if (!entry) throw new Error('Teams binding release target is unavailable');
        const processId = entry.value.processId;
        await this.ownerAdmission.runExclusive(processId, async () => {
            const binding = this.bindings.get(file)!.value;
            if (binding.releaseState === 'released') return;
            const rows = [...this.bindings.values()].map(row => row.value)
                .filter(row => row.workspaceId === workspaceId && row.processId === processId);
            if (rows.some(row => row !== binding && row.releaseState === undefined)) {
                this.update(file, binding.status, { releaseState: 'released' });
                return;
            }
            const replace = this.deps.queue.replaceBotControl;
            if (!replace) throw new Error('Teams binding release lifecycle is unavailable');
            const origin = rows.find(row => toQueueProcessId(row.taskId) === processId);
            await releaseBotControlledConversation(this.deps.store, {
                getTask: id => this.deps.queue.getTask(id),
                replaceBotControl: (id, expected, replacement) => replace.call(this.deps.queue, id, expected, replacement),
            }, workspaceId, processId, 'teams', origin?.taskId, async () => {
                this.update(file, binding.status, { releaseState: 'released' });
            }, () => this.update(file, binding.status, { releaseState: 'releasing' }));
        });
    }

    private withOwnerAdmission<T>(workspaceId: string, processId: string, operation: () => Promise<T>): Promise<T> {
        return this.ownerAdmission.runExclusive(processId, async () => {
            if ([...this.bindings.values()].some(({ value }) => value.workspaceId === workspaceId
                && value.processId === processId && value.releaseState === 'releasing')) {
                throw new Error('Teams conversation binding release is pending');
            }
            return operation();
        });
    }

    private discardRejected(file: string, admissionError: unknown): void {
        try {
            fs.unlinkSync(file);
            this.bindings.delete(file);
        } catch (rollbackError) {
            throw Object.assign(new Error('Teams admission receipt rollback failed'), {
                errors: [admissionError, rollbackError],
            });
        }
    }

    async reconnected(): Promise<void> {
        await this.reconcile();
        this.scheduleRetry();
        await this.deps.onReconnected?.();
    }

    async reconcileTask(taskId: string): Promise<void> {
        if (this.disposed || !this.deps.isEnabled() || !this.deps.target().connected) return;
        for (const [file, { value }] of this.bindings) {
            if (value.releaseState || value.admissionOnly || value.taskId !== taskId || !['awaiting', 'retryable'].includes(value.status)
                || (value.nextAttemptAt && Date.parse(value.nextAttemptAt) > Date.now()) || this.active.has(file)) continue;
            this.active.add(file);
            try {
                await this.deliver(file, value);
            } finally {
                this.active.delete(file);
            }
        }
    }

    private async reconcileProcess(processId: string | undefined, taskId: string): Promise<void> {
        if (!processId) {
            await this.reconcileTask(taskId);
            return;
        }
        const ids = new Set([...this.bindings.values()]
            .filter(({ value }) => value.processId === processId)
            .map(({ value }) => value.taskId));
        ids.add(taskId);
        for (const id of ids) await this.reconcileTask(id);
    }

    private hasThreadSwitched(binding: AnswerBinding): boolean {
        const root = [...this.bindings.values()].find(({ value }) =>
            value.messageId === value.rootId && value.teamId === binding.teamId && value.channelId === binding.channelId
            && value.messageId === binding.rootId)?.value;
        const selected = this.threadSelections.get(bindingName(binding.teamId, binding.channelId, binding.rootId))?.value;
        const activeProcessId = selected ? selected.processId
            : root && root.selectedProcessId !== undefined ? root.selectedProcessId : root?.processId;
        return !!(root || selected)
            && ((selected?.workspaceId ?? root?.selectedWorkspaceId ?? root?.workspaceId) !== binding.workspaceId
                || (activeProcessId !== undefined && activeProcessId !== binding.processId));
    }

    private async sourceLabel(binding: AnswerBinding, process: AIProcess | undefined): Promise<string> {
        const saved = binding.sourceContext ?? binding.answerContext;
        if (saved) return saved;
        const workspace = (await this.deps.store.getWorkspaces()).find(w => w.id === binding.workspaceId);
        return `Repo ${workspace?.name ?? 'unavailable'} · Chat ${process?.title ?? process?.customTitle ?? createHash('sha256').update(binding.processId).digest('hex').slice(0, 8)}`.slice(0, 140);
    }

    private async deliver(file: string, binding: AnswerBinding): Promise<void> {
        if (this.bindings.get(file)?.value.releaseState) return;
        const candidate = this.deps.queue.getTask(binding.taskId);
        const task = binding.requestId
            ? (candidate?.payload?.relayRequestId === binding.requestId ? candidate
                : this.deps.queue.getAll?.().find(queued => queued.payload?.relayRequestId === binding.requestId
                    && queued.repoId === binding.workspaceId && queued.processId === binding.processId))
            : candidate;
        if (binding.requestId && task
            && (task.repoId !== binding.workspaceId || task.processId !== binding.processId)) return;
        if (binding.requestId && task?.payload?.relayRequestId === binding.requestId
            && isTerminalStatus(task.status) && !binding.terminalStatus) {
            this.update(file, binding.status, {
                taskId: task.id, terminalStatus: task.status,
            });
            binding = this.bindings.get(file)!.value;
        }
        const process = await this.deps.store.getProcess(binding.processId, binding.workspaceId);
        if (process && (process.id !== binding.processId || process.metadata?.workspaceId !== binding.workspaceId)) return;
        if (!binding.requestId && (
            (task && (task.repoId !== binding.workspaceId || (task.processId && task.processId !== binding.processId)))
            || (process && process.metadata?.queueTaskId !== binding.taskId)
            || (!task && !process && !binding.terminalStatus)
            || !isTerminalStatus(task?.status ?? binding.terminalStatus ?? process?.status)
            || (task?.status === 'completed' && !process)
        )) return;
        if (binding.requestId && !process) return;
        const turns = process?.conversationTurns ?? [];
        const userIndex = binding.requestId
            ? findRequestTurn(turns, binding.requestId)
            : turns[0]?.role === 'user' ? 0 : -1;
        if (userIndex < 0 && !['cancelled', 'failed'].includes(task?.status ?? binding.terminalStatus ?? '')) return;
        const { answer, closed } = findRequestAnswer(turns, userIndex);
        const persistedTerminal = binding.requestId && !closed
            && (process?.status === 'failed' || process?.status === 'cancelled')
            ? process.status : undefined;
        if (binding.requestId && !binding.terminalStatus && !persistedTerminal
            && !(answer && process?.status === 'completed')) return;
        const failureText = findRequestFailureText(turns, userIndex,
            process?.status === 'failed' ? process.error : undefined);
        let text: string;
        if (!binding.requestId && (task?.status ?? binding.terminalStatus ?? process?.status) === 'cancelled') {
            text = RELAY_ANSWER_TEXT.cancelled;
        } else if (!binding.requestId && (task?.status ?? binding.terminalStatus ?? process?.status) === 'failed') {
            text = failureText;
        } else if (binding.requestId && (binding.terminalStatus ?? persistedTerminal) === 'cancelled') {
            text = RELAY_ANSWER_TEXT.cancelled;
        } else if (binding.requestId && (binding.terminalStatus ?? persistedTerminal) === 'failed') {
            text = failureText;
        } else if (answer && typeof answer.content === 'string') {
            text = answer.content.trim() ? answer.content : RELAY_ANSWER_TEXT.empty;
        } else if (binding.requestId && userIndex < 0) {
            return;
        } else if ((task?.status ?? process?.status) === 'cancelled' && (!binding.requestId || process?.status === 'cancelled')) {
            text = RELAY_ANSWER_TEXT.cancelled;
        } else if ((task?.status ?? process?.status) === 'failed' && (!binding.requestId || process?.status === 'failed')) {
            text = failureText;
        } else {
            return;
        }
        const switched = this.hasThreadSwitched(binding);
        const label = answerLabel(binding);
        const plainParts = !binding.answerHash && !switched
            ? formatTeamsAnswerChunks(text, label) : undefined;
        const needsContext = switched || !!binding.answerContext || !!binding.sourceContext
            || (plainParts !== undefined && plainParts.length > 1);
        let sourceContext = needsContext ? await this.sourceLabel(binding, process) : undefined;
        const legacyContinuation = !!(binding.answerHash && (binding.nextPart ?? 0) > 0
            && !binding.sourceContext && !binding.answerContext);
        const context = binding.answerContext ?? (switched && !legacyContinuation ? sourceContext : undefined);
        let notice = legacyContinuation && switched && !binding.continuationNoticeSent && sourceContext
            ? `<p><strong>Request ${label} · Continuation</strong></p><p>${escapeTeamsHtml(sourceContext)}</p>`
            : undefined;
        const parts = plainParts && !sourceContext ? plainParts : formatTeamsAnswerChunks(
            text, label, context, !binding.answerHash || binding.sourceContext ? sourceContext : undefined,
        );
        if (binding.answerHash && !binding.attribution && (binding.nextPart ?? 0) > 0) {
            const savedParts = formatTeamsAnswerChunks(
                text, label, context, binding.sourceContext ? sourceContext : undefined, 'legacy',
            );
            // Equal part counts alone do not prove that a confirmed boundary is unchanged.
            if (savedParts.length !== parts.length || savedParts.some((part, index) => part !== parts[index])) {
                this.update(file, 'ambiguous');
                console.error('[teams-answer-relay] Saved chunk boundaries changed; manual reconciliation required');
                return;
            }
        }
        const answerHash = createHash('sha256').update(text).digest('hex');
        if (binding.answerHash && (binding.answerHash !== answerHash
            || ((binding.nextPart ?? 0) > 0 && binding.partCount !== parts.length))) {
            this.update(file, 'ambiguous');
            console.error('[teams-answer-relay] Saved answer changed during delivery');
            return;
        }
        if (!binding.answerHash || (binding.nextPart ?? 0) === 0
            && (binding.partCount !== parts.length || binding.answerContext !== context)) {
            this.update(file, 'awaiting', {
                answerHash, attribution: 'compact', partCount: parts.length, nextPart: 0,
                ...(sourceContext ? { sourceContext } : {}),
                ...(context ? { answerContext: context.slice(0, 140) } : {}),
            });
        } else if (!binding.attribution || (binding.sourceContext && context && binding.answerContext !== context)) {
            this.update(file, 'awaiting', {
                attribution: 'compact',
                ...(binding.sourceContext && context ? { answerContext: context } : {}),
            });
        }
        const startPart = binding.nextPart ?? 0;
        let resumePart = startPart;
        let noticeSent = !!binding.continuationNoticeSent;
        let sendingParts = parts;
        for (let index = notice ? -1 : startPart; index < parts.length; index = index < 0 ? resumePart : index + 1) {
            const target = this.deps.target();
            if (!target.connected || target.teamId !== binding.teamId || target.channelId !== binding.channelId
                || !this.deps.isEnabled() || this.disposed || this.bindings.get(file)?.value.releaseState) return;
            if (index > 0 && !sourceContext && !noticeSent && this.hasThreadSwitched(binding)) {
                sourceContext = await this.sourceLabel(binding, process);
                notice = `<p><strong>Request ${label} · Continuation</strong></p><p>${escapeTeamsHtml(sourceContext)}</p>`;
                resumePart = index;
                index = -1;
            }
            if (index >= 0 && !context && sourceContext && (!binding.answerHash || !!binding.sourceContext)
                && sendingParts === parts && this.hasThreadSwitched(binding)) {
                sendingParts = formatTeamsAnswerChunks(text, label, sourceContext, sourceContext);
                if (sendingParts.length !== parts.length) {
                    this.update(file, 'ambiguous');
                    console.error('[teams-answer-relay] Saved answer changed during delivery');
                    return;
                }
                this.update(file, 'awaiting', { answerContext: sourceContext });
            }
            this.update(file, 'sending');
            let sendStarted = false;
            try {
                const beforeSend = this.deps.target();
                if (this.disposed || !this.deps.isEnabled() || this.bindings.get(file)?.value.releaseState || !beforeSend.connected
                    || beforeSend.teamId !== binding.teamId || beforeSend.channelId !== binding.channelId) {
                    this.update(file, 'awaiting');
                    return;
                }
                sendStarted = true;
                const acceptedId = await this.deps.send(index < 0 ? notice! : sendingParts[index], binding.rootId);
                if (!/^[A-Za-z0-9:_@.-]{1,256}$/.test(acceptedId)) {
                    this.update(file, 'ambiguous');
                    console.error('[teams-answer-relay] Send confirmation missing; manual reconciliation required');
                    return;
                }
                this.update(file, index === parts.length - 1 ? 'delivered' : 'awaiting',
                    index < 0 ? { continuationNoticeSent: true, acceptedMessageId: acceptedId }
                        : { nextPart: index + 1, acceptedMessageId: acceptedId });
                if (index < 0) noticeSent = true;
                if (index === parts.length - 1) this.compact();
            } catch (error) {
                if (!sendStarted) {
                    this.update(file, 'awaiting');
                    console.error('[teams-answer-relay] Send was not started');
                } else if (error instanceof TeamsMessageNotSentError || error instanceof TeamsMcpSendRejectedError
                    || (error instanceof TeamsOperationError && error.outcome !== 'unknown')) {
                    const retryCount = (this.bindings.get(file)?.value.retryCount ?? 0) + 1;
                    if (retryCount >= 5) {
                        this.update(file, 'failed', { retryCount });
                        console.error('[teams-answer-relay] Definite send rejection exceeded retry budget');
                    } else {
                        const retryAfterMs = error instanceof TeamsOperationError && Number.isFinite(error.retryAfterMs)
                            ? Math.max(0, Math.min(2_147_483_647, error.retryAfterMs!)) : 0;
                        this.update(file, 'retryable', {
                            retryCount,
                            nextAttemptAt: new Date(Date.now() + Math.max(retryAfterMs,
                                Math.min(60_000, 1_000 * 2 ** (retryCount - 1)))).toISOString(),
                        });
                        this.scheduleRetry();
                    }
                } else {
                    this.update(file, 'ambiguous');
                    console.error('[teams-answer-relay] Send outcome ambiguous; manual reconciliation required');
                }
                return;
            }
        }
    }

    private scheduleRetry(): void {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        if (this.disposed || !this.deps.isEnabled()) return;
        const next = [...this.bindings.values()]
            .filter(entry => entry.value.status === 'retryable' && entry.value.nextAttemptAt)
            .map(entry => Date.parse(entry.value.nextAttemptAt!))
            .reduce((min, time) => Math.min(min, time), Infinity);
        if (!Number.isFinite(next)) return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            void this.reconcile().catch(() => console.error('[teams-answer-relay] Retry reconciliation failed'));
        }, Math.max(1, next - Date.now()));
        this.retryTimer.unref();
    }

    private update(file: string, status: BindingStatus, patch: Partial<AnswerBinding> = {}): void {
        const entry = this.bindings.get(file);
        if (!entry) throw new Error('Teams answer binding missing');
        const value = { ...entry.value, status, ...patch };
        atomicWriteJsonUnique(file, value);
        this.bindings.set(file, { file, value });
    }

    private ensureCapacity(workspaceId: string): void {
        if ([...this.bindings.values()].filter(({ value }) =>
            value.workspaceId === workspaceId && !value.releaseState && value.status !== 'delivered').length >= 5_000) {
            throw new Error('Teams answer relay capacity reached');
        }
    }

    private compact(): void {
        const retentionCutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000;
        const delivered = [...this.bindings.values()]
            .filter(({ value }) => value.status === 'delivered')
            .sort((a, b) => Date.parse(b.value.createdAt) - Date.parse(a.value.createdAt));
        const liveOwners = new Set([...this.bindings.values()]
            .filter(({ value }) => !value.releaseState && (!value.requestId || value.messageId === value.rootId))
            .map(({ value }) => JSON.stringify([value.workspaceId, value.processId])));
        const counts = new Map<string, number>();
        for (const { file, value } of delivered) {
            const count = (counts.get(value.workspaceId) ?? 0) + 1;
            counts.set(value.workspaceId, count);
            if (value.releaseState || !value.requestId || value.messageId === value.rootId
                || !liveOwners.has(JSON.stringify([value.workspaceId, value.processId]))
                || (Date.parse(value.createdAt) >= retentionCutoff && count <= 2_000)) continue;
            try {
                fs.unlinkSync(file);
                this.bindings.delete(file);
            } catch {
                console.error('[teams-answer-relay] Failed to compact delivered receipt');
            }
        }
    }

    /** Posts relayed ask_user questions as replies in the thread of the request that started the turn. */
    questionTransport(): QuestionTransport {
        const find = (request: { processId: string; requestId: string }) => [...this.bindings.values()]
            .map(({ value }) => value)
            .find(value => value.releaseState === undefined && !value.admissionOnly && value.processId === request.processId
                && (value.requestId ? value.requestId === request.requestId : value.taskId === request.requestId));
        return {
            platform: 'teams',
            locate: request => {
                if (request.origin) {
                    const target = this.deps.target();
                    return !this.disposed && this.deps.isEnabled() && target.connected && target.teamId && target.channelId
                        && teamsQuestionChatKey(target.teamId, target.channelId) === request.origin.chatKey
                        ? { chatKey: request.origin.chatKey, threadId: request.origin.threadId } : undefined;
                }
                const binding = find(request);
                return binding
                    ? { chatKey: teamsQuestionChatKey(binding.teamId, binding.channelId), threadId: binding.rootId }
                    : undefined;
            },
            post: async (target, layout, request) => {
                const current = this.deps.target();
                const binding = find(request);
                if ((!request.origin && (!binding || binding.rootId !== target.threadId
                    || teamsQuestionChatKey(binding.teamId, binding.channelId) !== target.chatKey))
                    || this.disposed || !this.deps.isEnabled() || !current.connected || !current.teamId || !current.channelId
                    || teamsQuestionChatKey(current.teamId, current.channelId) !== target.chatKey) {
                    throw new TeamsMessageNotSentError();
                }
                return this.deps.send(formatTeamsQuestion(layout), target.threadId);
            },
        };
    }

    /**
     * Posts job completion notices as their own top-level channel posts and
     * binds each as a thread root selecting the job: replies route by thread
     * root, so a reply in the notice's thread continues the job, while a
     * notice inside the dispatcher's thread would route back to the dispatcher.
     */
    noticeTransport(): JobNoticeTransport {
        const connected = (chatKey: string) => {
            const target = this.deps.target();
            return !this.disposed && this.deps.isEnabled() && target.connected && !!target.teamId && !!target.channelId
                && teamsQuestionChatKey(target.teamId, target.channelId) === chatKey;
        };
        return {
            platform: 'teams',
            connected,
            post: async (chatKey, notice) => {
                if (!connected(chatKey)) return undefined;
                const { line, detail } = formatJobNotice(notice);
                let id: string | undefined;
                try {
                    const bodies = notice.desktopResult?.chunks ?? (notice.body !== undefined ? formatTeamsAnswerChunks(notice.body, 'result', line)
                        : [`<p>${escapeTeamsHtml(line)}</p>${detail ? `<p>${escapeTeamsHtml(detail)}</p>` : ''}`]);
                    for (const [index, body] of bodies.entries()) {
                        if (!connected(chatKey) || (notice.desktopResult
                            ? !await notice.desktopResult.beforePart(index) : notice.beforeSend && !await notice.beforeSend())) {
                            if (!id) return undefined;
                            throw new Error('Teams route unavailable after partial result delivery');
                        }
                        const sent = notice.threadId ? await this.deps.send(body, notice.threadId) : await this.deps.send(body);
                        if (!/^[A-Za-z0-9:_@.-]{1,256}$/.test(sent)) throw new Error('Teams send confirmation missing');
                        id = sent;
                        if (notice.operation !== 'compact' && !notice.threadId) {
                            this.saveThreadSelection(this.deps.target().channelId!, id, notice.workspaceId, notice.processId);
                        }
                    }
                } catch (error) {
                    if (!id && (error instanceof TeamsMessageNotSentError || error instanceof TeamsMcpSendRejectedError)) return undefined;
                    throw error;
                }
                return id;
            },
        };
    }

    dispose(): void {
        this.disposed = true;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.unsubscribeTerminal();
    }
}
