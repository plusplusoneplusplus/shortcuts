/** N-API promise, marshalling, bounds, safety, and error tests for Notes. */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { notesAddon } from './helpers';

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

describe('Notes build and search marshalling', () => {
    it('returns the exact bounded REST response shape', async () => {
        const building = notesAddon.buildNotesIndex(root, {});
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
        const index = await notesAddon.buildNotesIndex(root);
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
        const index = await notesAddon.buildNotesIndex(root, {});
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
        const index = await notesAddon.buildNotesIndex(path.join(root, 'missing'), {});
        expect(await index.search('anything')).toEqual({ results: [], truncated: false });
    });

    it('caps matching files at 50 without crossing an unbounded array', async () => {
        const cappedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-file-cap-'));
        try {
            for (let index = 0; index < 60; index++) {
                write(cappedRoot, `needle-${String(index).padStart(2, '0')}.md`, 'unrelated');
            }
            const index = await notesAddon.buildNotesIndex(cappedRoot, {});
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
            const index = await notesAddon.buildNotesIndex(cappedRoot, {});
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

describe('Notes refresh marshalling and consistency', () => {
    it('incrementally adds, modifies, and deletes files from a bounded batch', async () => {
        const changing = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-changes-'));
        try {
            write(changing, 'stable.md', 'old-token');
            const index = await notesAddon.buildNotesIndex(changing, {});

            write(changing, 'stable.md', 'modified-token');
            write(changing, 'nested/added.md', 'added-token');
            const refreshing = index.refreshChanged(['stable.md', 'nested/added.md']);
            expect(refreshing).toBeInstanceOf(Promise);
            await refreshing;
            expect((await index.search('modified-token')).results[0].path).toBe('stable.md');
            expect((await index.search('added-token')).results[0].path).toBe('nested/added.md');
            expect((await index.search('old-token')).results).toEqual([]);

            fs.rmSync(path.join(changing, 'nested/added.md'));
            await index.refreshChanged(['nested/added.md']);
            expect((await index.search('added-token')).results).toEqual([]);
        } finally {
            fs.rmSync(changing, { recursive: true, force: true });
        }
    });

    it('full refresh recovers directory rename sequences', async () => {
        const changing = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-rename-'));
        try {
            write(changing, 'before/note.md', 'rename-token');
            const index = await notesAddon.buildNotesIndex(changing, {});
            fs.renameSync(path.join(changing, 'before'), path.join(changing, 'after'));

            const refreshing = index.refresh();
            expect(refreshing).toBeInstanceOf(Promise);
            await refreshing;
            expect((await index.search('rename-token')).results).toEqual([
                {
                    path: 'after/note.md',
                    matches: [{ line: 1, text: 'rename-token' }],
                },
            ]);
        } finally {
            fs.rmSync(changing, { recursive: true, force: true });
        }
    });

    it('retains the last complete snapshot when incremental refresh fails', async () => {
        const changing = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-retention-'));
        try {
            write(changing, 'stable.md', 'stable-token');
            const index = await notesAddon.buildNotesIndex(changing, {});

            await expect(index.refreshChanged(['../escape.md'])).rejects.toThrow(
                /root-relative changed path/,
            );
            await expect(index.refreshChanged(['.'])).rejects.toThrow(/root-relative changed path/);
            expect((await index.search('stable-token')).results[0].path).toBe('stable.md');

            fs.rmSync(changing, { recursive: true, force: true });
            fs.writeFileSync(changing, 'not a directory');
            await expect(index.refresh()).rejects.toThrow(/failed to refresh Notes index/);
            expect((await index.search('stable-token')).results[0].path).toBe('stable.md');
        } finally {
            fs.rmSync(changing, { recursive: true, force: true });
        }
    });

    it('serializes concurrent incremental batches so changes are not lost', async () => {
        const changing = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-queued-'));
        try {
            const index = await notesAddon.buildNotesIndex(changing, {});
            write(changing, 'first.md', 'first-token');
            write(changing, 'second.md', 'second-token');

            await Promise.all([
                index.refreshChanged(['first.md']),
                index.refreshChanged(['second.md']),
            ]);
            expect((await index.search('first-token')).results[0].path).toBe('first.md');
            expect((await index.search('second-token')).results[0].path).toBe('second.md');
        } finally {
            fs.rmSync(changing, { recursive: true, force: true });
        }
    });

    it('searches racing incremental refresh see a complete old or new snapshot', async () => {
        const changing = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-race-'));
        try {
            const changedPaths = Array.from({ length: 20 }, (_, index) => `note-${index}.md`);
            for (const relative of changedPaths) write(changing, relative, 'old generation');
            const index = await notesAddon.buildNotesIndex(changing, {});
            for (const relative of changedPaths) write(changing, relative, 'new generation');

            const refreshing = index.refreshChanged(changedPaths);
            const searches = Array.from({ length: 30 }, () => index.search('generation'));
            const [, ...responses] = await Promise.all([refreshing, ...searches]);

            for (const response of responses) {
                expect(response.results).toHaveLength(20);
                const lines = response.results.map(result => result.matches[0].text);
                expect(
                    lines.every(line => line === 'old generation') ||
                        lines.every(line => line === 'new generation'),
                ).toBe(true);
            }
        } finally {
            fs.rmSync(changing, { recursive: true, force: true });
        }
    });

    it('searches racing full refresh see a complete old or new snapshot', async () => {
        const changing = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-full-race-'));
        try {
            const paths = Array.from({ length: 20 }, (_, index) => `note-${index}.md`);
            for (const relative of paths) write(changing, relative, 'old full generation');
            const index = await notesAddon.buildNotesIndex(changing, {});
            for (const relative of paths) write(changing, relative, 'new full generation');

            const refreshing = index.refresh();
            const searches = Array.from({ length: 30 }, () => index.search('full generation'));
            const [, ...responses] = await Promise.all([refreshing, ...searches]);

            for (const response of responses) {
                expect(response.results).toHaveLength(20);
                const lines = response.results.map(result => result.matches[0].text);
                expect(
                    lines.every(line => line === 'old full generation') ||
                        lines.every(line => line === 'new full generation'),
                ).toBe(true);
            }
        } finally {
            fs.rmSync(changing, { recursive: true, force: true });
        }
    });
});

/**
 * Drain the microtask queue without letting the event loop turn.
 *
 * A promise that settles here was settled by work the call itself already
 * finished on the JS thread, because a threadpool result reaches JavaScript
 * through a libuv callback that cannot run until the loop turns again. Racing
 * the work against a `setTimeout(0)` instead — the earlier shape of these
 * assertions — only holds while the work outlasts one timer tick, which is not
 * a property of the contract: on Windows, where timer resolution is coarse and
 * the runner is fast, an in-memory search finished first and the assertion
 * failed on a correctly asynchronous addon.
 */
async function drainMicrotasks(): Promise<void> {
    for (let tick = 0; tick < 16; tick++) await Promise.resolve();
}

describe('Notes async contract', () => {
    it('observes work that the JS thread itself finished', async () => {
        // Pins the teeth of the assertions below: this is the synchronous
        // shape they rule out, and the drain has to catch it.
        let resolved = false;
        void Promise.resolve({ results: [], truncated: false }).then(() => {
            resolved = true;
        });
        await drainMicrotasks();
        expect(resolved).toBe(true);
    });

    it('does not run build work on the JS thread', async () => {
        const big = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-async-build-'));
        try {
            const content = Array.from({ length: 2_000 }, (_, index) => `line ${index}`).join('\n');
            for (let index = 0; index < 300; index++) {
                write(big, `folder-${index % 20}/note-${index}.md`, content);
            }

            let resolved = false;
            const building = notesAddon.buildNotesIndex(big, {}).then(index => {
                resolved = true;
                return index;
            });
            await drainMicrotasks();
            expect(resolved).toBe(false);
            await building;
        } finally {
            fs.rmSync(big, { recursive: true, force: true });
        }
    });

    it('does not run search work on the JS thread', async () => {
        const big = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-async-search-'));
        try {
            const content = Array.from({ length: 25_000 }, (_, index) => `ordinary line ${index}`).join('\n');
            for (let index = 0; index < 40; index++) write(big, `note-${index}.md`, content);
            const index = await notesAddon.buildNotesIndex(big, {});

            let resolved = false;
            const searching = index.search('not-present-anywhere').then(response => {
                resolved = true;
                return response;
            });
            await drainMicrotasks();
            expect(resolved).toBe(false);
            await expect(searching).resolves.toEqual({ results: [], truncated: false });
        } finally {
            fs.rmSync(big, { recursive: true, force: true });
        }
    });

    it('does not run full or incremental refresh work on the JS thread', async () => {
        const big = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-async-refresh-'));
        try {
            const content = Array.from({ length: 2_000 }, (_, index) => `line ${index}`).join('\n');
            const changedPaths = Array.from({ length: 300 }, (_, index) =>
                `folder-${index % 20}/note-${index}.md`,
            );
            for (const relative of changedPaths) write(big, relative, content);
            const index = await notesAddon.buildNotesIndex(big, {});

            let fullResolved = false;
            const fullRefresh = index.refresh().then(() => {
                fullResolved = true;
            });
            await drainMicrotasks();
            expect(fullResolved).toBe(false);
            await fullRefresh;

            for (const relative of changedPaths) write(big, relative, `${content}\nchanged`);
            let incrementalResolved = false;
            const incrementalRefresh = index.refreshChanged(changedPaths).then(() => {
                incrementalResolved = true;
            });
            await drainMicrotasks();
            expect(incrementalResolved).toBe(false);
            await incrementalRefresh;
        } finally {
            fs.rmSync(big, { recursive: true, force: true });
        }
    });
});

describe('Notes build errors and symlink policy', () => {
    it('propagates an initial build error with the root path', async () => {
        await expect(notesAddon.buildNotesIndex(path.join(root, 'plain.txt'), {})).rejects.toThrow(
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

            const index = await notesAddon.buildNotesIndex(safeRoot, { skipSymlinks: true });
            expect((await index.search('outside-token')).results).toEqual([]);
            expect((await index.search('file-link')).results).toEqual([]);
        } finally {
            fs.rmSync(parent, { recursive: true, force: true });
        }
    });
});
