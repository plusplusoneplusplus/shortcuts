/**
 * BoundedMemoryStore — Hermes-style bounded, file-backed memory store.
 *
 * Single-file, single-target bounded store with add/replace/remove operations,
 * substring matching, character limits, atomic writes, mkdir-based file locking,
 * and § entry delimiters.
 *
 * Extends BaseFileStore for atomic writes and write-queue serialization.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import { BaseFileStore } from './base-file-store';
import { scanMemoryContent } from './memory-security-scanner';
import type { BoundedMemoryStoreOptions, MemoryMutationResult, MemoryUsage } from './bounded-memory-types';
import { ENTRY_DELIMITER, DEFAULT_CHAR_LIMIT } from './bounded-memory-types';

export class BoundedMemoryStore extends BaseFileStore {
    private entries: string[] = [];
    private snapshot: string | null = null;
    private readonly filePath: string;
    private readonly charLimit: number;
    private readonly lockPath: string;

    constructor(options: BoundedMemoryStoreOptions) {
        super();
        this.filePath = options.filePath;
        this.charLimit = options.charLimit ?? DEFAULT_CHAR_LIMIT;
        this.lockPath = options.filePath + '.lock';
    }

    /** Load entries from disk, deduplicate, capture frozen snapshot. */
    async load(): Promise<void> {
        const raw = await this.readFromDisk();
        this.entries = this.deduplicate(raw);
        this.snapshot = this.entries.length > 0 ? this.serialize(this.entries) : null;
    }

    /** Add a new entry. Rejects if empty, duplicate, over limit, or fails security scan. */
    async add(content: string): Promise<MemoryMutationResult> {
        const trimmed = content.trim();
        if (!trimmed) {
            return this.failResult('Content cannot be empty.');
        }

        const scan = scanMemoryContent(trimmed);
        if (scan.blocked) {
            return this.failResult(`Content blocked by security scanner: ${scan.reason}`);
        }

        return this.enqueueWrite(async () => {
            await this.acquireLock();
            try {
                this.entries = this.deduplicate(await this.readFromDisk());

                if (this.entries.includes(trimmed)) {
                    return this.failResult('Entry already exists.');
                }

                const newEntries = [...this.entries, trimmed];
                const serialized = this.serialize(newEntries);
                if (serialized.length > this.charLimit) {
                    const currentLen = this.entries.length > 0 ? this.serialize(this.entries).length : 0;
                    return this.failResult(
                        `Memory at ${currentLen.toLocaleString()}/${this.charLimit.toLocaleString()} chars. ` +
                        `Adding this entry (${trimmed.length} chars) would exceed the limit. ` +
                        `Replace or remove existing entries first.`,
                    );
                }

                await this.atomicWrite(this.filePath, serialized);
                this.entries = newEntries;
                return this.successResult('Entry added.');
            } finally {
                await this.releaseLock();
            }
        });
    }

    /** Replace entry matched by oldText substring with newContent. */
    async replace(oldText: string, newContent: string): Promise<MemoryMutationResult> {
        if (!oldText) {
            return this.failResult('Search text cannot be empty.');
        }
        const trimmedNew = newContent.trim();
        if (!trimmedNew) {
            return this.failResult('Replacement content cannot be empty. Use remove() instead.');
        }

        const scan = scanMemoryContent(trimmedNew);
        if (scan.blocked) {
            return this.failResult(`Content blocked by security scanner: ${scan.reason}`);
        }

        return this.enqueueWrite(async () => {
            await this.acquireLock();
            try {
                this.entries = this.deduplicate(await this.readFromDisk());
                const matches = this.findMatches(this.entries, oldText);

                const resolution = this.resolveMatches(matches, oldText);
                if ('error' in resolution) return resolution.error;

                const { index } = resolution.resolved;
                const newEntries = [...this.entries];
                newEntries[index] = trimmedNew;

                const serialized = this.serialize(newEntries);
                if (serialized.length > this.charLimit) {
                    return this.failResult(
                        `Replacement would put memory at ${serialized.length.toLocaleString()}/${this.charLimit.toLocaleString()} chars. ` +
                        `Try a shorter replacement or remove other entries first.`,
                    );
                }

                await this.atomicWrite(this.filePath, serialized);
                this.entries = newEntries;
                return this.successResult('Entry replaced.');
            } finally {
                await this.releaseLock();
            }
        });
    }

    /** Remove entry matched by oldText substring. */
    async remove(oldText: string): Promise<MemoryMutationResult> {
        if (!oldText) {
            return this.failResult('Search text cannot be empty.');
        }

        return this.enqueueWrite(async () => {
            await this.acquireLock();
            try {
                this.entries = this.deduplicate(await this.readFromDisk());
                const matches = this.findMatches(this.entries, oldText);

                const resolution = this.resolveMatches(matches, oldText);
                if ('error' in resolution) return resolution.error;

                const { index } = resolution.resolved;
                const newEntries = this.entries.filter((_, i) => i !== index);

                const serialized = newEntries.length > 0 ? this.serialize(newEntries) : '';
                await this.atomicWrite(this.filePath, serialized);
                this.entries = newEntries;
                return this.successResult('Entry removed.');
            } finally {
                await this.releaseLock();
            }
        });
    }

    /** Read current live entries (not snapshot). No file lock needed. */
    read(): string[] {
        return [...this.entries];
    }

    /** Return the frozen snapshot captured at load() time. Null if not loaded or empty. */
    getSnapshot(): string | null {
        return this.snapshot;
    }

    /** Return current usage statistics. */
    getUsage(): MemoryUsage {
        return this.computeUsage(this.entries);
    }

    /** Return the configured character limit. */
    getCharLimit(): number {
        return this.charLimit;
    }

    /**
     * Trusted atomic rewrite: replace all entries with a reconciled list.
     *
     * Used by the reconciliation core after AI-proposed entries have been
     * validated. Each entry is re-scanned for security threats. The total
     * serialized size must not exceed the char limit.
     *
     * Entries are trimmed, deduplicated, and empty strings are filtered out.
     */
    async setEntries(newEntries: string[]): Promise<MemoryMutationResult> {
        return this.enqueueWrite(async () => {
            await this.acquireLock();
            try {
                // Trim, filter empty, deduplicate
                const cleaned: string[] = [];
                const seen = new Set<string>();
                for (const entry of newEntries) {
                    const trimmed = entry.trim();
                    if (!trimmed) continue;
                    if (seen.has(trimmed)) continue;
                    seen.add(trimmed);
                    cleaned.push(trimmed);
                }

                // Security scan each entry
                for (const entry of cleaned) {
                    const scan = scanMemoryContent(entry);
                    if (scan.blocked) {
                        return this.failResult(
                            `Entry blocked by security scanner: ${scan.reason} — entry: "${entry.substring(0, 80)}"`,
                        );
                    }
                }

                // Enforce char limit
                if (cleaned.length > 0) {
                    const serialized = this.serialize(cleaned);
                    if (serialized.length > this.charLimit) {
                        return this.failResult(
                            `Reconciled entries (${serialized.length} chars) exceed the limit (${this.charLimit} chars).`,
                        );
                    }
                    await this.atomicWrite(this.filePath, serialized);
                } else {
                    await this.atomicWrite(this.filePath, '');
                }

                this.entries = cleaned;
                return this.successResult(
                    `Memory rewritten with ${cleaned.length} entries.`,
                );
            } finally {
                await this.releaseLock();
            }
        });
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private async readFromDisk(): Promise<string[]> {
        try {
            const content = await fs.readFile(this.filePath, 'utf-8');
            if (!content.trim()) return [];
            return content.split(ENTRY_DELIMITER)
                .map(e => e.trim())
                .filter(e => e.length > 0);
        } catch (err: any) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }
    }

    private deduplicate(entries: string[]): string[] {
        const seen = new Set<string>();
        return entries.filter(entry => {
            if (seen.has(entry)) return false;
            seen.add(entry);
            return true;
        });
    }

    private serialize(entries: string[]): string {
        return entries.join(ENTRY_DELIMITER);
    }

    private computeUsage(entries: string[]): MemoryUsage {
        const current = entries.length > 0 ? this.serialize(entries).length : 0;
        return {
            current,
            limit: this.charLimit,
            percent: this.charLimit > 0 ? Math.min(100, Math.round((current / this.charLimit) * 100)) : 0,
            entryCount: entries.length,
        };
    }

    private findMatches(entries: string[], substring: string): Array<{ index: number; entry: string }> {
        return entries
            .map((entry, index) => ({ index, entry }))
            .filter(({ entry }) => entry.includes(substring));
    }

    private resolveMatches(
        matches: Array<{ index: number; entry: string }>,
        substring: string,
    ): { resolved: { index: number; entry: string } } | { error: MemoryMutationResult } {
        if (matches.length === 0) {
            return { error: this.failResult(`No entry matched '${substring}'.`) };
        }

        if (matches.length === 1) {
            return { resolved: matches[0] };
        }

        const allIdentical = matches.every(m => m.entry === matches[0].entry);
        if (allIdentical) {
            return { resolved: matches[0] };
        }

        const previews = matches.map(m => m.entry.substring(0, 80));
        return {
            error: {
                ...this.failResult('Multiple entries matched. Be more specific.'),
                matches: previews,
            },
        };
    }

    private failResult(message: string): MemoryMutationResult {
        return {
            success: false,
            message,
            entries: [...this.entries],
            usage: this.computeUsage(this.entries),
        };
    }

    private successResult(message: string): MemoryMutationResult {
        return {
            success: true,
            message,
            entries: [...this.entries],
            usage: this.computeUsage(this.entries),
        };
    }

    // -----------------------------------------------------------------------
    // File locking — mkdir-based, cross-platform
    // -----------------------------------------------------------------------

    private async acquireLock(timeoutMs = 5000): Promise<void> {
        await fs.mkdir(path.dirname(this.lockPath), { recursive: true });
        const start = Date.now();
        while (true) {
            try {
                await fs.mkdir(this.lockPath);
                return;
            } catch (err: any) {
                if (err.code !== 'EEXIST') throw err;
                if (Date.now() - start > timeoutMs) {
                    try {
                        const stat = await fs.stat(this.lockPath);
                        if (Date.now() - stat.mtimeMs > 30000) {
                            await fs.rm(this.lockPath, { recursive: true, force: true });
                            continue;
                        }
                    } catch { /* lock dir vanished between check and stat */ }
                    throw new Error(`Failed to acquire memory lock after ${timeoutMs}ms`);
                }
                await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
            }
        }
    }

    private async releaseLock(): Promise<void> {
        await fs.rm(this.lockPath, { recursive: true, force: true });
    }
}
