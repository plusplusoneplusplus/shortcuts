/**
 * Tests for cache-utils shared primitives.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    readCacheFile,
    readCacheFileIf,
    writeCacheFile,
    clearCacheFile,
    clearCacheDir,
    scanCacheItems,
    scanCacheItemsMap,
} from '../../src/cache/cache-utils';

// ============================================================================
// Test helpers
// ============================================================================

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-utils-test-'));
});

afterEach(() => {
    if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

function writePlainFile(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================================
// readCacheFile
// ============================================================================

describe('readCacheFile', () => {
    it('should read and parse a valid JSON file', () => {
        const filePath = path.join(tmpDir, 'data.json');
        const data = { foo: 'bar', count: 42 };
        writePlainFile(filePath, data);

        const result = readCacheFile<typeof data>(filePath);
        expect(result).toEqual(data);
    });

    it('should return null for missing file', () => {
        const result = readCacheFile(path.join(tmpDir, 'nonexistent.json'));
        expect(result).toBeNull();
    });

    it('should return null for corrupted JSON', () => {
        const filePath = path.join(tmpDir, 'bad.json');
        fs.writeFileSync(filePath, '{ invalid json }}', 'utf-8');

        const result = readCacheFile(filePath);
        expect(result).toBeNull();
    });

    it('should return null for empty file', () => {
        const filePath = path.join(tmpDir, 'empty.json');
        fs.writeFileSync(filePath, '', 'utf-8');

        const result = readCacheFile(filePath);
        expect(result).toBeNull();
    });

    it('should handle nested paths', () => {
        const filePath = path.join(tmpDir, 'a', 'b', 'c', 'data.json');
        const data = { nested: true };
        writePlainFile(filePath, data);

        const result = readCacheFile<typeof data>(filePath);
        expect(result).toEqual(data);
    });
});

// ============================================================================
// readCacheFileIf
// ============================================================================

describe('readCacheFileIf', () => {
    it('should return data when validation passes', () => {
        const filePath = path.join(tmpDir, 'valid.json');
        const data = { gitHash: 'abc123', value: 'hello' };
        writePlainFile(filePath, data);

        const result = readCacheFileIf<typeof data>(
            filePath,
            (d) => d.gitHash === 'abc123'
        );
        expect(result).toEqual(data);
    });

    it('should return null when validation fails', () => {
        const filePath = path.join(tmpDir, 'stale.json');
        const data = { gitHash: 'old-hash', value: 'stale' };
        writePlainFile(filePath, data);

        const result = readCacheFileIf<typeof data>(
            filePath,
            (d) => d.gitHash === 'new-hash'
        );
        expect(result).toBeNull();
    });

    it('should return null for missing file', () => {
        const result = readCacheFileIf<{ x: number }>(
            path.join(tmpDir, 'missing.json'),
            () => true
        );
        expect(result).toBeNull();
    });

    it('should return null for corrupted file even with permissive validator', () => {
        const filePath = path.join(tmpDir, 'corrupt.json');
        fs.writeFileSync(filePath, 'not json', 'utf-8');

        const result = readCacheFileIf<unknown>(
            filePath,
            () => true
        );
        expect(result).toBeNull();
    });

    it('should support multi-field validation', () => {
        const filePath = path.join(tmpDir, 'multi.json');
        const data = { metadata: { hash: 'h1' }, graph: { nodes: [] } };
        writePlainFile(filePath, data);

        const result = readCacheFileIf<typeof data>(
            filePath,
            (d) => !!d.metadata && !!d.graph
        );
        expect(result).toEqual(data);
    });
});

// ============================================================================
// writeCacheFile
// ============================================================================

describe('writeCacheFile', () => {
    it('should write JSON to file', () => {
        const filePath = path.join(tmpDir, 'output.json');
        const data = { key: 'value', num: 123 };

        writeCacheFile(filePath, data);

        const content = fs.readFileSync(filePath, 'utf-8');
        expect(JSON.parse(content)).toEqual(data);
    });

    it('should create parent directories automatically', () => {
        const filePath = path.join(tmpDir, 'deep', 'nested', 'dir', 'file.json');
        writeCacheFile(filePath, { hello: 'world' });

        expect(fs.existsSync(filePath)).toBe(true);
        expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ hello: 'world' });
    });

    it('should overwrite existing file', () => {
        const filePath = path.join(tmpDir, 'overwrite.json');
        writeCacheFile(filePath, { version: 1 });
        writeCacheFile(filePath, { version: 2 });

        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(content.version).toBe(2);
    });

    it('should not leave .tmp file after successful write', () => {
        const filePath = path.join(tmpDir, 'atomic.json');
        writeCacheFile(filePath, { data: 'test' });

        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.existsSync(filePath + '.tmp')).toBe(false);
    });

    it('should write pretty-printed JSON', () => {
        const filePath = path.join(tmpDir, 'pretty.json');
        writeCacheFile(filePath, { a: 1, b: 2 });

        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toContain('\n'); // Pretty-printed has newlines
        expect(content).toContain('  '); // Indented
    });
});

// ============================================================================
// clearCacheFile
// ============================================================================

describe('clearCacheFile', () => {
    it('should delete an existing file and return true', () => {
        const filePath = path.join(tmpDir, 'to-delete.json');
        writePlainFile(filePath, { data: true });

        const result = clearCacheFile(filePath);
        expect(result).toBe(true);
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should return false for non-existent file', () => {
        const result = clearCacheFile(path.join(tmpDir, 'nonexistent.json'));
        expect(result).toBe(false);
    });
});

// ============================================================================
// clearCacheDir
// ============================================================================

describe('clearCacheDir', () => {
    it('should delete directory recursively and return true', () => {
        const dir = path.join(tmpDir, 'cache-dir');
        fs.mkdirSync(dir, { recursive: true });
        writePlainFile(path.join(dir, 'a.json'), { a: 1 });
        writePlainFile(path.join(dir, 'sub', 'b.json'), { b: 2 });

        const result = clearCacheDir(dir);
        expect(result).toBe(true);
        expect(fs.existsSync(dir)).toBe(false);
    });

    it('should return false for non-existent directory', () => {
        const result = clearCacheDir(path.join(tmpDir, 'no-dir'));
        expect(result).toBe(false);
    });
});

// ============================================================================
// scanCacheItems
// ============================================================================

describe('scanCacheItems', () => {
    interface CachedItem {
        data: { id: string; value: string };
        gitHash: string;
    }

    it('should find all cached items when valid', () => {
        const ids = ['a', 'b', 'c'];
        for (const id of ids) {
            writePlainFile(
                path.join(tmpDir, `${id}.json`),
                { data: { id, value: `val-${id}` }, gitHash: 'hash1' }
            );
        }

        const result = scanCacheItems<CachedItem, { id: string; value: string }>(
            ids,
            (id) => path.join(tmpDir, `${id}.json`),
            (cached) => cached.gitHash === 'hash1',
            (cached) => cached.data
        );

        expect(result.found).toHaveLength(3);
        expect(result.missing).toHaveLength(0);
        expect(result.found.map(f => f.id).sort()).toEqual(['a', 'b', 'c']);
    });

    it('should report missing items when file does not exist', () => {
        writePlainFile(
            path.join(tmpDir, 'a.json'),
            { data: { id: 'a', value: 'val' }, gitHash: 'h' }
        );

        const result = scanCacheItems<CachedItem, { id: string; value: string }>(
            ['a', 'b'],
            (id) => path.join(tmpDir, `${id}.json`),
            () => true,
            (cached) => cached.data
        );

        expect(result.found).toHaveLength(1);
        expect(result.missing).toEqual(['b']);
    });

    it('should report items as missing when validation fails', () => {
        writePlainFile(
            path.join(tmpDir, 'stale.json'),
            { data: { id: 'stale', value: 'old' }, gitHash: 'old-hash' }
        );

        const result = scanCacheItems<CachedItem, { id: string; value: string }>(
            ['stale'],
            (id) => path.join(tmpDir, `${id}.json`),
            (cached) => cached.gitHash === 'new-hash',
            (cached) => cached.data
        );

        expect(result.found).toHaveLength(0);
        expect(result.missing).toEqual(['stale']);
    });

    it('should handle null from pathResolver as missing', () => {
        const result = scanCacheItems<CachedItem, { id: string; value: string }>(
            ['x'],
            () => null,
            () => true,
            (cached) => cached.data
        );

        expect(result.found).toHaveLength(0);
        expect(result.missing).toEqual(['x']);
    });

    it('should handle corrupted cache files', () => {
        const filePath = path.join(tmpDir, 'corrupt.json');
        fs.writeFileSync(filePath, '{{broken}}', 'utf-8');

        const result = scanCacheItems<CachedItem, { id: string; value: string }>(
            ['corrupt'],
            (id) => path.join(tmpDir, `${id}.json`),
            () => true,
            (cached) => cached.data
        );

        expect(result.found).toHaveLength(0);
        expect(result.missing).toEqual(['corrupt']);
    });

    it('should handle empty id list', () => {
        const result = scanCacheItems<CachedItem, { id: string; value: string }>(
            [],
            () => null,
            () => true,
            (cached) => cached.data
        );

        expect(result.found).toHaveLength(0);
        expect(result.missing).toHaveLength(0);
    });

    it('should handle mixed found and missing items', () => {
        writePlainFile(
            path.join(tmpDir, 'found.json'),
            { data: { id: 'found', value: 'yes' }, gitHash: 'match' }
        );
        // 'missing1' doesn't exist on disk
        writePlainFile(
            path.join(tmpDir, 'stale.json'),
            { data: { id: 'stale', value: 'old' }, gitHash: 'no-match' }
        );

        const result = scanCacheItems<CachedItem, { id: string; value: string }>(
            ['found', 'missing1', 'stale'],
            (id) => path.join(tmpDir, `${id}.json`),
            (cached) => cached.gitHash === 'match',
            (cached) => cached.data
        );

        expect(result.found).toHaveLength(1);
        expect(result.found[0].id).toBe('found');
        expect(result.missing.sort()).toEqual(['missing1', 'stale']);
    });
});

// ============================================================================
// scanCacheItemsMap
// ============================================================================

describe('scanCacheItemsMap', () => {
    interface CachedProbe {
        probeResult: { topic: string; modules: string[] };
        gitHash: string;
    }

    it('should return found items as Map entries', () => {
        writePlainFile(
            path.join(tmpDir, 'auth.json'),
            { probeResult: { topic: 'auth', modules: ['a'] }, gitHash: 'h1' }
        );
        writePlainFile(
            path.join(tmpDir, 'db.json'),
            { probeResult: { topic: 'db', modules: ['b'] }, gitHash: 'h1' }
        );

        const result = scanCacheItemsMap<CachedProbe, { topic: string; modules: string[] }>(
            ['auth', 'db'],
            (id) => path.join(tmpDir, `${id}.json`),
            (cached) => cached.gitHash === 'h1',
            (cached) => cached.probeResult
        );

        expect(result.found.size).toBe(2);
        expect(result.found.get('auth')?.topic).toBe('auth');
        expect(result.found.get('db')?.topic).toBe('db');
        expect(result.missing).toHaveLength(0);
    });

    it('should report missing items in Map scan', () => {
        const result = scanCacheItemsMap<CachedProbe, { topic: string; modules: string[] }>(
            ['missing'],
            (id) => path.join(tmpDir, `${id}.json`),
            () => true,
            (cached) => cached.probeResult
        );

        expect(result.found.size).toBe(0);
        expect(result.missing).toEqual(['missing']);
    });

    it('should handle stale entries in Map scan', () => {
        writePlainFile(
            path.join(tmpDir, 'old.json'),
            { probeResult: { topic: 'old', modules: [] }, gitHash: 'old-hash' }
        );

        const result = scanCacheItemsMap<CachedProbe, { topic: string; modules: string[] }>(
            ['old'],
            (id) => path.join(tmpDir, `${id}.json`),
            (cached) => cached.gitHash === 'new-hash',
            (cached) => cached.probeResult
        );

        expect(result.found.size).toBe(0);
        expect(result.missing).toEqual(['old']);
    });

    it('should handle null pathResolver in Map scan', () => {
        const result = scanCacheItemsMap<CachedProbe, { topic: string; modules: string[] }>(
            ['x', 'y'],
            () => null,
            () => true,
            (cached) => cached.probeResult
        );

        expect(result.found.size).toBe(0);
        expect(result.missing).toEqual(['x', 'y']);
    });
});
