/** N-API promise, marshalling, bounds, safety, and error tests for Notes. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { disabled, notesAddon } from './helpers';

const suite = disabled ? describe.skip : describe;
let root: string;

function write(base: string, relative: string, contents: string): void {
    const target = path.join(base, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
}

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-boundary-'));
    write(root, 'nested/Needle.md', 'first\nTARGET line\r\nlast target');
    write(root, 'nested/ignored.MD', 'target');
    write(root, 'plain.txt', 'target');
    write(root, 'unicode.md', 'İSTANBUL\nStraße\nCAFÉ');
});

afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

suite('Notes build and search marshalling', () => {
    it('returns the exact bounded REST response shape', async () => {
        const building = notesAddon!.buildNotesIndex(root, {});
        expect(building).toBeInstanceOf(Promise);
        const index = await building;

        const searching = index.search('target');
        expect(searching).toBeInstanceOf(Promise);
        await expect(searching).resolves.toEqual({
            results: [
                {
                    path: 'nested/Needle.md',
                    matches: [
                        { line: 2, text: 'TARGET line\r' },
                        { line: 3, text: 'last target' },
                    ],
                },
            ],
            truncated: false,
        });
    });

    it('puts a filename match before original content lines', async () => {
        const index = await notesAddon!.buildNotesIndex(root);
        expect(await index.search('needle')).toEqual({
            results: [
                {
                    path: 'nested/Needle.md',
                    matches: [{ line: 0, text: 'Needle.md' }],
                },
            ],
            truncated: false,
        });
    });

    it('uses JavaScript-compatible Unicode lowercasing', async () => {
        const index = await notesAddon!.buildNotesIndex(root, {});
        expect((await index.search('İST')).results[0].matches[0]).toEqual({
            line: 1,
            text: 'İSTANBUL',
        });
        expect((await index.search('straße')).results[0].matches[0].line).toBe(2);
        expect((await index.search('café')).results[0].matches[0].line).toBe(3);
        expect((await index.search('STRASSE')).results).toEqual([]);
        expect((await index.search('istanbul')).results).toEqual([]);
    });

    it('builds a missing root as an empty, non-truncated index', async () => {
        const index = await notesAddon!.buildNotesIndex(path.join(root, 'missing'), {});
        expect(await index.search('anything')).toEqual({ results: [], truncated: false });
    });

    it('caps matching files at 50 without crossing an unbounded array', async () => {
        const cappedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-file-cap-'));
        try {
            for (let index = 0; index < 60; index++) {
                write(cappedRoot, `needle-${String(index).padStart(2, '0')}.md`, 'unrelated');
            }
            const index = await notesAddon!.buildNotesIndex(cappedRoot, {});
            const response = await index.search('needle');
            expect(response.results).toHaveLength(50);
            expect(response.results.flatMap(result => result.matches)).toHaveLength(50);
            expect(response.truncated).toBe(true);
        } finally {
            fs.rmSync(cappedRoot, { recursive: true, force: true });
        }
    });

    it('caps filename and line matches together at 100', async () => {
        const cappedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-match-cap-'));
        try {
            write(cappedRoot, 'needle.md', Array.from({ length: 120 }, () => 'needle').join('\n'));
            const index = await notesAddon!.buildNotesIndex(cappedRoot, {});
            const response = await index.search('needle');
            expect(response.results).toHaveLength(1);
            expect(response.results[0].matches).toHaveLength(100);
            expect(response.results[0].matches[0]).toEqual({ line: 0, text: 'needle.md' });
            expect(response.results[0].matches.at(-1)?.line).toBe(99);
            expect(response.truncated).toBe(true);
        } finally {
            fs.rmSync(cappedRoot, { recursive: true, force: true });
        }
    });
});

suite('Notes async contract', () => {
    it('build work does not block a queued Node timer', async () => {
        const big = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-async-build-'));
        try {
            const content = Array.from({ length: 2_000 }, (_, index) => `line ${index}`).join('\n');
            for (let index = 0; index < 300; index++) {
                write(big, `folder-${index % 20}/note-${index}.md`, content);
            }

            let resolved = false;
            const building = notesAddon!.buildNotesIndex(big, {}).then(index => {
                resolved = true;
                return index;
            });
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            expect(resolved).toBe(false);
            await building;
        } finally {
            fs.rmSync(big, { recursive: true, force: true });
        }
    });

    it('search work does not block a queued Node timer', async () => {
        const big = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-async-search-'));
        try {
            const content = Array.from({ length: 25_000 }, (_, index) => `ordinary line ${index}`).join('\n');
            for (let index = 0; index < 40; index++) write(big, `note-${index}.md`, content);
            const index = await notesAddon!.buildNotesIndex(big, {});

            let resolved = false;
            const searching = index.search('not-present-anywhere').then(response => {
                resolved = true;
                return response;
            });
            await new Promise<void>(resolve => setTimeout(resolve, 0));
            expect(resolved).toBe(false);
            await expect(searching).resolves.toEqual({ results: [], truncated: false });
        } finally {
            fs.rmSync(big, { recursive: true, force: true });
        }
    });
});

suite('Notes build errors and symlink policy', () => {
    it('propagates an initial build error with the root path', async () => {
        await expect(notesAddon!.buildNotesIndex(path.join(root, 'plain.txt'), {})).rejects.toThrow(
            /plain\.txt/,
        );
    });

    it.runIf(process.platform !== 'win32')('skips external file and directory symlinks', async () => {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-symlink-'));
        const safeRoot = path.join(parent, 'root');
        const outside = path.join(parent, 'outside');
        try {
            fs.mkdirSync(safeRoot);
            write(outside, 'secret.md', 'outside-token');
            fs.symlinkSync(path.join(outside, 'secret.md'), path.join(safeRoot, 'file-link.md'));
            fs.symlinkSync(outside, path.join(safeRoot, 'directory-link'), 'dir');

            const index = await notesAddon!.buildNotesIndex(safeRoot, { skipSymlinks: true });
            expect((await index.search('outside-token')).results).toEqual([]);
            expect((await index.search('file-link')).results).toEqual([]);
        } finally {
            fs.rmSync(parent, { recursive: true, force: true });
        }
    });
});
