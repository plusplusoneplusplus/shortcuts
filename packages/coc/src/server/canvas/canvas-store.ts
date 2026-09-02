/**
 * File-based persistence for chat canvases — markdown artifacts the AI and
 * the user co-edit in a side panel next to a conversation.
 *
 * Each canvas lives under `~/.coc/repos/<workspaceId>/canvases/<canvasId>/`:
 *   - `canvas.json`            — descriptor (title, revision, linked process, timestamps)
 *   - `artifact.md`            — the markdown content
 *   - `versions/<rev>.json`    — per-revision snapshots (capped, newest kept)
 *   - `comments.json`          — anchored user comments (open | sent | resolved)
 *   - `extension/`             — extension documents (manifest, UI, capabilities)
 *   - `files/`                 — read-only data an extension canvas may read
 *
 * Updates are revision-checked: callers pass `expectedRevision` and receive a
 * conflict result when the canvas changed underneath them. Edits can be
 * expressed as exact-match string replacements (each `oldText` must appear
 * exactly once) or as a full content replacement. Every persisted revision
 * also writes a version snapshot so the dashboard can step through history
 * and restore an older state as a new revision.
 *
 * This class is the facade. The work is split across services so each contract
 * stands on its own:
 *
 *   - {@link CanvasWriteQueue}          — one writer per canvas, so a
 *                                         read-check-write is a real critical
 *                                         section (see the module for what
 *                                         "concurrent" means for sync code)
 *   - {@link CanvasRecordRepository}    — descriptor + artifact + snapshot as
 *                                         one staged commit
 *   - {@link CanvasExtensionRepository} — the extension document set, published
 *                                         together with its revision
 *   - {@link CanvasCommentRepository}   — comment mutations as read-modify-write
 *                                         under the lock
 *   - {@link CanvasFileSandbox}         — path safety and the read-only files tree
 */

import * as crypto from 'crypto';
import { CanvasLayout } from './canvas-layout';
import { CanvasWriteQueue } from './canvas-write-queue';
import { CanvasRecordRepository } from './canvas-record-repository';
import { CanvasExtensionRepository } from './canvas-extension-repository';
import { CanvasCommentRepository } from './canvas-comment-repository';
import { CanvasFileSandbox } from './canvas-file-sandbox';
import type { StagedCommit } from './canvas-atomic-write';
import {
    isValidCanvasId,
    normalizeCanvasLanguage,
    generateCanvasId,
    MAX_COMMENT_ANCHOR_LENGTH,
    MAX_COMMENT_BODY_LENGTH,
    type CanvasComment,
    type CanvasCommentStatus,
    type CanvasDescriptor,
    type CanvasEditor,
    type CanvasExtension,
    type CanvasRecord,
    type CanvasType,
    type CanvasUpdateResult,
    type CanvasVersion,
    type CanvasVersionMeta,
    type CreateCanvasInput,
    type UpdateCanvasInput,
} from './canvas-types';
import type {
    CanvasFileEncoding,
    CanvasFileEntry,
    CanvasFileReadResult,
    CanvasFileWriteResult,
} from './canvas-file-sandbox';

