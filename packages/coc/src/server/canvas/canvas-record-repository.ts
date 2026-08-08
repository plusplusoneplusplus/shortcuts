/**
 * Canvas record persistence
 *
 * Owns the three files that make up a canvas revision — the descriptor, the
 * artifact, and the version snapshot — plus snapshot listing and pruning.
 *
 * A revision is committed as one staged unit (see {@link StagedCommit}): all
 * three files are written to temps first, then renamed snapshot → artifact →
 * descriptor. The descriptor goes last on purpose, because it is what carries
 * the revision number: a torn commit can leave content that is newer than the
 * recorded revision, never a revision that names content nobody wrote.
 *
 * Reads are forgiving in one specific way. If the descriptor parses but the
 * artifact is missing or unreadable, the snapshot for that same revision is
 * used as the content, which is exactly what a torn commit or a truncated
 * artifact leaves behind. Anything skipped is reported through
 * {@link reportCanvasCorruption} instead of vanishing silently.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CanvasLayout, DESCRIPTOR_FILE, ARTIFACT_FILE } from './canvas-layout';
import { StagedCommit, cleanupStaleTemps, isCanvasTempName } from './canvas-atomic-write';
import { reportCanvasCorruption, isAbsentError } from './canvas-diagnostics';
import {
    isValidCanvasId,
    MAX_CANVAS_VERSIONS,
    type CanvasDescriptor,
    type CanvasRecord,
    type CanvasVersion,
    type CanvasVersionMeta,
} from './canvas-types';

const VERSION_FILE_PATTERN = /^(\d+)\.json$/;

export class CanvasRecordRepository {
    constructor(private readonly layout: CanvasLayout) {}

    /** Read the descriptor alone, or null when absent or unparseable. */
    readDescriptor(workspaceId: string, canvasId: string): CanvasDescriptor | null {
        if (!isValidCanvasId(canvasId)) return null;
        try {
            const raw = fs.readFileSync(this.layout.descriptorPath(workspaceId, canvasId), 'utf-8');
            return JSON.parse(raw) as CanvasDescriptor;
        } catch (error) {
            reportCanvasCorruption({ workspaceId, canvasId, role: 'descriptor', file: DESCRIPTOR_FILE, error });
            return null;
        }
    }

    /** Read descriptor + content, or null when the canvas does not exist. */
    readRecord(workspaceId: string, canvasId: string): CanvasRecord | null {
        const descriptor = this.readDescriptor(workspaceId, canvasId);
        if (!descriptor) return null;
        return { ...descriptor, content: this.readContent(workspaceId, canvasId, descriptor.revision) };
    }

    /** List descriptors (no content), newest first. */
    listDescriptors(workspaceId: string, filter?: { processId?: string }): CanvasDescriptor[] {
        const root = this.layout.workspaceRoot(workspaceId);
        let entries: string[];
        try {
            entries = fs.readdirSync(root);
        } catch (error) {
            if (!isAbsentError(error)) {
                reportCanvasCorruption({ workspaceId, role: 'listing', error });
            }
            return [];
        }

        const descriptors: CanvasDescriptor[] = [];
        for (const entry of entries) {
            if (!isValidCanvasId(entry)) continue;
            const descriptor = this.readDescriptor(workspaceId, entry);
            if (!descriptor) continue;
            if (filter?.processId && descriptor.processId !== filter.processId) continue;
            descriptors.push(descriptor);
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

    /**
     * Prepare a revision without publishing it. The caller commits — that is
     * how an extension save gets its documents and its revision into place
     * through one staging phase and one rename phase.
     */
    stageCommit(record: CanvasRecord): StagedCommit {
        const { content, ...descriptor } = record;
        const snapshot: CanvasVersion = {
            revision: record.revision,
            title: record.title,
            editor: record.lastEditor,
            updatedAt: record.updatedAt,
            content,
        };

        const staged = new StagedCommit();
        // Snapshot first, descriptor last: see the file header.
        staged.stage(this.layout.versionPath(record.workspaceId, record.id, record.revision), JSON.stringify(snapshot, null, 2));
        staged.stage(this.layout.artifactPath(record.workspaceId, record.id), content);
        staged.stage(this.layout.descriptorPath(record.workspaceId, record.id), JSON.stringify(descriptor, null, 2));
        return staged;
    }

    /** Housekeeping that runs after a revision is visible: prune and sweep temps. */
    afterCommit(record: CanvasRecord): void {
        this.pruneVersions(record.workspaceId, record.id, record.revision);
        cleanupStaleTemps(this.layout.canvasDir(record.workspaceId, record.id), {
            workspaceId: record.workspaceId,
            canvasId: record.id,
        });
    }

    /** Stage, publish, and prune one revision. */
    commit(record: CanvasRecord): void {
        const staged = this.stageCommit(record);
        try {
            staged.commit();
        } catch (error) {
            staged.rollback();
            throw error;
        }
        this.afterCommit(record);
    }

    /** List version snapshot metadata (no content), newest first. */
    listVersions(workspaceId: string, canvasId: string): CanvasVersionMeta[] {
        if (!isValidCanvasId(canvasId)) return [];
        const versionsDir = this.layout.versionsDir(workspaceId, canvasId);
        let entries: string[];
        try {
            entries = fs.readdirSync(versionsDir);
        } catch (error) {
            if (!isAbsentError(error)) {
                reportCanvasCorruption({ workspaceId, canvasId, role: 'version', error });
            }
            return [];
        }

        const versions: CanvasVersionMeta[] = [];
        for (const entry of entries) {
            if (isCanvasTempName(entry) || !VERSION_FILE_PATTERN.test(entry)) continue;
            try {
                const raw = JSON.parse(fs.readFileSync(path.join(versionsDir, entry), 'utf-8')) as CanvasVersion;
                versions.push({
                    revision: raw.revision,
                    title: raw.title,
                    editor: raw.editor,
                    updatedAt: raw.updatedAt,
                });
            } catch (error) {
                reportCanvasCorruption({ workspaceId, canvasId, role: 'version', file: entry, error });
            }
        }

        versions.sort((a, b) => b.revision - a.revision);
        return versions;
    }

    /** Read one full version snapshot, or null when it does not exist. */
    getVersion(workspaceId: string, canvasId: string, revision: number): CanvasVersion | null {
        if (!isValidCanvasId(canvasId) || !Number.isInteger(revision) || revision < 1) return null;
        try {
            const raw = fs.readFileSync(this.layout.versionPath(workspaceId, canvasId, revision), 'utf-8');
            return JSON.parse(raw) as CanvasVersion;
        } catch (error) {
            reportCanvasCorruption({ workspaceId, canvasId, role: 'version', file: `${revision}.json`, error });
            return null;
        }
    }

    /**
     * Content for a descriptor's revision. Falls back to that revision's
     * snapshot when the artifact cannot be read, so a torn write costs history
     * rather than the whole canvas.
     */
    private readContent(workspaceId: string, canvasId: string, revision: number): string {
        try {
            return fs.readFileSync(this.layout.artifactPath(workspaceId, canvasId), 'utf-8');
        } catch (error) {
            reportCanvasCorruption({ workspaceId, canvasId, role: 'artifact', file: ARTIFACT_FILE, error });
            const snapshot = this.getVersion(workspaceId, canvasId, revision);
            return snapshot?.content ?? '';
        }
    }

    /** Drop snapshots older than the retention window (best-effort). */
    private pruneVersions(workspaceId: string, canvasId: string, revision: number): void {
        const cutoff = revision - MAX_CANVAS_VERSIONS;
        if (cutoff < 1) return;
        const versionsDir = this.layout.versionsDir(workspaceId, canvasId);
        let entries: string[];
        try {
            entries = fs.readdirSync(versionsDir);
        } catch (error) {
            reportCanvasCorruption({ workspaceId, canvasId, role: 'version-prune', error });
            return;
        }
        for (const entry of entries) {
            const match = VERSION_FILE_PATTERN.exec(entry);
            if (!match || Number(match[1]) > cutoff) continue;
            try {
                fs.unlinkSync(path.join(versionsDir, entry));
            } catch (error) {
                reportCanvasCorruption({ workspaceId, canvasId, role: 'version-prune', file: entry, error });
            }
        }
    }
}
