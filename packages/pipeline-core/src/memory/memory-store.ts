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
} from './types';

/** Compute a stable 16-char hex hash for a repository root path. */
export function computeRepoHash(repoPath: string): string {
    return crypto
        .createHash('sha256')
        .update(path.resolve(repoPath))
        .digest('hex')
        .substring(0, 16);
}

export class FileMemoryStore implements MemoryStore {
    private readonly dataDir: string;
    private readonly systemDir: string;
    private readonly reposDir: string;
    private writeQueue: Promise<void>;

    constructor(options?: MemoryStoreOptions) {
        this.dataDir = options?.dataDir ?? path.join(os.homedir(), '.coc', 'memory');
        this.systemDir = path.join(this.dataDir, 'system');
        this.reposDir = path.join(this.dataDir, 'repos');
        this.writeQueue = Promise.resolve();
    }

    // --- Write queue serialization (FileProcessStore pattern) ---

    private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(
            () => {},
            () => {},
        );
        return result;
    }

    // --- Path helpers ---

    getSystemDir(): string {
        return this.systemDir;
    }

    getRepoDir(repoHash: string): string {
        return path.join(this.reposDir, repoHash);
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
        if ((level === 'repo' || level === 'both') && repoHash) {
            await fs.mkdir(path.join(this.reposDir, repoHash, 'raw'), { recursive: true });
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
        if (level === 'repo' && repoHash) {
            return path.join(this.reposDir, repoHash, 'raw');
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
            if ((level === 'repo' || level === 'both') && repoHash) {
                await writeTo(path.join(this.reposDir, repoHash, 'raw'));
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
        if ((level === 'repo' || level === 'both') && repoHash) {
            results.push(...await readDir(path.join(this.reposDir, repoHash, 'raw')));
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
            if (repoHash) dirs.push(path.join(this.reposDir, repoHash, 'raw'));
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
            if ((level === 'repo' || level === 'both') && repoHash) {
                if (await tryDelete(path.join(this.reposDir, repoHash, 'raw'))) {
                    deleted = true;
                }
            }
        });
        return deleted;
    }

    // --- Consolidated memory (stub — implemented in 003) ---

    async readConsolidated(
        _level: MemoryLevel,
        _repoHash?: string,
    ): Promise<string | null> {
        throw new Error('Not implemented — see task 003');
    }

    async writeConsolidated(
        _level: MemoryLevel,
        _content: string,
        _repoHash?: string,
    ): Promise<void> {
        throw new Error('Not implemented — see task 003');
    }

    // --- Index (stub — implemented in 003) ---

    async readIndex(
        _level: MemoryLevel,
        _repoHash: string | undefined,
    ): Promise<MemoryIndex> {
        throw new Error('Not implemented — see task 003');
    }

    async updateIndex(
        _level: MemoryLevel,
        _repoHash: string | undefined,
        _updates: Partial<MemoryIndex>,
    ): Promise<void> {
        throw new Error('Not implemented — see task 003');
    }

    // --- Repo info (stub — implemented in 003) ---

    async getRepoInfo(_repoHash: string): Promise<RepoInfo | null> {
        throw new Error('Not implemented — see task 003');
    }

    async updateRepoInfo(_repoHash: string, _info: Partial<RepoInfo>): Promise<void> {
        throw new Error('Not implemented — see task 003');
    }

    // --- Management (stub — implemented in 003) ---

    async clear(
        _level: MemoryLevel,
        _repoHash?: string,
        _rawOnly?: boolean,
    ): Promise<void> {
        throw new Error('Not implemented — see task 003');
    }

    async getStats(
        _level: MemoryLevel,
        _repoHash?: string,
    ): Promise<MemoryStats> {
        throw new Error('Not implemented — see task 003');
    }

    async listRepos(): Promise<string[]> {
        throw new Error('Not implemented — see task 003');
    }
}
