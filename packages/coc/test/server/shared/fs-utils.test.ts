/**
 * Shared Filesystem Utilities Tests
 *
 * Unit tests for atomicWriteJSON, getErrorMessage, and resolveCollision.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { atomicWriteJSON, getErrorMessage, resolveCollision } from '../../../src/server/shared/fs-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-utils-test-'));
});

afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// atomicWriteJSON
// ---------------------------------------------------------------------------

describe('atomicWriteJSON', () => {
    it('writes JSON to a new file', async () => {
        const filePath = path.join(tmpDir, 'test.json');
        await atomicWriteJSON(filePath, { hello: 'world' });
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(JSON.parse(content)).toEqual({ hello: 'world' });
    });

    it('creates parent directories recursively', async () => {
        const filePath = path.join(tmpDir, 'a', 'b', 'c', 'test.json');
        await atomicWriteJSON(filePath, { nested: true });
        expect(fs.existsSync(filePath)).toBe(true);
    });

    it('overwrites an existing file', async () => {
        const filePath = path.join(tmpDir, 'overwrite.json');
        await atomicWriteJSON(filePath, { v: 1 });
        await atomicWriteJSON(filePath, { v: 2 });
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(content.v).toBe(2);
    });

    it('does not leave a temp file on success', async () => {
        const filePath = path.join(tmpDir, 'clean.json');
        await atomicWriteJSON(filePath, { ok: true });
        expect(fs.existsSync(filePath + '.tmp')).toBe(false);
    });

    it('formats JSON with 2-space indentation', async () => {
        const filePath = path.join(tmpDir, 'pretty.json');
        await atomicWriteJSON(filePath, { a: 1 });
        const content = fs.readFileSync(filePath, 'utf-8');
        expect(content).toBe(JSON.stringify({ a: 1 }, null, 2));
    });
});

// ---------------------------------------------------------------------------
// getErrorMessage
// ---------------------------------------------------------------------------

describe('getErrorMessage', () => {
    it('returns message from an Error instance', () => {
        expect(getErrorMessage(new Error('oops'))).toBe('oops');
    });

    it('returns String(err) for a string thrown value', () => {
        expect(getErrorMessage('something went wrong')).toBe('something went wrong');
    });

    it('returns String(err) for a numeric thrown value', () => {
        expect(getErrorMessage(42)).toBe('42');
    });

    it('returns fallback for [object Object] stringification', () => {
        expect(getErrorMessage({}, 'fallback msg')).toBe('fallback msg');
    });

    it('returns default fallback when not provided and err stringifies to [object Object]', () => {
        expect(getErrorMessage({})).toBe('Unknown error');
    });

    it('handles null', () => {
        expect(getErrorMessage(null)).toBe('null');
    });

    it('handles undefined', () => {
        expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('respects a custom fallback parameter', () => {
        expect(getErrorMessage(new Error('real error'), 'custom fallback')).toBe('real error');
    });
});

// ---------------------------------------------------------------------------
// resolveCollision
// ---------------------------------------------------------------------------

describe('resolveCollision', () => {
    it('returns the original path when no file exists', async () => {
        const filePath = path.join(tmpDir, 'nonexistent.md');
        const result = await resolveCollision(filePath);
        expect(result).toBe(filePath);
    });

    it('returns a timestamped variant when the path already exists', async () => {
        const filePath = path.join(tmpDir, 'existing.md');
        fs.writeFileSync(filePath, '');
        const result = await resolveCollision(filePath);
        expect(result).not.toBe(filePath);
        expect(result).toMatch(/existing-\d+\.md$/);
    });

    it('preserves the directory of the original path', async () => {
        const filePath = path.join(tmpDir, 'sub', 'file.txt');
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, '');
        const result = await resolveCollision(filePath);
        expect(path.dirname(result)).toBe(path.dirname(filePath));
    });

    it('preserves extension for files with extensions', async () => {
        const filePath = path.join(tmpDir, 'doc.md');
        fs.writeFileSync(filePath, '');
        const result = await resolveCollision(filePath);
        expect(result.endsWith('.md')).toBe(true);
    });

    it('appends timestamp before extension for files with no extension', async () => {
        const filePath = path.join(tmpDir, 'noext');
        fs.writeFileSync(filePath, '');
        const result = await resolveCollision(filePath);
        expect(result).not.toBe(filePath);
        expect(path.extname(result)).toBe('');
        expect(result).toMatch(/noext-\d+$/);
    });
});
