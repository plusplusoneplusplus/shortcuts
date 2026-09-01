/**
 * The read-only data an extension canvas may look at, under the canvas's own
 * `files/` directory. This is the security-sensitive half of canvas storage —
 * path shape rules, traversal defense, symlink containment, listing bounds,
 * encoding choice, and size caps — and it is kept apart from revision
 * persistence so a change to how artifacts are stored cannot quietly loosen
 * where an extension is allowed to read.
 *
 * Nothing here knows about revisions, snapshots, or comments. The only thing
 * it borrows from the rest of the store is "does this canvas exist", handed in
 * as a predicate.
 */

import * as fs from 'fs';
import * as path from 'path';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { CanvasLayout } from './canvas-layout';
import { getFileCategoryByName } from '../core/file-category';
import { isValidCanvasId } from './canvas-types';

/** How a canvas file's bytes are handed to a caller. */
export type CanvasFileEncoding = 'utf-8' | 'base64';

/** One entry in a canvas's files listing (metadata only, no content). */
export interface CanvasFileEntry {
    /** Path relative to the canvas files root, always `/`-separated. */
    path: string;
    /** Size in bytes on disk (NOT the length of the encoded content). */
    size: number;
    /** The encoding `readFile` would return this file in. */
    encoding: CanvasFileEncoding;
}

/** One canvas file, read. */
export interface CanvasFile extends CanvasFileEntry {
    /** UTF-8 text, or standard base64 when `encoding` is `base64`. */
    content: string;
}

export type CanvasFileReadResult =
    | { ok: true; file: CanvasFile }
    | { ok: false; reason: 'invalid-path' }
    | { ok: false; reason: 'not-found' }
    | { ok: false; reason: 'too-large'; size: number; limit: number };

export type CanvasFileWriteResult =
    | { ok: true; file: CanvasFileEntry }
    | { ok: false; reason: 'invalid-path' }
    | { ok: false; reason: 'not-found' }
    | { ok: false; reason: 'too-large'; size: number; limit: number };

/** Size cap for a file served as UTF-8 text. */
export const MAX_CANVAS_TEXT_FILE_BYTES = 1024 * 1024;
/**
 * Size cap for a file served as base64. Mirrors the notes attachment ceiling
 * (`MAX_IMAGE_SIZE_BYTES`) — the same "one asset a browser will hold in memory"
 * bound. Note the encoded payload is ~4/3 of this.
 */
export const MAX_CANVAS_BINARY_FILE_BYTES = 10 * 1024 * 1024;

/** Upper bound on entries returned by a listing, so a huge tree cannot stall a request. */
export const MAX_CANVAS_FILE_ENTRIES = 2000;

/** Directory depth a listing walks before giving up on a branch. */
const MAX_CANVAS_FILE_DEPTH = 12;

/**
 * Percent-encoded forms that must never survive into a decoded path: `.` (as in
 * `..`), the two separators, NUL, and `%` itself — the marker of a
 * double-encoded payload. A caller checks its STILL-ENCODED input with this
 * before decoding, so `%2e%2e` is refused before it becomes `..` and
 * `%252e%252e` is refused before it becomes `%2e%2e`.
 *
 * Kept narrower than "any percent-escape" because a URL legitimately encodes
 * spaces and other ordinary filename characters as `%20` and friends.
 */
const ENCODED_PATH_ESCAPES = /%(?:2e|2f|5c|00|25)/i;

/**
 * True when a still-percent-encoded path contains an escape that would decode
 * into a traversal character. Layer 0, for callers holding the raw form (the
 * REST route matches on the raw pathname); {@link isSafeCanvasFilePath} then
 * checks the decoded form.
 */
export function hasEncodedPathEscape(rawPath: string): boolean {
    return ENCODED_PATH_ESCAPES.test(rawPath);
}

/**
 * Any percent-escape at all, applied to a path that has ALREADY been decoded.
 * A real filename can contain a bare `%` (`50% off.csv`), but a `%` followed by
 * two hex digits in a decoded path means the input was encoded twice, and the
 * only reason to do that is to survive one decode.
 */
const RESIDUAL_PERCENT_ESCAPE = /%[0-9a-fA-F]{2}/;

/**
 * Reject a canvas-relative file path by SHAPE, before it touches the
 * filesystem. This is layer 1 of 4 (shape → resolve → containment → realpath);
 * on its own it proves nothing about where the path lands, only that it is not
 * obviously trying to leave.
 *
 * Rejected: `..` in any position, an absolute path (leading separator or a
 * Windows drive letter), a UNC path, backslashes (a separator on Windows and a
 * legal filename character on POSIX — never worth the ambiguity), NUL and other
 * control characters, and any residual percent-escape (see
 * {@link RESIDUAL_PERCENT_ESCAPE}).
 *
 * Takes the DECODED path. A caller holding the raw URL form runs
 * {@link hasEncodedPathEscape} on it first.
 */
