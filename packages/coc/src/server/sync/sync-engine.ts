/**
 * Git-backed sync engine for My Work / My Life notes.
 *
 * Clones/pulls/pushes a user-configured Git remote to synchronize
 * note files across machines. Uses a single shared repo at ~/.coc/sync/.
 *
 * Mapping:
 *   ~/.coc/repos/my_work/notes/  ↔  sync-repo/my-work/
 *   ~/.coc/repos/my_life/notes/  ↔  sync-repo/my-life/
 */

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import type { AIInvoker } from '@plusplusoneplusplus/forge';
import type { ResolvedCLIConfig } from '../../config';

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
    resolvedConfig: ResolvedCLIConfig;
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

function buildFolderMappings(dataDir: string): FolderMapping[] {
    return [
        {
            repoFolder: 'my-work',
            localDir: path.join(dataDir, 'repos', 'my_work', 'notes'),
        },
        {
            repoFolder: 'my-life',
            localDir: path.join(dataDir, 'repos', 'my_life', 'notes'),
        },
    ];
}

// ── Git helpers ──────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
    return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120_000,
    }).trim();
}

function isGitRepo(dir: string): boolean {
    try {
        git(['rev-parse', '--is-inside-work-tree'], dir);
        return true;
    } catch {
        return false;
    }
}

// ── Lock file helpers ────────────────────────────────────────────────────────

function acquireLock(lockPath: string): boolean {
    try {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
        return true;
    } catch {
        // Check for stale lock
        try {
            const pid = parseInt(fs.readFileSync(lockPath, 'utf8'), 10);
            if (pid && !isProcessRunning(pid)) {
                fs.unlinkSync(lockPath);
                fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
                return true;
            }
        } catch { /* lock held by active process */ }
        return false;
    }
}

