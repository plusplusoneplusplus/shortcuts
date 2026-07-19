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
import { getRepoDataPath } from '../paths';

// ============================================================================
// Types
// ============================================================================

export type CanvasEditor = 'ai' | 'user';

export type CanvasType = 'markdown' | 'code' | 'extension' | 'excalidraw' | 'exploration';

export const CANVAS_TYPES: readonly CanvasType[] = ['markdown', 'code', 'extension', 'excalidraw', 'exploration'];

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
}

export interface CanvasExtensionManifest {
    /** Human-readable description of what this extension canvas does. */
    description: string;
    capabilities: CanvasCapabilityMeta[];
}

export interface CanvasExtension {
    manifest: CanvasExtensionManifest;
    /** Self-contained HTML+JS rendered in the panel's sandboxed iframe. */
    uiHtml: string;
    /** Script assigning a top-level `capabilities` object of (state, params) => nextState functions. */
    capabilitiesJs: string;
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
const EXTENSION_CAPABILITIES_FILE = 'capabilities.js';

/** Size caps for extension documents. */
export const MAX_EXTENSION_UI_BYTES = 512 * 1024;
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
        const type: CanvasType = input.type === 'code' || input.type === 'extension' || input.type === 'excalidraw' || input.type === 'exploration'
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

    getExtension(workspaceId: string, canvasId: string): CanvasExtension | null {
        if (!isValidCanvasId(canvasId)) return null;
        const dir = path.join(this.getCanvasDir(workspaceId, canvasId), EXTENSION_DIR);
        try {
            const manifest = JSON.parse(fs.readFileSync(path.join(dir, EXTENSION_MANIFEST_FILE), 'utf-8')) as CanvasExtensionManifest;
            const uiHtml = fs.readFileSync(path.join(dir, EXTENSION_UI_FILE), 'utf-8');
            const capabilitiesJs = fs.readFileSync(path.join(dir, EXTENSION_CAPABILITIES_FILE), 'utf-8');
            return { manifest, uiHtml, capabilitiesJs };
        } catch {
            return null;
        }
    }

    /**
     * Write the extension documents for an extension canvas and bump the
     * revision so open panels reload the UI. Returns the updated record,
     * or null when the canvas does not exist or is not an extension canvas.
     */
    saveExtension(workspaceId: string, canvasId: string, extension: CanvasExtension, editor: CanvasEditor): CanvasRecord | null {
        const existing = this.getCanvas(workspaceId, canvasId);
        if (!existing || existing.type !== 'extension') return null;

        const dir = path.join(this.getCanvasDir(workspaceId, canvasId), EXTENSION_DIR);
        fs.mkdirSync(dir, { recursive: true });
        writeFileAtomic(path.join(dir, EXTENSION_MANIFEST_FILE), JSON.stringify(extension.manifest, null, 2));
        writeFileAtomic(path.join(dir, EXTENSION_UI_FILE), extension.uiHtml);
        writeFileAtomic(path.join(dir, EXTENSION_CAPABILITIES_FILE), extension.capabilitiesJs);

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
