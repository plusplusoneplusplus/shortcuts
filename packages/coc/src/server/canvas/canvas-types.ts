/**
 * The shapes every canvas persistence service speaks: descriptors, records,
 * edits, version snapshots, extension documents, and comments. Kept free of
 * `fs` so the repositories, the sandbox, and the store facade can all import
 * them without a cycle.
 */

import * as crypto from 'crypto';

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

export const MAX_COMMENT_ANCHOR_LENGTH = 500;
export const MAX_COMMENT_BODY_LENGTH = 4000;

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
