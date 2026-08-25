/**
 * N-API boundary tests for content search: marshalling, async behaviour, error
 * propagation and concurrency against the real compiled addon.
 *
 * The engine's own semantics — caps, modes, gitignore, context — are pinned by
 * the Rust suite in `rust/core/tests/content_search.rs`. What is only testable
 * here is what crossing into JavaScript does to them: that the option object
 * reaches Rust with its camelCase names, that columns are JavaScript string
 * indices, that a bad query rejects rather than throwing synchronously, and
 * that concurrent queries do not interfere.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { contentSearchAddon as addon } from './helpers';
import type { NativeContentSearchResult } from '../src/content-search';

let root: string;

function write(relative: string, contents = ''): void {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
}

/** `path:line` for every match, which is what most assertions care about. */
function locations(result: NativeContentSearchResult): string[] {
    return result.matches.map(match => `${match.path}:${match.line}`);
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-content-'));
    // A .git directory makes gitignore rules apply exactly as ripgrep applies them.
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    write('.git/HEAD', 'ref: refs/heads/main\n');
    write('.gitignore', 'ignored.txt\ndist/\n');
    write('src/index.ts', 'const needle = 1;\nexport { needle };\n');
    write('src/nested/deep.ts', 'before\nNEEDLE in here\nafter\n');
    write('README.md', 'no match at all\n');
    write('ignored.txt', 'needle\n');
    write('dist/bundle.js', 'needle\n');
    write('docs/日本語/ファイル.md', 'ここに needle があります\n');
    write('docs/a file with spaces.md', 'needle\n');
});

afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('marshalling', () => {
    it('returns repo-relative POSIX paths, gitignored entries excluded', async () => {
        const result = await addon.searchContent(root, 'needle');

        expect(locations(result)).toEqual([
            'docs/a file with spaces.md:1',
            'docs/日本語/ファイル.md:1',
            'src/index.ts:1',
            'src/index.ts:2',
            'src/nested/deep.ts:2',
        ]);
        expect(result.truncated).toBe(false);
    });

    it('accepts an omitted options argument', async () => {
        await expect(addon.searchContent(root, 'no match at all')).resolves.toMatchObject({
            matches: [{ path: 'README.md', line: 1 }],
        });
    });

    it('reports columns as JavaScript string indices into the returned text', async () => {
        const result = await addon.searchContent(root, 'needle');

        for (const match of result.matches) {
            expect(match.text.slice(match.startColumn, match.endColumn).toLowerCase()).toBe(
                'needle',
            );
        }
    });

    it('keeps columns correct for a line with non-ASCII characters before the match', async () => {
        const result = await addon.searchContent(root, 'needle', {
            path: 'docs/日本語',
        });

        const [match] = result.matches;
        expect(match.text).toBe('ここに needle があります');
        // Four UTF-16 units of Japanese text and a space precede the match.
        expect(match.startColumn).toBe(4);
        expect(match.text.slice(match.startColumn, match.endColumn)).toBe('needle');
    });

    it('carries context lines across as arrays of strings', async () => {
        const result = await addon.searchContent(root, 'NEEDLE in here');

        expect(result.matches[0].before).toEqual(['before']);
        expect(result.matches[0].after).toEqual(['after']);
    });

    it('passes every camelCase option through to the engine', async () => {
        const sensitive = await addon.searchContent(root, 'NEEDLE', { caseSensitive: true });
        expect(locations(sensitive)).toEqual(['src/nested/deep.ts:2']);

        const scoped = await addon.searchContent(root, 'needle', { path: 'src/nested' });
        expect(locations(scoped)).toEqual(['src/nested/deep.ts:2']);

        const ignored = await addon.searchContent(root, 'needle', { showIgnored: true });
        expect(locations(ignored)).toContain('ignored.txt:1');

        const worded = await addon.searchContent(root, 'needl', { wholeWord: true });
        expect(worded.matches).toEqual([]);

        const regex = await addon.searchContent(root, 'ne+dle', { regex: true });
        expect(locations(regex)).toContain('src/index.ts:1');

        const included = await addon.searchContent(root, 'needle', { include: ['*.md'] });
        expect(locations(included)).toEqual([
            'docs/a file with spaces.md:1',
            'docs/日本語/ファイル.md:1',
        ]);

        const excluded = await addon.searchContent(root, 'needle', { exclude: ['*.ts'] });
        expect(locations(excluded)).toEqual([
            'docs/a file with spaces.md:1',
            'docs/日本語/ファイル.md:1',
        ]);

        const bare = await addon.searchContent(root, 'needle', { contextLines: 0 });
        expect(bare.matches.every(match => match.before.length + match.after.length === 0)).toBe(
            true,
        );

        const capped = await addon.searchContent(root, 'needle', { maxResults: 2 });
        expect(capped.matches).toHaveLength(2);
        expect(capped.truncated).toBe(true);

        const perFile = await addon.searchContent(root, 'needle', { maxPerFile: 1 });
        expect(locations(perFile)).not.toContain('src/index.ts:2');
        expect(perFile.truncated).toBe(true);

        const tiny = await addon.searchContent(root, 'needle', { maxFileSizeBytes: 1 });
        expect(tiny.matches).toEqual([]);
        expect(tiny.truncated).toBe(true);
    });
});

