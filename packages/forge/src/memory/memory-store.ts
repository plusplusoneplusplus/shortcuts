/**
 * FileMemoryStore — persistence layer for the CoC memory system.
 *
 * Handles storage layout, repo hashing, and raw observation CRUD.
 * Follows FileProcessStore patterns: atomic tmp→rename writes,
 * write-queue serialization, and mkdir({ recursive: true }).
 *
 * No VS Code dependencies — pure Node.js.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import {
    MemoryStore,
    MemoryStoreOptions,
    MemoryLevel,
    RawObservation,
    RawObservationMetadata,
    MemoryIndex,
    MemoryStats,
    RepoInfo,
    GitRemoteInfo,
} from './types';
import { BaseFileStore } from './base-file-store';

/** Compute a stable 16-char hex hash for a repository root path. */
export function computeRepoHash(repoPath: string): string {
    return crypto
        .createHash('sha256')
        .update(path.resolve(repoPath))
        .digest('hex')
        .substring(0, 16);
}

export class FileMemoryStore extends BaseFileStore implements MemoryStore {
    private readonly dataDir: string;
    private readonly systemDir: string;
    private readonly reposDir: string;
    private readonly gitRemotesDir: string;
    private readonly _repoDir?: string;

    constructor(options?: MemoryStoreOptions) {
        super();
        this.dataDir = options?.dataDir ?? process.env.COC_DATA_DIR ?? path.join(os.homedir(), '.coc', 'memory');
        this.systemDir = path.join(this.dataDir, 'system');
        this.reposDir = path.join(this.dataDir, 'repos');
        this.gitRemotesDir = path.join(this.dataDir, 'git-remotes');
        this._repoDir = options?.repoDir;
    }

    /**
     * Resolve the repo-level directory. When `_repoDir` is set it takes
     * precedence; otherwise falls back to the traditional hash-based path.
     * Returns `undefined` when neither source can produce a path.
     */
    private resolveRepoDir(repoHash?: string): string | undefined {
        if (this._repoDir) return this._repoDir;
        if (repoHash) return path.join(this.reposDir, repoHash);
        return undefined;
    }

    // --- Path helpers ---

    getSystemDir(): string {
        return this.systemDir;
    }

    getRepoDir(repoHash: string): string {
        return path.join(this.reposDir, repoHash);
    }

    getGitRemoteDir(remoteHash: string): string {
        return path.join(this.gitRemotesDir, remoteHash);
    }

    computeRepoHash(repoPath: string): string {
        return computeRepoHash(repoPath);
    }

    // --- Storage layout ---

    /** Create the raw/ directory for the specified level(s). Idempotent. */
    async ensureStorageLayout(level: MemoryLevel, repoHash?: string): Promise<void> {
        if (level === 'system' || level === 'both') {
            await fs.mkdir(path.join(this.systemDir, 'raw'), { recursive: true });
        }
        const repoDir = this.resolveRepoDir(repoHash);
        if ((level === 'repo' || level === 'both') && repoDir) {
            await fs.mkdir(path.join(repoDir, 'raw'), { recursive: true });
        }
        if (level === 'git-remote' && repoHash) {
            await fs.mkdir(path.join(this.gitRemotesDir, repoHash, 'raw'), { recursive: true });
        }
    }

    // --- Filename helpers ---

    private sanitizePipelineId(id: string): string {
        return id.replace(/[^a-zA-Z0-9\-_]/g, '_');
    }

    private generateRawFilename(metadata: RawObservationMetadata): string {
        const ts = metadata.timestamp.replace(/:/g, '-');
        const pipeline = this.sanitizePipelineId(metadata.pipeline);
        return `${ts}-${pipeline}.md`;
    }

    // --- Raw observation format ---

    private formatRawObservation(metadata: RawObservationMetadata, content: string): string {
        const lines = [
            '---',
            `pipeline: ${metadata.pipeline}`,
            `timestamp: ${metadata.timestamp}`,
        ];
        if (metadata.repo) lines.push(`repo: ${metadata.repo}`);
        if (metadata.model) lines.push(`model: ${metadata.model}`);
        lines.push('---');
        return lines.join('\n') + '\n\n' + content.trim() + '\n';
    }

    private parseRawObservation(fileContent: string, filename: string): RawObservation {
        const frontmatterMatch = fileContent.match(/^---\n([\s\S]*?)\n---\n/);
        if (!frontmatterMatch) {
            throw new Error(`Invalid raw observation format: ${filename}`);
        }
        const frontmatter = frontmatterMatch[1];
        const content = fileContent.slice(frontmatterMatch[0].length).trim();

        const metadata: RawObservationMetadata = {
            pipeline: this.extractField(frontmatter, 'pipeline') ?? 'unknown',
            timestamp: this.extractField(frontmatter, 'timestamp') ?? new Date().toISOString(),
            repo: this.extractField(frontmatter, 'repo'),
            model: this.extractField(frontmatter, 'model'),
        };

        return { metadata, content, filename };
    }

