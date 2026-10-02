import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { toQueueProcessId, type AIProcess, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsMcpSendRejectedError } from '@plusplusoneplusplus/coc-connector/teams';
import { getRepoDataPath } from '../paths';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { formatTeamsAnswerChunks } from './teams-answer-format';
import { TeamsMessageNotSentError } from './teams-messaging-manager';
import { escapeTeamsHtml } from './teams-outbound-format';
import { onTaskTerminal } from './chat-target';

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
    partCount?: number;
    nextPart?: number;
    answerHash?: string;
    answerContext?: string;
    sourceContext?: string;
    continuationNoticeSent?: boolean;
    acceptedMessageId?: string;
    sentMessageIds?: string[];
    lastReplyAt?: string;
    lastReplyIds?: string[];
    retryCount?: number;
    nextAttemptAt?: string;
    terminalStatus?: 'completed' | 'failed' | 'cancelled';
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
    queue: Pick<ScheduleQueueEventBus, 'on' | 'off' | 'getTask'> & { getAll?: () => QueuedTask[] };
    isEnabled: () => boolean;
    target: () => { connected: boolean; teamId?: string; channelId?: string };
    send: (text: string, rootId: string) => Promise<string>;
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
    return new RegExp(`(?:^|>)Request ${label} \u00b7 Part [1-9]\\d*/[1-9]\\d*(?:<|\\s|$)`).test(text);
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
        || (row.selectedWorkspaceId !== undefined && (typeof row.selectedWorkspaceId !== 'string' || !row.selectedWorkspaceId))
        || (row.selectedProcessId !== undefined && row.selectedProcessId !== null
            && (typeof row.selectedProcessId !== 'string' || !row.selectedProcessId))
        || (row.selectedTaskId !== undefined && (typeof row.selectedTaskId !== 'string' || !row.selectedTaskId))
        || (row.commandIds !== undefined && (!Array.isArray(row.commandIds)
            || row.commandIds.some(id => typeof id !== 'string' || !id)))
        || (row.answerHash !== undefined && (typeof row.answerHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.answerHash)))
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
        || (row.terminalStatus !== undefined && !['completed', 'failed', 'cancelled'].includes(String(row.terminalStatus)))
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
    private readonly active = new Set<string>();
    private disposed = false;
    private retryTimer: NodeJS.Timeout | undefined;
    private readonly onTerminal = (task: QueuedTask) => {
        try {
            if (typeof task.payload?.relayRequestId === 'string'
                && ['completed', 'failed', 'cancelled'].includes(task.status)) {
                for (const [file, { value }] of this.bindings) {
                    if (value.requestId !== task.payload.relayRequestId) continue;
                    if (value.workspaceId !== task.repoId || value.processId !== task.processId) continue;
                    this.update(file, value.status, {
                        taskId: task.id,
                        terminalStatus: task.status as 'completed' | 'failed' | 'cancelled',
                    });
                }
            } else if (['completed', 'failed', 'cancelled'].includes(task.status)) {
                for (const [file, { value }] of this.bindings) {
                    if (value.requestId || value.taskId !== task.id
                        || value.workspaceId !== task.repoId
                        || (task.processId && value.processId !== task.processId)) continue;
                    this.update(file, value.status, {
                        terminalStatus: task.status as 'completed' | 'failed' | 'cancelled',
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

    hasInbound(msg: InboundTeamsMessage): boolean {
        const target = this.deps.target();
        return [...this.bindings.values()].some(({ value }) =>
            value.teamId === target.teamId && value.channelId === msg.channelId
            && value.messageId === msg.messageId);
    }

    threadRoots(teamId: string, channelId: string): string[] {
        return [...new Set([...this.bindings.values()]
            .filter(({ value }) => value.teamId === teamId && value.channelId === channelId
                && !value.requestId && value.messageId === value.rootId)
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
            !value.requestId && value.teamId === target.teamId && value.channelId === msg.channelId
            && value.messageId === msg.replyToMessageId);
    }

    getThreadSelection(msg: InboundTeamsMessage): { workspaceId: string } | null {
        const target = this.deps.target();
        if (!msg.replyToMessageId || !target.teamId || target.channelId !== msg.channelId) return null;
        const root = this.rootEntry(msg)?.[1].value;
        const state = this.threadSelections.get(bindingName(target.teamId, msg.channelId, msg.replyToMessageId))?.value;
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
        if (!root && !state) return null;
        const workspaceId = state?.workspaceId ?? root?.selectedWorkspaceId ?? root!.workspaceId;
        if (!(await this.deps.store.getWorkspaces()).some(ws => ws.id === workspaceId)) {
            throw new Error('Teams thread workspace is unavailable');
        }
        if (state?.processId === null || (!state && root?.selectedProcessId === null)) return { workspaceId };
        const processId = state?.processId ?? root?.selectedProcessId ?? root?.processId;
        if (!processId) return { workspaceId };
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

    async selectThreadTarget(msg: InboundTeamsMessage, workspaceId: string, processId: string | null): Promise<void> {
        if (this.disposed || !this.deps.isEnabled()) throw new Error('Teams thread selection is unavailable');
        const target = this.deps.target();
        if (!target.connected || !target.teamId || target.channelId !== msg.channelId || !msg.replyToMessageId) {
            throw new Error('Teams thread target is unavailable');
        }
        if (!(await this.deps.store.getWorkspaces()).some(ws => ws.id === workspaceId)) {
            throw new Error('Teams thread workspace is unavailable');
        }
        if (processId) {
            const process = await this.deps.store.getProcess(processId, workspaceId);
            if (!process || process.id !== processId || process.metadata?.workspaceId !== workspaceId
                || ['failed', 'cancelled'].includes(process.status)) {
                throw new Error('Teams thread chat is unavailable');
            }
        }
        this.saveThreadSelection(msg, workspaceId, processId, undefined, msg.messageId);
    }

    private saveThreadSelection(msg: InboundTeamsMessage, workspaceId: string, processId: string | null, taskId?: string, commandId?: string): void {
        const teamId = this.deps.target().teamId!;
        const name = bindingName(teamId, msg.channelId, msg.replyToMessageId!);
        const existing = this.threadSelections.get(name);
        const file = getRepoDataPath(this.deps.dataDir, workspaceId, path.join('teams-thread-roots', name));
        const value: ThreadSelection = {
            version: 1, teamId, channelId: msg.channelId, rootId: msg.replyToMessageId!,
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
        this.saveThreadSelection(msg, workspaceId, toQueueProcessId(taskId), taskId);
        return this.admitNew(msg, workspaceId, enqueue, taskId);
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
            !value.requestId && value.messageId === msg.replyToMessageId
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
            if (value.requestId || value.messageId !== msg.replyToMessageId
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
            if (value.requestId || value.teamId !== teamId || value.channelId !== channelId
                || value.rootId !== rootId || value.sentMessageIds?.includes(messageId)) continue;
            this.update(file, value.status, { sentMessageIds: [...(value.sentMessageIds ?? []), messageId] });
            break;
        }
    }

    async restore(): Promise<void> {
        const seen = new Map<string, string>();
        const conflicts = new Set<string>();
        const discovery = path.join(this.deps.dataDir, 'teams-thread-discovery');
        if (fs.existsSync(discovery)) {
            for (const name of fs.readdirSync(discovery).filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
                try {
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
                } catch {
                    console.error('[teams-answer-relay] Invalid discovered thread root');
                }
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
                    try {
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
                    } catch {
                        console.error('[teams-answer-relay] Invalid persisted thread root');
                    }
                }
            }
        }
        for (const workspace of workspaces) {
            const folder = getRepoDataPath(this.deps.dataDir, workspace.id, 'teams-answer-relay');
            if (!fs.existsSync(folder)) continue;
            for (const name of fs.readdirSync(folder).filter(n => /^[a-f0-9]{64}\.json$/.test(n))) {
                const file = path.join(folder, name);
                try {
                    const value = readBinding(file);
                    if (value?.workspaceId === workspace.id
                        && bindingName(value.teamId, value.channelId, value.messageId) === name) {
                        const first = seen.get(name);
                        if (first) {
                            conflicts.add(name);
                            this.bindings.delete(first);
                            console.error('[teams-answer-relay] Conflicting workspace bindings require reconciliation');
                        } else if (!conflicts.has(name)) {
                            seen.set(name, file);
                            this.bindings.set(file, { file, value });
                        }
                    } else {
                        console.error('[teams-answer-relay] Binding identity mismatch');
                    }
                } catch {
                    console.error('[teams-answer-relay] Invalid persisted binding');
                }
            }
        }
        this.compact();
        for (const [file, { value }] of this.bindings) {
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
    ): Promise<{ taskId: string; duplicate: boolean }> {
        if (this.disposed || !this.deps.isEnabled()) throw new Error('Teams answer relay is unavailable');
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
            createdAt: new Date().toISOString(),
        };
        atomicWriteJsonUnique(file, value);
        this.bindings.set(file, { file, value });
        try {
            if (await enqueue(taskId) !== taskId) throw new Error('Queue returned a different task ID');
            return { taskId, duplicate: false };
        } catch (error) {
            // Keep the receipt until reconciliation: an enqueue could have
            // succeeded before its caller observed an error.
            console.error('[teams-answer-relay] Admission outcome requires reconciliation');
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
    ): Promise<{ duplicate: boolean; taskId: string }> {
        if (this.disposed || !this.deps.isEnabled()) throw new Error('Teams answer relay is unavailable');
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
        if (prior) return { duplicate: true, taskId: prior.taskId };
        this.ensureCapacity(workspaceId);
        const file = bindingPath(this.deps.dataDir, workspaceId, name);
        const taskId = process.metadata?.queueTaskId;
        const value: AnswerBinding = {
            version: 1, workspaceId, teamId: target.teamId, channelId: msg.channelId,
            messageId: msg.messageId, rootId: msg.replyToMessageId || msg.messageId,
            taskId: typeof taskId === 'string' ? taskId : process.id,
            processId: process.id, requestId: randomUUID(), status: 'admitting',
            createdAt: new Date().toISOString(),
        };
        atomicWriteJsonUnique(file, value);
        this.bindings.set(file, { file, value });
        try {
            const result = await admit(value.requestId!);
            if (result.taskId) this.update(file, 'admitting', { taskId: result.taskId });
            return { duplicate: false, taskId: value.taskId };
        } catch (error) {
            console.error('[teams-answer-relay] Follow-up admission outcome requires reconciliation');
            throw error;
        }
    }

    async admitPendingFollowUp(
        msg: InboundTeamsMessage,
        selectedTaskId: string,
        enqueue: (workspaceId: string, processId: string, requestId: string) => Promise<string>,
    ): Promise<{ duplicate: boolean } | null> {
        if (this.disposed || !this.deps.isEnabled()) return null;
        const target = this.deps.target();
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
        const task = this.deps.queue.getTask(parent.taskId);
        if (!task || !['queued', 'running'].includes(task.status)
            || task.repoId !== parent.workspaceId || !target.connected) {
            throw new Error('Teams topic is unavailable');
        }
        const name = bindingName(parent.teamId, msg.channelId, msg.messageId);
        if ([...this.bindings.values()].some(({ value }) =>
            value.teamId === parent.teamId && value.channelId === msg.channelId && value.messageId === msg.messageId)) {
            return { duplicate: true };
        }
        this.ensureCapacity(parent.workspaceId);
        const file = bindingPath(this.deps.dataDir, parent.workspaceId, name);
        const requestId = randomUUID();
        const value: AnswerBinding = {
            version: 1, workspaceId: parent.workspaceId, teamId: parent.teamId,
            channelId: parent.channelId, messageId: msg.messageId,
            rootId: msg.replyToMessageId || msg.messageId, processId: parent.processId,
            taskId: parent.taskId, requestId, status: 'admitting', createdAt: new Date().toISOString(),
        };
        atomicWriteJsonUnique(file, value);
        this.bindings.set(file, { file, value });
        try {
            const taskId = await enqueue(parent.workspaceId, parent.processId, requestId);
            this.update(file, 'admitting', { taskId });
            return { duplicate: false };
        } catch (error) {
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
        for (const { value } of this.bindings.values()) await this.reconcileTask(value.taskId);
    }

    async reconnected(): Promise<void> {
        await this.reconcile();
        this.scheduleRetry();
    }

    async reconcileTask(taskId: string): Promise<void> {
        if (this.disposed || !this.deps.isEnabled() || !this.deps.target().connected) return;
        for (const [file, { value }] of this.bindings) {
            if (value.taskId !== taskId || !['awaiting', 'retryable'].includes(value.status)
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
            !value.requestId && value.teamId === binding.teamId && value.channelId === binding.channelId
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
        const candidate = this.deps.queue.getTask(binding.taskId);
        const task = binding.requestId
            ? (candidate?.payload?.relayRequestId === binding.requestId ? candidate
                : this.deps.queue.getAll?.().find(queued => queued.payload?.relayRequestId === binding.requestId
                    && queued.repoId === binding.workspaceId && queued.processId === binding.processId))
            : candidate;
        if (binding.requestId && task
            && (task.repoId !== binding.workspaceId || task.processId !== binding.processId)) return;
        if (binding.requestId && task?.payload?.relayRequestId === binding.requestId
            && ['completed', 'failed', 'cancelled'].includes(task.status) && !binding.terminalStatus) {
            this.update(file, binding.status, {
                taskId: task.id, terminalStatus: task.status as 'completed' | 'failed' | 'cancelled',
            });
            binding = this.bindings.get(file)!.value;
        }
        const process = await this.deps.store.getProcess(binding.processId, binding.workspaceId);
        if (process && (process.id !== binding.processId || process.metadata?.workspaceId !== binding.workspaceId)) return;
        if (!binding.requestId && (
            (task && (task.repoId !== binding.workspaceId || (task.processId && task.processId !== binding.processId)))
            || (process && process.metadata?.queueTaskId !== binding.taskId)
            || (!task && !process && !binding.terminalStatus)
            || !['completed', 'failed', 'cancelled'].includes(task?.status ?? binding.terminalStatus ?? process?.status ?? '')
            || (task?.status === 'completed' && !process)
        )) return;
        if (binding.requestId && !process) return;
        const turns = process?.conversationTurns ?? [];
        const userIndex = binding.requestId
            ? turns.findIndex(turn => turn.role === 'user' && turn.relayRequestId === binding.requestId)
            : turns[0]?.role === 'user' ? 0 : -1;
        if (userIndex < 0 && !['cancelled', 'failed'].includes(task?.status ?? binding.terminalStatus ?? '')) return;
        const next = turns.slice(userIndex + 1);
        const nextUser = next.findIndex(turn => turn.role === 'user');
        const requestTurns = nextUser < 0 ? next : next.slice(0, nextUser);
        const answer = requestTurns
            .filter(turn => turn.role === 'assistant' && !turn.interrupted && !turn.streaming && !turn.displayOnly)
            .at(-1);
        const persistedTerminal = binding.requestId && nextUser < 0
            && (process?.status === 'failed' || process?.status === 'cancelled')
            ? process.status : undefined;
        if (binding.requestId && !binding.terminalStatus && !persistedTerminal
            && !(answer && process?.status === 'completed')) return;
        let text: string;
        if (!binding.requestId && (task?.status ?? binding.terminalStatus ?? process?.status) === 'cancelled') {
            text = 'This request was cancelled.';
        } else if (!binding.requestId && (task?.status ?? binding.terminalStatus ?? process?.status) === 'failed') {
            text = 'This request could not be completed.';
        } else if (binding.requestId && (binding.terminalStatus ?? persistedTerminal) === 'cancelled') {
            text = 'This request was cancelled.';
        } else if (binding.requestId && (binding.terminalStatus ?? persistedTerminal) === 'failed') {
            text = 'This request could not be completed.';
        } else if (answer && typeof answer.content === 'string') {
            text = answer.content.trim() ? answer.content : 'This request completed without a text answer.';
        } else if (binding.requestId && userIndex < 0) {
            return;
        } else if ((task?.status ?? process?.status) === 'cancelled' && (!binding.requestId || process?.status === 'cancelled')) {
            text = 'This request was cancelled.';
        } else if ((task?.status ?? process?.status) === 'failed' && (!binding.requestId || process?.status === 'failed')) {
            text = 'This request could not be completed.';
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
                answerHash, partCount: parts.length, nextPart: 0,
                ...(sourceContext ? { sourceContext } : {}),
                ...(context ? { answerContext: context.slice(0, 140) } : {}),
            });
        } else if (binding.sourceContext && context && binding.answerContext !== context) {
            this.update(file, 'awaiting', { answerContext: context });
        }
        const startPart = binding.nextPart ?? 0;
        let resumePart = startPart;
        let noticeSent = !!binding.continuationNoticeSent;
        let sendingParts = parts;
        for (let index = notice ? -1 : startPart; index < parts.length; index = index < 0 ? resumePart : index + 1) {
            const target = this.deps.target();
            if (!target.connected || target.teamId !== binding.teamId || target.channelId !== binding.channelId
                || !this.deps.isEnabled() || this.disposed) return;
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
                if (this.disposed || !this.deps.isEnabled() || !beforeSend.connected
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
                } else if (error instanceof TeamsMessageNotSentError || error instanceof TeamsMcpSendRejectedError) {
                    const retryCount = (this.bindings.get(file)?.value.retryCount ?? 0) + 1;
                    if (retryCount >= 5) {
                        this.update(file, 'failed', { retryCount });
                        console.error('[teams-answer-relay] Definite send rejection exceeded retry budget');
                    } else {
                        this.update(file, 'retryable', {
                            retryCount,
                            nextAttemptAt: new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** (retryCount - 1))).toISOString(),
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
            value.workspaceId === workspaceId && value.status !== 'delivered').length >= 5_000) {
            throw new Error('Teams answer relay capacity reached');
        }
    }

    private compact(): void {
        const retentionCutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000;
        const delivered = [...this.bindings.values()]
            .filter(({ value }) => value.status === 'delivered')
            .sort((a, b) => Date.parse(b.value.createdAt) - Date.parse(a.value.createdAt));
        const counts = new Map<string, number>();
        for (const { file, value } of delivered) {
            const count = (counts.get(value.workspaceId) ?? 0) + 1;
            counts.set(value.workspaceId, count);
            if ((!value.requestId && value.messageId === value.rootId)
                || (Date.parse(value.createdAt) >= retentionCutoff && count <= 2_000)) continue;
            try {
                fs.unlinkSync(file);
                this.bindings.delete(file);
            } catch {
                console.error('[teams-answer-relay] Failed to compact delivered receipt');
            }
        }
    }

    dispose(): void {
        this.disposed = true;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.unsubscribeTerminal();
    }
}
