import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { NativeSymbolIndex } from '../src/symbol-index';
import { removeDir, symbolIndexAddon } from './helpers';

let root: string;
let data: string;
let index: NativeSymbolIndex;
const progress: Array<{ phase: string; processed: number; total: number }> = [];

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-symbol-root-'));
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-symbol-data-'));
    fs.writeFileSync(
        path.join(root, 'symbols.cpp'),
        'int target() { return 1; }\nint targetHelper() { return target(); }\n',
    );
    index = await symbolIndexAddon.buildSymbolIndex(
        root,
        path.join(data, 'symbols.sqlite'),
        event => progress.push(event),
    );
});

afterAll(() => {
    if (root) removeDir(root);
    if (data) removeDir(data);
});

describe('persistent symbol-index boundary', () => {
    it('reports progress throughout a cold build', async () => {
        expect(progress[0]).toEqual({ phase: 'scanning', processed: 0, total: 0 });
        expect(progress).toContainEqual({ phase: 'indexing', processed: 0, total: 1 });
        await vi.waitFor(() => {
            expect(progress.at(-1)).toEqual({ phase: 'complete', processed: 1, total: 1 });
        });
    });

    it('marshals exact hits and one-based positions', async () => {
        await expect(index.search('target')).resolves.toEqual([
            expect.objectContaining({
                name: 'target',
                kind: 'function',
                path: 'symbols.cpp',
                line: 1,
                column: 5,
            }),
        ]);
    });

    it('supports bounded prefix searches and misses', async () => {
        const prefix = await index.search('target', { prefix: true, limit: 1 });
        expect(prefix).toHaveLength(1);
        expect(prefix[0].name).toBe('target');
        await expect(index.search('missing')).resolves.toEqual([]);
    });

    it('incrementally refreshes only named changed files', async () => {
        fs.writeFileSync(path.join(root, 'new.cpp'), 'int refreshed() { return 1; }\n');
        fs.writeFileSync(path.join(root, 'unlisted.cpp'), 'int unlisted() { return 1; }\n');
        await index.refreshChanged(['new.cpp']);
        await expect(index.search('refreshed')).resolves.toEqual([
            expect.objectContaining({ name: 'refreshed', path: 'new.cpp' }),
        ]);
        await expect(index.search('unlisted')).resolves.toEqual([]);
    });

    it('removes named deleted files and rejects traversal', async () => {
        fs.unlinkSync(path.join(root, 'new.cpp'));
        await index.refreshChanged(['new.cpp']);
        await expect(index.search('refreshed')).resolves.toEqual([]);
        await expect(index.refreshChanged(['../outside.cpp'])).rejects.toThrow(/repository-relative/);
    });

    it('bounds targeted refresh batches', async () => {
        expect(() => index.refreshChanged(Array.from({ length: 1025 }, (_, i) => `${i}.cpp`)))
            .toThrow(/at most 1024/);
    });
});
