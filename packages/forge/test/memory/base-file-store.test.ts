import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { BaseFileStore } from '../../src/memory/base-file-store';

/** Minimal concrete subclass that exposes protected methods for testing. */
class TestStore extends BaseFileStore {
    async testEnqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        return this.enqueueWrite(fn);
    }
    async testAtomicWrite(filePath: string, content: string): Promise<void> {
        return this.atomicWrite(filePath, content);
    }
    async testReadJSON<T>(filePath: string, defaultValue: T): Promise<T> {
        return this.readJSON(filePath, defaultValue);
    }
    async testListDirectory(dir: string): Promise<string[]> {
        return this.listDirectory(dir);
    }
}

describe('BaseFileStore', () => {
    let tmpDir: string;
    let store: TestStore;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'base-file-store-test-'));
        store = new TestStore();
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // --- atomicWrite ---

    describe('atomicWrite', () => {
        it('creates file with correct content', async () => {
            const filePath = path.join(tmpDir, 'test.txt');
            await store.testAtomicWrite(filePath, 'hello world');
            const content = await fs.readFile(filePath, 'utf-8');
            expect(content).toBe('hello world');
        });

        it('creates parent directories as needed', async () => {
            const filePath = path.join(tmpDir, 'sub', 'dir', 'test.txt');
            await store.testAtomicWrite(filePath, 'nested');
            const content = await fs.readFile(filePath, 'utf-8');
            expect(content).toBe('nested');
        });

        it('leaves no .tmp file after write', async () => {
            const filePath = path.join(tmpDir, 'test.txt');
            await store.testAtomicWrite(filePath, 'data');
            const files = await fs.readdir(tmpDir);
            expect(files.filter(f => f.endsWith('.tmp'))).toEqual([]);
        });

        it('overwrites existing file', async () => {
            const filePath = path.join(tmpDir, 'test.txt');
            await store.testAtomicWrite(filePath, 'first');
            await store.testAtomicWrite(filePath, 'second');
            const content = await fs.readFile(filePath, 'utf-8');
            expect(content).toBe('second');
        });
    });

    // --- enqueueWrite ---

    describe('enqueueWrite', () => {
        it('serializes concurrent writes in submission order', async () => {
            const results: number[] = [];
            const promises = Array.from({ length: 5 }, (_, i) =>
                store.testEnqueueWrite(async () => {
                    await new Promise(r => setTimeout(r, 10 - i * 2));
                    results.push(i);
                    return i;
                }),
            );
            await Promise.all(promises);
            expect(results).toEqual([0, 1, 2, 3, 4]);
        });

        it('continues processing after a failed write', async () => {
            let secondRan = false;
            await store.testEnqueueWrite(() => Promise.reject(new Error('intentional failure')))
                .catch(() => {});
            await store.testEnqueueWrite(async () => { secondRan = true; });
            expect(secondRan).toBe(true);
        });

        it('returns the value produced by the write function', async () => {
            const result = await store.testEnqueueWrite(async () => 42);
            expect(result).toBe(42);
        });
    });

    // --- readJSON ---

    describe('readJSON', () => {
        it('parses valid JSON file', async () => {
            const filePath = path.join(tmpDir, 'data.json');
            await fs.writeFile(filePath, JSON.stringify({ foo: 'bar' }), 'utf-8');
            const result = await store.testReadJSON(filePath, {});
            expect(result).toEqual({ foo: 'bar' });
        });

        it('returns defaultValue when file does not exist', async () => {
            const result = await store.testReadJSON(path.join(tmpDir, 'no-such.json'), { default: true });
            expect(result).toEqual({ default: true });
        });

        it('returns defaultValue when file contains invalid JSON', async () => {
            const filePath = path.join(tmpDir, 'bad.json');
            await fs.writeFile(filePath, 'not valid json!', 'utf-8');
            const result = await store.testReadJSON(filePath, null);
            expect(result).toBeNull();
        });

        it('returns null defaultValue for missing nullable file', async () => {
            const result = await store.testReadJSON<string | null>(
                path.join(tmpDir, 'missing.json'),
                null,
            );
            expect(result).toBeNull();
        });

        it('returns empty array defaultValue for missing list file', async () => {
            const result = await store.testReadJSON<unknown[]>(
                path.join(tmpDir, 'missing.json'),
                [],
            );
            expect(result).toEqual([]);
        });
    });

    // --- listDirectory ---

    describe('listDirectory', () => {
        it('returns subdirectory names', async () => {
            await fs.mkdir(path.join(tmpDir, 'sub1'));
            await fs.mkdir(path.join(tmpDir, 'sub2'));
            await fs.writeFile(path.join(tmpDir, 'file.txt'), 'x');
            const result = await store.testListDirectory(tmpDir);
            expect(result.sort()).toEqual(['sub1', 'sub2']);
        });

        it('returns empty array for missing directory', async () => {
            const result = await store.testListDirectory(path.join(tmpDir, 'nonexistent'));
            expect(result).toEqual([]);
        });

        it('returns empty array for empty directory', async () => {
            const result = await store.testListDirectory(tmpDir);
            expect(result).toEqual([]);
        });

        it('does not include files — only directories', async () => {
            await fs.writeFile(path.join(tmpDir, 'file.txt'), 'x');
            await fs.writeFile(path.join(tmpDir, 'file.json'), '{}');
            const result = await store.testListDirectory(tmpDir);
            expect(result).toEqual([]);
        });
    });
});
