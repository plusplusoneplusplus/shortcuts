/**
 * Memory Store
 *
 * File-based storage for AI memory entries.
 * Each entry is stored as a JSON file in the storageDir.
 * A lightweight index.json tracks IDs + metadata for fast listing/search.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface MemoryEntry {
    /** Unique identifier (UUID). */
    id: string;
    /** Full text content of the memory. */
    content: string;
    /** Optional AI-generated one-line summary. */
    summary?: string;
    /** User-defined tags for filtering. */
    tags: string[];
    /** Origin: 'manual' | pipeline name | session id. */
    source: string;
    /** ISO-8601 creation timestamp. */
    createdAt: string;
    /** ISO-8601 last-updated timestamp. */
    updatedAt: string;
    /** Future: vector embedding for semantic search. */
    embedding?: number[];
}

/** Lightweight index record (no content/embedding) for fast listing. */
export type MemoryIndexRecord = Omit<MemoryEntry, 'content' | 'embedding'>;

export interface MemoryListQuery {
    /** Full-text search query (matched against content + tags). */
    q?: string;
    /** Filter by exact tag. */
    tag?: string;
    /** 1-based page number. */
    page?: number;
    /** Page size (default 20). */
    pageSize?: number;
}

export interface MemoryListResult {
    entries: MemoryIndexRecord[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

// ============================================================================
// Constants
// ============================================================================

const INDEX_FILE = 'index.json';
const DEFAULT_PAGE_SIZE = 20;

// ============================================================================
// FileMemoryStore
// ============================================================================

/**
 * File-based memory store.
 * Entries are stored as <storageDir>/<id>.json.
 * An index file at <storageDir>/index.json enables fast listing and search.
 */
export class FileMemoryStore {
    constructor(private readonly storageDir: string) {}

    /** Ensure the storage directory and index exist. */
    private ensureDir(): void {
        fs.mkdirSync(this.storageDir, { recursive: true });
    }

    private indexPath(): string {
        return path.join(this.storageDir, INDEX_FILE);
    }

    private entryPath(id: string): string {
        return path.join(this.storageDir, `${id}.json`);
    }

    /** Read the index from disk. Returns empty array on missing/corrupt file. */
    private readIndex(): MemoryIndexRecord[] {
        const p = this.indexPath();
        try {
            if (!fs.existsSync(p)) return [];
            const raw = fs.readFileSync(p, 'utf-8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /** Write the index atomically. */
    private writeIndex(index: MemoryIndexRecord[]): void {
        this.ensureDir();
        const tmpPath = this.indexPath() + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf-8');
        fs.renameSync(tmpPath, this.indexPath());
    }

    /** Write a single entry file atomically. */
    private writeEntryFile(entry: MemoryEntry): void {
        this.ensureDir();
        const filePath = this.entryPath(entry.id);
        const tmpPath = filePath + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(entry, null, 2), 'utf-8');
        fs.renameSync(tmpPath, filePath);
    }

    // ── Public API ──────────────────────────────────────────────────────

    /**
     * List entries with optional full-text search, tag filter, and pagination.
     */
    list(query: MemoryListQuery = {}): MemoryListResult {
        const index = this.readIndex();
        const { q, tag, page = 1, pageSize = DEFAULT_PAGE_SIZE } = query;

        let filtered = index;

        if (tag) {
            filtered = filtered.filter(e => e.tags.includes(tag));
        }

        if (q) {
            const lower = q.toLowerCase();
            filtered = filtered.filter(e =>
                (e.summary?.toLowerCase().includes(lower)) ||
                e.tags.some(t => t.toLowerCase().includes(lower)) ||
                e.source.toLowerCase().includes(lower),
            );
        }

        // Sort newest first
        filtered = [...filtered].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );

        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const safePage = Math.min(Math.max(1, page), totalPages);
        const start = (safePage - 1) * pageSize;
        const entries = filtered.slice(start, start + pageSize);

        return { entries, total, page: safePage, pageSize, totalPages };
    }

    /**
     * Get a single entry by ID (full content).
     * Returns undefined when not found.
     */
    get(id: string): MemoryEntry | undefined {
        const filePath = this.entryPath(id);
        try {
            if (!fs.existsSync(filePath)) return undefined;
            const raw = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(raw) as MemoryEntry;
        } catch {
            return undefined;
        }
    }

    /**
     * Create a new memory entry.
     * Generates a UUID if no id is provided.
     */
    create(input: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): MemoryEntry {
        this.ensureDir();
        const now = new Date().toISOString();
        const entry: MemoryEntry = {
            id: input.id ?? crypto.randomUUID(),
            content: input.content,
            summary: input.summary,
            tags: input.tags ?? [],
            source: input.source ?? 'manual',
            createdAt: now,
            updatedAt: now,
            embedding: input.embedding,
        };

        this.writeEntryFile(entry);

        // Update index
        const index = this.readIndex();
        const { content: _c, embedding: _e, ...record } = entry;
        index.push(record);
        this.writeIndex(index);

        return entry;
    }

    /**
     * Update tags and/or content of an existing entry.
     * Returns the updated entry, or undefined if not found.
     */
    update(id: string, patch: { tags?: string[]; content?: string; summary?: string }): MemoryEntry | undefined {
        const entry = this.get(id);
        if (!entry) return undefined;

        const updated: MemoryEntry = {
            ...entry,
            updatedAt: new Date().toISOString(),
        };
        if (patch.tags !== undefined) updated.tags = patch.tags;
        if (patch.content !== undefined) updated.content = patch.content;
        if (patch.summary !== undefined) updated.summary = patch.summary;

        this.writeEntryFile(updated);

        // Update index record
        const index = this.readIndex();
        const idx = index.findIndex(r => r.id === id);
        if (idx >= 0) {
            const { content: _c, embedding: _e, ...record } = updated;
            index[idx] = record;
            this.writeIndex(index);
        }

        return updated;
    }

    /**
     * Delete an entry by ID.
     * Returns true when deleted, false when not found.
     */
    delete(id: string): boolean {
        const filePath = this.entryPath(id);
        if (!fs.existsSync(filePath)) return false;

        try {
            fs.unlinkSync(filePath);
        } catch {
            return false;
        }

        // Remove from index
        const index = this.readIndex();
        const filtered = index.filter(r => r.id !== id);
        if (filtered.length !== index.length) {
            this.writeIndex(filtered);
        }

        return true;
    }
}
