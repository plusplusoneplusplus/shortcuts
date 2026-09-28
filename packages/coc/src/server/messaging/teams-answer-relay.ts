import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { toQueueProcessId, type AIProcess, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsMcpSendRejectedError } from '@plusplusoneplusplus/coc-connector/teams';
import { getRepoDataPath } from '../paths';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { formatTeamsAnswerChunks } from './teams-answer-format';
import { TeamsMessageNotSentError } from './teams-messaging-manager';

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
    requestId?: string;
    partCount?: number;
    nextPart?: number;
    answerHash?: string;
    acceptedMessageId?: string;
    retryCount?: number;
    nextAttemptAt?: string;
    terminalStatus?: 'completed' | 'failed' | 'cancelled';
    status: BindingStatus;
    createdAt: string;
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
        || (row.answerHash !== undefined && (typeof row.answerHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.answerHash)))
        || (row.acceptedMessageId !== undefined && (typeof row.acceptedMessageId !== 'string'
            || !/^[A-Za-z0-9:_@.-]{1,256}$/.test(row.acceptedMessageId)))
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

function writeBinding(file: string, binding: AnswerBinding): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(tmp, JSON.stringify(binding), { flag: 'wx' });
        fs.renameSync(tmp, file);
    } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
}

/** Workspace-scoped receipts for new Ask chats and their correlated follow-ups. */
export class TeamsAnswerRelay {
    private readonly bindings = new Map<string, { file: string; value: AnswerBinding }>();
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

    constructor(private readonly deps: TeamsAnswerRelayDeps) {
        for (const event of ['taskCompleted', 'taskFailed', 'taskCancelled'] as const) {
            deps.queue.on(event, this.onTerminal);
        }
    }

    hasInbound(msg: InboundTeamsMessage): boolean {
        const target = this.deps.target();
        return [...this.bindings.values()].some(({ value }) =>
            value.teamId === target.teamId && value.channelId === msg.channelId
            && value.messageId === msg.messageId);
    }

    async restore(): Promise<void> {
        const seen = new Map<string, string>();
        const conflicts = new Set<string>();
        for (const workspace of await this.deps.store.getWorkspaces()) {
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
        const taskId = `${Date.now()}-${randomUUID()}`;
        const value: AnswerBinding = {
            version: 1, workspaceId, teamId: target.teamId, channelId: msg.channelId,
            messageId: msg.messageId, rootId: msg.replyToMessageId || msg.messageId,
            taskId, processId: toQueueProcessId(taskId), status: 'admitting',
            createdAt: new Date().toISOString(),
        };
        writeBinding(file, value);
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
        writeBinding(file, value);
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
        writeBinding(file, value);
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
        const parts = formatTeamsAnswerChunks(text, bindingName(binding.teamId, binding.channelId, binding.messageId).slice(0, 10));
        const answerHash = createHash('sha256').update(text).digest('hex');
        if (binding.answerHash && (binding.answerHash !== answerHash || binding.partCount !== parts.length)) {
            this.update(file, 'ambiguous');
            console.error('[teams-answer-relay] Saved answer changed during delivery');
            return;
        }
        if (!binding.answerHash) this.update(file, 'awaiting', { answerHash, partCount: parts.length, nextPart: 0 });
        for (let index = binding.nextPart ?? 0; index < parts.length; index++) {
            const target = this.deps.target();
            if (!target.connected || target.teamId !== binding.teamId || target.channelId !== binding.channelId
                || !this.deps.isEnabled() || this.disposed) return;
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
                const acceptedId = await this.deps.send(parts[index], binding.rootId);
                if (!/^[A-Za-z0-9:_@.-]{1,256}$/.test(acceptedId)) {
                    this.update(file, 'ambiguous');
                    console.error('[teams-answer-relay] Send confirmation missing; manual reconciliation required');
                    return;
                }
                this.update(file, index === parts.length - 1 ? 'delivered' : 'awaiting', {
                    nextPart: index + 1, acceptedMessageId: acceptedId,
                });
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
        writeBinding(file, value);
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
            if (Date.parse(value.createdAt) >= retentionCutoff && count <= 2_000) continue;
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
        for (const event of ['taskCompleted', 'taskFailed', 'taskCancelled'] as const) {
            this.deps.queue.off(event, this.onTerminal);
        }
    }
}
