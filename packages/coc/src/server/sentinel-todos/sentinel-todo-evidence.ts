import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { resolveWorkingTreePath, MAX_WORKING_TREE_CONTENT_BYTES } from '../git/working-tree-file-content';
import { SentinelTodoError } from './sentinel-todo-store';

export function parseEvidenceInput<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) throw new SentinelTodoError('invalid', result.error.issues.map(issue => issue.message).join('; '));
    return result.data;
}

export function evidenceAttribution(actor: 'user' | 'sentinel', recordedRevision: number) {
    return { receiptId: randomUUID(), recordedRevision, recordedAt: new Date().toISOString(), recordedBy: actor };
}

/** Hash exact bytes, without allowing traversal, foreign-platform absolutes or symlink escapes. */
export function artifactVersion(root: string, reference: string): string {
    const normalized = reference.replace(/\\/g, '/');
    if (normalized.includes('\0') || (process.platform !== 'win32' && normalized.startsWith('//'))
        || (process.platform !== 'win32' && /^[A-Za-z]:/.test(normalized))) {
        throw new SentinelTodoError('invalid', 'Artifact path is outside the owning workspace');
    }
    const filename = resolveWorkingTreePath(root, normalized);
    if (!filename) throw new SentinelTodoError('invalid', 'Artifact path is outside the owning workspace');
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(filename);
    if (!resolveWorkingTreePath(realRoot, realFile)) throw new SentinelTodoError('invalid', 'Artifact symlink escapes the workspace');
    const handle = fs.openSync(realFile, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
        const before = fs.fstatSync(handle);
        if (!before.isFile() || before.size > MAX_WORKING_TREE_CONTENT_BYTES) {
            throw new SentinelTodoError('invalid', 'Artifact must be a regular file within the content size limit');
        }
        const buffer = Buffer.alloc(before.size + 1);
        let length = 0;
        while (length < buffer.length) {
            const read = fs.readSync(handle, buffer, length, buffer.length - length, length);
            if (!read) break;
            length += read;
        }
        const bytes = buffer.subarray(0, length);
        const after = fs.fstatSync(handle);
        const current = fs.statSync(filename);
        if (bytes.length !== before.size || before.size !== after.size
            || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
            || after.ino !== current.ino || after.dev !== current.dev
            || fs.realpathSync(filename) !== realFile
            || after.mtimeMs !== current.mtimeMs || after.ctimeMs !== current.ctimeMs) {
            throw new SentinelTodoError('conflict', 'Artifact changed while reading');
        }
        return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    } finally { fs.closeSync(handle); }
}

/** Relative references stay repo-relative; managed artifacts require an exact absolute reference. */
export function scopedArtifactVersion(roots: readonly string[], reference: string): string {
    const normalized = reference.replace(/\\/g, '/');
    const root = path.isAbsolute(normalized)
        ? roots.find(candidate => !!resolveWorkingTreePath(candidate, normalized))
        : roots[0];
    if (!root) throw new SentinelTodoError('invalid', 'Artifact path is outside the selected workspace artifact roots');
    return artifactVersion(root, reference);
}

export function artifactKey(phase: string, reference: string): string {
    return JSON.stringify([phase, reference]);
}
