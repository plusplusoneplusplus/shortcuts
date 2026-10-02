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
