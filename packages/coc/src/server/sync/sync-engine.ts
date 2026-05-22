/**
 * Git-backed sync engine for My Work / My Life notes.
 *
 * Each workspace gets its own SyncEngine instance. The engine
 * clones/pulls/pushes a user-configured Git remote to synchronize
 * note files across machines.
 *
 * Mapping (per workspace):
 *   ~/.coc/repos/<workspaceId>/notes/  ↔  ~/.coc/sync/<sync-subfolder>/
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { safeExistsAsync, safeReadDirAsync, safeReadFileAsync } from '@plusplusoneplusplus/forge';
import type { AIInvoker } from '@plusplusoneplusplus/forge';

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────────────────

export interface SyncStatus {
    /** Whether a sync is currently in progress */
    inProgress: boolean;
    /** ISO timestamp of last successful sync, or null if never synced */
    lastSyncTime: string | null;
    /** Error message from last sync attempt, or null if OK */
    lastError: string | null;
    /** Whether sync is enabled (gitRemote configured) */
    enabled: boolean;
}

export interface SyncEngineOptions {
    dataDir: string;
    /** Virtual workspace ID: 'my_work' or 'my_life' */
    workspaceId: string;
    logger?: SyncLogger;
    /** Optional AI invoker for intelligent merge conflict resolution. Falls back to simple resolution when absent. */
    aiInvoker?: AIInvoker;
}

export interface SyncLogger {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}

const DEFAULT_LOGGER: SyncLogger = {
    info: (msg) => console.log(`[sync] ${msg}`),
    warn: (msg) => console.warn(`[sync] ${msg}`),
    error: (msg) => console.error(`[sync] ${msg}`),
};

// ── Mapping ──────────────────────────────────────────────────────────────────

interface FolderMapping {
    /** Subfolder name inside the sync Git repo */
    repoFolder: string;
    /** Absolute path to the local notes directory */
    localDir: string;
}

// ── Git helpers ──────────────────────────────────────────────────────────────

async function git(args: string[], cwd: string): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120_000,
    });
    return stdout.trim();
}

async function isGitRepo(dir: string): Promise<boolean> {
    try {
        await git(['rev-parse', '--is-inside-work-tree'], dir);
        return true;
    } catch {
        return false;
    }
}

// ── Lock file helpers ────────────────────────────────────────────────────────

async function acquireLock(lockPath: string): Promise<boolean> {
    await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
    try {
        await fs.promises.writeFile(lockPath, String(process.pid), { flag: 'wx' });
        return true;
    } catch {
        // Check for stale lock
        try {
            const pid = parseInt(await fs.promises.readFile(lockPath, 'utf8'), 10);
            if (pid && !isProcessRunning(pid)) {
                await fs.promises.unlink(lockPath);
                await fs.promises.writeFile(lockPath, String(process.pid), { flag: 'wx' });
                return true;
            }
        } catch { /* lock held by active process */ }
        return false;
    }
}

async function releaseLock(lockPath: string): Promise<void> {
    try { await fs.promises.unlink(lockPath); } catch { /* ignore */ }
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

// ── File sync helpers ────────────────────────────────────────────────────────

async function copyDirContents(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });

    // Remove files in dest that don't exist in src
    const destEntries = await safeReadDirAsync(dest, true);
    if (destEntries.success) {
        for (const entry of destEntries.data!) {
            const destPath = path.join(dest, entry.name);
            if (!await safeExistsAsync(path.join(src, entry.name))) {
                if (entry.isDirectory()) {
                    await fs.promises.rm(destPath, { recursive: true, force: true });
                } else {
                    await fs.promises.unlink(destPath);
                }
            }
        }
    }

    if (!await safeExistsAsync(src)) return;

    const srcEntries = await safeReadDirAsync(src, true);
    if (!srcEntries.success) return;
    for (const entry of srcEntries.data!) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDirContents(srcPath, destPath);
        } else {
            await fs.promises.copyFile(srcPath, destPath);
        }
    }
}

// ── SyncEngine ───────────────────────────────────────────────────────────────

export class SyncEngine {
    private readonly dataDir: string;
    private readonly workspaceId: string;
    private readonly syncRepoDir: string;
    private readonly lockPath: string;
    private readonly logger: SyncLogger;
    private readonly mapping: FolderMapping;
    private readonly aiInvoker?: AIInvoker;

    private status: SyncStatus = {
        inProgress: false,
        lastSyncTime: null,
        lastError: null,
        enabled: false,
    };

