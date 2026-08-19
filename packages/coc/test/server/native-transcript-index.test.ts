/**
 * The transcript index is what keeps file-backed list requests from scaling
 * with total transcript bytes: repeat requests answer from cached metadata and
 * do no reads, and one request never reads the same file twice.
 */

import * as fs from 'fs';
import { describe, expect, it } from 'vitest';
import {
    NativeTranscriptIndex,
    type TranscriptFileSystem,
} from '../../src/server/native-copilot-sessions/native-transcript-index';

interface FakeFile {
    raw: string;
    mtimeMs: number;
}

function makeFileSystem(files: Record<string, FakeFile>) {
    const reads: string[] = [];
    const stats: string[] = [];
    const fileSystem: TranscriptFileSystem = {
        statSync: filePath => {
            stats.push(filePath);
            const file = files[filePath];
            if (!file) {
                return null;
            }
            return {
                isFile: () => true,
                mtimeMs: file.mtimeMs,
                size: Buffer.byteLength(file.raw, 'utf8'),
            } as unknown as fs.Stats;
        },
        readUtf8: filePath => {
            reads.push(filePath);
            return files[filePath]?.raw ?? null;
        },
    };
    return { fileSystem, reads, stats };
}

function makeIndex(files: Record<string, FakeFile>, capacity?: number) {
    const { fileSystem, reads, stats } = makeFileSystem(files);
    const parseCalls: string[] = [];
    const index = new NativeTranscriptIndex<{ id: string; chars: number }>({
        fileSystem,
        capacity,
        parseMetadata: (filePath, raw) => {
            parseCalls.push(filePath);
            return raw.trim() ? { id: filePath, chars: raw.length } : null;
        },
    });
    return { index, reads, stats, parseCalls };
}

describe('NativeTranscriptIndex', () => {
    it('parses a file once and serves later passes from cache without reading', () => {
        const { index, reads, parseCalls } = makeIndex({ '/a.jsonl': { raw: 'hello', mtimeMs: 100 } });

        index.beginPass();
        expect(index.getMetadata('/a.jsonl')).toEqual({ id: '/a.jsonl', chars: 5 });
        expect(reads).toEqual(['/a.jsonl']);

        index.beginPass();
        expect(index.getMetadata('/a.jsonl')).toEqual({ id: '/a.jsonl', chars: 5 });
        // Warm pass: still stats the file to detect change, but never reads it.
        expect(reads).toEqual(['/a.jsonl']);
        expect(parseCalls).toEqual(['/a.jsonl']);
    });

    it('re-parses when the file mtime changes', () => {
        const files = { '/a.jsonl': { raw: 'hello', mtimeMs: 100 } };
        const { index, parseCalls } = makeIndex(files);

        index.beginPass();
        index.getMetadata('/a.jsonl');
        files['/a.jsonl'].mtimeMs = 200;
        index.beginPass();
        index.getMetadata('/a.jsonl');

        expect(parseCalls).toEqual(['/a.jsonl', '/a.jsonl']);
    });

    it('re-parses when the file size changes at an identical mtime', () => {
        const files = { '/a.jsonl': { raw: 'hello', mtimeMs: 100 } };
        const { index, parseCalls } = makeIndex(files);

        index.beginPass();
        expect(index.getMetadata('/a.jsonl')).toEqual({ id: '/a.jsonl', chars: 5 });
        // Same mtime, different bytes — a same-second rewrite must invalidate.
        files['/a.jsonl'].raw = 'hello world';
        index.beginPass();
        expect(index.getMetadata('/a.jsonl')).toEqual({ id: '/a.jsonl', chars: 11 });
        expect(parseCalls).toHaveLength(2);
    });

    it('caches a null parse result so an unusable file is not re-read', () => {
        const { index, reads, parseCalls } = makeIndex({ '/empty.jsonl': { raw: '   ', mtimeMs: 5 } });

        index.beginPass();
        expect(index.getMetadata('/empty.jsonl')).toBeNull();
        index.beginPass();
        expect(index.getMetadata('/empty.jsonl')).toBeNull();

        expect(reads).toEqual(['/empty.jsonl']);
        expect(parseCalls).toEqual(['/empty.jsonl']);
    });

    it('returns null for a missing file without caching an entry', () => {
        const { index, reads } = makeIndex({});
        index.beginPass();
        expect(index.getMetadata('/missing.jsonl')).toBeNull();
        expect(reads).toEqual([]);
        expect(index.size).toBe(0);
    });

    it('reads a file once per pass when metadata and search both need it', () => {
        const { index, reads } = makeIndex({ '/a.jsonl': { raw: 'needle in transcript', mtimeMs: 1 } });

        index.beginPass();
        index.getMetadata('/a.jsonl');
        expect(index.readRaw('/a.jsonl')).toBe('needle in transcript');
        // Metadata parse + substring search share the single read.
        expect(reads).toEqual(['/a.jsonl']);
    });

    it('does not carry raw text across passes', () => {
        const files = { '/a.jsonl': { raw: 'first', mtimeMs: 1 } };
        const { index, reads } = makeIndex(files);

        index.beginPass();
        expect(index.readRaw('/a.jsonl')).toBe('first');
        files['/a.jsonl'] = { raw: 'second', mtimeMs: 2 };
        index.beginPass();
        expect(index.readRaw('/a.jsonl')).toBe('second');
        expect(reads).toHaveLength(2);
    });

    it('evicts least-recently-used entries beyond capacity', () => {
        const files: Record<string, FakeFile> = {
            '/a.jsonl': { raw: 'a', mtimeMs: 1 },
            '/b.jsonl': { raw: 'b', mtimeMs: 1 },
            '/c.jsonl': { raw: 'c', mtimeMs: 1 },
        };
        const { index, parseCalls } = makeIndex(files, 2);

        index.beginPass();
        index.getMetadata('/a.jsonl');
        index.getMetadata('/b.jsonl');
        // Touch /a so /b becomes the least-recently-used entry.
        index.getMetadata('/a.jsonl');
        index.getMetadata('/c.jsonl');
        expect(index.size).toBe(2);

        index.beginPass();
        index.getMetadata('/a.jsonl');
        // /a survived eviction, so it is not parsed a second time.
        expect(parseCalls.filter(p => p === '/a.jsonl')).toHaveLength(1);

        index.getMetadata('/b.jsonl');
        expect(parseCalls.filter(p => p === '/b.jsonl')).toHaveLength(2);
    });

    it('treats a non-positive capacity as holding at least one entry', () => {
        const { index } = makeIndex({ '/a.jsonl': { raw: 'a', mtimeMs: 1 } }, 0);
        index.beginPass();
        index.getMetadata('/a.jsonl');
        expect(index.size).toBe(1);
    });
});
