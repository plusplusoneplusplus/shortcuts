/**
 * Tests for the file-based PR review-progress store (AC-04).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    reviewProgressPaths,
    readReviewProgress,
    writeReviewProgress,
    clearReviewProgress,
    validateReviewProgressInput,
    MAX_FILES_PER_SET,
    emptyReviewProgress,
} from '../../src/server/repos/review-progress-store';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'review-progress-store-test-'));
}

describe('reviewProgressPaths', () => {
    it('places files under <dataDir>/repos/<workspaceId>/review-progress', () => {
        const paths = reviewProgressPaths('/data', 'ws1', 'repo', '42');
        expect(paths.dir).toBe(path.join('/data', 'repos', 'ws1', 'review-progress'));
        expect(paths.filePath.endsWith('repo_42.json')).toBe(true);
    });

    it('sanitizes filesystem-unsafe characters in repo and pr keys', () => {
        const paths = reviewProgressPaths('/data', 'ws1', 'org/repo', 'pr:99');
        const filename = path.basename(paths.filePath);
        expect(filename).not.toContain('/');
        expect(filename).not.toContain(':');
        expect(filename).toBe('org_repo_pr_99.json');
    });

    it('keys by (workspaceId, repoId, prId) — multi-repo isolation', () => {
        const a = reviewProgressPaths('/data', 'ws-a', 'repo', '1');
        const b = reviewProgressPaths('/data', 'ws-b', 'repo', '1');
        const c = reviewProgressPaths('/data', 'ws-a', 'other-repo', '1');
        expect(a.filePath).not.toBe(b.filePath);
        expect(a.filePath).not.toBe(c.filePath);
        // Same repo+pr in a different workspace must land in a different dir.
        expect(path.dirname(a.filePath)).not.toBe(path.dirname(b.filePath));
    });
});

describe('writeReviewProgress / readReviewProgress', () => {
    let dataDir: string;
    beforeEach(() => { dataDir = makeTempDir(); });

    it('persists and re-reads a record', () => {
        writeReviewProgress(dataDir, 'ws', 'repo', '1', {
            headSha: 'sha-aaa',
            reviewedFiles: ['src/a.ts'],
            visitedFiles: ['src/a.ts', 'src/b.ts'],
            lastSelectedFile: 'src/a.ts',
        });

        const read = readReviewProgress(dataDir, 'ws', 'repo', '1', 'sha-aaa');
        expect(read.reviewedFiles).toEqual(['src/a.ts']);
        expect(read.visitedFiles).toEqual(['src/a.ts', 'src/b.ts']);
        expect(read.lastSelectedFile).toBe('src/a.ts');
        expect(read.headSha).toBe('sha-aaa');
        expect(read.repoId).toBe('repo');
        expect(read.prId).toBe('1');
        expect(typeof read.updatedAt).toBe('string');
    });

    it('returns empty record when no file exists', () => {
        const read = readReviewProgress(dataDir, 'ws', 'repo', '1', 'sha-aaa');
        expect(read.reviewedFiles).toEqual([]);
        expect(read.visitedFiles).toEqual([]);
        expect(read.lastSelectedFile).toBeNull();
        expect(read.headSha).toBe('sha-aaa');
    });

    it('stale-head reset: returns empty record when stored headSha differs', () => {
        writeReviewProgress(dataDir, 'ws', 'repo', '1', {
            headSha: 'sha-old',
            reviewedFiles: ['src/a.ts'],
            visitedFiles: ['src/a.ts'],
            lastSelectedFile: 'src/a.ts',
        });
        const read = readReviewProgress(dataDir, 'ws', 'repo', '1', 'sha-new');
        expect(read.reviewedFiles).toEqual([]);
        expect(read.visitedFiles).toEqual([]);
        expect(read.lastSelectedFile).toBeNull();
        expect(read.headSha).toBe('sha-new');
    });

    it('returns empty record on corrupt JSON', () => {
        const { dir, filePath } = reviewProgressPaths(dataDir, 'ws', 'repo', '1');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, '{ not json', 'utf-8');
        const read = readReviewProgress(dataDir, 'ws', 'repo', '1', 'sha');
        expect(read.reviewedFiles).toEqual([]);
    });

    it('multi-repo separation: writing one workspace does not affect another', () => {
        writeReviewProgress(dataDir, 'ws-a', 'repo', '1', {
            headSha: 'sha',
            reviewedFiles: ['a.ts'],
            visitedFiles: ['a.ts'],
            lastSelectedFile: null,
        });
        const otherWs = readReviewProgress(dataDir, 'ws-b', 'repo', '1', 'sha');
        expect(otherWs.reviewedFiles).toEqual([]);
        const otherRepo = readReviewProgress(dataDir, 'ws-a', 'other-repo', '1', 'sha');
        expect(otherRepo.reviewedFiles).toEqual([]);
        const sameKey = readReviewProgress(dataDir, 'ws-a', 'repo', '1', 'sha');
        expect(sameKey.reviewedFiles).toEqual(['a.ts']);
    });

    it('write deduplicates and clamps file lists', () => {
        const dupes = ['a.ts', 'a.ts', 'b.ts'];
        const out = writeReviewProgress(dataDir, 'ws', 'repo', '1', {
            headSha: 'sha',
            reviewedFiles: dupes,
            visitedFiles: dupes,
            lastSelectedFile: null,
        });
        expect(out.reviewedFiles).toEqual(['a.ts', 'b.ts']);
        expect(out.visitedFiles).toEqual(['a.ts', 'b.ts']);
    });

    it('write enforces MAX_FILES_PER_SET upper bound', () => {
        const huge: string[] = [];
        for (let i = 0; i < MAX_FILES_PER_SET + 50; i++) huge.push(`f${i}.ts`);
        const out = writeReviewProgress(dataDir, 'ws', 'repo', '1', {
            headSha: 'sha',
            reviewedFiles: huge,
            visitedFiles: [],
            lastSelectedFile: null,
        });
        expect(out.reviewedFiles).toHaveLength(MAX_FILES_PER_SET);
    });

    it('clearReviewProgress removes the file', () => {
        writeReviewProgress(dataDir, 'ws', 'repo', '1', {
            headSha: 'sha',
            reviewedFiles: ['a.ts'],
            visitedFiles: ['a.ts'],
            lastSelectedFile: null,
        });
        clearReviewProgress(dataDir, 'ws', 'repo', '1');
        const read = readReviewProgress(dataDir, 'ws', 'repo', '1', 'sha');
        expect(read.reviewedFiles).toEqual([]);
    });

    it('clearReviewProgress is a no-op when the file does not exist', () => {
        expect(() => clearReviewProgress(dataDir, 'ws', 'repo', '1')).not.toThrow();
    });

    it('overwrite replaces previous content atomically', () => {
        writeReviewProgress(dataDir, 'ws', 'repo', '1', {
            headSha: 'sha', reviewedFiles: ['a.ts'], visitedFiles: ['a.ts'], lastSelectedFile: 'a.ts',
        });
        writeReviewProgress(dataDir, 'ws', 'repo', '1', {
            headSha: 'sha', reviewedFiles: ['b.ts'], visitedFiles: ['b.ts'], lastSelectedFile: 'b.ts',
        });
        const read = readReviewProgress(dataDir, 'ws', 'repo', '1', 'sha');
        expect(read.reviewedFiles).toEqual(['b.ts']);
        expect(read.visitedFiles).toEqual(['b.ts']);
        expect(read.lastSelectedFile).toBe('b.ts');
    });
});

describe('emptyReviewProgress', () => {
    it('returns a zero-state record with the requested keys', () => {
        const r = emptyReviewProgress('repo', '1', 'sha');
        expect(r).toEqual({
            repoId: 'repo',
            prId: '1',
            headSha: 'sha',
            reviewedFiles: [],
            visitedFiles: [],
            lastSelectedFile: null,
            updatedAt: new Date(0).toISOString(),
        });
    });
});

describe('validateReviewProgressInput', () => {
    it('rejects non-object input', () => {
        expect(validateReviewProgressInput(null).ok).toBe(false);
        expect(validateReviewProgressInput(42).ok).toBe(false);
        expect(validateReviewProgressInput('string').ok).toBe(false);
    });

    it('requires a non-empty headSha string', () => {
        const v = validateReviewProgressInput({});
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.error).toMatch(/headSha/);
    });

    it('rejects non-string array entries in reviewedFiles', () => {
        const v = validateReviewProgressInput({ headSha: 'sha', reviewedFiles: ['ok', 42] });
        expect(v.ok).toBe(false);
    });

    it('rejects non-string array entries in visitedFiles', () => {
        const v = validateReviewProgressInput({ headSha: 'sha', visitedFiles: [{}] });
        expect(v.ok).toBe(false);
    });

    it('rejects non-string non-null lastSelectedFile', () => {
        const v = validateReviewProgressInput({ headSha: 'sha', lastSelectedFile: 42 });
        expect(v.ok).toBe(false);
    });

    it('defaults missing arrays to empty', () => {
        const v = validateReviewProgressInput({ headSha: 'sha' });
        expect(v.ok).toBe(true);
        if (v.ok) {
            expect(v.record.reviewedFiles).toEqual([]);
            expect(v.record.visitedFiles).toEqual([]);
            expect(v.record.lastSelectedFile).toBeNull();
        }
    });

    it('accepts well-formed input and trims headSha', () => {
        const v = validateReviewProgressInput({
            headSha: '  sha  ',
            reviewedFiles: ['a.ts'],
            visitedFiles: ['a.ts', 'b.ts'],
            lastSelectedFile: 'a.ts',
        });
        expect(v.ok).toBe(true);
        if (v.ok) {
            expect(v.record.headSha).toBe('sha');
            expect(v.record.reviewedFiles).toEqual(['a.ts']);
            expect(v.record.lastSelectedFile).toBe('a.ts');
        }
    });
});
