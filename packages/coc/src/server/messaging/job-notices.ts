/**
 * Completion notices for jobs a WhatsApp/Teams-started turn handed off with
 * `send_to_conversation` create mode.
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
import { toQueueProcessId, toTaskId, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import { getRepoDataPath } from '../paths';
import type { ScheduleQueueEventBus } from '../schedule/schedule-queue-await';
import { atomicWriteJsonUnique } from '../shared/fs-utils';
import { onTaskTerminal } from './chat-target';
import { RELAY_ANSWER_TEXT, findRequestFailureText, isTerminalStatus, type RelayTerminalStatus } from './relay-answer';

export type MessagingConnector = 'whatsapp' | 'teams';

/** Where a handed-off job came from: the connector and its group/channel key. No secrets, no paths. */
export interface MessagingJobOrigin {
    connector: MessagingConnector;
    chatKey: string;
    /** Original Teams thread root for questions; completion notices remain top-level. */
    threadId?: string;
}

export function isMessagingJobOrigin(value: unknown): value is MessagingJobOrigin {
    const origin = value as Partial<MessagingJobOrigin> | null;
    return !!origin && typeof origin === 'object'
        && (origin.connector === 'whatsapp' || origin.connector === 'teams')
        && typeof origin.chatKey === 'string' && !!origin.chatKey
        && (origin.threadId === undefined || (typeof origin.threadId === 'string' && !!origin.threadId));
}

export interface JobNotice {
    workspaceId: string;
    processId: string;
    repo: string;
    title: string;
    status: RelayTerminalStatus;
    /** Safe failure text (fixed, or a recognized usage-limit reset); failed notices only. */
    detail?: string;
}

const STATUS_EMOJI: Record<RelayTerminalStatus, string> = { completed: '✅', failed: '❌', cancelled: '⏹' };

/** `<repo> · <title> · ✅`, plus the failure detail line. Each connector escapes/formats it. */
export function formatJobNotice(notice: JobNotice): { line: string; detail?: string } {
    return {
        line: `${notice.repo} · ${notice.title.slice(0, 80)} · ${STATUS_EMOJI[notice.status]}`,
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
}

const FILE = 'messaging-job-notices.json';
const MAX_JOBS = 500;
const MAX_DONE = 50;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export class MessagingJobNotices {
    private readonly transports = new Map<MessagingConnector, JobNoticeTransport>();
    private readonly jobs = new Map<string, NoticeJob[]>();
    private readonly active = new Set<NoticeJob>();
    private readonly rerun = new Set<NoticeJob>();
    private readonly unsubscribe: () => void;

    constructor(private readonly deps: {
        dataDir: string;
        store: Pick<ProcessStore, 'getProcess' | 'getWorkspaces'>;
        queue: Pick<ScheduleQueueEventBus, 'on' | 'off'> & { getAll?: () => QueuedTask[] };
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
        this.unsubscribe();
    }

    /** Start tracking a handed-off local job; every terminal turn of it is noticed. */
    track(job: { processId: string; workspaceId: string; origin: MessagingJobOrigin }): void {
        const rows = this.load(job.workspaceId);
        if (rows.some(row => row.processId === job.processId)) return;
        const cutoff = Date.now() - RETENTION_MS;
        const kept = rows.filter(row => Date.parse(row.createdAt) >= cutoff).slice(-(MAX_JOBS - 1));
        rows.splice(0, rows.length, ...kept, {
            processId: job.processId, workspaceId: job.workspaceId, origin: job.origin,
            createdAt: new Date().toISOString(), done: [], pending: [], noticeIds: [],
        });
        this.save(job.workspaceId);
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
                if (job.done.length || job.pending.length) continue;
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
    async reconcile(platform?: MessagingConnector): Promise<void> {
        for (const rows of this.jobs.values()) {
            for (const job of rows) {
                if (job.pending.length && (!platform || job.origin.connector === platform)) await this.drain(job);
            }
        }
    }

    private async onTerminal(task: QueuedTask): Promise<void> {
        if (!isTerminalStatus(task.status)) return;
        const processId = task.processId ?? toQueueProcessId(task.id);
        const rows = typeof task.repoId === 'string' && task.repoId ? this.load(task.repoId) : [...this.jobs.values()].flat();
        const job = rows.find(row => row.processId === processId);
        if (!job || job.done.includes(task.id) || job.sending === task.id
            || job.pending.some(entry => entry.taskId === task.id)) return;
        job.pending.push({ taskId: task.id, status: task.status });
        this.save(job.workspaceId);
        await this.drain(job);
    }

    private async drain(job: NoticeJob): Promise<void> {
        if (this.active.has(job)) {
            this.rerun.add(job);
            return;
        }
        this.active.add(job);
        try {
            do {
                this.rerun.delete(job);
                while (job.pending.length) {
                    const transport = this.transports.get(job.origin.connector);
                    if (!transport?.connected(job.origin.chatKey)) return;
                    const entry = job.pending[0];
                    const notice = await this.buildNotice(job, entry.status);
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
            } while (this.rerun.has(job));
        } finally {
            this.active.delete(job);
        }
    }

    private async buildNotice(job: NoticeJob, status: RelayTerminalStatus): Promise<JobNotice> {
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
            ...(status === 'failed' ? {
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
            || (row.sending !== undefined && typeof row.sending !== 'string'))) {
            throw new Error(`Invalid messaging job notices for workspace ${workspaceId}`);
        }
        this.jobs.set(workspaceId, rows);
        return rows;
    }

    private save(workspaceId: string): void {
        atomicWriteJsonUnique(getRepoDataPath(this.deps.dataDir, workspaceId, FILE), this.load(workspaceId));
    }
}