export function isSafeCanvasFilePath(relativePath: unknown): relativePath is string {
    if (typeof relativePath !== 'string') return false;
    if (relativePath.length === 0 || relativePath.length > 1024) return false;
    // NUL and every other C0 control character (a NUL truncates the path in
    // some syscall layers, so anything after it would be invisible here).
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(relativePath)) return false;
    if (relativePath.includes('\\')) return false;
    if (RESIDUAL_PERCENT_ESCAPE.test(relativePath)) return false;
    if (relativePath.startsWith('/')) return false;
    if (/^[a-zA-Z]:/.test(relativePath)) return false;
    // `..` anywhere — as a whole segment, and also inside a name, which no
    // legitimate data file needs and which keeps this check unarguable.
    if (relativePath.includes('..')) return false;
    // A `.` or empty segment (`a//b`, `a/./b`) normalizes away rather than
    // resolving to a real name; reject instead of silently accepting an alias.
    if (relativePath.split('/').some(segment => segment === '' || segment === '.')) return false;
    return true;
}

/**
 * The encoding a canvas file is served in, from its name alone. Text files go
 * out as UTF-8; everything else — images, archives, anything unrecognized —
 * goes out as base64, because decoding real bytes as UTF-8 corrupts them.
 */
export function encodingForFile(fileName: string): CanvasFileEncoding {
    return getFileCategoryByName(fileName) === 'text' ? 'utf-8' : 'base64';
}

export class CanvasFileSandbox {
    /**
     * @param layout       Where the canvas's files root lives.
     * @param canvasExists Whether the canvas is real, for the write path (a
     *                     write to a canvas that does not exist must not create
     *                     a directory tree for it).
     */
    constructor(
        private readonly layout: CanvasLayout,
        private readonly canvasExists: (workspaceId: string, canvasId: string) => boolean,
    ) {}

    /**
     * Absolute path of the directory holding the files this canvas may read:
     * `<dataDir>/repos/<workspaceId>/canvases/<canvasId>/files`. Inside the
     * directory the canvas already owns, so it inherits `isValidCanvasId`
     * containment and `getRepoDataPath` — there is no second root to keep in
     * step with the first.
     */
    filesRoot(workspaceId: string, canvasId: string): string {
        return this.layout.filesRoot(workspaceId, canvasId);
    }

    /**
     * Resolve a canvas-relative path to a real absolute path inside the files
     * root, or refuse. Four layers, in order, because each catches what the one
     * before it cannot:
     *
     *   1. shape — `..`, absolute paths, backslashes, NUL, encoded forms
     *   2. `path.resolve` against the root
     *   3. `isWithinDirectory` — containment of the resolved path
     *   4. `realpathSync` on BOTH sides, then containment again
     *
     * Layer 4 is the one that matters most: layers 1–3 all pass for a symlink
     * that sits legitimately inside the files directory and points at
     * `/etc/shadow`. The root is realpath'd too, since the data directory
     * itself is often reached through a symlink (`/var` → `/private/var` on
     * macOS), and comparing a resolved target against an unresolved root would
     * reject every read there.
     */
    resolve(
        workspaceId: string,
        canvasId: string,
        relativePath: unknown,
    ): { ok: true; absolutePath: string } | { ok: false; reason: 'invalid-path' | 'not-found' } {
        if (!isValidCanvasId(canvasId)) return { ok: false, reason: 'invalid-path' };
        if (!isSafeCanvasFilePath(relativePath)) return { ok: false, reason: 'invalid-path' };

        const root = this.filesRoot(workspaceId, canvasId);
        const resolved = path.resolve(root, relativePath);
        if (!isWithinDirectory(resolved, root)) return { ok: false, reason: 'invalid-path' };

        let realRoot: string;
        try {
            realRoot = fs.realpathSync(root);
        } catch {
            // No files directory at all — nothing to find, and nothing leaked.
            return { ok: false, reason: 'not-found' };
        }
        let realTarget: string;
        try {
            realTarget = fs.realpathSync(resolved);
        } catch {
            return { ok: false, reason: 'not-found' };
        }
        if (!isWithinDirectory(realTarget, realRoot)) return { ok: false, reason: 'invalid-path' };
        return { ok: true, absolutePath: realTarget };
    }

