/**
 * Stat-keyed metadata index for file-backed native CLI transcript stores.
 *
 * File-backed providers (Codex, Claude Code) answer list requests from cheap
 * `statSync` calls instead of re-reading and re-parsing every transcript. An
 * entry is reused only while the file's `mtimeMs` and `size` are unchanged, so
 * an externally-rewritten transcript is re-parsed on the next request.
 *
 * The index also carries the raw text of files it read during the current
 * request via {@link NativeTranscriptIndex.readRaw}, so a list request that
 * both parses metadata and substring-searches a transcript reads the file once
 * rather than twice.
 *
 * Entries are bounded and evicted least-recently-used first so a long-lived
 * server process cannot retain unbounded metadata for a growing CLI store.
 */

import * as fs from 'fs';

/** Default number of transcript files an index keeps metadata for. */
export const DEFAULT_TRANSCRIPT_INDEX_CAPACITY = 2000;

interface IndexEntry<TMetadata> {
    mtimeMs: number;
    size: number;
    metadata: TMetadata | null;
}

export interface NativeTranscriptIndexOptions<TMetadata> {
    /**
     * Parse list metadata for one transcript file. Returning `null` marks the
     * file as "known to carry no usable session", which is cached too so an
     * unparseable file is not re-read on every list request.
     */
    parseMetadata: (filePath: string, raw: string, stat: fs.Stats) => TMetadata | null;
    /** Maximum number of cached files. Defaults to {@link DEFAULT_TRANSCRIPT_INDEX_CAPACITY}. */
    capacity?: number;
    /** Injected filesystem seam; tests use it to assert read/stat counts. */
    fileSystem?: TranscriptFileSystem;
}

/** The narrow filesystem surface the index needs. */
export interface TranscriptFileSystem {
    statSync: (filePath: string) => fs.Stats | null;
    readUtf8: (filePath: string) => string | null;
}

export const nodeTranscriptFileSystem: TranscriptFileSystem = {
    statSync: filePath => {
        try {
            return fs.statSync(filePath);
        } catch {
            return null;
        }
    },
    readUtf8: filePath => {
        try {
            return fs.readFileSync(filePath, 'utf8');
        } catch {
            return null;
        }
    },
};

export class NativeTranscriptIndex<TMetadata> {
    private readonly entries = new Map<string, IndexEntry<TMetadata>>();
    private readonly capacity: number;
    private readonly fileSystem: TranscriptFileSystem;
    private readonly parseMetadata: NativeTranscriptIndexOptions<TMetadata>['parseMetadata'];
    /** Raw text read while serving the current request, keyed by file path. */
    private readonly rawThisPass = new Map<string, string | null>();

    constructor(options: NativeTranscriptIndexOptions<TMetadata>) {
        this.parseMetadata = options.parseMetadata;
        this.capacity = Math.max(1, options.capacity ?? DEFAULT_TRANSCRIPT_INDEX_CAPACITY);
        this.fileSystem = options.fileSystem ?? nodeTranscriptFileSystem;
    }

    /**
     * Begin a request pass. Drops any raw file text carried from the previous
     * pass so transcripts are never served from a stale in-memory copy.
     */
    beginPass(): void {
        this.rawThisPass.clear();
    }

    /**
     * Cached list metadata for one transcript file, parsing it only when the
     * file is new or has changed since it was last indexed.
     */
    getMetadata(filePath: string): TMetadata | null {
        const stat = this.fileSystem.statSync(filePath);
        if (!stat?.isFile()) {
            return null;
        }
        const cached = this.entries.get(filePath);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            // Refresh LRU recency without re-reading the file.
            this.entries.delete(filePath);
            this.entries.set(filePath, cached);
            return cached.metadata;
        }
        const raw = this.readRaw(filePath);
        const metadata = raw === null ? null : this.parseMetadata(filePath, raw, stat);
        this.store(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, metadata });
        return metadata;
    }

    /**
     * Raw transcript text, reusing the read performed earlier in this pass when
     * one happened. Callers that need full reconstruction (detail requests) or
     * substring search go through here so one pass never reads a file twice.
     */
    readRaw(filePath: string): string | null {
        if (this.rawThisPass.has(filePath)) {
            return this.rawThisPass.get(filePath) ?? null;
        }
        const raw = this.fileSystem.readUtf8(filePath);
        this.rawThisPass.set(filePath, raw);
        return raw;
    }

    /** Number of files currently held in the index. Exposed for tests. */
    get size(): number {
        return this.entries.size;
    }

    private store(filePath: string, entry: IndexEntry<TMetadata>): void {
        this.entries.delete(filePath);
        this.entries.set(filePath, entry);
        while (this.entries.size > this.capacity) {
            const oldest = this.entries.keys().next();
            if (oldest.done) {
                break;
            }
            this.entries.delete(oldest.value);
        }
    }
}
