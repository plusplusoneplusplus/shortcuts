/**
 * Canvas Store
 *
 * File-based persistence for chat canvases — markdown artifacts the AI and
 * the user co-edit in a side panel next to a conversation.
 *
 * Each canvas lives under `~/.coc/repos/<workspaceId>/canvases/<canvasId>/`:
 *   - `canvas.json`            — descriptor (title, revision, linked process, timestamps)
 *   - `artifact.md`            — the markdown content
 *   - `versions/<rev>.json`    — per-revision snapshots (capped, newest kept)
 *   - `comments.json`          — anchored user comments (open | sent | resolved)
 *   - `files/`                 — read-only data an extension canvas may read
 *
 * Updates are revision-checked: callers pass `expectedRevision` and receive a
 * conflict result when the canvas changed underneath them. Edits can be
 * expressed as exact-match string replacements (each `oldText` must appear
 * exactly once) or as a full content replacement. Every persisted revision
 * also writes a version snapshot so the dashboard can step through history
 * and restore an older state as a new revision.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { getRepoDataPath } from '../paths';
import { getFileCategoryByName } from '../core/file-category';

// ============================================================================
// Types
// ============================================================================

export type CanvasEditor = 'ai' | 'user';

export type CanvasType = 'markdown' | 'code' | 'extension' | 'excalidraw' | 'kusto';

export const CANVAS_TYPES: readonly CanvasType[] = ['markdown', 'code', 'extension', 'excalidraw', 'kusto'];

export interface CanvasDescriptor {
    id: string;
    workspaceId: string;
    title: string;
    /** Artifact type: markdown document, single code file, or custom extension (JSON shared state). */
    type: CanvasType;
    /** Language hint for code canvases (e.g. "typescript", "python"). */
    language?: string;
    /**
     * Optional semantic role declared by the author (e.g. "plan", "goal",
     * "notes"). Set at creation; lets the system route the canvas into a
     * matching workflow (e.g. a "plan" canvas surfaces the Implement card).
     */
    purpose?: string;
    /** Monotonic revision counter, incremented on every content/title change. */
    revision: number;
    createdAt: string;
    updatedAt: string;
    /**
     * Strictly-monotonic per-store ordering counter, bumped on every
     * create/update. Breaks `updatedAt` ties in `listCanvases` so the most
     * recently touched canvas sorts first even when several writes land in the
     * same millisecond. Optional: descriptors written before this field existed
     * fall back to `updatedAt` ordering.
     */
    seq?: number;
    /** Process that created the canvas (links the canvas to a chat). */
    processId?: string;
    lastEditor: CanvasEditor;
}

export interface CanvasRecord extends CanvasDescriptor {
    content: string;
}

export interface CanvasEdit {
    /** Exact text to replace. Must appear exactly once in the artifact. */
    oldText: string;
    newText: string;
}

export interface CreateCanvasInput {
    workspaceId: string;
    title: string;
    content: string;
    type?: CanvasType;
    language?: string;
    /** Optional semantic role for the canvas (e.g. "plan", "goal", "notes"). */
    purpose?: string;
    processId?: string;
    editor?: CanvasEditor;
}

export interface UpdateCanvasInput {
    /** Full content replacement. Mutually exclusive with `edits`. */
    content?: string;
    /** Targeted exact-match replacements, applied in order. */
    edits?: CanvasEdit[];
    /** When set, the update fails with a conflict if the stored revision differs. */
    expectedRevision?: number;
    title?: string;
    editor: CanvasEditor;
}

export type CanvasUpdateResult =
    | { ok: true; canvas: CanvasRecord }
    | { ok: false; reason: 'not-found' }
    | { ok: false; reason: 'revision-conflict'; currentRevision: number }
    | { ok: false; reason: 'edit-mismatch'; error: string };

export interface CanvasVersionMeta {
    revision: number;
    title: string;
    editor: CanvasEditor;
    updatedAt: string;
}

export interface CanvasVersion extends CanvasVersionMeta {
    content: string;
}