// The store's surface is unchanged: everything it used to define is still
// importable from this module.
export {
    CANVAS_TYPES,
    MAX_EXTENSION_UI_BYTES,
    MAX_EXTENSION_UI_JS_BYTES,
    MAX_EXTENSION_CAPABILITIES_BYTES,
    MAX_CANVAS_VERSIONS,
    normalizeCanvasLanguage,
    isValidCanvasId,
    generateCanvasId,
} from './canvas-types';
export type {
    CanvasEditor,
    CanvasType,
    CanvasDescriptor,
    CanvasRecord,
    CanvasEdit,
    CreateCanvasInput,
    UpdateCanvasInput,
    CanvasUpdateResult,
    CanvasVersionMeta,
    CanvasVersion,
    CanvasCapabilityMeta,
    CanvasExtensionManifest,
    CanvasExtension,
    CanvasCommentStatus,
    CanvasComment,
} from './canvas-types';
export {
    MAX_CANVAS_TEXT_FILE_BYTES,
    MAX_CANVAS_BINARY_FILE_BYTES,
    MAX_CANVAS_FILE_ENTRIES,
    hasEncodedPathEscape,
    isSafeCanvasFilePath,
} from './canvas-file-sandbox';
export type {
    CanvasFileEncoding,
    CanvasFileEntry,
    CanvasFile,
    CanvasFileReadResult,
    CanvasFileWriteResult,
} from './canvas-file-sandbox';

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

    private readonly layout: CanvasLayout;
    private readonly queue: CanvasWriteQueue;
    private readonly records: CanvasRecordRepository;
    private readonly extensions: CanvasExtensionRepository;
    private readonly comments: CanvasCommentRepository;
    private readonly files: CanvasFileSandbox;

    constructor(dataDir: string) {
        this.layout = new CanvasLayout(dataDir);
        this.queue = new CanvasWriteQueue(workspaceId => this.layout.locksDir(workspaceId));
        this.records = new CanvasRecordRepository(this.layout);
        this.extensions = new CanvasExtensionRepository(this.layout);
        this.comments = new CanvasCommentRepository(this.layout);
        this.files = new CanvasFileSandbox(
            this.layout,
            (workspaceId, canvasId) => this.records.readDescriptor(workspaceId, canvasId) !== null,
        );
    }

    private nextSeq(): number {
        return ++this.seqCounter;
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
        this.queue.runExclusive(record.workspaceId, record.id, () => this.records.commit(record));
        return record;
    }

    getCanvas(workspaceId: string, canvasId: string): CanvasRecord | null {
        return this.records.readRecord(workspaceId, canvasId);
    }

    /** List canvas descriptors (no content), newest first. */
    listCanvases(workspaceId: string, filter?: { processId?: string }): CanvasDescriptor[] {
        return this.records.listDescriptors(workspaceId, filter);
    }

    /**
     * Apply an update to a canvas.
     *
     * The revision check and the write happen inside one per-canvas critical
     * section, so a stale `expectedRevision` cannot slip through a window
     * between the two: of two writers holding the same expected revision,
     * exactly one commits and the other gets `revision-conflict` with the
     * revision the winner just wrote.
     */
    updateCanvas(workspaceId: string, canvasId: string, input: UpdateCanvasInput): CanvasUpdateResult {
        if (!isValidCanvasId(canvasId)) return { ok: false, reason: 'not-found' };
        return this.queue.runExclusive(workspaceId, canvasId, (): CanvasUpdateResult => {
            const existing = this.records.readRecord(workspaceId, canvasId);
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
            this.records.commit(updated);
            return { ok: true, canvas: updated };
        });
    }

    // ------------------------------------------------------------------
    // Version snapshots
    // ------------------------------------------------------------------

    /** List version snapshot metadata (no content), newest first. */
    listVersions(workspaceId: string, canvasId: string): CanvasVersionMeta[] {
        return this.records.listVersions(workspaceId, canvasId);
    }

    /** Read one full version snapshot, or null when it does not exist. */
    getVersion(workspaceId: string, canvasId: string, revision: number): CanvasVersion | null {
        return this.records.getVersion(workspaceId, canvasId, revision);
    }

    // ------------------------------------------------------------------
    // Extension documents (type 'extension' canvases)
    // ------------------------------------------------------------------

    /** Read the extension documents, or null when the canvas has none. */
    getExtension(workspaceId: string, canvasId: string): CanvasExtension | null {
        return this.extensions.read(workspaceId, canvasId);
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
     *
     * Documents and revision are staged together and published in one rename
     * phase, documents first. That ordering is the safe one for code the canvas
     * host executes: a reader can briefly see the new documents at the old
     * revision (harmless — the panel reloads on the next revision change), but
     * never a bumped revision still serving the previous UI.
     */
    saveExtension(workspaceId: string, canvasId: string, extension: CanvasExtension, editor: CanvasEditor): CanvasRecord | null {
        if (!isValidCanvasId(canvasId)) return null;
        return this.queue.runExclusive(workspaceId, canvasId, () => {
            const existing = this.records.readRecord(workspaceId, canvasId);
            if (!existing || existing.type !== 'extension') return null;

            const updated: CanvasRecord = {
                ...existing,
                revision: existing.revision + 1,
                updatedAt: new Date().toISOString(),
                seq: this.nextSeq(),
                lastEditor: editor,
            };

            const stagedDocuments = this.extensions.stage(workspaceId, canvasId, extension);
            let stagedRecord: StagedCommit;
            try {
                stagedRecord = this.records.stageCommit(updated);
            } catch (error) {
                stagedDocuments.rollback();
                throw error;
            }
            try {
                stagedDocuments.commit();
                stagedRecord.commit();
            } catch (error) {
                stagedDocuments.rollback();
                stagedRecord.rollback();
                throw error;
            }
            this.records.afterCommit(updated);
            return updated;
        });
    }

    // ------------------------------------------------------------------
    // Canvas files (read-only data given to an extension canvas)
    // ------------------------------------------------------------------

    getCanvasFilesRoot(workspaceId: string, canvasId: string): string {
        return this.files.filesRoot(workspaceId, canvasId);
    }

    listCanvasFiles(workspaceId: string, canvasId: string): CanvasFileEntry[] {
        return this.files.list(workspaceId, canvasId);
    }

    readCanvasFile(
        workspaceId: string,
        canvasId: string,
        relativePath: unknown,
        options?: { encoding?: CanvasFileEncoding },
    ): CanvasFileReadResult {
        return this.files.read(workspaceId, canvasId, relativePath, options);
    }

    writeCanvasFile(
        workspaceId: string,
        canvasId: string,
        relativePath: unknown,
        content: string,
        encoding: CanvasFileEncoding = 'utf-8',
    ): CanvasFileWriteResult {
        return this.files.write(workspaceId, canvasId, relativePath, content, encoding);
    }

    // ------------------------------------------------------------------
    // Comments
    // ------------------------------------------------------------------

    listComments(workspaceId: string, canvasId: string, filter?: { status?: CanvasCommentStatus }): CanvasComment[] {
        const comments = this.comments.read(workspaceId, canvasId);
        return filter?.status ? comments.filter(c => c.status === filter.status) : comments;
    }

    addComment(workspaceId: string, canvasId: string, input: { anchorText: string; body: string }): CanvasComment | null {
        if (!isValidCanvasId(canvasId)) return null;
        return this.queue.runExclusive(workspaceId, canvasId, () => {
            if (!this.records.readDescriptor(workspaceId, canvasId)) return null;
            const now = new Date().toISOString();
            const comment: CanvasComment = {
                id: crypto.randomBytes(6).toString('hex'),
                anchorText: input.anchorText.slice(0, MAX_COMMENT_ANCHOR_LENGTH),
                body: input.body.slice(0, MAX_COMMENT_BODY_LENGTH),
                status: 'open',
                createdAt: now,
                updatedAt: now,
            };
            return this.comments.mutate(workspaceId, canvasId, existing => ({
                comments: [...existing, comment],
                result: comment,
            }));
        });
    }

    setCommentStatus(workspaceId: string, canvasId: string, commentId: string, status: CanvasCommentStatus): CanvasComment | null {
        if (!isValidCanvasId(canvasId)) return null;
        return this.queue.runExclusive(workspaceId, canvasId, () =>
            this.comments.mutate<CanvasComment | null>(workspaceId, canvasId, existing => {
                const index = existing.findIndex(c => c.id === commentId);
                if (index === -1) return { comments: null, result: null };
                const updated: CanvasComment = { ...existing[index], status, updatedAt: new Date().toISOString() };
                const comments = [...existing];
                comments[index] = updated;
                return { comments, result: updated };
            }),
        );
    }

    deleteComment(workspaceId: string, canvasId: string, commentId: string): boolean {
        if (!isValidCanvasId(canvasId)) return false;
        return this.queue.runExclusive(workspaceId, canvasId, () =>
            this.comments.mutate<boolean>(workspaceId, canvasId, existing => {
                const remaining = existing.filter(c => c.id !== commentId);
                if (remaining.length === existing.length) return { comments: null, result: false };
                return { comments: remaining, result: true };
            }),
        );
    }
}

function preview(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > 60 ? `"${flat.slice(0, 60)}…"` : `"${flat}"`;
}