    private intervalTimer: ReturnType<typeof setInterval> | null = null;

    constructor(opts: SyncEngineOptions) {
        this.dataDir = opts.dataDir;
        this.workspaceId = opts.workspaceId;
        const syncSubfolder = opts.workspaceId.replace(/_/g, '-');
        this.syncRepoDir = path.join(opts.dataDir, 'sync', syncSubfolder);
        this.lockPath = path.join(this.syncRepoDir, '.lock');
        this.logger = opts.logger ?? DEFAULT_LOGGER;
        this.mapping = {
            repoFolder: '.',
            localDir: path.join(opts.dataDir, 'repos', opts.workspaceId, 'notes'),
        };
        this.aiInvoker = opts.aiInvoker;
    }

    /** Returns the current sync status. */
    getStatus(): SyncStatus {
        return { ...this.status };
    }

    /**
     * Start the sync engine: do an initial sync, then schedule periodic syncs.
     * No-op when gitRemote is empty.
     */
    async start(gitRemote: string, intervalMinutes: number): Promise<void> {
        if (!gitRemote) {
            this.logger.info(`Sync disabled for ${this.workspaceId} (no gitRemote configured)`);
            return;
        }

        this.status.enabled = true;
        this.logger.info(`Starting sync engine for ${this.workspaceId}`);

        // Fire-and-forget initial sync — don't block server startup
        this.performSync(gitRemote).catch(() => {});

        this.startPeriodicSync(intervalMinutes);
    }

    /** Stop the periodic sync timer. */
    stop(): void {
        this.stopPeriodicSync();
    }

