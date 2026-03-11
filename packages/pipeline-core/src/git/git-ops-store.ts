/**
 * Git Ops Store — file-based persistence for background git operations.
 *
 * Tracks running / completed / failed git operations (pull, push, fetch) per workspace
 * so that the UI can recover status after a page refresh or server restart.
 *
 * Storage layout: `<dataDir>/git-ops/<workspaceId>.json` — one file per workspace
 * containing an array of the last N job records (default 10).
 *
 * Follows the same atomic-write and write-queue patterns as FileProcessStore.
 *
 * No VS Code dependencies — pure Node.js.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { withRetry } from '../runtime/retry';
import { getLogger } from '../logger';

// ============================================================================
// Types
// ============================================================================

export type GitOpType = 'pull' | 'push' | 'fetch';
export type GitOpStatus = 'running' | 'success' | 'failed' | 'interrupted';

export interface GitOpJob {
    id: string;
    workspaceId: string;
    op: GitOpType;
    status: GitOpStatus;
    startedAt: string;      // ISO 8601
    finishedAt?: string;     // ISO 8601
    output?: string;
    error?: string;
    pid?: number;            // for stale-job detection on restart
}

export interface GitOpsStoreOptions {
    /** Directory for data files. Default: ~/.coc/ */
    dataDir?: string;
    /** Maximum jobs retained per workspace. Default: 10 */
    maxJobsPerWorkspace?: number;
}

// ============================================================================
// Store
// ============================================================================

export class GitOpsStore {
    private readonly opsDir: string;
    private readonly maxJobs: number;
    private writeQueue: Promise<void> = Promise.resolve();

    /** Transient FS error codes worth retrying */
    private static readonly RETRYABLE_FS_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM', 'ENOLCK', 'EIO']);

    constructor(options?: GitOpsStoreOptions) {
        const dataDir = options?.dataDir ?? process.env.COC_DATA_DIR ?? path.join(os.homedir(), '.coc');
        this.opsDir = path.join(dataDir, 'git-ops');
        this.maxJobs = options?.maxJobsPerWorkspace ?? 10;
    }

    /** Create a new job record and persist it. Returns the created job. */
    async create(job: GitOpJob): Promise<GitOpJob> {
        await this.enqueueWrite(async () => {
            const jobs = await this.readWorkspaceJobs(job.workspaceId);
            jobs.push(job);
            await this.writeWorkspaceJobs(job.workspaceId, this.prune(jobs));
        });
        return job;
    }

    /** Update fields on an existing job. Returns the updated job or undefined if not found. */
    async update(workspaceId: string, jobId: string, patch: Partial<Pick<GitOpJob, 'status' | 'finishedAt' | 'output' | 'error'>>): Promise<GitOpJob | undefined> {
        let updated: GitOpJob | undefined;
        await this.enqueueWrite(async () => {
            const jobs = await this.readWorkspaceJobs(workspaceId);
            const idx = jobs.findIndex(j => j.id === jobId);
            if (idx === -1) return;
            jobs[idx] = { ...jobs[idx], ...patch };
            updated = jobs[idx];
            await this.writeWorkspaceJobs(workspaceId, jobs);
        });
        return updated;
    }

    /** Get a specific job by ID. */
    async getById(workspaceId: string, jobId: string): Promise<GitOpJob | undefined> {
        const jobs = await this.readWorkspaceJobs(workspaceId);
        return jobs.find(j => j.id === jobId);
    }

    /** Get the most recent job for a workspace, optionally filtered by op type. */
    async getLatest(workspaceId: string, op?: GitOpType): Promise<GitOpJob | undefined> {
        const jobs = await this.readWorkspaceJobs(workspaceId);
        const filtered = op ? jobs.filter(j => j.op === op) : jobs;
        return filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
    }

    /** Get all jobs for a workspace that are currently running. */
    async getRunning(workspaceId: string, op?: GitOpType): Promise<GitOpJob[]> {
        const jobs = await this.readWorkspaceJobs(workspaceId);
        return jobs.filter(j => j.status === 'running' && (!op || j.op === op));
    }

    /**
     * Startup sweep: mark all `running` jobs as `interrupted`.
     * Call this once on server start to handle jobs orphaned by a crash/restart.
     */
    async markStaleRunningJobs(): Promise<number> {
        let count = 0;
        await fs.mkdir(this.opsDir, { recursive: true }).catch(() => {});
        let files: string[];
        try {
            files = await fs.readdir(this.opsDir);
        } catch {
            return 0;
        }
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const workspaceId = file.replace(/\.json$/, '');
            await this.enqueueWrite(async () => {
                const jobs = await this.readWorkspaceJobs(workspaceId);
                let changed = false;
                for (const job of jobs) {
                    if (job.status === 'running') {
                        job.status = 'interrupted';
                        job.finishedAt = new Date().toISOString();
                        job.error = 'Server restarted while operation was in progress';
                        changed = true;
                        count++;
                    }
                }
                if (changed) {
                    await this.writeWorkspaceJobs(workspaceId, jobs);
                }
            });
        }
        return count;
    }

    // --- Internal helpers ---

    private workspaceFilePath(workspaceId: string): string {
        const safe = workspaceId.replace(/[^a-zA-Z0-9\-_]/g, '_');
        return path.join(this.opsDir, `${safe}.json`);
    }

    private async readWorkspaceJobs(workspaceId: string): Promise<GitOpJob[]> {
        try {
            const data = await fs.readFile(this.workspaceFilePath(workspaceId), 'utf-8');
            return JSON.parse(data) as GitOpJob[];
        } catch {
            return [];
        }
    }

    private async writeWorkspaceJobs(workspaceId: string, jobs: GitOpJob[]): Promise<void> {
        await fs.mkdir(this.opsDir, { recursive: true });
        const filePath = this.workspaceFilePath(workspaceId);
        const tmpPath = filePath + '.tmp';
        await this.retryAtomicWrite(tmpPath, async () => {
            await fs.writeFile(tmpPath, JSON.stringify(jobs, null, 2), 'utf-8');
            await fs.rename(tmpPath, filePath);
        });
    }

    private prune(jobs: GitOpJob[]): GitOpJob[] {
        if (jobs.length <= this.maxJobs) return jobs;
        // Keep running jobs + most recent terminal jobs
        const running = jobs.filter(j => j.status === 'running');
        const terminal = jobs.filter(j => j.status !== 'running');
        const keep = this.maxJobs - running.length;
        return [...running, ...terminal.slice(Math.max(0, terminal.length - keep))];
    }

    private async retryAtomicWrite(tmpPath: string, fn: () => Promise<void>): Promise<void> {
        const logger = getLogger();
        try {
            await withRetry(fn, {
                attempts: 3,
                delayMs: 100,
                backoff: 'exponential',
                maxDelayMs: 2000,
                operationName: `atomic write ${path.basename(tmpPath)}`,
                retryOn: (error: unknown) => {
                    const code = (error as NodeJS.ErrnoException)?.code;
                    return !!code && GitOpsStore.RETRYABLE_FS_ERRORS.has(code);
                },
                onAttempt: (attempt, maxAttempts, lastError) => {
                    if (attempt > 1) {
                        const code = (lastError as NodeJS.ErrnoException)?.code ?? 'unknown';
                        logger.warn('GitOpsStore', `Retrying atomic write (attempt ${attempt}/${maxAttempts}) after ${code}`);
                    }
                },
            });
        } catch (outerError) {
            try { await fs.unlink(tmpPath); } catch { /* ignore */ }
            throw outerError;
        }
    }

    private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(() => {}, () => {});
        return result;
    }
}
