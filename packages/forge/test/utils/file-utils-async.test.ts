/**
 * Tests for async file utility helpers: safeExistsAsync, safeStatsAsync,
 * safeReadDirAsync, safeReadFileAsync.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    safeExistsAsync,
    safeStatsAsync,
    safeReadDirAsync,
    safeReadFileAsync,
} from '../../src/utils/file-utils';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'file-utils-async-'));
});

afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// safeExistsAsync
// ============================================================================

describe('safeExistsAsync', () => {
    it('returns true for an existing file', async () => {
        const filePath = path.join(tmpDir, 'exists.txt');
        await fs.promises.writeFile(filePath, 'hello');
        expect(await safeExistsAsync(filePath)).toBe(true);
    });

    it('returns true for an existing directory', async () => {
        const dirPath = path.join(tmpDir, 'subdir');
        await fs.promises.mkdir(dirPath);
        expect(await safeExistsAsync(dirPath)).toBe(true);
    });

    it('returns false for a non-existent path', async () => {
        expect(await safeExistsAsync(path.join(tmpDir, 'nope.txt'))).toBe(false);
    });
});

// ============================================================================
// safeStatsAsync
// ============================================================================

describe('safeStatsAsync', () => {
    it('returns stats for an existing file', async () => {
        const filePath = path.join(tmpDir, 'stats.txt');
        await fs.promises.writeFile(filePath, 'data');
        const result = await safeStatsAsync(filePath);
        expect(result.success).toBe(true);
        expect(result.data!.isFile()).toBe(true);
    });

    it('returns stats for an existing directory', async () => {
        const dirPath = path.join(tmpDir, 'statsdir');
        await fs.promises.mkdir(dirPath);
        const result = await safeStatsAsync(dirPath);
        expect(result.success).toBe(true);
        expect(result.data!.isDirectory()).toBe(true);
    });

    it('returns failure for a non-existent path', async () => {
        const result = await safeStatsAsync(path.join(tmpDir, 'missing'));
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('ENOENT');
    });
});

// ============================================================================
// safeReadDirAsync
// ============================================================================

describe('safeReadDirAsync', () => {
    it('reads directory entries as strings', async () => {
        await fs.promises.writeFile(path.join(tmpDir, 'a.txt'), '');
        await fs.promises.writeFile(path.join(tmpDir, 'b.txt'), '');
        const result = await safeReadDirAsync(tmpDir);
        expect(result.success).toBe(true);
        expect(result.data!.sort()).toEqual(['a.txt', 'b.txt']);
    });

    it('reads directory entries with file types', async () => {
        await fs.promises.writeFile(path.join(tmpDir, 'file.txt'), '');
        await fs.promises.mkdir(path.join(tmpDir, 'dir'));
        const result = await safeReadDirAsync(tmpDir, true);
        expect(result.success).toBe(true);
        const entries = result.data as fs.Dirent[];
        expect(entries.length).toBe(2);
        const names = entries.map(e => e.name).sort();
        expect(names).toEqual(['dir', 'file.txt']);
    });

    it('returns failure for a non-existent directory', async () => {
        const result = await safeReadDirAsync(path.join(tmpDir, 'missing'));
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('ENOENT');
    });

    it('returns empty array for an empty directory', async () => {
        const emptyDir = path.join(tmpDir, 'empty');
        await fs.promises.mkdir(emptyDir);
        const result = await safeReadDirAsync(emptyDir);
        expect(result.success).toBe(true);
        expect(result.data).toEqual([]);
    });
});

// ============================================================================
// safeReadFileAsync
// ============================================================================

describe('safeReadFileAsync', () => {
    it('reads a file with default utf8 encoding', async () => {
        const filePath = path.join(tmpDir, 'read.txt');
        await fs.promises.writeFile(filePath, 'hello world');
        const result = await safeReadFileAsync(filePath);
        expect(result.success).toBe(true);
        expect(result.data).toBe('hello world');
    });

    it('reads a file with explicit encoding', async () => {
        const filePath = path.join(tmpDir, 'enc.txt');
        await fs.promises.writeFile(filePath, 'data', 'utf-8');
        const result = await safeReadFileAsync(filePath, { encoding: 'utf-8' });
        expect(result.success).toBe(true);
        expect(result.data).toBe('data');
    });

    it('returns failure for a non-existent file', async () => {
        const result = await safeReadFileAsync(path.join(tmpDir, 'missing.txt'));
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('ENOENT');
    });

    it('reads an empty file', async () => {
        const filePath = path.join(tmpDir, 'empty.txt');
        await fs.promises.writeFile(filePath, '');
        const result = await safeReadFileAsync(filePath);
        expect(result.success).toBe(true);
        expect(result.data).toBe('');
    });
});
