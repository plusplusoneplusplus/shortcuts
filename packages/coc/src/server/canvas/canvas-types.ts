/**
 * The shapes every canvas persistence service speaks: descriptors, records,
 * edits, version snapshots, extension documents, and comments. Kept free of
 * `fs` so the repositories, the sandbox, and the store facade can all import
 * them without a cycle.
 */

import * as crypto from 'crypto';

export type CanvasEditor = 'ai' | 'user';

export type CanvasType = 'markdown' | 'code' | 'excalidraw' | 'kusto' | 'copilot-extension';

export const CANVAS_TYPES: readonly CanvasType[] = ['markdown', 'code', 'excalidraw', 'kusto', 'copilot-extension'];

export interface CanvasDescriptor {
    id: string;
    workspaceId: string;
    title: string;
    /** Document, query, diagram, or extension runtime identity. */
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
    /** Internal preallocated identity for recoverable publication. */
    id?: string;
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