export interface CanvasCapabilityMeta {
    name: string;
    description: string;
    /** Free-form description of the params object the capability expects. */
    paramsDescription?: string;
    /**
     * Run this capability on the ASYNC path: a terminable worker thread with a
     * 30 s budget and a `host` object (`host.complete`), instead of the default
     * `node:vm` call with a 1000 ms budget and no host.
     *
     * Absent or false is the legacy shape and the default — every capability
     * stored before this field existed keeps the sync path exactly.
     */
    async?: boolean;
}

export interface CanvasExtensionManifest {
    /** Human-readable description of what this extension canvas does. */
    description: string;
    capabilities: CanvasCapabilityMeta[];
    /**
     * Minimum `window.CanvasHost` protocol version this extension's `uiHtml`
     * requires. Absent means "whatever the host offers" — every extension written
     * before the versioned bridge. A host reads this to decide which bridge
     * features an extension may be handed, without sniffing for method existence.
     */
    hostVersion?: number;
    /**
     * Vendored libraries the compiled `ui.js` needs, already dependency-resolved
     * and in load order (see `canvas-libraries.ts`). Absent on every `uiHtml`
     * extension — the legacy path loads nothing.
     */
    libraries?: string[];
}

export interface CanvasExtension {
    manifest: CanvasExtensionManifest;
    /**
     * Self-contained HTML+JS rendered in the panel's sandboxed iframe. Empty
     * for a JSX-authored extension, which renders from `uiJs` instead.
     */
    uiHtml: string;
    /** Script assigning a top-level `capabilities` object of (state, params) => nextState functions. */
    capabilitiesJs: string;
    /**
     * Compiled UI for a JSX-authored extension: the esbuild-transformed `uiJsx`,
     * which assigns `window.CanvasExtension = { mount(rootEl, host) {} }`.
     * Absent for `uiHtml` extensions. When present it takes precedence over
     * `uiHtml`.
     */
    uiJs?: string;
    /**
     * The JSX source `uiJs` was derived from. Stored so version history shows
     * what the AI actually wrote rather than only the transform output; never
     * executed.
     */
    uiJsx?: string;
}

export type CanvasCommentStatus = 'open' | 'sent' | 'resolved';

export interface CanvasComment {
    id: string;
    /** Excerpt of the canvas text the comment is anchored to. */
    anchorText: string;
    body: string;
    status: CanvasCommentStatus;
    createdAt: string;
    updatedAt: string;
}

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

// ============================================================================
// Constants & helpers
// ============================================================================

const CANVASES_DIR_NAME = 'canvases';
const DESCRIPTOR_FILE = 'canvas.json';
const ARTIFACT_FILE = 'artifact.md';
const VERSIONS_DIR = 'versions';
const COMMENTS_FILE = 'comments.json';
const EXTENSION_DIR = 'extension';
const EXTENSION_MANIFEST_FILE = 'manifest.json';
const EXTENSION_UI_FILE = 'ui.html';
const EXTENSION_UI_JS_FILE = 'ui.js';
const EXTENSION_UI_JSX_FILE = 'ui.jsx';
const EXTENSION_CAPABILITIES_FILE = 'capabilities.js';

/** Size caps for extension documents. */
export const MAX_EXTENSION_UI_BYTES = 512 * 1024;
/**
 * Cap on the compiled `ui.js`. Mirrors `MAX_EXTENSION_UI_BYTES` — a JSX
 * transform is roughly source-sized (libraries are never inlined into the
 * stored document), so the same ceiling applies to `uiJsx` and its output.
 */
export const MAX_EXTENSION_UI_JS_BYTES = 512 * 1024;
export const MAX_EXTENSION_CAPABILITIES_BYTES = 256 * 1024;

/** Number of most recent version snapshots kept per canvas. */
export const MAX_CANVAS_VERSIONS = 50;

