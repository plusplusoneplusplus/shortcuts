/**
 * Windows-only differential tests for RepoFiles path containment. The oracle
 * is the TypeScript guard the handle replaced: strip leading separators,
 * `path.resolve` against the root, then accept only the root itself or
 * `root + path.sep`. Two spellings knowingly differ and are pinned to the
 * native result (`differs`). The lexical cases, including UNC roots, live in
 * `rust/core/tests/repo_files_blob.rs` (`windows_paths`).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadNativeRepoFiles, type NativeRepoFiles } from '../src/repo-files';
import { removeDir } from './helpers';

const addon = loadNativeRepoFiles();
const TRAVERSAL = { code: 'InvalidArg', message: 'Path traversal detected: path escapes repo root' };
const options = { showIgnored: false, maxEntries: 100 };

describe.runIf(process.platform === 'win32')('RepoFiles Windows path containment', () => {
    let root: string;
    let files: NativeRepoFiles;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-win-paths-'));
        fs.mkdirSync(path.join(root, 'src', 'nested'), { recursive: true });
        fs.writeFileSync(path.join(root, 'src', 'a.txt'), 'alpha');
        fs.writeFileSync(path.join(root, 'src', 'nested', 'b.txt'), 'beta');
        files = addon.openRepoFiles(root);
    });

    afterEach(() => {
        files.dispose();
        removeDir(root);
    });

    /** Where the old guard resolved `input`, and whether it accepted it. */
    function oracle(input: string): { target: string; accepted: boolean } {
        const target = path.resolve(root, input.replace(/^[/\\]+/, '') || '.');
        const base = path.resolve(root);
        return { target, accepted: target === base || target.startsWith(base + path.sep) };
    }

    /** Spellings of the root-relative `leaf` (written with `\`). */
    function spellings(leaf: string): Array<{ input: string; differs: boolean }> {
        const drive = root.slice(0, 2);
        const flipped = drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase();
        const other = drive.toUpperCase() === 'Z:' ? 'Y:' : 'Z:';
        const name = path.basename(root);
        const posix = leaf.split('\\').join('/');
        const agreed = [
            `${root}\\${leaf}`, // drive-absolute
            `${root.split('\\').join('/')}/${posix}`,
            `${path.dirname(root)}\\${leaf}`,
            `${root.toUpperCase()}\\${leaf}`, // directory names compare case-sensitively
            `/${drive}/${posix}`,
            `${other}\\${leaf}`,
            `${other}${leaf}`, // drive-relative on another drive
            `\\\\server\\share\\${leaf}`, // UNC-looking: stripped, so inside the root
            `//server/share/${posix}`,
            `x/y\\..\\..\\${leaf}`, // mixed separators
            `x\\..//..\\${leaf}`,
            `..\\${name}\\${leaf}`, // backslash traversal
            `..\\${name}-evil\\${leaf}`,
            `..\\..\\${leaf}`,
            `\\${leaf}`,
            `\\..\\${leaf}`,
        ];
        return [
            ...agreed.map(input => ({ input, differs: false })),
            // `path.resolve` read a same-drive `C:x` against the root; a drive
            // prefix replaces the root natively, so it is rejected.
            { input: `${drive}${leaf}`, differs: true },
            // `startsWith` refused another drive-letter case; natively it is the same root.
            { input: `${flipped}${root.slice(2)}\\${leaf}`, differs: true },
        ];
    }

    it('reads blobs where the old guard did, with the same messages', async () => {
        for (const { input, differs } of spellings('src\\a.txt')) {
            const { target, accepted } = oracle(input);
            const read = files.readBlob(input);
            if (accepted === differs) {
                await expect(read, input).rejects.toMatchObject(TRAVERSAL);
            } else if (fs.existsSync(target)) {
                await expect(read, input).resolves.toMatchObject({ content: 'alpha', encoding: 'utf-8' });
            } else {
                await expect(read, input).rejects.toThrow(`File not found: ${input}`);
            }
        }
    });

    it('writes blobs where the old guard did and nowhere else', async () => {
        const count = spellings('w').length;
        for (let i = 0; i < count; i++) {
            const { input, differs } = spellings(`w\\${i}.txt`)[i];
            const { target, accepted } = oracle(input);
            const write = files.writeBlob(input, `content ${i}`);
            if (accepted === differs) {
                await expect(write, input).rejects.toMatchObject(TRAVERSAL);
                expect(fs.existsSync(target), input).toBe(false);
            } else {
                await expect(write, input).resolves.toBeUndefined();
                expect(fs.readFileSync(target, 'utf-8'), input).toBe(`content ${i}`);
            }
        }
    });

    it('lists directories where the old guard did, with POSIX entry paths', async () => {
        for (const { input, differs } of spellings('src')) {
            const { target, accepted } = oracle(input);
            const listing = files.listDirectory(input, options);
            const walk = files.listFiles(input, options);
            if (accepted === differs) {
                await expect(listing, input).rejects.toMatchObject(TRAVERSAL);
                await expect(walk, input).rejects.toMatchObject(TRAVERSAL);
            } else if (fs.existsSync(target)) {
                expect((await listing).entries.map(e => e.path), input).toEqual(['src/nested', 'src/a.txt']);
                expect((await walk).files, input).toEqual(['src/a.txt', 'src/nested/b.txt']);
            } else {
                await expect(listing, input).rejects.toThrow(`Path does not exist: ${input}`);
                expect((await walk).files, input).toEqual([]);
            }
        }
        const deep = await files.listDirectory('\\', { ...options, depth: 3 });
        expect(deep.entries[0].children?.[0]).toMatchObject({
            path: 'src/nested',
            children: [{ path: 'src/nested/b.txt' }],
        });
    });
});
