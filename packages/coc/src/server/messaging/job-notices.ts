/**
 * Completion notices for jobs a WhatsApp/Teams-started turn handed off with
 * `send_to_conversation` create mode, or that a mode-prefixed message to a
 * sentinel started directly (`job-handoff.ts`).
 *
 * Platform-neutral: the per-repo notice ledger, terminal-event matching, the
 * notice wording and failure-text rules live here. Each connector registers a
 * {@link JobNoticeTransport} that formats and posts a notice and binds the
 * posted message to the job, so a reply to the notice continues that job.
 *
 * Ledger rules (`messaging-job-notices.json` per job workspace, written with
 * `atomicWriteJsonUnique`): a terminal turn is recorded as pending before it
 * is sent, so a disconnected connector or a restart only delays it; a send in
 * flight is marked `sending`, and a crash there leaves the notice done (never
 * resent). Each queue task id is noticed at most once.
 */

import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { toQueueProcessId, toTaskId, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { DelegatedJobStore } from '../delegation/delegated-job-store';
import { getRepoDataPath } from '../paths';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import { onTaskTerminal } from './chat-target';
import { RELAY_ANSWER_TEXT, findRequestFailureText, isTerminalStatus, type RelayTerminalStatus } from './relay-answer';
import { formatTeamsAnswerChunks } from './teams-answer-format';
import { formatLabeledWhatsAppChunks, formatWhatsAppAnswer } from './whatsapp-answer-format';
import { mirrorChunkEchoMatches, mirrorEchoText } from './sentinel-mirror-adapters';
import type { SentinelMirrorEcho } from './sentinel-mirror-service';

export type MessagingConnector = 'whatsapp' | 'teams';

/** Where a handed-off job came from: the connector and its group/channel key. No secrets, no paths. */
export interface MessagingJobOrigin {
    connector: MessagingConnector;
    chatKey: string;
    /** Original Teams thread root for questions and parent results; child notices remain top-level. */
    threadId?: string;
    /** Private authority for desktop handoffs; never renderer/process provenance. */
    desktopMirror?: { workspaceId: string; processId: string; requestId: string; bindingId: string };
}

export type MessagingOriginAuthority = 'ready' | 'wait' | 'suppress';

export function connectorMessagingOrigin(origin: MessagingJobOrigin): MessagingJobOrigin {
    return { connector: origin.connector, chatKey: origin.chatKey,
        ...(origin.threadId ? { threadId: origin.threadId } : {}) };
}

export function isMessagingJobOrigin(value: unknown): value is MessagingJobOrigin {
    const origin = value as Partial<MessagingJobOrigin> | null;
    return !!origin && typeof origin === 'object'
        && (origin.connector === 'whatsapp' || origin.connector === 'teams')
        && typeof origin.chatKey === 'string' && !!origin.chatKey
        && (origin.threadId === undefined || (typeof origin.threadId === 'string' && !!origin.threadId))
        && (origin.desktopMirror === undefined || (!!origin.desktopMirror && typeof origin.desktopMirror === 'object'
            && ['workspaceId', 'processId', 'requestId', 'bindingId'].every(key =>
                typeof (origin.desktopMirror as Record<string, unknown>)[key] === 'string'
                && !!(origin.desktopMirror as Record<string, unknown>)[key])));
}

export interface JobNotice {
    operation?: 'compact' | 'result';
    /** Parent review answer or fixed cancellation notice, already scoped to its receipt. */
    body?: string;
    threadId?: string;
    workspaceId: string;
    processId: string;
    repo: string;
    title: string;
    status: RelayTerminalStatus;
    /** Safe failure text (fixed, or a recognized usage-limit reset); failed notices only. */
    detail?: string;
    /** Ephemeral authority recheck before each physical part; never persisted or formatted. */
    beforeSend?: () => Promise<boolean>;
    /** Immutable private desktop result parts and durable before-dispatch evidence. */
    desktopResult?: { chunks: readonly string[]; beforePart: (index: number) => Promise<boolean> };
}

const STATUS_EMOJI: Record<RelayTerminalStatus, string> = { completed: '✅', failed: '❌', cancelled: '⏹' };

/** `<repo> · <title> · ✅`, plus the failure detail line. Each connector escapes/formats it. */
export function formatJobNotice(notice: JobNotice): { line: string; detail?: string } {
    return {
        line: `${notice.repo} · ${notice.title.slice(0, 80)}${notice.operation === 'compact' ? ' · Compaction' : ''} · ${STATUS_EMOJI[notice.status]}`,
        ...(notice.detail ? { detail: notice.detail } : {}),
    };
}

export interface JobNoticeTransport {
    readonly platform: MessagingConnector;
    /** Whether a notice can be posted to `chatKey` now. */
    connected(chatKey: string): boolean;
    /**
     * Post a notice and bind its message to the job. Resolves the message id,
     * or undefined when it was definitely not sent (retried on reconnect).
     * Throws when the outcome is unknown; that notice is never resent.
     */
    post(chatKey: string, notice: JobNotice): Promise<string | undefined>;
}

interface NoticeJob {
    /** A single compaction/result receipt; ordinary jobs notice every turn. */
    taskId?: string;
    processId: string;
    workspaceId: string;
    origin: MessagingJobOrigin;
    createdAt: string;
    /** Queue task ids whose notice was posted or attempted with an unknown outcome. */
    done: string[];
    /** Terminal turns waiting for their connector. */
    pending: Array<{ taskId: string; status: RelayTerminalStatus }>;
    /** Task id of the send in flight. */
    sending?: string;
    noticeIds: string[];
    result?: Pick<JobNotice, 'repo' | 'title' | 'body' | 'status'>;
    resultChunks?: string[];
    resultAttemptedPartCount?: number;
}

const FILE = 'messaging-job-notices.json';
const MAX_JOBS = 500;
const MAX_DONE = 50;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const resultLabel = (receiptId: string) => createHash('sha256').update(receiptId).digest('hex');

export class MessagingJobNotices {
    private readonly transports = new Map<MessagingConnector, JobNoticeTransport>();
    private readonly jobs = new Map<string, NoticeJob[]>();
    private readonly active = new Map<NoticeJob, Promise<void>>();
    private readonly rerun = new Set<NoticeJob>();
    private readonly unsubscribe: () => void;
    private disposed = false;

    constructor(private readonly deps: {
        dataDir: string;
        delegatedJobs?: Pick<DelegatedJobStore, 'list'>;
        store: Pick<ProcessStore, 'getProcess' | 'getWorkspaces'>;
        queue: Pick<ScheduleQueueEventBus, 'on' | 'off'> & { getAll?: () => QueuedTask[] };
        authorizeDesktopOrigin?: (
            origin: MessagingJobOrigin, parent?: { workspaceId: string; processId: string },
        ) => Promise<MessagingOriginAuthority>;
    }) {
        this.unsubscribe = onTaskTerminal(deps.queue, task => {
            void this.onTerminal(task).catch(error =>
                console.error('[job-notices] Could not record a terminal notice:', error));
        });
    }

    register(transport: JobNoticeTransport): void {
        this.transports.set(transport.platform, transport);
    }

    dispose(): void {
        this.disposed = true;
        this.unsubscribe();
    }

    /** Start tracking a handed-off local job; every terminal turn of it is noticed. */
    track(job: { processId: string; workspaceId: string; origin: MessagingJobOrigin; taskId?: string }): void {
        const rows = this.load(job.workspaceId);
        if (rows.some(row => row.processId === job.processId && row.taskId === job.taskId)) return;
        const cutoff = Date.now() - RETENTION_MS;
        const kept = rows.filter(row => Date.parse(row.createdAt) >= cutoff).slice(-(MAX_JOBS - 1));
        rows.splice(0, rows.length, ...kept, {
            processId: job.processId, workspaceId: job.workspaceId, origin: job.origin, ...(job.taskId ? { taskId: job.taskId } : {}),
            createdAt: new Date().toISOString(), done: [], pending: [], noticeIds: [],
        });
        this.save(job.workspaceId);
    }

    /** Persist a parent result before the delegation ledger acknowledges delivery. */
    queueResult(job: {
        processId: string; workspaceId: string; origin: MessagingJobOrigin; receiptId: string;
        repo: string; title: string; body: string; status: RelayTerminalStatus;
    }): void {
        const rows = this.load(job.workspaceId);
        if (rows.some(row => row.taskId === job.receiptId && row.result)) return;
        rows.push({ processId: job.processId, workspaceId: job.workspaceId, origin: { ...job.origin },
            taskId: job.receiptId, createdAt: new Date().toISOString(), done: [], noticeIds: [],
            pending: [{ taskId: job.receiptId, status: job.status }],
            result: { repo: job.repo, title: job.title, body: job.body.slice(0, 16_000), status: job.status },
        });
        try { this.save(job.workspaceId); }
        catch (error) { rows.pop(); throw error; }
        void this.reconcile(job.origin.connector).catch(error =>
            console.error('[job-notices] Could not deliver parent result:', error));
    }

    /**
     * Load every workspace's ledger, settle sends a restart interrupted, queue
     * notices for first turns that ended while the server was down, and post
     * what is pending.
     */
    async restore(): Promise<void> {
        for (const workspace of await this.deps.store.getWorkspaces()) {
            const rows = this.load(workspace.id);
            let changed = false;
            for (const job of rows) {
                if (job.sending) {
                    console.error('[job-notices] Notice send outcome unknown after restart; not resending');
                    job.done = [...job.done, job.sending].slice(-MAX_DONE);
                    job.sending = undefined;
                    changed = true;
                }
                if (job.result || job.done.length || job.pending.length) continue;
                if (job.taskId) {
                    const task = this.deps.queue.getAll?.().find(task => task.id === job.taskId);
                    const process = await this.deps.store.getProcess(job.processId, job.workspaceId);
                    const compact = process?.metadata?.compaction;
                    const status = task?.status ?? (compact?.taskId === job.taskId ? compact.state : undefined);
                    if (isTerminalStatus(status)) {
                        job.pending.push({ taskId: job.taskId, status });
                        changed = true;
                    }
                    continue;
                }
                const process = await this.deps.store.getProcess(job.processId, job.workspaceId);
                const busy = this.deps.queue.getAll?.().some(task => (task.processId ?? toQueueProcessId(task.id)) === job.processId
                    && (task.status === 'queued' || task.status === 'running'));
                if (process && isTerminalStatus(process.status) && !busy) {
                    const taskId = typeof process.metadata?.queueTaskId === 'string' ? process.metadata.queueTaskId : toTaskId(job.processId);
                    job.pending.push({ taskId, status: process.status });
                    changed = true;
                }
            }
            if (changed) this.save(workspace.id);
        }
        await this.reconcile();
    }

    /** Post pending notices (connector reconnected, or after restore). */
    async reconcile(platform?: MessagingConnector, desktopResultsOnly = false): Promise<void> {
        for (const rows of this.jobs.values()) {
            for (const job of rows) {
                if (job.pending.length && (!platform || job.origin.connector === platform)
                    && (!desktopResultsOnly || (job.result && job.origin.desktopMirror))) {
                    // Source settlement must recheck an earlier in-flight readiness snapshot.
                    if (desktopResultsOnly) await this.active.get(job);
                    await this.drain(job);
                }
            }
        }
    }

    async isOwnDesktopResultMessage(message: SentinelMirrorEcho): Promise<boolean> {
        if (message.isSelf === false) return false;
        const text = mirrorEchoText(message.connector === 'teams' ? message.text.replace(/<[^>]*>/g, ' ') : message.text);
        const marker = message.connector === 'whatsapp'
            ? /^CoC · Desktop result · Receipt ([A-Za-z0-9_-]{1,256}) · Part ([1-9]\d*)\/([1-9]\d*)(?: |$)/.exec(text)
            : /^CoC · Request ([A-Za-z0-9_-]{1,256}) · Part ([1-9]\d*)\/([1-9]\d*) ?Desktop result(?: |$)/.exec(text);
        if (!marker) return false;
        const part = Number(marker[2]);
        const total = Number(marker[3]);
        if (!Number.isSafeInteger(part) || !Number.isSafeInteger(total) || part > total) return false;
        try {
            for (const workspace of await this.deps.store.getWorkspaces()) {
                if (message.workspaceId && message.workspaceId !== workspace.id) continue;
                for (const job of this.load(workspace.id)) {
                    const pin = job.origin.desktopMirror;
                    if (!pin || !job.result || !job.taskId
                        || (message.connector === 'teams' ? resultLabel(job.taskId) : job.taskId) !== marker[1]
                        || pin.workspaceId !== job.workspaceId || pin.processId !== job.processId
                        || (message.processId && message.processId !== job.processId)
                        || job.origin.connector !== message.connector || job.origin.chatKey !== message.chatKey
                        || job.origin.threadId !== message.threadId
                        || (message.accountKey && !pin.bindingId.startsWith(`${message.accountKey}:`))
                        || total !== job.resultChunks?.length || part > (job.resultAttemptedPartCount ?? 0)) continue;
                    if (!mirrorChunkEchoMatches(message.connector, job.resultChunks[part - 1], message.text)) continue;
                    if (!message.accountKey || message.isSelf !== true) throw new Error('Result sender is unverified');
                    return true;
                }
            }
            return false;
        } catch {
            console.error('[job-notices] Desktop result echo verification unavailable; admission paused');
            throw new Error('Desktop result sender verification is unavailable. Message admission is paused.');
        }
    }

    private async onTerminal(task: QueuedTask): Promise<void> {
        if (!isTerminalStatus(task.status)) return;
        const processId = task.processId ?? toQueueProcessId(task.id);
        const rows = typeof task.repoId === 'string' && task.repoId ? this.load(task.repoId) : [...this.jobs.values()].flat();
        const job = rows.find(row => !row.result && row.processId === processId && (row.taskId ? row.taskId === task.id : task.payload?.kind !== 'compact'));
        if (!job || job.done.includes(task.id) || job.sending === task.id
            || job.pending.some(entry => entry.taskId === task.id)) return;
        job.pending.push({ taskId: task.id, status: task.status });
        this.save(job.workspaceId);
        await this.drain(job);
    }

    private drain(job: NoticeJob): Promise<void> {
        if (this.disposed) return Promise.resolve();
        const existing = this.active.get(job);
        if (existing) {
            this.rerun.add(job);
            return existing;
        }
        const work = this.runDrain(job).finally(() => this.active.delete(job));
        this.active.set(job, work);
        return work;
    }

    private async runDrain(job: NoticeJob): Promise<void> {
        do {
            this.rerun.delete(job);
            while (job.pending.length) {
                const transport = this.transports.get(job.origin.connector);
                if (!transport?.connected(job.origin.chatKey)) return;
                const entry = job.pending[0];
                const notice = await this.buildNotice(job, entry.status);
                const policy = await this.directNoticePolicy(job, entry.taskId);
                if (this.disposed || policy === 'wait') return;
                const authority = policy === 'suppress' ? 'ready' : await this.desktopAuthority(job);
                if (this.disposed || authority === 'wait') return;
                if (policy === 'suppress' || authority === 'suppress') {
                    const done = job.done;
                    job.pending.shift();
                    job.done = [...done, entry.taskId].slice(-MAX_DONE);
                    try { this.save(job.workspaceId); }
                    catch (error) { job.pending.unshift(entry); job.done = done; throw error; }
                    if (authority === 'suppress') {
                        console.error('[job-notices] Captured desktop destination authority unavailable; notice suppressed');
                    }
                    continue;
                }
                if (job.origin.desktopMirror) {
                    notice.beforeSend = async () => !this.disposed
                        && await this.desktopAuthority(job) === 'ready' && !this.disposed;
                    if (job.result) {
                        if (!job.resultChunks) {
                            const { line } = formatJobNotice(notice);
                            job.resultChunks = job.origin.connector === 'teams'
                                ? formatTeamsAnswerChunks(notice.body!, resultLabel(entry.taskId),
                                    `Desktop result · Receipt ${entry.taskId} · ${line}`)
                                : formatLabeledWhatsAppChunks(`${line}\n\n${formatWhatsAppAnswer(notice.body!)}`,
                                    (part, total) => `CoC · Desktop result · Receipt ${entry.taskId} · Part ${part}/${total}\n\n`);
                            try { this.save(job.workspaceId); }
                            catch { job.resultChunks = undefined; throw new Error('Desktop result preparation storage unavailable'); }
                        }
                        notice.desktopResult = {
                            chunks: [...job.resultChunks],
                            beforePart: async index => {
                                if (!Number.isInteger(index) || index < 0 || index >= job.resultChunks!.length
                                    || !await notice.beforeSend!()) return false;
                                const previous = job.resultAttemptedPartCount;
                                job.resultAttemptedPartCount = Math.max(previous ?? 0, index + 1);
                                try { this.save(job.workspaceId); }
                                catch {
                                    job.resultAttemptedPartCount = previous;
                                    console.error('[job-notices] Desktop result attempt storage unavailable; delivery paused');
                                    return false;
                                }
                                return true;
                            },
                        };
                    }
                }
                job.pending.shift();
                job.sending = entry.taskId;
                this.save(job.workspaceId);
                let messageId: string | undefined;
                let unknown = false;
                try {
                    messageId = await transport.post(job.origin.chatKey, notice);
                } catch (error) {
                    unknown = true;
                    console.error(`[job-notices] ${job.origin.connector} notice outcome unknown; not resending:`,
                        error instanceof Error ? error.name : 'unknown error');
                }
                if (this.disposed) return;
                job.sending = undefined;
                if (!messageId && !unknown) {
                    job.pending.unshift(entry);
                    this.save(job.workspaceId);
                    return;
                }
                job.done = [...job.done, entry.taskId].slice(-MAX_DONE);
                if (messageId) job.noticeIds = [...job.noticeIds, messageId].slice(-MAX_DONE);
                this.save(job.workspaceId);
            }
        } while (!this.disposed && this.rerun.has(job));
    }

    private async desktopAuthority(job: NoticeJob): Promise<MessagingOriginAuthority> {
        const pin = job.origin.desktopMirror;
        if (!pin) return 'ready';
        try {
            if (!job.result && !this.deps.delegatedJobs?.list(pin.workspaceId).some(row =>
                row.parent.workspaceId === pin.workspaceId && row.parent.processId === pin.processId
                && row.child.workspaceId === job.workspaceId && row.child.processId === job.processId
                && !row.child.serverId && JSON.stringify(row.messagingOrigin) === JSON.stringify(job.origin))) return 'suppress';
            return await this.deps.authorizeDesktopOrigin?.(job.origin,
                job.result ? { workspaceId: job.workspaceId, processId: job.processId } : undefined) ?? 'wait';
        } catch {
            console.error('[job-notices] Captured desktop destination verification unavailable; delivery paused');
            return 'wait';
        }
    }

    /** Only the original ordinary turn shares the parent's result; later child turns keep their notices. */
    private async directNoticePolicy(job: NoticeJob, taskId: string): Promise<'send' | 'wait' | 'suppress'> {
        if (!this.deps.delegatedJobs || job.result || job.taskId || taskId !== toTaskId(job.processId)) return 'send';
        for (const workspace of await this.deps.store.getWorkspaces()) {
            const delegation = this.deps.delegatedJobs.list(workspace.id).find(row =>
                !row.child.serverId && !row.child.sessionId
                && row.child.workspaceId === job.workspaceId && row.child.processId === job.processId
                && row.messagingOrigin?.connector === job.origin.connector
                && row.messagingOrigin.chatKey === job.origin.chatKey
                && row.messagingOrigin.threadId === job.origin.threadId);
            if (!delegation) continue;
            const delivery = delegation.terminal?.delivery;
            if (delivery?.state === 'failed') return 'send';
            if (delivery?.state === 'queued' || delivery?.state === 'delivered') {
                // Durable outbox coverage, including the crash window before ledger acknowledgement.
                if (this.load(workspace.id).some(row => row.result && row.taskId === delivery.receiptId
                    && row.processId === delegation.parent.processId
                    && row.origin.connector === job.origin.connector && row.origin.chatKey === job.origin.chatKey
                    && row.origin.threadId === job.origin.threadId)) return 'suppress';
                if (delivery.state === 'delivered') return 'send';
            }
            return 'wait';
        }
        return 'send';
    }

    private async buildNotice(job: NoticeJob, status: RelayTerminalStatus): Promise<JobNotice> {
        if (job.result) return { ...job.result, operation: 'result',
            workspaceId: job.workspaceId, processId: job.processId, threadId: job.origin.threadId };
        const process = await this.deps.store.getProcess(job.processId, job.workspaceId);
        const workspace = (await this.deps.store.getWorkspaces()).find(ws => ws.id === job.workspaceId);
        const turns = process?.conversationTurns ?? [];
        const lastUser = turns.map(turn => turn.role).lastIndexOf('user');
        return {
            workspaceId: job.workspaceId,
            processId: job.processId,
            repo: workspace?.name ?? job.workspaceId,
            title: process?.title ?? process?.customTitle ?? job.processId.slice(0, 8),
            status,
            ...(job.taskId ? { operation: 'compact' as const, threadId: job.origin.threadId,
                detail: status === 'completed' ? 'Context compacted.' : status === 'cancelled' ? 'Queued compaction cancelled.' : 'Compaction failed. Later messages can continue.' } : {}),
            ...(!job.taskId && status === 'failed' ? {
                detail: process
                    ? findRequestFailureText(turns, lastUser, process.status === 'failed' ? process.error : undefined)
                    : RELAY_ANSWER_TEXT.failed,
            } : {}),
        };
    }

    private load(workspaceId: string): NoticeJob[] {
        const existing = this.jobs.get(workspaceId);
        if (existing) return existing;
        const file = getRepoDataPath(this.deps.dataDir, workspaceId, FILE);
        const rows: NoticeJob[] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as NoticeJob[] : [];
        if (!Array.isArray(rows) || rows.some(row => !row || row.workspaceId !== workspaceId
            || typeof row.processId !== 'string' || !row.processId || !isMessagingJobOrigin(row.origin)
            || typeof row.createdAt !== 'string' || !Array.isArray(row.done) || !Array.isArray(row.pending)
            || !Array.isArray(row.noticeIds) || row.pending.some(entry => !isTerminalStatus(entry?.status))
            || (row.result !== undefined && (!row.taskId || typeof row.result.body !== 'string'
                || typeof row.result.repo !== 'string' || typeof row.result.title !== 'string' || !isTerminalStatus(row.result.status)))
            || (row.sending !== undefined && typeof row.sending !== 'string')
            || (row.resultChunks !== undefined && (!row.result || !row.origin.desktopMirror
                || !Array.isArray(row.resultChunks) || !row.resultChunks.length
                || row.resultChunks.some(chunk => typeof chunk !== 'string')))
            || (row.resultAttemptedPartCount !== undefined && (!Number.isSafeInteger(row.resultAttemptedPartCount)
                || row.resultAttemptedPartCount < 0 || row.resultAttemptedPartCount > (row.resultChunks?.length ?? 0))))) {
            throw new Error(`Invalid messaging job notices for workspace ${workspaceId}`);
        }
        this.jobs.set(workspaceId, rows);
        return rows;
    }

    private save(workspaceId: string): void {
        atomicWriteJsonUnique(getRepoDataPath(this.deps.dataDir, workspaceId, FILE), this.load(workspaceId));
    }
}