const MAX_COMMENT_ANCHOR_LENGTH = 500;
const MAX_COMMENT_BODY_LENGTH = 4000;
const LANGUAGE_PATTERN = /^[a-z0-9+#.-]{1,32}$/;

/** Normalize a language hint; returns undefined when missing or unusable. */
export function normalizeCanvasLanguage(raw: string | undefined): string | undefined {
    if (typeof raw !== 'string') return undefined;
    const language = raw.trim().toLowerCase();
    return LANGUAGE_PATTERN.test(language) ? language : undefined;
}

const CANVAS_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;

export function isValidCanvasId(id: string): boolean {
    return typeof id === 'string' && CANVAS_ID_PATTERN.test(id) && !id.includes('..');
}

// ---------------------------------------------------------------------------
// Canvas files — the read-only data an extension canvas is given
// ---------------------------------------------------------------------------

/** Subdirectory of a canvas's own directory holding the files it may read. */
const FILES_DIR = 'files';

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

/** Derive a filesystem-safe canvas id from a title plus a random suffix. */
export function generateCanvasId(title: string): string {
    const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    const suffix = crypto.randomBytes(3).toString('hex');
    return slug ? `${slug}-${suffix}` : `canvas-${suffix}`;
}

/**
 * The encoding a canvas file is served in, from its name alone. Text files go
 * out as UTF-8; everything else — images, archives, anything unrecognized —
 * goes out as base64, because decoding real bytes as UTF-8 corrupts them.
 */
function encodingForFile(fileName: string): CanvasFileEncoding {
    return getFileCategoryByName(fileName) === 'text' ? 'utf-8' : 'base64';
}

function writeFileAtomic(filePath: string, data: string): void {
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, data, 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

// ============================================================================
// Store
// ============================================================================

export class CanvasStore {
    /**
     * Monotonic counter assigned to each create/update as `CanvasDescriptor.seq`.
     * Breaks `updatedAt` ties in `listCanvases` so the most recently touched
     * canvas sorts first even when several writes share a millisecond timestamp.
     * Per store instance and in-memory only; cross-timestamp ordering still
     * relies on `updatedAt`, so a fresh process (counter reset to 0) keeps older
     * canvases correctly ordered by their persisted timestamps.
     */
    private seqCounter = 0;

    constructor(private readonly dataDir: string) {}

    private nextSeq(): number {
        return ++this.seqCounter;
    }

    private getWorkspaceRoot(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, CANVASES_DIR_NAME);
    }

    private getCanvasDir(workspaceId: string, canvasId: string): string {
        return path.join(this.getWorkspaceRoot(workspaceId), canvasId);
    }

    createCanvas(input: CreateCanvasInput): CanvasRecord {
        const id = generateCanvasId(input.title);
        const now = new Date().toISOString();
        const type: CanvasType = input.type === 'code' || input.type === 'extension' || input.type === 'excalidraw' || input.type === 'kusto'
            ? input.type
            : 'markdown';
        const language = type === 'code' ? normalizeCanvasLanguage(input.language) : undefined;
        const record: CanvasRecord = {
            id,
            workspaceId: input.workspaceId,
            title: input.title,
            type,
            ...(language ? { language } : {}),
            ...(input.purpose && typeof input.purpose === 'string' && input.purpose.trim()
                ? { purpose: input.purpose.trim() }
                : {}),
            revision: 1,
            createdAt: now,
            updatedAt: now,
            seq: this.nextSeq(),
            ...(input.processId ? { processId: input.processId } : {}),
            lastEditor: input.editor ?? 'ai',
            content: input.content,
        };
        this.persist(record);
        return record;
    }

    getCanvas(workspaceId: string, canvasId: string): CanvasRecord | null {
        if (!isValidCanvasId(canvasId)) return null;
        const dir = this.getCanvasDir(workspaceId, canvasId);
        const descriptorPath = path.join(dir, DESCRIPTOR_FILE);
        try {
            const descriptor = JSON.parse(fs.readFileSync(descriptorPath, 'utf-8')) as CanvasDescriptor;
            let content = '';
            try {
                content = fs.readFileSync(path.join(dir, ARTIFACT_FILE), 'utf-8');
            } catch {
                // Descriptor without artifact — treat as empty content
            }
            return { ...descriptor, content };
        } catch {
            return null;
        }
    }

    /** List canvas descriptors (no content), newest first. */
    listCanvases(workspaceId: string, filter?: { processId?: string }): CanvasDescriptor[] {
        const root = this.getWorkspaceRoot(workspaceId);
        let entries: string[];
        try {
            entries = fs.readdirSync(root);
        } catch {
            return [];
        }

        const descriptors: CanvasDescriptor[] = [];
        for (const entry of entries) {
            if (!isValidCanvasId(entry)) continue;
            try {
                const raw = fs.readFileSync(path.join(root, entry, DESCRIPTOR_FILE), 'utf-8');
                const descriptor = JSON.parse(raw) as CanvasDescriptor;
                if (filter?.processId && descriptor.processId !== filter.processId) continue;
                descriptors.push(descriptor);
            } catch {
                // Skip unreadable/corrupt entries
            }
        }

        // Newest first by wall-clock timestamp, with the monotonic seq breaking
        // ties when writes share a millisecond so the most recently touched
        // canvas is always first.
        descriptors.sort((a, b) => {
            if (a.updatedAt !== b.updatedAt) {
                return a.updatedAt < b.updatedAt ? 1 : -1;
            }
            return (b.seq ?? 0) - (a.seq ?? 0);
        });
        return descriptors;
    }

    updateCanvas(workspaceId: string, canvasId: string, input: UpdateCanvasInput): CanvasUpdateResult {
        const existing = this.getCanvas(workspaceId, canvasId);
        if (!existing) {
            return { ok: false, reason: 'not-found' };
        }

        if (input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) {
            return { ok: false, reason: 'revision-conflict', currentRevision: existing.revision };
        }

        let content = existing.content;
        if (input.edits && input.edits.length > 0) {
            for (const edit of input.edits) {
                if (typeof edit?.oldText !== 'string' || typeof edit?.newText !== 'string' || edit.oldText.length === 0) {
                    return { ok: false, reason: 'edit-mismatch', error: 'Each edit needs a non-empty oldText and a newText string' };
                }
                const first = content.indexOf(edit.oldText);
                if (first === -1) {
                    return { ok: false, reason: 'edit-mismatch', error: `oldText not found in canvas: ${preview(edit.oldText)}` };
                }
                if (content.indexOf(edit.oldText, first + 1) !== -1) {
                    return { ok: false, reason: 'edit-mismatch', error: `oldText matches more than once — include more surrounding context: ${preview(edit.oldText)}` };
                }
                content = content.slice(0, first) + edit.newText + content.slice(first + edit.oldText.length);
            }
        } else if (input.content !== undefined) {
            content = input.content;
        } else if (input.title === undefined) {
            return { ok: false, reason: 'edit-mismatch', error: 'Provide edits, content, or a title to update' };
        }

        const updated: CanvasRecord = {
            ...existing,
            title: input.title ?? existing.title,
            content,
            revision: existing.revision + 1,
            updatedAt: new Date().toISOString(),
            seq: this.nextSeq(),
            lastEditor: input.editor,
        };
        this.persist(updated);
        return { ok: true, canvas: updated };
    }

    // ------------------------------------------------------------------
    // Version snapshots
    // ------------------------------------------------------------------

    /** List version snapshot metadata (no content), newest first. */
    listVersions(workspaceId: string, canvasId: string): CanvasVersionMeta[] {
        if (!isValidCanvasId(canvasId)) return [];
        const versionsDir = path.join(this.getCanvasDir(workspaceId, canvasId), VERSIONS_DIR);
        let entries: string[];
        try {
            entries = fs.readdirSync(versionsDir);
        } catch {
            return [];
        }

        const versions: CanvasVersionMeta[] = [];
        for (const entry of entries) {
            if (!/^\d+\.json$/.test(entry)) continue;
            try {
                const raw = JSON.parse(fs.readFileSync(path.join(versionsDir, entry), 'utf-8')) as CanvasVersion;
                versions.push({
                    revision: raw.revision,
                    title: raw.title,
                    editor: raw.editor,
                    updatedAt: raw.updatedAt,
                });
            } catch {
                // Skip unreadable snapshots
            }
        }

        versions.sort((a, b) => b.revision - a.revision);
        return versions;
    }

    /** Read one full version snapshot, or null when it does not exist. */
    getVersion(workspaceId: string, canvasId: string, revision: number): CanvasVersion | null {
        if (!isValidCanvasId(canvasId) || !Number.isInteger(revision) || revision < 1) return null;
        const versionPath = path.join(this.getCanvasDir(workspaceId, canvasId), VERSIONS_DIR, `${revision}.json`);
        try {
            return JSON.parse(fs.readFileSync(versionPath, 'utf-8')) as CanvasVersion;
        } catch {
            return null;
        }
    }

    // ------------------------------------------------------------------
    // Extension documents (type 'extension' canvases)
    // ------------------------------------------------------------------

    /**
     * Read the extension documents, or null when the canvas has none.
     *
     * `manifest.json` and `capabilities.js` are required — an extension without
     * them is unusable. The UI documents are OPTIONAL reads because there are
     * two authoring paths: a legacy/HTML extension has `ui.html` and no `ui.js`,
     * a JSX extension has `ui.js` (+ its `ui.jsx` source) and no `ui.html`. One
     * of the two must exist; a directory with neither is as broken as a missing
     * manifest and still returns null, exactly as before.
     */
    getExtension(workspaceId: string, canvasId: string): CanvasExtension | null {
        if (!isValidCanvasId(canvasId)) return null;
        const dir = path.join(this.getCanvasDir(workspaceId, canvasId), EXTENSION_DIR);
        const readOptional = (file: string): string | undefined => {
            try {
                return fs.readFileSync(path.join(dir, file), 'utf-8');
            } catch {
                return undefined;
            }
        };
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, EXTENSION_MANIFEST_FILE), 'utf-8')) as CanvasExtensionManifest;
            const capabilitiesJs = fs.readFileSync(path.join(dir, EXTENSION_CAPABILITIES_FILE), 'utf-8');
            const uiHtml = readOptional(EXTENSION_UI_FILE);
            const uiJs = readOptional(EXTENSION_UI_JS_FILE);
            const uiJsx = readOptional(EXTENSION_UI_JSX_FILE);
            if (uiHtml === undefined && uiJs === undefined) return null;
            return {
                manifest,
                uiHtml: uiHtml ?? '',
                capabilitiesJs,
                ...(uiJs !== undefined ? { uiJs } : {}),
                ...(uiJsx !== undefined ? { uiJsx } : {}),
            };
        } catch {
            return null;
        }
    }

    /**
     * Write the extension documents for an extension canvas and bump the
     * revision so open panels reload the UI. Returns the updated record,
     * or null when the canvas does not exist or is not an extension canvas.
     *
     * The UI documents written are exactly the ones present on `extension`, and
     * the others are REMOVED. Rebuilding a JSX canvas as an `uiHtml` one would
     * otherwise leave a stale `ui.js` behind — and `ui.js` wins over `ui.html`,
     * so the old UI would keep rendering.
     */
    saveExtension(workspaceId: string, canvasId: string, extension: CanvasExtension, editor: CanvasEditor): CanvasRecord | null {
        const existing = this.getCanvas(workspaceId, canvasId);
        if (!existing || existing.type !== 'extension') return null;

        const dir = path.join(this.getCanvasDir(workspaceId, canvasId), EXTENSION_DIR);
        fs.mkdirSync(dir, { recursive: true });
        writeFileAtomic(path.join(dir, EXTENSION_MANIFEST_FILE), JSON.stringify(extension.manifest, null, 2));
        writeFileAtomic(path.join(dir, EXTENSION_CAPABILITIES_FILE), extension.capabilitiesJs);

        const uiDocuments: [string, string | undefined][] = [
            // A JSX extension carries uiHtml: '' — treat empty as absent so it
            // does not shadow ui.js with a blank document.
            [EXTENSION_UI_FILE, extension.uiHtml || undefined],
            [EXTENSION_UI_JS_FILE, extension.uiJs],
            [EXTENSION_UI_JSX_FILE, extension.uiJsx],
        ];
        for (const [file, contents] of uiDocuments) {
            const filePath = path.join(dir, file);
            if (contents !== undefined) {
                writeFileAtomic(filePath, contents);
            } else {
                try {
                    fs.unlinkSync(filePath);
                } catch { /* absent already */ }
            }
        }

        const updated: CanvasRecord = {
            ...existing,
            revision: existing.revision + 1,
            updatedAt: new Date().toISOString(),
            seq: this.nextSeq(),
            lastEditor: editor,
        };
        this.persist(updated);
        return updated;
    }

    // ------------------------------------------------------------------
    // Canvas files (read-only data given to an extension canvas)
    // ------------------------------------------------------------------

    /**
     * Absolute path of the directory holding the files this canvas may read:
     * `<dataDir>/repos/<workspaceId>/canvases/<canvasId>/files`. Inside the
     * directory the canvas already owns, so it inherits `isValidCanvasId`
     * containment and `getRepoDataPath` — there is no second root to keep in
     * step with the first.
     */
    getCanvasFilesRoot(workspaceId: string, canvasId: string): string {
        return path.join(this.getCanvasDir(workspaceId, canvasId), FILES_DIR);
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
    private resolveCanvasFilePath(
        workspaceId: string,
        canvasId: string,
        relativePath: unknown,
    ): { ok: true; absolutePath: string } | { ok: false; reason: 'invalid-path' | 'not-found' } {
        if (!isValidCanvasId(canvasId)) return { ok: false, reason: 'invalid-path' };
        if (!isSafeCanvasFilePath(relativePath)) return { ok: false, reason: 'invalid-path' };

        const root = this.getCanvasFilesRoot(workspaceId, canvasId);
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
     * List the canvas's files, newest-agnostic and sorted by path. Symlinks are
     * skipped outright rather than resolved: a listing that followed them could
     * advertise a path whose target lives outside the root, and `readFile`
     * would then (correctly) refuse the very entry the listing offered.
     *
     * Bounded by `MAX_CANVAS_FILE_ENTRIES` and `MAX_CANVAS_FILE_DEPTH` so a
     * pathological tree cannot stall a request.
     */
    listCanvasFiles(workspaceId: string, canvasId: string): CanvasFileEntry[] {
        if (!isValidCanvasId(canvasId)) return [];
        const root = this.getCanvasFilesRoot(workspaceId, canvasId);
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
    readCanvasFile(
        workspaceId: string,
        canvasId: string,
        relativePath: unknown,
        options?: { encoding?: CanvasFileEncoding },
    ): CanvasFileReadResult {
        const resolved = this.resolveCanvasFilePath(workspaceId, canvasId, relativePath);
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
    writeCanvasFile(
        workspaceId: string,
        canvasId: string,
        relativePath: unknown,
        content: string,
        encoding: CanvasFileEncoding = 'utf-8',
    ): CanvasFileWriteResult {
        if (!isValidCanvasId(canvasId)) return { ok: false, reason: 'invalid-path' };
        if (!isSafeCanvasFilePath(relativePath)) return { ok: false, reason: 'invalid-path' };
        if (!this.getCanvas(workspaceId, canvasId)) return { ok: false, reason: 'not-found' };

        const root = this.getCanvasFilesRoot(workspaceId, canvasId);
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

    // ------------------------------------------------------------------
    // Comments
    // ------------------------------------------------------------------

    listComments(workspaceId: string, canvasId: string, filter?: { status?: CanvasCommentStatus }): CanvasComment[] {
        const comments = this.readComments(workspaceId, canvasId);
        return filter?.status ? comments.filter(c => c.status === filter.status) : comments;
    }

    addComment(workspaceId: string, canvasId: string, input: { anchorText: string; body: string }): CanvasComment | null {
        if (!this.getCanvas(workspaceId, canvasId)) return null;
        const now = new Date().toISOString();
        const comment: CanvasComment = {
            id: crypto.randomBytes(6).toString('hex'),
            anchorText: input.anchorText.slice(0, MAX_COMMENT_ANCHOR_LENGTH),
            body: input.body.slice(0, MAX_COMMENT_BODY_LENGTH),
            status: 'open',
            createdAt: now,
            updatedAt: now,
        };
        const comments = this.readComments(workspaceId, canvasId);
        comments.push(comment);
        this.writeComments(workspaceId, canvasId, comments);
        return comment;
    }

    setCommentStatus(workspaceId: string, canvasId: string, commentId: string, status: CanvasCommentStatus): CanvasComment | null {
        const comments = this.readComments(workspaceId, canvasId);
        const comment = comments.find(c => c.id === commentId);
        if (!comment) return null;
        comment.status = status;
        comment.updatedAt = new Date().toISOString();
        this.writeComments(workspaceId, canvasId, comments);
        return comment;
    }

    deleteComment(workspaceId: string, canvasId: string, commentId: string): boolean {
        const comments = this.readComments(workspaceId, canvasId);
        const remaining = comments.filter(c => c.id !== commentId);
        if (remaining.length === comments.length) return false;
        this.writeComments(workspaceId, canvasId, remaining);
        return true;
    }

    private readComments(workspaceId: string, canvasId: string): CanvasComment[] {
        if (!isValidCanvasId(canvasId)) return [];
        const commentsPath = path.join(this.getCanvasDir(workspaceId, canvasId), COMMENTS_FILE);
        try {
            const parsed = JSON.parse(fs.readFileSync(commentsPath, 'utf-8'));
            return Array.isArray(parsed) ? parsed as CanvasComment[] : [];
        } catch {
            return [];
        }
    }

    private writeComments(workspaceId: string, canvasId: string, comments: CanvasComment[]): void {
        const dir = this.getCanvasDir(workspaceId, canvasId);
        fs.mkdirSync(dir, { recursive: true });
        writeFileAtomic(path.join(dir, COMMENTS_FILE), JSON.stringify(comments, null, 2));
    }

    // ------------------------------------------------------------------
    // Persistence
    // ------------------------------------------------------------------

    private persist(record: CanvasRecord): void {
        const dir = this.getCanvasDir(record.workspaceId, record.id);
        fs.mkdirSync(dir, { recursive: true });
        const { content, ...descriptor } = record;
        writeFileAtomic(path.join(dir, DESCRIPTOR_FILE), JSON.stringify(descriptor, null, 2));
        writeFileAtomic(path.join(dir, ARTIFACT_FILE), content);
        this.snapshotVersion(dir, record);
    }

    private snapshotVersion(canvasDir: string, record: CanvasRecord): void {
        const versionsDir = path.join(canvasDir, VERSIONS_DIR);
        fs.mkdirSync(versionsDir, { recursive: true });
        const snapshot: CanvasVersion = {
            revision: record.revision,
            title: record.title,
            editor: record.lastEditor,
            updatedAt: record.updatedAt,
            content: record.content,
        };
        writeFileAtomic(path.join(versionsDir, `${record.revision}.json`), JSON.stringify(snapshot, null, 2));

        // Prune snapshots beyond the retention cap (best-effort)
        const cutoff = record.revision - MAX_CANVAS_VERSIONS;
        if (cutoff < 1) return;
        let entries: string[];
        try {
            entries = fs.readdirSync(versionsDir);
        } catch {
            return;
        }
        for (const entry of entries) {
            const match = /^(\d+)\.json$/.exec(entry);
            if (!match) continue;
            if (Number(match[1]) <= cutoff) {
                try {
                    fs.unlinkSync(path.join(versionsDir, entry));
                } catch { /* best-effort */ }
            }
        }
    }
}

function preview(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > 60 ? `"${flat.slice(0, 60)}…"` : `"${flat}"`;
}
