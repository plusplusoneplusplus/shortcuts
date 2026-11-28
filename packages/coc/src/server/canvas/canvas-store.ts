import * as crypto from 'crypto';
import * as fs from 'fs';
import { reportCanvasCorruption, isAbsentError } from './canvas-diagnostics';
import { removeManagedPath, assertManagedPath } from '../canvas-extensions/generated-packages';
import { CanvasLayout } from './canvas-layout';
import { CanvasWriteQueue } from './canvas-write-queue';
import { CanvasRecordRepository } from './canvas-record-repository';
import { CanvasCommentRepository } from './canvas-comment-repository';
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
    type CanvasRecord,
    type CanvasType,
    type CanvasUpdateResult,
    type CanvasVersion,
    type CanvasVersionMeta,
    type CreateCanvasInput,
    type UpdateCanvasInput,
} from './canvas-types';

export {
    CANVAS_TYPES,
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
    CanvasCommentStatus,
    CanvasComment,
} from './canvas-types';
export { hasEncodedPathEscape, isSafeCanvasFilePath } from './canvas-file-sandbox';

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
    private readonly comments: CanvasCommentRepository;

    constructor(dataDir: string) {
        this.layout = new CanvasLayout(dataDir);
        this.queue = new CanvasWriteQueue(workspaceId => this.layout.locksDir(workspaceId));
        this.records = new CanvasRecordRepository(this.layout);
        this.comments = new CanvasCommentRepository(this.layout);
    }

    private nextSeq(): number {
        return ++this.seqCounter;
    }

    createCanvas(input: CreateCanvasInput): CanvasRecord {
        const id = input.id ?? generateCanvasId(input.title);
        if (!isValidCanvasId(id)) throw new Error('Invalid canvas ID');
        const now = new Date().toISOString();
        const type: CanvasType = input.type === 'code' || input.type === 'excalidraw' || input.type === 'kusto' || input.type === 'copilot-extension'
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
        this.queue.runExclusive(record.workspaceId, record.id, () => {
            if (this.records.readDescriptor(record.workspaceId, record.id)) throw new Error('Canvas already exists');
            this.records.commit(record);
        });
        return record;
    }

    /** Raw-type retirement runs under the writer lock and retries filesystem failures on every read. */
    retireUnsupportedCanvas(workspaceId: string, canvasId: string): void {
        if (!isValidCanvasId(canvasId)) return;
        this.queue.runExclusive(workspaceId, canvasId, () => {
            try {
                assertManagedPath(this.layout.dataDir, this.layout.descriptorPath(workspaceId, canvasId));
                const descriptor = JSON.parse(fs.readFileSync(this.layout.descriptorPath(workspaceId, canvasId), 'utf8'));
                if (descriptor?.type === 'extension') {
                    removeManagedPath(this.layout.dataDir, this.layout.canvasDir(workspaceId, canvasId));
                }
            } catch (error) {
                if (!isAbsentError(error)) reportCanvasCorruption({ workspaceId, canvasId, role: 'retirement', error });
            }
        });
    }

    getCanvas(workspaceId: string, canvasId: string): CanvasRecord | null {
        this.retireUnsupportedCanvas(workspaceId, canvasId);
        return this.records.readRecord(workspaceId, canvasId);
    }

    /** List canvas descriptors (no content), newest first. */
    listCanvases(workspaceId: string, filter?: { processId?: string }): CanvasDescriptor[] {
        try {
            for (const id of fs.readdirSync(this.layout.workspaceRoot(workspaceId))) this.retireUnsupportedCanvas(workspaceId, id);
        } catch (error) { if (!isAbsentError(error)) reportCanvasCorruption({ workspaceId, role: 'listing', error }); }
        return this.records.listDescriptors(workspaceId, filter);
    }

    /** Internal lifecycle removal, including all versions, comments and files. */
    deleteCanvas(workspaceId: string, canvasId: string): void {
        if (!isValidCanvasId(canvasId)) throw new Error('Invalid canvas ID');
        this.queue.runExclusive(workspaceId, canvasId, () => {
            removeManagedPath(this.layout.dataDir, this.layout.canvasDir(workspaceId, canvasId));
        });
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
        if (this.getCanvas(workspaceId, canvasId)?.type === 'copilot-extension') return [];
        return this.records.listVersions(workspaceId, canvasId);
    }

    /** Read one full version snapshot, or null when it does not exist. */
    getVersion(workspaceId: string, canvasId: string, revision: number): CanvasVersion | null {
        if (this.getCanvas(workspaceId, canvasId)?.type === 'copilot-extension') return null;
        return this.records.getVersion(workspaceId, canvasId, revision);
    }

    // ------------------------------------------------------------------

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