describe('async contract', () => {
    it('returns a promise and does not resolve in the same microtask', async () => {
        let settled = false;
        const pending = addon.searchContent(root, 'needle');
        expect(pending).toBeInstanceOf(Promise);

        void pending.then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        await pending;
        expect(settled).toBe(true);
    });

    it('does not block the event loop while the walk runs', async () => {
        const ticks: string[] = [];
        const search = addon.searchContent(root, 'needle').then(() => ticks.push('search'));
        const timer = new Promise<void>(resolve =>
            setTimeout(() => {
                ticks.push('timer');
                resolve();
            }, 0),
        );

        await Promise.all([search, timer]);
        expect(ticks).toContain('timer');
    });
});

describe('error propagation', () => {
    it('rejects an invalid regex rather than throwing synchronously', async () => {
        const pending = addon.searchContent(root, '(unclosed', { regex: true });

        await expect(pending).rejects.toThrow(/invalid regular expression/);
    });

    it('tags a caller mistake with the InvalidArg status', async () => {
        const error = await addon
            .searchContent(root, '(unclosed', { regex: true })
            .then(() => null)
            .catch((e: NodeJS.ErrnoException) => e);

        expect(error?.code).toBe('InvalidArg');
    });

    it('rejects a path that escapes the root', async () => {
        await expect(addon.searchContent(root, 'needle', { path: '../..' })).rejects.toThrow(
            /invalid search path/,
        );
    });

    it('rejects a path that does not exist', async () => {
        await expect(addon.searchContent(root, 'needle', { path: 'nope' })).rejects.toThrow(
            /no such directory/,
        );
    });

    it('rejects a root that does not exist', async () => {
        await expect(
            addon.searchContent(path.join(root, 'absent'), 'needle'),
        ).rejects.toThrow();
    });

    it('resolves empty for an empty query rather than matching every line', async () => {
        await expect(addon.searchContent(root, '')).resolves.toEqual({
            matches: [],
            truncated: false,
        });
    });

    it('treats a regex metacharacter as a literal unless regex is set', async () => {
        await expect(addon.searchContent(root, '(unclosed')).resolves.toMatchObject({
            matches: [],
        });
    });
});

describe('concurrency', () => {
    it('runs overlapping searches without interfering', async () => {
        const queries = ['needle', 'NEEDLE in here', 'no match at all', 'needle', 'nothing here'];

        const results = await Promise.all(queries.map(query => addon.searchContent(root, query)));

        expect(locations(results[0])).toEqual(locations(results[3]));
        expect(locations(results[1])).toEqual(['src/nested/deep.ts:2']);
        expect(locations(results[2])).toEqual(['README.md:1']);
        expect(results[4].matches).toEqual([]);
    });

    it('keeps per-call options independent across concurrent calls', async () => {
        const [sensitive, insensitive] = await Promise.all([
            addon.searchContent(root, 'NEEDLE', { caseSensitive: true }),
            addon.searchContent(root, 'NEEDLE', { caseSensitive: false }),
        ]);

        expect(locations(sensitive)).toEqual(['src/nested/deep.ts:2']);
        expect(insensitive.matches.length).toBeGreaterThan(sensitive.matches.length);
    });
});