    /**
     * List the canvas's files, sorted by path. Symlinks are skipped outright
     * rather than resolved: a listing that followed them could advertise a path
     * whose target lives outside the root, and `read` would then (correctly)
     * refuse the very entry the listing offered.
     *
     * Bounded by `MAX_CANVAS_FILE_ENTRIES` and `MAX_CANVAS_FILE_DEPTH` so a
     * pathological tree cannot stall a request.
     */
    list(workspaceId: string, canvasId: string): CanvasFileEntry[] {
        if (!isValidCanvasId(canvasId)) return [];
        const root = this.filesRoot(workspaceId, canvasId);
        const entries: CanvasFileEntry[] = [];

        const walk = (dir: string, prefix: string, depth: number): void => {
            if (depth > MAX_CANVAS_FILE_DEPTH || entries.length >= MAX_CANVAS_FILE_ENTRIES) return;
            let dirents: fs.Dirent[];
            try {
                dirents = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const dirent of dirents) {
                if (entries.length >= MAX_CANVAS_FILE_ENTRIES) return;
                if (dirent.isSymbolicLink()) continue;
                const relativePath = prefix ? `${prefix}/${dirent.name}` : dirent.name;
                if (dirent.isDirectory()) {
                    walk(path.join(dir, dirent.name), relativePath, depth + 1);
                    continue;
                }
                if (!dirent.isFile()) continue;
                // A name the read side would refuse is not worth advertising.
                if (!isSafeCanvasFilePath(relativePath)) continue;
                try {
                    const stats = fs.statSync(path.join(dir, dirent.name));
                    entries.push({
                        path: relativePath,
                        size: stats.size,
                        encoding: encodingForFile(dirent.name),
                    });
                } catch {
                    // Vanished between readdir and stat — skip it
                }
            }
        };

        walk(root, '', 0);
        entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        return entries;
    }

    /**
     * Read one canvas file. The encoding is decided by the file's own name
     * (text vs bytes), and only `base64` may be forced by a caller — forcing
     * `utf-8` onto real bytes would hand back silently corrupted content.
     *
     * The size cap always follows the file's OWN classification, not the
     * requested encoding, so asking for base64 cannot raise the ceiling on a
     * 5 MB CSV.
     */
    read(
        workspaceId: string,
        canvasId: string,
        relativePath: unknown,
        options?: { encoding?: CanvasFileEncoding },
    ): CanvasFileReadResult {
        const resolved = this.resolve(workspaceId, canvasId, relativePath);
        if (!resolved.ok) return resolved;

        let stats: fs.Stats;
        try {
            stats = fs.statSync(resolved.absolutePath);
        } catch {
            return { ok: false, reason: 'not-found' };
        }
        if (!stats.isFile()) return { ok: false, reason: 'not-found' };

        const naturalEncoding = encodingForFile(path.basename(resolved.absolutePath));
        const limit = naturalEncoding === 'utf-8' ? MAX_CANVAS_TEXT_FILE_BYTES : MAX_CANVAS_BINARY_FILE_BYTES;
        if (stats.size > limit) {
            return { ok: false, reason: 'too-large', size: stats.size, limit };
        }
        const encoding: CanvasFileEncoding = options?.encoding === 'base64' ? 'base64' : naturalEncoding;

        let buffer: Buffer;
        try {
            buffer = fs.readFileSync(resolved.absolutePath);
        } catch {
            return { ok: false, reason: 'not-found' };
        }
        return {
            ok: true,
            file: {
                // The path as the caller asked for it, so a client can key on
                // what it requested rather than on a resolved absolute path.
                path: relativePath as string,
                size: buffer.length,
                encoding,
                content: buffer.toString(encoding === 'base64' ? 'base64' : 'utf-8'),
            },
        };
    }

    /**
     * Write a file into the canvas's files directory. SERVER-SIDE ONLY: this is
     * how the AI hands an artifact its data (`extension_canvas`), and it is
     * deliberately not reachable from the REST surface or the iframe bridge —
     * the canvas state is the write channel there, and it is revision-checked
     * and version-snapshotted in a way a file write is not.
     */
    write(
        workspaceId: string,
        canvasId: string,
        relativePath: unknown,
        content: string,
        encoding: CanvasFileEncoding = 'utf-8',
    ): CanvasFileWriteResult {
        if (!isValidCanvasId(canvasId)) return { ok: false, reason: 'invalid-path' };
        if (!isSafeCanvasFilePath(relativePath)) return { ok: false, reason: 'invalid-path' };
        if (!this.canvasExists(workspaceId, canvasId)) return { ok: false, reason: 'not-found' };

        const root = this.filesRoot(workspaceId, canvasId);
        const resolved = path.resolve(root, relativePath);
        if (!isWithinDirectory(resolved, root)) return { ok: false, reason: 'invalid-path' };

        const buffer = Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf-8');
        const limit = encodingForFile(path.basename(resolved)) === 'utf-8'
            ? MAX_CANVAS_TEXT_FILE_BYTES
            : MAX_CANVAS_BINARY_FILE_BYTES;
        if (buffer.length > limit) {
            return { ok: false, reason: 'too-large', size: buffer.length, limit };
        }

        // The target does not exist yet, so it cannot be realpath'd — its parent
        // can, and a symlinked subdirectory is the way a write would otherwise
        // land outside the root.
        const parent = path.dirname(resolved);
        fs.mkdirSync(parent, { recursive: true });
        try {
            if (!isWithinDirectory(fs.realpathSync(parent), fs.realpathSync(root))) {
                return { ok: false, reason: 'invalid-path' };
            }
        } catch {
            return { ok: false, reason: 'invalid-path' };
        }

        fs.writeFileSync(resolved, buffer);
        return {
            ok: true,
            file: {
                path: relativePath as string,
                size: buffer.length,
                encoding: encodingForFile(path.basename(resolved)),
            },
        };
    }
}
