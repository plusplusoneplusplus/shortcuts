import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { once } from 'events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadNativeRepoFiles, type NativeRepoFiles } from '../src/repo-files';

const addon = loadNativeRepoFiles();
let fixture: string;
let root: string;
let files: NativeRepoFiles;

beforeEach(() => {
    fixture = fs.mkdtempSync(path.resolve('.repo-delete-native-'));
    root = path.join(fixture, 'root');
    fs.mkdirSync(root);
    files = addon.openRepoFiles(root, 60_000);
});
afterEach(() => {
    files.dispose();
    fs.rmSync(fixture, { recursive: true, force: true });
});

describe('RepoFiles.deleteEntry', () => {
    it('deletes files and populated folders and refreshes both index variants', async () => {
        fs.mkdirSync(path.join(root, 'folder'));
        fs.writeFileSync(path.join(root, 'folder', 'file.txt'), 'content');
        fs.writeFileSync(path.join(root, 'keep.txt'), 'keep');
        for (const showIgnored of [false, true]) {
            expect((await files.indexFiles({ showIgnored, maxEntries: 100 })).files).toContain('folder/file.txt');
        }
        await expect(files.deleteEntry('folder')).resolves.toBeUndefined();
        for (const showIgnored of [false, true]) {
            expect((await files.indexFiles({ showIgnored, maxEntries: 100 })).files).toEqual(['keep.txt']);
            expect(await files.searchFiles('file', 100, showIgnored)).toEqual([]);
        }
        await files.deleteEntry('keep.txt');
        expect(fs.readdirSync(root)).toEqual([]);
    });

    it.each(['.', '/', '../outside', 'folder/../keep', 'C:keep', '.git', 'folder/.GiT'])('rejects protected or invalid path %s', async target => {
        fs.writeFileSync(path.join(root, 'keep'), 'untouched');
        await expect(files.deleteEntry(target)).rejects.toMatchObject({
            code: 'INVALID_DELETE_PATH', partial: false, removedEntries: 0,
        });
        expect(fs.readFileSync(path.join(root, 'keep'), 'utf8')).toBe('untouched');
    });

    it('rejects nested Git metadata before removing any child', async () => {
        fs.mkdirSync(path.join(root, 'folder'));
        fs.writeFileSync(path.join(root, 'folder', 'a'), 'keep');
        fs.writeFileSync(path.join(root, 'folder', '.git'), 'gitdir: elsewhere');
        await expect(files.deleteEntry('folder')).rejects.toMatchObject({
            code: 'INVALID_DELETE_PATH', partial: false, removedEntries: 0,
        });
        expect(fs.readFileSync(path.join(root, 'folder', 'a'), 'utf8')).toBe('keep');
    });

    it('rejects missing entries and disposed handles without success fallback', async () => {
        await expect(files.deleteEntry('missing')).rejects.toMatchObject({
            code: 'ENTRY_NOT_FOUND', partial: false, removedEntries: 0,
        });
        files.dispose();
        await expect(files.deleteEntry('missing')).rejects.toMatchObject({ code: 'Closing' });
    });

    it('unlinks links without changing their targets and rejects linked ancestors', async () => {
        const outside = path.join(fixture, 'outside');
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, 'keep'), 'outside');
        fs.symlinkSync(outside, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
        await expect(files.deleteEntry('link/keep')).rejects.toMatchObject({ code: 'INVALID_DELETE_PATH' });
        await files.deleteEntry('link');
        expect(fs.readFileSync(path.join(outside, 'keep'), 'utf8')).toBe('outside');
        expect(fs.existsSync(path.join(root, 'link'))).toBe(false);
    });

    it.runIf(process.platform === 'win32')('retains partial failure metadata and refreshes the index after a locked child', async () => {
        fs.mkdirSync(path.join(root, 'folder'));
        fs.writeFileSync(path.join(root, 'folder', 'a'), 'remove');
        const locked = path.join(root, 'folder', 'z');
        fs.writeFileSync(locked, 'keep');
        // The child holds a read-share-only Windows handle until stdin closes.
        const child = spawn('powershell.exe', ['-NoProfile', '-Command',
            '$f=[IO.File]::Open($env:DELETE_LOCK_FILE,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); [Console]::WriteLine("ready"); [Console]::ReadLine() | Out-Null; $f.Dispose()'],
        { env: { ...process.env, DELETE_LOCK_FILE: locked }, stdio: ['pipe', 'pipe', 'pipe'] });
        const exited = once(child, 'exit');
        try {
            await once(child.stdout!, 'data');
            for (const showIgnored of [false, true]) await files.indexFiles({ showIgnored, maxEntries: 100 });
            await expect(files.deleteEntry('folder')).rejects.toMatchObject({
                code: 'DELETE_IO_ERROR', partial: true, removedEntries: 1,
                message: expect.stringContaining('no rollback'),
            });
            for (const showIgnored of [false, true]) {
                expect((await files.indexFiles({ showIgnored, maxEntries: 100 })).files).toEqual(['folder/z']);
            }
            expect(fs.readFileSync(locked, 'utf8')).toBe('keep');
        } finally {
            child.stdin!.end('\n');
            await exited;
        }
    });
});
