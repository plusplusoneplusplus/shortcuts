/**
 * Canvas Store
 *
 * File-based persistence for chat canvases — markdown artifacts the AI and
 * the user co-edit in a side panel next to a conversation.
 *
 * Each canvas lives under `~/.coc/repos/<workspaceId>/canvases/<canvasId>/`:
 *   - `canvas.json`  — descriptor (title, revision, linked process, timestamps)
 *   - `artifact.md`  — the markdown content
 *
 * Updates are revision-checked: callers pass `expectedRevision` and receive a
 * conflict result when the canvas changed underneath them. Edits can be
 * expressed as exact-match string replacements (each `oldText` must appear
 * exactly once) or as a full content replacement.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
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

export interface CanvasDescriptor {
    id: string;
    workspaceId: string;
    title: string;
    /** Artifact type. Phase 1 supports markdown documents only. */
    type: 'markdown';
    /** Monotonic revision counter, incremented on every content/title change. */
    revision: number;
    createdAt: string;
    updatedAt: string;
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

// ============================================================================
// Constants & helpers
// ============================================================================

const CANVASES_DIR_NAME = 'canvases';
const DESCRIPTOR_FILE = 'canvas.json';
const ARTIFACT_FILE = 'artifact.md';

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
    constructor(private readonly dataDir: string) {}

    private getWorkspaceRoot(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, CANVASES_DIR_NAME);
    }

    private getCanvasDir(workspaceId: string, canvasId: string): string {
        return path.join(this.getWorkspaceRoot(workspaceId), canvasId);
    }

    createCanvas(input: CreateCanvasInput): CanvasRecord {
        const id = generateCanvasId(input.title);
        const now = new Date().toISOString();
        const record: CanvasRecord = {
            id,
            workspaceId: input.workspaceId,
            title: input.title,
            type: 'markdown',
            revision: 1,
            createdAt: now,
            updatedAt: now,
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

        descriptors.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
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
            lastEditor: input.editor,
        };
        this.persist(updated);
        return { ok: true, canvas: updated };
    }

    private persist(record: CanvasRecord): void {
        const dir = this.getCanvasDir(record.workspaceId, record.id);
        fs.mkdirSync(dir, { recursive: true });
        const { content, ...descriptor } = record;
        writeFileAtomic(path.join(dir, DESCRIPTOR_FILE), JSON.stringify(descriptor, null, 2));
        writeFileAtomic(path.join(dir, ARTIFACT_FILE), content);
    }
}

function preview(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > 60 ? `"${flat.slice(0, 60)}…"` : `"${flat}"`;
}