function releaseLock(lockPath: string): void {
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
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

function copyDirContents(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });

    // Remove files in dest that don't exist in src
    if (fs.existsSync(dest)) {
        for (const entry of fs.readdirSync(dest, { withFileTypes: true })) {
            const destPath = path.join(dest, entry.name);
            const srcPath = path.join(src, entry.name);
            if (!fs.existsSync(srcPath)) {
                if (entry.isDirectory()) {
                    fs.rmSync(destPath, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(destPath);
                }
            }
        }
    }

    if (!fs.existsSync(src)) return;

    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirContents(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// ── SyncEngine ───────────────────────────────────────────────────────────────

export class SyncEngine {
    private readonly dataDir: string;
    private readonly syncRepoDir: string;
    private readonly lockPath: string;
    private readonly logger: SyncLogger;
    private readonly mappings: FolderMapping[];
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
        this.syncRepoDir = path.join(opts.dataDir, 'sync');
        this.lockPath = path.join(this.syncRepoDir, '.lock');
        this.logger = opts.logger ?? DEFAULT_LOGGER;
        this.mappings = buildFolderMappings(opts.dataDir);
        this.aiInvoker = opts.aiInvoker;
        this.status.enabled = isSyncEnabled(opts.resolvedConfig);
    }

    /** Returns the current sync status. */
    getStatus(): SyncStatus {
        return { ...this.status };
    }

    /** Update the config (e.g. after admin config change). */
    updateConfig(config: ResolvedCLIConfig): void {
        const wasEnabled = this.status.enabled;
        this.status.enabled = isSyncEnabled(config);

        if (this.status.enabled && !wasEnabled) {
            this.startPeriodicSync(config.sync.intervalMinutes);
        } else if (!this.status.enabled && wasEnabled) {
            this.stopPeriodicSync();
        }
    }

    /**
     * Start the sync engine: do an initial sync, then schedule periodic syncs.
     * Safe to call even when sync is disabled (will be a no-op).
     */
    async start(config: ResolvedCLIConfig): Promise<void> {
        if (!isSyncEnabled(config)) {
            this.logger.info('Sync disabled (no gitRemote configured)');
            return;
        }

        this.status.enabled = true;
        this.logger.info('Starting sync engine');

        // Fire-and-forget initial sync — don't block server startup
        this.performSync(config.sync.gitRemote).catch(() => {});

        this.startPeriodicSync(config.sync.intervalMinutes);
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

        if (!acquireLock(this.lockPath)) {
            this.logger.warn('Could not acquire sync lock, skipping');
            return;
        }

        this.gitRemoteCache = gitRemote;
        this.status.inProgress = true;
        this.status.lastError = null;

        try {
            // 1. Ensure the sync repo exists (clone or verify)
            this.ensureSyncRepo(gitRemote);

            // 2. Copy local notes → sync repo
            this.copyLocalToRepo();

            // 3. Stage + commit local changes
            this.commitLocalChanges();

            // 4. Pull remote changes (may produce conflicts)
            const hasConflicts = this.pullRemote();

            // 5. If conflicts, resolve them
            if (hasConflicts) {
                await this.resolveConflicts();
            }

            // 6. Push to remote
            this.pushToRemote();

            // 7. Copy sync repo → local notes
            this.copyRepoToLocal();

            this.status.lastSyncTime = new Date().toISOString();
            this.status.lastError = null;
            this.logger.info(`Sync completed successfully at ${this.status.lastSyncTime}`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.status.lastError = message;
            this.logger.error(`Sync failed: ${message}`);
        } finally {
            this.status.inProgress = false;
            releaseLock(this.lockPath);
        }
    }

    private ensureSyncRepo(gitRemote: string): void {
        if (isGitRepo(this.syncRepoDir)) {
            // Verify the remote matches
            try {
                const currentRemote = git(['remote', 'get-url', 'origin'], this.syncRepoDir);
                if (currentRemote !== gitRemote) {
                    git(['remote', 'set-url', 'origin', gitRemote], this.syncRepoDir);
                    this.logger.info('Updated sync repo remote URL');
                }
            } catch {
                git(['remote', 'add', 'origin', gitRemote], this.syncRepoDir);
            }
            return;
        }

        // Clone fresh
        fs.mkdirSync(this.syncRepoDir, { recursive: true });
        try {
            git(['clone', gitRemote, '.'], this.syncRepoDir);
            this.logger.info('Cloned sync repo');
        } catch {
            // Remote might be empty — init locally and add remote
            git(['init'], this.syncRepoDir);
            git(['remote', 'add', 'origin', gitRemote], this.syncRepoDir);
            this.logger.info('Initialized empty sync repo with remote');
        }
    }

    private copyLocalToRepo(): void {
        for (const mapping of this.mappings) {
            const repoSubDir = path.join(this.syncRepoDir, mapping.repoFolder);
            if (fs.existsSync(mapping.localDir)) {
                copyDirContents(mapping.localDir, repoSubDir);
            }
        }
    }

    private commitLocalChanges(): void {
        git(['add', '-A'], this.syncRepoDir);

        // Check if there's anything to commit
        try {
            git(['diff', '--cached', '--quiet'], this.syncRepoDir);
            // No changes staged
        } catch {
            // Changes exist — commit them
            const hostname = require('os').hostname();
            git(
                ['commit', '-m', `sync from ${hostname} at ${new Date().toISOString()}`],
                this.syncRepoDir,
            );
            this.logger.info('Committed local changes');
        }
    }

    private pullRemote(): boolean {
        try {
            // Check if remote has any commits first
            try {
                git(['ls-remote', '--heads', 'origin'], this.syncRepoDir);
            } catch {
                return false; // Can't reach remote or empty
            }

            git(['pull', '--no-rebase', 'origin', 'HEAD'], this.syncRepoDir);
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
        const statusOutput = git(['status', '--porcelain'], this.syncRepoDir);
        const conflictedFiles = statusOutput
            .split('\n')
            .filter(line => line.startsWith('UU') || line.startsWith('AA') || line.startsWith('DU') || line.startsWith('UD'))
            .map(line => line.slice(3).trim());

        if (conflictedFiles.length === 0) return;

        this.logger.info(`Resolving ${conflictedFiles.length} conflicted file(s)`);

        for (const file of conflictedFiles) {
            const filePath = path.join(this.syncRepoDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const resolved = await this.resolveFileConflict(file, content);
                fs.writeFileSync(filePath, resolved, 'utf8');
                git(['add', file], this.syncRepoDir);
            } catch (err) {
                this.logger.error(`Failed to resolve conflict in ${file}: ${err}`);
                // Accept theirs as fallback
                try {
                    git(['checkout', '--theirs', file], this.syncRepoDir);
                    git(['add', file], this.syncRepoDir);
                } catch { /* last resort: skip */ }
            }
        }

        try {
            git(['commit', '--no-edit'], this.syncRepoDir);
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

    private pushToRemote(): void {
        try {
            git(['push', '-u', 'origin', 'HEAD'], this.syncRepoDir);
            this.logger.info('Pushed to remote');
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`Push failed (will retry next cycle): ${message}`);
        }
    }

    private copyRepoToLocal(): void {
        for (const mapping of this.mappings) {
            const repoSubDir = path.join(this.syncRepoDir, mapping.repoFolder);
            if (fs.existsSync(repoSubDir)) {
                fs.mkdirSync(mapping.localDir, { recursive: true });
                copyDirContents(repoSubDir, mapping.localDir);
            }
        }
    }
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function isSyncEnabled(config: ResolvedCLIConfig): boolean {
    return typeof config.sync?.gitRemote === 'string' && config.sync.gitRemote.length > 0;
}

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
