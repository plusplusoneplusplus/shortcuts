/**
 * N-API promise, marshalling, and error-propagation tests for the Notes
 * filesystem capability.
 *
 * The behaviour itself is pinned in `rust/core/tests/notes_fs*.rs`. What this
 * suite covers is the crossing: that every export returns a real promise, that
 * the recursive tree object survives, that the two discriminated unions arrive
 * as objects rather than exceptions, and — the load-bearing one — that a typed
 * failure keeps its HTTP status and its exact message, because the routes send
 * both to the client verbatim.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isNativeNotesPathError, toNotesFsError } from '../src/notes-fs';
import { notesAddon, notesFsAddon } from './helpers';

let root: string;

const DEFAULT_ROOT = { isDefaultRoot: true, systemFolderNames: ['Plans'] };
const SELECTED_ROOT = { isDefaultRoot: false, systemFolderNames: ['Plans'] };
const DEFAULT_CONTENT = { isDefaultRoot: true, allowedPrefixes: [] as string[] };
const SELECTED_CONTENT = { isDefaultRoot: false, allowedPrefixes: [] as string[] };

function write(relative: string, contents: string): string {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
    return target;
}

/** Run an operation expected to reject, and decode the typed failure. */
async function failure(operation: Promise<unknown>): Promise<{ statusCode: number; message: string }> {
    try {
        await operation;
    } catch (error) {
        const decoded = toNotesFsError(error);
        return { statusCode: decoded.statusCode, message: decoded.message };
    }
    throw new Error('expected the operation to reject');
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-fs-'));
});

afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('tree marshalling', () => {
    it('returns a promise and a recursive node shape with per-directory order', async () => {
        write('Notebook/Section/page.md', '# page');
        write('Notebook/.order.json', JSON.stringify({ order: ['Section'] }, null, 2));

        const scanning = notesFsAddon.notesTree(root, { isDefaultRoot: true });
        expect(scanning).toBeInstanceOf(Promise);
        const tree = await scanning;

        expect(tree.explicitOrder).toEqual([]);
        const notebook = tree.entries.find((entry) => entry.name === 'Notebook');
        expect(notebook?.kind).toBe('notebook');
        expect(notebook?.path).toBe('Notebook');
        expect(notebook?.explicitOrder).toEqual(['Section']);
        expect(notebook?.lastModifiedAt).toBeUndefined();

        const section = notebook?.children?.[0];
        expect(section?.kind).toBe('section');
        expect(section?.path).toBe('Notebook/Section');

        const page = section?.children?.[0];
        expect(page?.kind).toBe('page');
        expect(page?.path).toBe('Notebook/Section/page.md');
        expect(page?.children).toBeUndefined();
        expect(page?.explicitOrder).toBeUndefined();
        expect(page?.lastModifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    });

    it('returns nothing but the root order for an empty root', async () => {
        expect(await notesFsAddon.notesTree(root, { isDefaultRoot: false })).toEqual({
            entries: [],
            explicitOrder: [],
        });
    });
});

describe('content marshalling', () => {
    it('reads content and an mtime the write path accepts back', async () => {
        write('note.md', 'hello');

        const read = await notesFsAddon.readNote(root, 'note.md', SELECTED_CONTENT);
        expect(read.content).toBe('hello');
        expect(typeof read.mtimeMs).toBe('number');

        const written = await notesFsAddon.writeNote(
            root,
            'note.md',
            'goodbye',
            read.mtimeMs,
            SELECTED_CONTENT,
        );
        expect(written.status).toBe('written');
        expect(typeof written.mtimeMs).toBe('number');
        expect(written.currentContent).toBeUndefined();
        expect(fs.readFileSync(path.join(root, 'note.md'), 'utf-8')).toBe('goodbye');
    });

    it('resolves rather than rejects on a stale mtime, carrying both current fields', async () => {
        write('note.md', 'on disk');

        const conflict = await notesFsAddon.writeNote(root, 'note.md', 'mine', 1, SELECTED_CONTENT);
        expect(conflict.status).toBe('conflict');
        expect(conflict.currentContent).toBe('on disk');
        expect(typeof conflict.currentMtime).toBe('number');
        expect(conflict.mtimeMs).toBeUndefined();
        expect(fs.readFileSync(path.join(root, 'note.md'), 'utf-8')).toBe('on disk');
    });

    it('treats a missing expectedMtime as an unconditional write', async () => {
        write('note.md', 'on disk');
        const first = await notesFsAddon.writeNote(root, 'note.md', 'a', undefined, SELECTED_CONTENT);
        expect(first.status).toBe('written');
        const second = await notesFsAddon.writeNote(root, 'note.md', 'b', null, SELECTED_CONTENT);
        expect(second.status).toBe('written');
    });

    it('rejects a missing file as a 404 with the message the route sends', async () => {
        expect(await failure(notesFsAddon.readNote(root, 'gone.md', SELECTED_CONTENT))).toEqual({
            statusCode: 404,
            message: 'File not found',
        });
    });

    it('rejects an escaping path as a 403 with the message intact', async () => {
        const denied = await failure(notesFsAddon.readNote(root, '../escape.md', SELECTED_CONTENT));
        expect(denied.statusCode).toBe(403);
        expect(denied.message).toContain('Access denied');
    });

    it('applies the default root allow-list to an absolute path', async () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-native-notes-outside-'));
        try {
            const target = path.join(outside, 'scratch.md');
            fs.writeFileSync(target, 'outside');

            expect(
                await failure(notesFsAddon.readNote(root, target, DEFAULT_CONTENT)),
            ).toEqual({
                statusCode: 403,
                message: 'Access denied: path is outside workspace data directory',
            });

            const allowed = await notesFsAddon.readNote(root, target, {
                isDefaultRoot: true,
                allowedPrefixes: [outside],
            });
            expect(allowed.content).toBe('outside');
        } finally {
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });
});

describe('entry marshalling', () => {
    it('creates each kind and echoes back the effective path', async () => {
        expect(await notesFsAddon.createNotesEntry(root, 'Book', 'notebook', SELECTED_ROOT)).toEqual({
            path: 'Book',
            kind: 'notebook',
        });
        expect(await notesFsAddon.createNotesEntry(root, 'Book/Sec', 'section', SELECTED_ROOT)).toEqual({
            path: 'Book/Sec',
            kind: 'section',
        });
        expect(await notesFsAddon.createNotesEntry(root, 'Book/Sec/p', 'page', SELECTED_ROOT)).toEqual({
            path: 'Book/Sec/p.md',
            kind: 'page',
        });
        expect(fs.existsSync(path.join(root, 'Book/Sec/p.md'))).toBe(true);
    });

    it('rejects an unknown kind synchronously as a 400', () => {
        expect(() => notesFsAddon.createNotesEntry(root, 'x', 'chapter', SELECTED_ROOT)).toThrow(
            /Invalid entry type: chapter/,
        );
    });

    it('returns the rename outcome the binding cascade needs', async () => {
        write('Book/old.md', 'body');

        const outcome = await notesFsAddon.renameNotesEntry(
            root,
            'Book/old.md',
            'Book/new',
            SELECTED_ROOT,
        );
        expect(outcome).toEqual({
            kind: 'file',
            oldRel: 'Book/old.md',
            newRel: 'Book/new.md',
            effectiveNewPath: 'Book/new.md',
        });
    });

    it('returns the delete outcome the binding cascade needs', async () => {
        write('Book/page.md', 'body');

        expect(await notesFsAddon.deleteNotesEntry(root, 'Book/page.md', SELECTED_ROOT)).toEqual({
            kind: 'file',
            rel: 'Book/page.md',
        });
        expect(await notesFsAddon.deleteNotesEntry(root, 'Book', SELECTED_ROOT)).toEqual({
            kind: 'dir',
            rel: 'Book',
        });
    });

    it('propagates a 409 collision and a 404 miss with their messages', async () => {
        write('a.md', 'a');
        write('b.md', 'b');

        const collision = await failure(
            notesFsAddon.renameNotesEntry(root, 'a.md', 'b.md', SELECTED_ROOT),
        );
        expect(collision.statusCode).toBe(409);

        const missing = await failure(
            notesFsAddon.deleteNotesEntry(root, 'nope.md', SELECTED_ROOT),
        );
        expect(missing).toEqual({ statusCode: 404, message: 'Path not found' });
    });

    it('propagates the default root system-folder refusal as a 403', async () => {
        fs.mkdirSync(path.join(root, 'Plans'));
        const denied = await failure(notesFsAddon.deleteNotesEntry(root, 'Plans', DEFAULT_ROOT));
        expect(denied).toEqual({ statusCode: 403, message: 'Cannot delete a system folder' });
    });

    it('writes an order file in the committed byte format', async () => {
        fs.mkdirSync(path.join(root, 'Book'));

        const writing = notesFsAddon.writeNotesOrder(root, 'Book', ['b.md', 'a.md'], SELECTED_ROOT);
        expect(writing).toBeInstanceOf(Promise);
        await expect(writing).resolves.toBeUndefined();

        expect(fs.readFileSync(path.join(root, 'Book/.order.json'), 'utf-8')).toBe(
            JSON.stringify({ order: ['b.md', 'a.md'] }, null, 2),
        );
    });

    it('accepts the empty parent path as the root itself', async () => {
        await notesFsAddon.writeNotesOrder(root, '', ['Book'], SELECTED_ROOT);
        expect(fs.existsSync(path.join(root, '.order.json'))).toBe(true);
    });
});

describe('safe-path resolution', () => {
    it('resolves the union arm rather than rejecting', async () => {
        const resolving = notesFsAddon.resolveSafeNotesPath(root, 'Book/page.md');
        expect(resolving).toBeInstanceOf(Promise);

        const ok = await resolving;
        expect(isNativeNotesPathError(ok)).toBe(false);
        expect(ok.relativePath).toBe('Book/page.md');
        expect(ok.absolutePath).toBe(path.join(root, 'Book', 'page.md'));
        expect(ok.error).toBeUndefined();

        const denied = await notesFsAddon.resolveSafeNotesPath(root, '../outside.md');
        expect(isNativeNotesPathError(denied)).toBe(true);
        expect(denied.statusCode).toBe(403);
        expect(denied.absolutePath).toBeUndefined();
    });

    it('honours allowRoot for the empty path', async () => {
        expect(isNativeNotesPathError(await notesFsAddon.resolveSafeNotesPath(root, ''))).toBe(true);
        const allowed = await notesFsAddon.resolveSafeNotesPath(root, '', { allowRoot: true });
        expect(isNativeNotesPathError(allowed)).toBe(false);
        expect(allowed.relativePath).toBe('');
    });
});

describe('error decoding', () => {
    it('decodes an unprefixed failure as a 500 with its message intact', () => {
        const decoded = toNotesFsError(new Error('something else broke'));
        expect(decoded.statusCode).toBe(500);
        expect(decoded.message).toBe('something else broke');
    });

    it('passes an already-decoded error through unchanged', () => {
        const first = toNotesFsError(new Error('[notes-fs:409] Destination already exists'));
        expect(first.statusCode).toBe(409);
        expect(first.message).toBe('Destination already exists');
        expect(toNotesFsError(first)).toBe(first);
    });
});

describe('write-through into the live search index', () => {
    it('makes an autosaved note findable without waiting for a watcher', async () => {
        write('existing.md', 'unrelated');
        const index = await notesAddon.buildNotesIndex(root, {});
        expect((await index.search('needle')).results).toEqual([]);

        await notesFsAddon.writeNote(root, 'fresh.md', 'a needle here', undefined, SELECTED_CONTENT);

        expect((await index.search('needle')).results).toEqual([
            { path: 'fresh.md', matches: [{ line: 1, text: 'a needle here' }] },
        ]);
    });

    it('drops a deleted note from the live index', async () => {
        write('doomed.md', 'a needle here');
        const index = await notesAddon.buildNotesIndex(root, {});
        expect((await index.search('needle')).results).toHaveLength(1);

        await notesFsAddon.deleteNotesEntry(root, 'doomed.md', SELECTED_ROOT);

        expect((await index.search('needle')).results).toEqual([]);
    });
});
