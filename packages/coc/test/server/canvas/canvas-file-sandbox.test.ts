/**
 * Canvas file sandbox — the path-safety contract on its own, without a store.
 *
 * These are the rules that keep an extension canvas reading only its own
 * `files/` directory: shape rejection, containment after resolution, symlink
 * escapes, listing bounds, encoding choice, and size caps.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    CanvasFileSandbox,
    isSafeCanvasFilePath,
    hasEncodedPathEscape,
    encodingForFile,
    MAX_CANVAS_TEXT_FILE_BYTES,
    MAX_CANVAS_FILE_ENTRIES,
} from '../../../src/server/canvas/canvas-file-sandbox';
import { CanvasLayout } from '../../../src/server/canvas/canvas-layout';

const WS = 'test-workspace';
const CANVAS = 'data-canvas-abc123';

describe('isSafeCanvasFilePath', () => {
    it('accepts ordinary relative names', () => {
        expect(isSafeCanvasFilePath('data.csv')).toBe(true);
        expect(isSafeCanvasFilePath('raw/jan/rows.json')).toBe(true);
        expect(isSafeCanvasFilePath('50% off.csv')).toBe(true);
    });

    it('rejects traversal, absolute, UNC and control-character paths', () => {
        for (const bad of [
            '../secret',
            'a/../../b',
            'weird..name',
            '/etc/passwd',
            'C:\\Windows\\win.ini',
            '\\\\server\\share',
            'a\\b',
            'a\u0000b',
            'a//b',
            'a/./b',
            '',
            'x'.repeat(1025),
        ]) {
            expect(isSafeCanvasFilePath(bad), bad).toBe(false);
        }
    });

    it('rejects a path that was percent-encoded twice to survive one decode', () => {
        expect(isSafeCanvasFilePath('%2e%2e/secret')).toBe(false);
        expect(hasEncodedPathEscape('%2e%2e/secret')).toBe(true);
        expect(hasEncodedPathEscape('%252e%252e/secret')).toBe(true);
        expect(hasEncodedPathEscape('my%20file.csv')).toBe(false);
    });

    it('rejects non-strings', () => {
        expect(isSafeCanvasFilePath(undefined)).toBe(false);
        expect(isSafeCanvasFilePath(42)).toBe(false);
        expect(isSafeCanvasFilePath({ path: 'a.csv' })).toBe(false);
    });
});

describe('encodingForFile', () => {
    it('serves text as utf-8 and everything else as base64', () => {
        expect(encodingForFile('rows.csv')).toBe('utf-8');
        expect(encodingForFile('notes.md')).toBe('utf-8');
        expect(encodingForFile('chart.png')).toBe('base64');
        expect(encodingForFile('archive.zip')).toBe('base64');
    });
});

describe('CanvasFileSandbox', () => {
    let dataDir: string;
    let sandbox: CanvasFileSandbox;
    let layout: CanvasLayout;
    let existingCanvases: Set<string>;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-sandbox-'));
        layout = new CanvasLayout(dataDir);
        existingCanvases = new Set([CANVAS]);
        sandbox = new CanvasFileSandbox(layout, (_ws, id) => existingCanvases.has(id));
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const seed = (relativePath: string, contents: string | Buffer): string => {
        const target = path.join(sandbox.filesRoot(WS, CANVAS), relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, contents);
        return target;
    };

    it('reads a text file as utf-8 and a binary file as base64', () => {
        seed('rows.csv', 'a,b\n1,2\n');
        seed('chart.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));

        const text = sandbox.read(WS, CANVAS, 'rows.csv');
        expect(text.ok && text.file.encoding).toBe('utf-8');
        expect(text.ok && text.file.content).toBe('a,b\n1,2\n');

        const binary = sandbox.read(WS, CANVAS, 'chart.png');
        expect(binary.ok && binary.file.encoding).toBe('base64');
        expect(binary.ok && Buffer.from(binary.file.content, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    });

    it('refuses a path that escapes the files root', () => {
        expect(sandbox.read(WS, CANVAS, '../canvas.json')).toEqual({ ok: false, reason: 'invalid-path' });
        expect(sandbox.read(WS, CANVAS, '%2e%2e/canvas.json')).toEqual({ ok: false, reason: 'invalid-path' });
        expect(sandbox.read(WS, 'bad id!', 'rows.csv')).toEqual({ ok: false, reason: 'invalid-path' });
    });

    it('refuses a symlink that points outside the files root', () => {
        seed('keep.txt', 'inside');
        const outside = path.join(dataDir, 'outside-secret.txt');
        fs.writeFileSync(outside, 'secret');
        const link = path.join(sandbox.filesRoot(WS, CANVAS), 'escape.txt');
        try {
            fs.symlinkSync(outside, link);
        } catch {
            return; // Symlinks unavailable (unprivileged Windows) — nothing to assert.
        }

        expect(sandbox.read(WS, CANVAS, 'escape.txt')).toEqual({ ok: false, reason: 'invalid-path' });
        // And a listing never advertises what the read side would refuse.
        expect(sandbox.list(WS, CANVAS).map(e => e.path)).toEqual(['keep.txt']);
    });

    it('reports not-found for a missing file and a missing files root', () => {
        expect(sandbox.read(WS, CANVAS, 'nope.csv')).toEqual({ ok: false, reason: 'not-found' });
        expect(sandbox.read(WS, 'other-canvas-abc123', 'nope.csv')).toEqual({ ok: false, reason: 'not-found' });
    });

    it('refuses a text file over the size cap, and reports the cap', () => {
        seed('huge.csv', 'x'.repeat(MAX_CANVAS_TEXT_FILE_BYTES + 1));
        expect(sandbox.read(WS, CANVAS, 'huge.csv')).toEqual({
            ok: false,
            reason: 'too-large',
            size: MAX_CANVAS_TEXT_FILE_BYTES + 1,
            limit: MAX_CANVAS_TEXT_FILE_BYTES,
        });
    });

    it('keeps the text cap when base64 is requested for a text file', () => {
        seed('huge.csv', 'x'.repeat(MAX_CANVAS_TEXT_FILE_BYTES + 1));
        const result = sandbox.read(WS, CANVAS, 'huge.csv', { encoding: 'base64' });
        expect(result.ok).toBe(false);
        expect(result.ok === false && result.reason).toBe('too-large');
    });

    it('lists nested files sorted by path and caps the number of entries', () => {
        seed('b.csv', '1');
        seed('a/inner.csv', '2');
        expect(sandbox.list(WS, CANVAS).map(e => e.path)).toEqual(['a/inner.csv', 'b.csv']);

        for (let i = 0; i < 30; i++) seed(`bulk/f${i}.csv`, 'x');
        expect(sandbox.list(WS, CANVAS).length).toBeLessThanOrEqual(MAX_CANVAS_FILE_ENTRIES);
    });

    it('returns an empty listing for a canvas with no files directory', () => {
        expect(sandbox.list(WS, 'other-canvas-abc123')).toEqual([]);
        expect(sandbox.list(WS, 'bad id!')).toEqual([]);
    });

    it('writes a file into the sandbox and refuses a write to a canvas that does not exist', () => {
        const written = sandbox.write(WS, CANVAS, 'out/rows.csv', 'a,b\n');
        expect(written).toEqual({ ok: true, file: { path: 'out/rows.csv', size: 4, encoding: 'utf-8' } });
        expect(sandbox.read(WS, CANVAS, 'out/rows.csv')).toMatchObject({ ok: true });

        expect(sandbox.write(WS, 'ghost-canvas-abc123', 'rows.csv', 'x')).toEqual({ ok: false, reason: 'not-found' });
        expect(sandbox.write(WS, CANVAS, '../escape.csv', 'x')).toEqual({ ok: false, reason: 'invalid-path' });
    });

    it('refuses a write over the size cap', () => {
        const oversized = 'x'.repeat(MAX_CANVAS_TEXT_FILE_BYTES + 1);
        expect(sandbox.write(WS, CANVAS, 'huge.csv', oversized)).toEqual({
            ok: false,
            reason: 'too-large',
            size: MAX_CANVAS_TEXT_FILE_BYTES + 1,
            limit: MAX_CANVAS_TEXT_FILE_BYTES,
        });
        expect(fs.existsSync(path.join(sandbox.filesRoot(WS, CANVAS), 'huge.csv'))).toBe(false);
    });

    it('refuses a write through a symlinked subdirectory', () => {
        const escapeTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-escape-'));
        const root = sandbox.filesRoot(WS, CANVAS);
        fs.mkdirSync(root, { recursive: true });
        try {
            fs.symlinkSync(escapeTarget, path.join(root, 'link'), 'dir');
        } catch {
            fs.rmSync(escapeTarget, { recursive: true, force: true });
            return; // Symlinks unavailable — nothing to assert.
        }

        expect(sandbox.write(WS, CANVAS, 'link/pwned.txt', 'x')).toEqual({ ok: false, reason: 'invalid-path' });
        expect(fs.existsSync(path.join(escapeTarget, 'pwned.txt'))).toBe(false);
        fs.rmSync(escapeTarget, { recursive: true, force: true });
    });
});
