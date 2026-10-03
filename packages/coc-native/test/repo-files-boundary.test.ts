/**
 * N-API boundary tests for the repository-file backend: blob shapes, error
 * codes and messages as the REST routes see them. Path and blob semantics are
 * pinned by `rust/core/tests/repo_files_blob.rs`; index lifecycle by
 * `repo_files_indexes.rs`.
 */

import * as fs from 'fs';
import { execFileSync } from 'child_process';
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

    it('returns the same MIME shape for extension aliases and dotfiles', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-mime-'));
        const files = addon.openRepoFiles(dir);
        const groups = [
            ['application/javascript', ['js', 'mjs', 'cjs', 'jsx']],
            ['application/typescript', ['ts', 'tsx']],
            ['text/plain', ['txt', 'env', 'log', 'lock']],
            ['text/csv', ['csv']],
            ['text/html', ['html', 'htm']],
            ['text/markdown', ['md', 'markdown']],
            ['application/x-yaml', ['yaml', 'yml']],
            ['application/x-sh', ['sh', 'bash']],
            ['text/x-c', ['c', 'h']],
            ['text/x-c++', ['cpp', 'hpp']],
            ['image/jpeg', ['jpg', 'jpeg']],
            ['application/octet-stream', ['unknown']],
        ] as const;
        try {
            for (const [mimeType, extensions] of groups) {
                for (const extension of extensions) {
                    const name = `.hidden.other.${extension.toUpperCase()}`;
                    fs.writeFileSync(path.join(dir, name), 'héllo');
                    await expect(files.readBlob(name)).resolves.toEqual({
                        content: 'héllo', encoding: 'utf-8', mimeType,
                    });
                }
            }
            fs.writeFileSync(path.join(dir, '.env'), 'x');
            await expect(files.readBlob('.env')).resolves.toMatchObject({ mimeType: 'application/octet-stream' });
        } finally {
            files.dispose();
            removeDir(dir);
        }
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

    it('uses Git directory rules and ripgrep file rules for flat and deep listings', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-list-ignore-'));
        const files = addon.openRepoFiles(dir);
        try {
            execFileSync('git', ['init', '-q', dir]);
            fs.writeFileSync(path.join(dir, '.ignore'), 'visible/\n*.log\n!git-hidden/\n');
            fs.writeFileSync(path.join(dir, '.gitignore'), 'git-hidden/\n');
            fs.writeFileSync(path.join(dir, '.git', 'info', 'exclude'), 'local-hidden/\n');
            for (const name of ['visible', 'git-hidden', 'local-hidden']) {
                fs.mkdirSync(path.join(dir, name));
                fs.writeFileSync(path.join(dir, name, 'keep.txt'), 'x');
            }
            fs.writeFileSync(path.join(dir, 'visible', '.ignore'), 'nested/\n*.tmp\n');
            fs.mkdirSync(path.join(dir, 'visible', 'nested'));
            fs.writeFileSync(path.join(dir, 'visible', 'debug.log'), 'x');
            fs.writeFileSync(path.join(dir, 'visible', 'cache.tmp'), 'x');
            const options = { showIgnored: false, maxEntries: 100 };
            const flat = await files.listDirectory('', options);
            const dirs = ['visible', 'git-hidden', 'local-hidden'];
            const gitIgnored = execFileSync('git', ['-C', dir, 'check-ignore', '--stdin'], {
                input: dirs.map(name => `${name}/`).join('\n') + '\n', encoding: 'utf8',
            }).trim().split('\n').map(name => name.replace(/\/$/, ''));
            expect(flat.entries.filter(e => e.type === 'dir').map(e => e.name)).toEqual([
                '.git', ...dirs.filter(name => !gitIgnored.includes(name)),
            ]);
            const deep = await files.listDirectory('', { ...options, depth: 3 });
            const visible = deep.entries.find(e => e.name === 'visible')!;
            expect(visible.children!.map(e => e.name)).toEqual(['nested', '.ignore', 'keep.txt']);
            expect(deep.entries.map(e => e.name)).toEqual(flat.entries.map(e => e.name));
            expect((await files.listDirectory('', { ...options, showIgnored: true })).entries
                .filter(e => e.type === 'dir').map(e => e.name)).toEqual(['.git', 'git-hidden', 'local-hidden', 'visible']);
            expect((await files.indexFiles(options)).files).not.toContain('visible/keep.txt');
            expect((await files.listFiles('visible', options)).files).toEqual(['visible/.ignore', 'visible/keep.txt']);
        } finally {
            files.dispose();
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

describe('RepoFiles indexes', () => {
    it('lists, searches and refreshes the whole-root index after a write', async () => {
        const files = addon.openRepoFiles(root, 60_000);
        const before = await files.indexFiles({ showIgnored: true, maxEntries: 1 });
        expect(before).toEqual({ files: [expect.any(String)], truncated: true });

        await files.writeBlob('zz-created.ts', 'x');
        const [hit] = await files.searchFiles('zzcreated', 5, true);
        expect(hit).toMatchObject({ path: 'zz-created.ts', indices: expect.any(Array) });
        const [ranked] = await files.searchFilesRanked('zzcreated', 5, true);
        expect(ranked.ranking).toMatchObject({ tier: 2 });
        await expect(files.invalidate()).resolves.toBe(true);
    });

    // A one-hour TTL keeps the built snapshots from refreshing on their own,
    // so only replaceContent itself can make outside changes visible.
    const target = (text: string, match: string) =>
        ({ line: 1, text, startColumn: text.indexOf(match), endColumn: text.indexOf(match) + match.length });

    it('refreshes both built variants when replaceContent writes, even if a later file fails', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-replace-index-'));
        const files = addon.openRepoFiles(dir, 3_600_000);
        const listed = async (showIgnored: boolean) => (await files.indexFiles({ showIgnored, maxEntries: 100 })).files;
        const locked = path.join(dir, 'locked.txt');
        try {
            execFileSync('git', ['init', '-q', dir]);
            fs.writeFileSync(path.join(dir, '.gitignore'), 'secret.txt\n');
            fs.writeFileSync(path.join(dir, 'secret.txt'), 'x');
            expect(await listed(false)).not.toContain('secret.txt');
            expect(await files.searchFiles('secret', 5, false)).toEqual([]);
            expect(await listed(true)).toContain('secret.txt');

            fs.writeFileSync(path.join(dir, 'outside.txt'), 'x');
            await expect(files.replaceContent('secret.txt', 'public.txt', [
                { path: '.gitignore', targets: [target('secret.txt', 'secret.txt')] },
            ])).resolves.toEqual({ replacedMatches: 1, replacedFiles: 1, skipped: [] });
            expect(await listed(false)).toContain('secret.txt');
            expect((await files.searchFiles('secret', 5, false)).map(hit => hit.path)).toEqual(['secret.txt']);
            expect(await listed(true)).toContain('outside.txt');

            // .gitignore is committed, then writing the read-only second file fails.
            fs.writeFileSync(locked, 'public.txt\n');
            fs.chmodSync(locked, 0o444);
            fs.writeFileSync(path.join(dir, 'late.txt'), 'x');
            await expect(files.replaceContent('public.txt', 'secret.txt', [
                { path: '.gitignore', targets: [target('public.txt', 'public.txt')] },
                { path: 'locked.txt', targets: [target('public.txt', 'public.txt')] },
            ])).rejects.not.toMatchObject({ code: 'InvalidArg' });
            expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe('secret.txt\n');
            expect(await listed(false)).not.toContain('secret.txt');
            expect(await files.searchFiles('secret', 5, false)).toEqual([]);
            expect(await listed(true)).toContain('late.txt');
        } finally {
            files.dispose();
            if (fs.existsSync(locked)) fs.chmodSync(locked, 0o644);
            removeDir(dir);
        }
    });

    it('leaves built variants alone when replaceContent writes nothing or rejects the query', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-replace-noop-'));
        const files = addon.openRepoFiles(dir, 3_600_000);
        const listed = async (showIgnored: boolean) => (await files.indexFiles({ showIgnored, maxEntries: 100 })).files;
        try {
            fs.writeFileSync(path.join(dir, 'a.txt'), 'old\n');
            expect(await listed(false)).toEqual(['a.txt']);
            expect(await listed(true)).toEqual(['a.txt']);

            fs.writeFileSync(path.join(dir, 'outside.txt'), 'x');
            const none = { replacedMatches: 0, replacedFiles: 0 };
            await expect(files.replaceContent('old', 'new', [])).resolves.toEqual({ ...none, skipped: [] });
            await expect(files.replaceContent('old', 'new', [
                { path: 'gone.txt', targets: [target('old', 'old')] },
                { path: 'a.txt', targets: [target('stale old', 'old')] },
            ])).resolves.toMatchObject({ ...none, skipped: [{ reason: 'missing' }, { reason: 'stale' }] });
            await expect(files.replaceContent('(', 'new', [
                { path: 'a.txt', targets: [target('old', 'old')] },
            ], { regex: true })).rejects.toMatchObject({ code: 'InvalidArg' });
            expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('old\n');
            expect(await listed(false)).toEqual(['a.txt']);
            expect(await listed(true)).toEqual(['a.txt']);
            expect(await files.searchFiles('outside', 5, false)).toEqual([]);

            await expect(files.invalidate()).resolves.toBe(true);
            expect(await listed(false)).toEqual(['a.txt', 'outside.txt']);
            expect(await listed(true)).toEqual(['a.txt', 'outside.txt']);
        } finally {
            files.dispose();
            removeDir(dir);
        }
    });

    it('rejects every call after dispose', async () => {
        const files = addon.openRepoFiles(root);
        await files.searchFiles('a', 5, false);
        files.dispose();
        for (const call of [
            () => files.searchFiles('a', 5, false),
            () => files.indexFiles({ showIgnored: false, maxEntries: 5 }),
            () => files.readBlob('a.md'),
            () => files.writeBlob('d.txt', 'x'),
        ]) {
            await expect(call()).rejects.toMatchObject({ code: 'Closing', message: 'Repo files handle disposed' });
        }
        expect(fs.existsSync(path.join(root, 'd.txt'))).toBe(false);
    });
});


describe('RepoFiles content search', () => {
    it('owns tracked eligibility, fresh reads, untracked mode and UTF-16 offsets', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-repo-content-'));
        const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
        const files = addon.openRepoFiles(dir);
        try {
            git('init');
            fs.mkdirSync(path.join(dir, 'ignored'));
            fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored/\n');
            fs.writeFileSync(path.join(dir, 'tracked.txt'), 'before\n🎯 Needle\nafter\n');
            fs.writeFileSync(path.join(dir, 'ignored', 'tracked.txt'), 'Needle\n');
            fs.writeFileSync(path.join(dir, 'untracked.txt'), 'Needle\n');
            fs.writeFileSync(path.join(dir, 'ignored', 'untracked.txt'), 'Needle\n');
            git('add', '.gitignore', 'tracked.txt');
            git('add', '-f', 'ignored/tracked.txt');
            const tracked = await files.searchContent('needle', undefined, true);
            expect(tracked.matches.map(m => m.path)).toEqual(['ignored/tracked.txt', 'tracked.txt']);
            expect(tracked.matches[1]).toMatchObject({ startColumn: 3, endColumn: 9, before: ['before'], after: ['after'] });
            const untracked = await files.searchContent('Needle', undefined, true, true);
            expect(untracked.matches.map(m => m.path)).toEqual(['ignored/tracked.txt', 'tracked.txt', 'untracked.txt']);
            const scoped = await files.searchContent('Needle', { path: '/ignored', include: ['*.txt'] }, true);
            expect(scoped.matches.map(m => m.path)).toEqual(['ignored/tracked.txt']);
            const multiline = await files.searchContent('before\n🎯 Needle', undefined, true);
            expect(multiline.matches.map(m => m.line)).toEqual([1, 2]);
            expect(multiline.matches[0].group).toBe(multiline.matches[1].group);
            fs.writeFileSync(path.join(dir, 'tracked.txt'), 'gone\n');
            expect((await files.searchContent('Needle', undefined, true)).matches.map(m => m.path)).toEqual(['ignored/tracked.txt']);
        } finally {
            files.dispose();
            removeDir(dir);
        }
    });

    it('parses WSL output without host Git and keeps empty candidates empty', async () => {
        // Deliberately not a Git repo: any accidental host command would fail.
        const files = addon.openRepoFiles(root);
        expect(await files.prepareContentCandidates(true)).toEqual({
            args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
            timeoutMs: 15_000,
            maxBuffer: 64 * 1024 * 1024,
        });
        expect((await files.searchContent('héllo', { path: './' }, true, false, 'a.md\0')).matches).toHaveLength(1);
        expect((await files.searchContent('héllo', undefined, true, false, '')).matches).toEqual([]);
        files.dispose();
        await expect(files.prepareContentCandidates(false)).rejects.toThrow('Repo files handle disposed');
        await expect(files.searchContent('héllo')).rejects.toMatchObject({ code: 'Closing' });
    });

    it('preserves error categories and missing-root messages', async () => {
        const files = addon.openRepoFiles(root);
        await expect(files.searchContent('[', { regex: true })).rejects.toMatchObject({ code: 'InvalidArg' });
        await expect(files.searchContent('x', { path: '../escape' })).rejects.toMatchObject({ code: 'InvalidArg' });
        await expect(files.searchContent('x', { include: ['['] })).rejects.toMatchObject({ code: 'InvalidArg' });
        await expect(files.searchContent('x', undefined, true)).rejects.toMatchObject({
            code: 'GenericFailure',
            message: expect.stringContaining('[repo-files:tracked-unavailable] Git-tracked search is unavailable:'),
        });
        const missing = path.join(root, 'missing-root');
        await expect(addon.openRepoFiles(missing).prepareContentCandidates(false)).rejects.toThrow(`Repo not found on disk: ${missing}`);
        await expect(addon.openRepoFiles(path.join(root, 'a.md')).prepareContentCandidates(false)).rejects.toThrow('Repo not found on disk:');
        await expect(addon.openRepoFiles(missing).searchContent('x')).rejects.toThrow(`Repo not found on disk: ${missing}`);
        await expect(addon.openRepoFiles(path.join(root, 'a.md')).searchContent('x')).rejects.toThrow('Repo not found on disk:');
        files.dispose();
    });

    it('keeps roots isolated and clamps repository result limits', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-repo-content-caps-'));
        const files = addon.openRepoFiles(dir);
        try {
            fs.writeFileSync(path.join(dir, 'caps.txt'), 'unique-marker\n'.repeat(600));
            const limited = await files.searchContent('unique-marker', { maxResults: 0 });
            expect(limited.matches).toHaveLength(1);
            expect(limited.truncated).toBe(true);
            const capped = await files.searchContent('unique-marker', { maxResults: 1000, maxPerFile: 1000 });
            expect(capped.matches).toHaveLength(500);
            expect(capped.truncated).toBe(true);
            expect((await addon.openRepoFiles(root).searchContent('unique-marker')).matches).toEqual([]);
        } finally {
            files.dispose();
            removeDir(dir);
        }
    });
});