    /**
     * Trigger a one-off sync immediately. Returns when complete.
     * Exposed for the manual-trigger REST endpoint.
     */
    async triggerSync(gitRemote: string): Promise<SyncStatus> {
        await this.performSync(gitRemote);
        return this.getStatus();
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private startPeriodicSync(intervalMinutes: number): void {
        this.stopPeriodicSync();
        const ms = intervalMinutes * 60_000;
        this.intervalTimer = setInterval(() => {
            if (this.status.enabled) {
                this.performSync(this.getGitRemoteFromStatus()).catch(() => {});
            }
        }, ms);
        // Don't hold the event loop open for the timer
        if (this.intervalTimer && typeof this.intervalTimer === 'object' && 'unref' in this.intervalTimer) {
            this.intervalTimer.unref();
        }
        this.logger.info(`Periodic sync scheduled every ${intervalMinutes} minutes`);
    }

    private stopPeriodicSync(): void {
        if (this.intervalTimer) {
            clearInterval(this.intervalTimer);
            this.intervalTimer = null;
        }
    }

    private gitRemoteCache: string = '';

    private getGitRemoteFromStatus(): string {
        return this.gitRemoteCache;
    }

    private async performSync(gitRemote: string): Promise<void> {
        if (this.status.inProgress) {
            this.logger.warn('Sync already in progress, skipping');
            return;
        }

        if (!await acquireLock(this.lockPath)) {
            this.logger.warn('Could not acquire sync lock, skipping');
            return;
        }

        this.gitRemoteCache = gitRemote;
        this.status.inProgress = true;
        this.status.lastError = null;

        try {
            // 1. Ensure the sync repo exists (clone or verify)
            await this.ensureSyncRepo(gitRemote);

            // 2. Copy local notes → sync repo
            await this.copyLocalToRepo();

            // 3. Stage + commit local changes
            await this.commitLocalChanges();

            // 4. Pull remote changes (may produce conflicts)
            const hasConflicts = await this.pullRemote();

            // 5. If conflicts, resolve them
            if (hasConflicts) {
                await this.resolveConflicts();
            }

            // 6. Push to remote
            await this.pushToRemote();

            // 7. Copy sync repo → local notes
            await this.copyRepoToLocal();

            this.status.lastSyncTime = new Date().toISOString();
            this.status.lastError = null;
            this.logger.info(`Sync completed successfully at ${this.status.lastSyncTime}`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.status.lastError = message;
            this.logger.error(`Sync failed: ${message}`);
        } finally {
            this.status.inProgress = false;
            await releaseLock(this.lockPath);
        }
    }

    private async ensureSyncRepo(gitRemote: string): Promise<void> {
        if (await isGitRepo(this.syncRepoDir)) {
            // Verify the remote matches
            try {
                const currentRemote = await git(['remote', 'get-url', 'origin'], this.syncRepoDir);
                if (currentRemote !== gitRemote) {
                    await git(['remote', 'set-url', 'origin', gitRemote], this.syncRepoDir);
                    this.logger.info('Updated sync repo remote URL');
                }
            } catch {
                await git(['remote', 'add', 'origin', gitRemote], this.syncRepoDir);
            }
            return;
        }

        // Clone fresh
        await fs.promises.mkdir(this.syncRepoDir, { recursive: true });
        try {
            await git(['clone', gitRemote, '.'], this.syncRepoDir);
            this.logger.info('Cloned sync repo');
        } catch {
            // Remote might be empty — init locally and add remote
            await git(['init'], this.syncRepoDir);
            await git(['remote', 'add', 'origin', gitRemote], this.syncRepoDir);
            this.logger.info('Initialized empty sync repo with remote');
        }
    }

    private async copyLocalToRepo(): Promise<void> {
        if (await safeExistsAsync(this.mapping.localDir)) {
            await copyDirContents(this.mapping.localDir, this.syncRepoDir);
        }
    }

    private async commitLocalChanges(): Promise<void> {
        await git(['add', '-A'], this.syncRepoDir);

        // Check if there's anything to commit
        try {
            await git(['diff', '--cached', '--quiet'], this.syncRepoDir);
            // No changes staged
        } catch {
            // Changes exist — commit them
            const hostname = require('os').hostname();
            await git(
                ['commit', '-m', `sync from ${hostname} at ${new Date().toISOString()}`],
                this.syncRepoDir,
            );
            this.logger.info('Committed local changes');
        }
    }

    private async pullRemote(): Promise<boolean> {
        try {
            // Check if remote has any commits first
            try {
                await git(['ls-remote', '--heads', 'origin'], this.syncRepoDir);
            } catch {
                return false; // Can't reach remote or empty
            }

            await git(['pull', '--no-rebase', 'origin', 'HEAD'], this.syncRepoDir);
            return false;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes('CONFLICT') || message.includes('Automatic merge failed')) {
                this.logger.warn('Merge conflicts detected');
                return true;
            }
            // If pull fails for non-conflict reasons (e.g. no upstream), that's OK
            if (message.includes('couldn\'t find remote ref') || message.includes('no tracking information')) {
                return false;
            }
            throw err;
        }
    }

    private async resolveConflicts(): Promise<void> {
        // Get list of conflicted files
        const statusOutput = await git(['status', '--porcelain'], this.syncRepoDir);
        const conflictedFiles = statusOutput
            .split('\n')
            .filter(line => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DU') || line.startsWith('UD'))
            .map(line => line.slice(3).trim());

        if (conflictedFiles.length === 0) return;

        this.logger.info(`Resolving ${conflictedFiles.length} conflicted file(s)`);

        for (const file of conflictedFiles) {
            const filePath = path.join(this.syncRepoDir, file);
            try {
                const readResult = await safeReadFileAsync(filePath);
                if (!readResult.success) throw readResult.error!;
                const resolved = await this.resolveFileConflict(file, readResult.data!);
                await fs.promises.writeFile(filePath, resolved, 'utf8');
                await git(['add', file], this.syncRepoDir);
            } catch (err) {
                this.logger.error(`Failed to resolve conflict in ${file}: ${err}`);
                // Accept theirs as fallback
                try {
                    await git(['checkout', '--theirs', file], this.syncRepoDir);
                    await git(['add', file], this.syncRepoDir);
                } catch { /* last resort: skip */ }
            }
        }

        try {
            await git(['commit', '--no-edit'], this.syncRepoDir);
            this.logger.info('Committed conflict resolution');
        } catch {
            // May already be committed
        }
    }

    /**
     * Resolve a single file's merge conflicts. Uses AI when available,
     * falls back to simple concatenation-based resolution.
     */
    private async resolveFileConflict(fileName: string, content: string): Promise<string> {
        if (!this.aiInvoker) {
            return resolveConflictSimple(content);
        }

        try {
            const resolved = await resolveConflictWithAI(this.aiInvoker, fileName, content);
            this.logger.info(`AI resolved conflict in ${fileName}`);
            return resolved;
        } catch (err) {
            this.logger.warn(`AI conflict resolution failed for ${fileName}, falling back to simple merge: ${err}`);
            return resolveConflictSimple(content);
        }
    }

    private async pushToRemote(): Promise<void> {
        try {
            await git(['push', '-u', 'origin', 'HEAD'], this.syncRepoDir);
            this.logger.info('Pushed to remote');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Push failed (will retry next cycle): ${message}`);
        }
    }

    private async copyRepoToLocal(): Promise<void> {
        if (await safeExistsAsync(this.syncRepoDir)) {
            await fs.promises.mkdir(this.mapping.localDir, { recursive: true });
            // Copy everything except .git and .lock
            const entries = await safeReadDirAsync(this.syncRepoDir, true);
            if (!entries.success) return;
            for (const entry of entries.data!) {
                if (entry.name === '.git' || entry.name === '.lock') continue;
                const src = path.join(this.syncRepoDir, entry.name);
                const dest = path.join(this.mapping.localDir, entry.name);
                if (entry.isDirectory()) {
                    await copyDirContents(src, dest);
                } else {
                    await fs.promises.copyFile(src, dest);
                }
            }
        }
    }
}

// ── Utilities ────────────────────────────────────────────────────────────────

/**
 * Simple merge-conflict resolution: extracts both sides and concatenates them,
 * preferring to keep all content from both versions.
 */
export function resolveConflictSimple(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inConflict = false;
    let side: 'ours' | 'theirs' = 'ours';
    const ours: string[] = [];
    const theirs: string[] = [];

    for (const line of lines) {
        if (line.startsWith('<<<<<<<')) {
            inConflict = true;
            side = 'ours';
            ours.length = 0;
            theirs.length = 0;
            continue;
        }
        if (line.startsWith('=======') && inConflict) {
            side = 'theirs';
            continue;
        }
        if (line.startsWith('>>>>>>>') && inConflict) {
            // Merge: keep both sides, deduplicate identical lines
            const oursText = ours.join('\n');
            const theirsText = theirs.join('\n');
            if (oursText === theirsText) {
                result.push(oursText);
            } else {
                result.push(oursText);
                if (oursText && theirsText) result.push('');
                result.push(theirsText);
            }
            inConflict = false;
            continue;
        }

        if (inConflict) {
            if (side === 'ours') ours.push(line);
            else theirs.push(line);
        } else {
            result.push(line);
        }
    }

    return result.join('\n');
}

// ── AI conflict resolution prompt ────────────────────────────────────────────

const CONFLICT_RESOLUTION_PROMPT = `You are resolving a Git merge conflict in a personal notes file used in a "My Work / My Life" productivity system.

The file below contains Git conflict markers (<<<<<<< / ======= / >>>>>>>). Each conflict region has two versions:
- "Ours" (between <<<<<<< and =======): changes from this machine
- "Theirs" (between ======= and >>>>>>>): changes from another machine

Your job:
1. Understand the semantic content — these are action items, journal entries, goals, reflections, or follow-ups.
2. Merge intelligently: keep ALL meaningful content from both sides. Do not drop any action items, tasks, or journal entries.
3. If both sides edited the same item (e.g. updated a status or added notes), combine them logically — prefer the more complete or recent version, but preserve any unique details from either side.
4. Remove the conflict markers entirely. Output ONLY the final resolved file content with no markers, no explanations, and no surrounding code fences.

File: {{fileName}}

Content with conflicts:
{{content}}`;

/**
 * Resolve merge conflicts using AI. Sends the conflicted file to the AI invoker
 * and expects back a clean resolved version.
 *
 * @throws if the AI call fails or returns an empty response
 */
export async function resolveConflictWithAI(
    aiInvoker: AIInvoker,
    fileName: string,
    content: string,
): Promise<string> {
    const prompt = CONFLICT_RESOLUTION_PROMPT
        .replace('{{fileName}}', fileName)
        .replace('{{content}}', content);

    const result = await aiInvoker(prompt);

    if (!result.success || !result.response?.trim()) {
        throw new Error(result.error || 'AI returned empty response for conflict resolution');
    }

    let resolved = result.response.trim();

    // Strip code fences if the AI wrapped the output
    if (resolved.startsWith('```')) {
        const lines = resolved.split('\n');
        // Remove first line (```markdown or ```) and last line (```)
        if (lines[lines.length - 1].trim() === '```') {
            lines.shift();
            lines.pop();
            resolved = lines.join('\n');
        }
    }

    // Sanity check: resolved content should not contain conflict markers
    if (resolved.includes('<<<<<<<') || resolved.includes('>>>>>>>')) {
        throw new Error('AI response still contains conflict markers');
    }

    return resolved;
}
