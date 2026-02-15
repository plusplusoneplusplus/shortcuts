/**
 * Tests for FileStateStore — JSON-file-backed StateStore implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileStateStore } from '../../src/editor/file-state-store';

describe('FileStateStore', () => {
    let tmpDir: string;
    let filePath: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-state-store-'));
        filePath = path.join(tmpDir, 'state.json');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('creates file on first set', async () => {
        const store = new FileStateStore(filePath);
        await store.update('key', 'value');
        expect(fs.existsSync(filePath)).toBe(true);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(content.key).toBe('value');
    });

    it('get returns defaultValue when file does not exist', () => {
        const store = new FileStateStore(path.join(tmpDir, 'nonexistent.json'));
        expect(store.get('x', 'fallback')).toBe('fallback');
    });

    it('get returns defaultValue for missing key in existing file', async () => {
        const store = new FileStateStore(filePath);
        await store.update('other', 1);
        expect(store.get('missing', 'default')).toBe('default');
    });

    it('round-trip multiple keys with different types', async () => {
        const store = new FileStateStore(filePath);
        await store.update('str', 'hello');
        await store.update('num', 42);
        await store.update('arr', [1, 2, 3]);

        // Create new store to test read from disk (no cache)
        const store2 = new FileStateStore(filePath);
        expect(store2.get('str', '')).toBe('hello');
        expect(store2.get('num', 0)).toBe(42);
        expect(store2.get('arr', [])).toEqual([1, 2, 3]);
    });

    it('atomic write leaves no .tmp file', async () => {
        const store = new FileStateStore(filePath);
        await store.update('key', 'value');
        expect(fs.existsSync(filePath + '.tmp')).toBe(false);
    });

    it('creates parent directories', async () => {
        const nestedPath = path.join(tmpDir, 'nested', 'dir', 'state.json');
        const store = new FileStateStore(nestedPath);
        await store.update('key', 'value');
        expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('handles corrupt JSON gracefully', () => {
        fs.writeFileSync(filePath, '{invalid json!!!', 'utf-8');
        const store = new FileStateStore(filePath);
        expect(store.get('key', 'fallback')).toBe('fallback');
    });

    it('set overwrites single key without affecting others', async () => {
        const store = new FileStateStore(filePath);
        await store.update('a', 1);
        await store.update('b', 2);
        await store.update('a', 99);

        expect(store.get('a', 0)).toBe(99);
        expect(store.get('b', 0)).toBe(2);
    });

    it('keys returns stored key names', async () => {
        const store = new FileStateStore(filePath);
        await store.update('x', 1);
        await store.update('y', 2);
        expect(store.keys().sort()).toEqual(['x', 'y']);
    });

    it('update returns a Promise', () => {
        const store = new FileStateStore(filePath);
        const result = store.update('k', 'v');
        expect(result).toBeInstanceOf(Promise);
    });
});