    private extractField(frontmatter: string, field: string): string | undefined {
        const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, 'm'));
        return match?.[1]?.trim();
    }

    // --- Raw observation CRUD ---

    private rawDir(level: MemoryLevel, repoHash: string | undefined): string {
        if (level === 'repo') {
            const repoDir = this.resolveRepoDir(repoHash);
            if (repoDir) return path.join(repoDir, 'raw');
        }
        if (level === 'git-remote' && repoHash) {
            return path.join(this.gitRemotesDir, repoHash, 'raw');
        }
        return path.join(this.systemDir, 'raw');
    }

    async writeRaw(
        level: MemoryLevel,
        repoHash: string | undefined,
        metadata: RawObservationMetadata,
        content: string,
    ): Promise<string> {
        const filename = this.generateRawFilename(metadata);
        const fileContent = this.formatRawObservation(metadata, content);

        await this.enqueueWrite(async () => {
            const writeTo = async (dir: string): Promise<void> => {
                await fs.mkdir(dir, { recursive: true });
                const filePath = path.join(dir, filename);
                const tmpPath = filePath + '.tmp';
                await fs.writeFile(tmpPath, fileContent, 'utf-8');
                await fs.rename(tmpPath, filePath);
            };

            if (level === 'system' || level === 'both') {
                await writeTo(path.join(this.systemDir, 'raw'));
            }
            const repoDir = this.resolveRepoDir(repoHash);
            if ((level === 'repo' || level === 'both') && repoDir) {
                await writeTo(path.join(repoDir, 'raw'));
            }
            if (level === 'git-remote' && repoHash) {
                await writeTo(path.join(this.gitRemotesDir, repoHash, 'raw'));
            }
        });

        return filename;
    }

    async listRaw(
        level: MemoryLevel,
        repoHash: string | undefined,
    ): Promise<string[]> {
        const readDir = async (rawDir: string): Promise<string[]> => {
            try {
                const files = await fs.readdir(rawDir);
                return files.filter(f => f.endsWith('.md')).sort();
            } catch {
                return [];
            }
        };

        const results: string[] = [];

        if (level === 'system' || level === 'both') {
            results.push(...await readDir(path.join(this.systemDir, 'raw')));
        }
        const repoDir = this.resolveRepoDir(repoHash);
        if ((level === 'repo' || level === 'both') && repoDir) {
            results.push(...await readDir(path.join(repoDir, 'raw')));
        }
        if (level === 'git-remote' && repoHash) {
            results.push(...await readDir(path.join(this.gitRemotesDir, repoHash, 'raw')));
        }

        // Deduplicate (both level may share filenames) and sort newest first
        const unique = [...new Set(results)];
        unique.sort().reverse();
        return unique;
    }

    async readRaw(
        level: MemoryLevel,
        repoHash: string | undefined,
        filename: string,
    ): Promise<RawObservation | undefined> {
        // Determine which directory to read from (prefer repo for 'both')
        const dirs: string[] = [];
        if (level === 'repo' || level === 'both') {
            const repoDir = this.resolveRepoDir(repoHash);
            if (repoDir) dirs.push(path.join(repoDir, 'raw'));
        }
        if (level === 'git-remote') {
            if (repoHash) dirs.push(path.join(this.gitRemotesDir, repoHash, 'raw'));
        }
        if (level === 'system' || level === 'both') {
            dirs.push(path.join(this.systemDir, 'raw'));
        }

        for (const dir of dirs) {
            try {
                const filePath = path.join(dir, filename);
                const content = await fs.readFile(filePath, 'utf-8');
                return this.parseRawObservation(content, filename);
            } catch {
                // Try next directory
            }
        }
        return undefined;
    }

    async deleteRaw(
        level: MemoryLevel,
        repoHash: string | undefined,
        filename: string,
    ): Promise<boolean> {
        let deleted = false;
        await this.enqueueWrite(async () => {
            const tryDelete = async (dir: string): Promise<boolean> => {
                try {
                    await fs.unlink(path.join(dir, filename));
                    return true;
                } catch {
                    return false;
                }
            };

            if (level === 'system' || level === 'both') {
                if (await tryDelete(path.join(this.systemDir, 'raw'))) {
                    deleted = true;
                }
            }
            const repoDir = this.resolveRepoDir(repoHash);
            if ((level === 'repo' || level === 'both') && repoDir) {
                if (await tryDelete(path.join(repoDir, 'raw'))) {
                    deleted = true;
                }
            }
            if (level === 'git-remote' && repoHash) {
                if (await tryDelete(path.join(this.gitRemotesDir, repoHash, 'raw'))) {
                    deleted = true;
                }
            }
        });
        return deleted;
    }

    // --- Consolidated memory ---

    /** Resolve the base directory for a given level + hash. */
    private levelDir(level: MemoryLevel, hash?: string): string {
        if (level === 'git-remote' && hash) return this.getGitRemoteDir(hash);
        if (level === 'repo') {
            const dir = this.resolveRepoDir(hash);
            if (dir) return dir;
        }
        return this.getSystemDir();
    }

    async readConsolidated(
        level: MemoryLevel,
        repoHash?: string,
    ): Promise<string | null> {
        const dir = this.levelDir(level, repoHash);
        const filePath = path.join(dir, 'consolidated.md');
        try {
            return await fs.readFile(filePath, 'utf-8');
        } catch {
            return null;
        }
    }

    async writeConsolidated(
        level: MemoryLevel,
        content: string,
        repoHash?: string,
    ): Promise<void> {
        return this.enqueueWrite(async () => {
            const dir = this.levelDir(level, repoHash);
            const filePath = path.join(dir, 'consolidated.md');
            await this.atomicWrite(filePath, content);
        });
    }

    // --- Index ---

    async readIndex(
        level: MemoryLevel,
        repoHash: string | undefined,
    ): Promise<MemoryIndex> {
        const dir = this.levelDir(level, repoHash);
        return this.readJSON(path.join(dir, 'index.json'), { lastAggregation: null, rawCount: 0, factCount: 0, categories: [] } as MemoryIndex);
    }

    async updateIndex(
        level: MemoryLevel,
        repoHash: string | undefined,
        updates: Partial<MemoryIndex>,
    ): Promise<void> {
        return this.enqueueWrite(async () => {
            const existing = await this.readIndex(level, repoHash);
            const merged: MemoryIndex = { ...existing, ...updates };
            const dir = this.levelDir(level, repoHash);
            const filePath = path.join(dir, 'index.json');
            await this.atomicWrite(filePath, JSON.stringify(merged, null, 2));
        });
    }

    // --- Repo info ---

    async getRepoInfo(repoHash: string): Promise<RepoInfo | null> {
        return this.readJSON<RepoInfo | null>(path.join(this.getRepoDir(repoHash), 'repo-info.json'), null);
    }

    async updateRepoInfo(repoHash: string, info: Partial<RepoInfo>): Promise<void> {
        return this.enqueueWrite(async () => {
            const existing = await this.getRepoInfo(repoHash);
            const merged: RepoInfo = {
                path: '', name: '', lastAccessed: new Date().toISOString(),
                ...existing, ...info,
            };
            const dir = this.getRepoDir(repoHash);
            const filePath = path.join(dir, 'repo-info.json');
            await this.atomicWrite(filePath, JSON.stringify(merged, null, 2));
        });
    }

    // --- Git remote info ---

    async getGitRemoteInfo(remoteHash: string): Promise<GitRemoteInfo | null> {
        return this.readJSON<GitRemoteInfo | null>(path.join(this.getGitRemoteDir(remoteHash), 'remote-info.json'), null);
    }

    async updateGitRemoteInfo(remoteHash: string, info: Partial<GitRemoteInfo>): Promise<void> {
        return this.enqueueWrite(async () => {
            const existing = await this.getGitRemoteInfo(remoteHash);
            const merged: GitRemoteInfo = {
                remoteUrl: '', name: '', lastAccessed: new Date().toISOString(),
                ...existing, ...info,
            };
            const dir = this.getGitRemoteDir(remoteHash);
            const filePath = path.join(dir, 'remote-info.json');
            await this.atomicWrite(filePath, JSON.stringify(merged, null, 2));
        });
    }

    async listGitRemotes(): Promise<string[]> {
        return this.listDirectory(this.gitRemotesDir);
    }

    // --- Management ---

    async clear(
        level: MemoryLevel,
        repoHash?: string,
        rawOnly?: boolean,
    ): Promise<void> {
        return this.enqueueWrite(async () => {
            const dir = this.levelDir(level, repoHash);
            if (rawOnly) {
                const rawDir = path.join(dir, 'raw');
                try {
                    await fs.rm(rawDir, { recursive: true, force: true });
                    await fs.mkdir(rawDir, { recursive: true });
                } catch {
                    // raw dir may not exist
                }
            } else {
                try {
                    await fs.rm(dir, { recursive: true, force: true });
                } catch {
                    // dir may not exist
                }
            }
        });
    }

    async getStats(
        level: MemoryLevel,
        repoHash?: string,
    ): Promise<MemoryStats> {
        const dir = this.levelDir(level, repoHash);
        const rawDir = path.join(dir, 'raw');

        let rawCount = 0;
        try {
            const entries = await fs.readdir(rawDir);
            rawCount = entries.filter(e => e.endsWith('.md')).length;
        } catch {
            // raw dir may not exist
        }

        let consolidatedExists = false;
        try {
            await fs.access(path.join(dir, 'consolidated.md'));
            consolidatedExists = true;
        } catch {
            // doesn't exist
        }

        const index = await this.readIndex(level, repoHash);

        return {
            rawCount,
            consolidatedExists,
            lastAggregation: index.lastAggregation,
            factCount: index.factCount,
        };
    }

    async listRepos(): Promise<string[]> {
        return this.listDirectory(this.reposDir);
    }
}
