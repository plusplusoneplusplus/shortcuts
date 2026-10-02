/**
 * N-API boundary tests for the repository-file backend: blob shapes, error
 * codes and messages as the REST routes see them. Path and blob semantics are
 * pinned by `rust/core/tests/repo_files_blob.rs`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadNativeRepoFiles } from '../src/repo-files';
import { removeDir } from './helpers';

const addon = loadNativeRepoFiles();
let root: string;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-repo-files-'));
    fs.writeFileSync(path.join(root, 'a.md'), '# héllo\n');
    fs.writeFileSync(path.join(root, 'b.bin'), Buffer.from([1, 0, 2]));
});

afterAll(() => removeDir(root));

describe('RepoFiles blobs', () => {
    it('reads text and binary with the route shape', async () => {
        const files = addon.openRepoFiles(root);
        await expect(files.readBlob('/a.md')).resolves.toEqual({
            content: '# héllo\n',
            encoding: 'utf-8',
            mimeType: 'text/markdown',
        });
        await expect(files.readBlob('b.bin')).resolves.toEqual({
            content: Buffer.from([1, 0, 2]).toString('base64'),
            encoding: 'base64',
            mimeType: 'application/octet-stream',
        });
    });

    it('writes through missing parents', async () => {
        const files = addon.openRepoFiles(root);
        await files.writeBlob('new/dir/c.txt', 'x\r\ny');
        expect(fs.readFileSync(path.join(root, 'new/dir/c.txt'), 'utf-8')).toBe('x\r\ny');
    });

    it('rejects traversal as InvalidArg and keeps route messages', async () => {
        const files = addon.openRepoFiles(root);
        await expect(files.readBlob('../x')).rejects.toMatchObject({
            code: 'InvalidArg',
            message: 'Path traversal detected: path escapes repo root',
        });
        await expect(files.writeBlob('a/../../x', '')).rejects.toMatchObject({ code: 'InvalidArg' });
        await expect(files.readBlob('missing.txt')).rejects.toThrow('File not found: missing.txt');
        await expect(files.readBlob('new')).rejects.toThrow('Not a file: new');
    });
});

describe('RepoFiles listings', () => {
    it('orders names exactly as Node localeCompare, dirs first', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-repo-list-'));
        try {
            const names = ['b', 'B.md', '_a', '-a', '.a', 'a10', 'a2', 'é', 'e', 'Z', '1', 'ä', 'ß', 'ss', '中文', '😀', 'a b', 'A_B', '~t'];
            for (const name of names) fs.writeFileSync(path.join(dir, name), 'xy');
            fs.mkdirSync(path.join(dir, 'zdir'));
            fs.writeFileSync(path.join(dir, 'zdir', 'f'), '');
            const { entries, truncated } = await addon.openRepoFiles(dir).listDirectory('', {
                showIgnored: false,
                maxEntries: 100,
                depth: 2,
            });
            expect(truncated).toBe(false);
            expect(entries.map((e) => e.name)).toEqual(['zdir', ...[...names].sort((a, b) => a.localeCompare(b))]);
            expect(entries[0]).toEqual({
                name: 'zdir',
                type: 'dir',
                path: 'zdir',
                children: [{ name: 'f', type: 'file', size: 0, path: 'zdir/f' }],
            });
            expect(entries[1]).toMatchObject({ type: 'file', size: 2 });
        } finally {
            removeDir(dir);
        }
    });

    it('walks a subtree and maps listing errors', async () => {
        fs.mkdirSync(path.join(root, 'new', 'dir'), { recursive: true });
        fs.writeFileSync(path.join(root, 'new', 'dir', 'c.txt'), '');
        const files = addon.openRepoFiles(root);
        await expect(files.listFiles('new', { showIgnored: false, maxEntries: 10 })).resolves.toEqual({
            files: ['new/dir/c.txt'],
            truncated: false,
        });
        await expect(files.listDirectory('missing', { showIgnored: false, maxEntries: 10 })).rejects.toThrow(
            'Path does not exist: missing',
        );
        await expect(files.listFiles('../x', { showIgnored: false, maxEntries: 10 })).rejects.toMatchObject({
            code: 'InvalidArg',
        });
    });
});
