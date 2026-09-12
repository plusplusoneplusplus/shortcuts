import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { NativeSymbolIndex } from '../src/symbol-index';
import { removeDir, symbolIndexAddon } from './helpers';

let root: string;
let data: string;
let index: NativeSymbolIndex;

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-symbol-root-'));
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-symbol-data-'));
    fs.writeFileSync(
        path.join(root, 'symbols.cpp'),
        'int target() { return 1; }\nint targetHelper() { return target(); }\n',
    );
    index = await symbolIndexAddon.buildSymbolIndex(root, path.join(data, 'symbols.sqlite'));
});

afterAll(() => {
    if (root) removeDir(root);
    if (data) removeDir(data);
});

describe('persistent symbol-index boundary', () => {
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

    it('incrementally refreshes changed files', async () => {
        fs.writeFileSync(path.join(root, 'new.cpp'), 'int refreshed() { return 1; }\n');
        await index.refresh();
        await expect(index.search('refreshed')).resolves.toEqual([
            expect.objectContaining({ name: 'refreshed', path: 'new.cpp' }),
        ]);
    });
});
