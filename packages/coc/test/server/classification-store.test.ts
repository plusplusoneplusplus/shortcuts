/**
 * Tests for the file-based classification store.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    classificationPaths,
    readClassification,
    writeClassification,
    writePending,
    readPending,
    clearPending,
    pruneStaleClassifications,
    pruneAllStaleClassifications,
    validateClassificationResult,
} from '../../src/server/repos/classification-store';
import type { DiffClassificationResult } from '../../src/server/spa/client/react/features/pull-requests/classification-types';

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'classification-store-test-'));
}

const validResult: DiffClassificationResult = {
    classifications: [
        { file: 'src/a.ts', hunkIndex: 0, category: 'logic', intensity: 'high', reason: 'New code' },
        { file: 'src/a.ts', hunkIndex: 1, category: 'mechanical', intensity: 'low', reason: 'Rename' },
    ],
};

describe('classificationPaths', () => {
    it('places files under <dataDir>/repos/<workspaceId>/classifications', () => {
        const paths = classificationPaths('/data', 'ws1', 'repo', '42', 'abcdef');
        expect(paths.dir).toBe(path.join('/data', 'repos', 'ws1', 'classifications'));
        expect(paths.resultPath.endsWith('repo_42_abcdef.json')).toBe(true);
        expect(paths.pendingPath.endsWith('repo_42_abcdef.json.pending')).toBe(true);
    });

    it('sanitizes filesystem-unsafe characters in key parts', () => {
        const paths = classificationPaths('/data', 'ws1', 'org/repo', '42', 'sha:bad');
        const filename = path.basename(paths.resultPath);
        // The sanitized filename must not contain the original unsafe chars
        expect(filename).not.toContain('/');
        expect(filename).not.toContain(':');
        expect(filename).toBe('org_repo_42_sha_bad.json');
    });
});

describe('writeClassification / readClassification', () => {
    let dataDir: string;
    beforeEach(() => { dataDir = makeTempDir(); });

    it('persists and re-reads a valid result', () => {
        const record = writeClassification(dataDir, 'ws', 'repo', '1', 'sha', validResult, { processId: 'p1' });
        expect(record.result.classifications).toHaveLength(2);

        const read = readClassification(dataDir, 'ws', 'repo', '1', 'sha');
        expect(read).toBeDefined();
        expect(read?.result).toEqual(validResult);
        expect(read?.processId).toBe('p1');
        expect(typeof read?.createdAt).toBe('string');
    });

    it('returns undefined when the file is missing', () => {
        expect(readClassification(dataDir, 'ws', 'repo', '1', 'sha')).toBeUndefined();
    });

    it('returns undefined when the file is corrupt', () => {
        const { resultPath, dir } = classificationPaths(dataDir, 'ws', 'repo', '1', 'sha');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(resultPath, 'not json', 'utf-8');
        expect(readClassification(dataDir, 'ws', 'repo', '1', 'sha')).toBeUndefined();
    });

    it('rejects invalid input and never writes the file', () => {
        const bad = { classifications: [{ file: 'a', hunkIndex: 0, category: 'oops', intensity: 'high', reason: 'x' }] } as unknown as DiffClassificationResult;
        expect(() => writeClassification(dataDir, 'ws', 'repo', '1', 'sha', bad))
            .toThrow(/category/);
        const { resultPath } = classificationPaths(dataDir, 'ws', 'repo', '1', 'sha');
        expect(fs.existsSync(resultPath)).toBe(false);
    });

    it('removes the pending marker on successful write', () => {
        writePending(dataDir, 'ws', 'repo', '1', 'sha', 'task-1');
        const { pendingPath } = classificationPaths(dataDir, 'ws', 'repo', '1', 'sha');
        expect(fs.existsSync(pendingPath)).toBe(true);

        writeClassification(dataDir, 'ws', 'repo', '1', 'sha', validResult);
        expect(fs.existsSync(pendingPath)).toBe(false);
    });

    it('overwrites an existing result for the same key', () => {
        writeClassification(dataDir, 'ws', 'repo', '1', 'sha', validResult);
        const next: DiffClassificationResult = {
            classifications: [{ file: 'b.ts', hunkIndex: 0, category: 'test', intensity: 'low', reason: 'Add' }],
        };
        writeClassification(dataDir, 'ws', 'repo', '1', 'sha', next);
        const read = readClassification(dataDir, 'ws', 'repo', '1', 'sha');
        expect(read?.result.classifications).toHaveLength(1);
        expect(read?.result.classifications[0].file).toBe('b.ts');
    });
});

describe('pending markers', () => {
    let dataDir: string;
    beforeEach(() => { dataDir = makeTempDir(); });

    it('writes and reads a pending marker', () => {
        writePending(dataDir, 'ws', 'repo', '1', 'sha', 'task-7');
        const pending = readPending(dataDir, 'ws', 'repo', '1', 'sha');
        expect(pending?.processId).toBe('task-7');
        expect(typeof pending?.startedAt).toBe('string');
    });

    it('returns undefined when no pending marker exists', () => {
        expect(readPending(dataDir, 'ws', 'repo', '1', 'sha')).toBeUndefined();
    });

    it('clearPending removes the marker', () => {
        writePending(dataDir, 'ws', 'repo', '1', 'sha', 'task-7');
        clearPending(dataDir, 'ws', 'repo', '1', 'sha');
        expect(readPending(dataDir, 'ws', 'repo', '1', 'sha')).toBeUndefined();
    });
});

describe('validateClassificationResult', () => {
    it('accepts a valid result', () => {
        const v = validateClassificationResult(validResult);
        expect(v.ok).toBe(true);
        if (v.ok) expect(v.classifications).toHaveLength(2);
    });

    it('rejects non-object input', () => {
        const v = validateClassificationResult(null);
        expect(v.ok).toBe(false);
    });

    it('rejects when classifications is not an array', () => {
        const v = validateClassificationResult({ classifications: 'oops' });
        expect(v.ok).toBe(false);
    });

    it('rejects empty classifications array', () => {
        const v = validateClassificationResult({ classifications: [] });
        expect(v.ok).toBe(false);
    });

    it('rejects an entry missing required fields', () => {
        const v = validateClassificationResult({ classifications: [{ file: 'a.ts' }] });
        expect(v.ok).toBe(false);
    });

    it('rejects an entry with bad category', () => {
        const v = validateClassificationResult({
            classifications: [{ file: 'a', hunkIndex: 0, category: 'other', intensity: 'high', reason: 'x' }],
        });
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.error).toMatch(/category/);
    });

    it('rejects an entry with bad intensity', () => {
        const v = validateClassificationResult({
            classifications: [{ file: 'a', hunkIndex: 0, category: 'logic', intensity: 'medium', reason: 'x' }],
        });
        expect(v.ok).toBe(false);
        if (!v.ok) expect(v.error).toMatch(/intensity/);
    });

    it('rejects negative hunkIndex', () => {
        const v = validateClassificationResult({
            classifications: [{ file: 'a', hunkIndex: -1, category: 'logic', intensity: 'high', reason: 'x' }],
        });
        expect(v.ok).toBe(false);
    });
});

describe('pruneStaleClassifications', () => {
    let dataDir: string;
    beforeEach(() => { dataDir = makeTempDir(); });

    it('removes files older than the cutoff', () => {
        writeClassification(dataDir, 'ws', 'repo', 'old', 'sha', validResult);
        writeClassification(dataDir, 'ws', 'repo', 'new', 'sha', validResult);

        const { resultPath: oldPath } = classificationPaths(dataDir, 'ws', 'repo', 'old', 'sha');
        const ancient = Date.now() - 40 * 24 * 60 * 60 * 1000;
        fs.utimesSync(oldPath, ancient / 1000, ancient / 1000);

        const removed = pruneStaleClassifications(dataDir, 'ws', 30);
        expect(removed).toBe(1);
        expect(fs.existsSync(oldPath)).toBe(false);
        expect(readClassification(dataDir, 'ws', 'repo', 'new', 'sha')).toBeDefined();
    });

    it('returns 0 when the directory does not exist', () => {
        expect(pruneStaleClassifications(dataDir, 'nope', 30)).toBe(0);
    });

    it('also prunes stale pending markers', () => {
        writePending(dataDir, 'ws', 'repo', '1', 'sha', 'task');
        const { pendingPath } = classificationPaths(dataDir, 'ws', 'repo', '1', 'sha');
        const ancient = Date.now() - 40 * 24 * 60 * 60 * 1000;
        fs.utimesSync(pendingPath, ancient / 1000, ancient / 1000);

        const removed = pruneStaleClassifications(dataDir, 'ws', 30);
        expect(removed).toBe(1);
        expect(fs.existsSync(pendingPath)).toBe(false);
    });
});

describe('pruneAllStaleClassifications', () => {
    let dataDir: string;
    beforeEach(() => { dataDir = makeTempDir(); });

    it('walks every workspace under <dataDir>/repos', () => {
        writeClassification(dataDir, 'wsA', 'repo', '1', 'sha', validResult);
        writeClassification(dataDir, 'wsB', 'repo', '1', 'sha', validResult);

        for (const ws of ['wsA', 'wsB']) {
            const { resultPath } = classificationPaths(dataDir, ws, 'repo', '1', 'sha');
            const ancient = Date.now() - 40 * 24 * 60 * 60 * 1000;
            fs.utimesSync(resultPath, ancient / 1000, ancient / 1000);
        }

        const removed = pruneAllStaleClassifications(dataDir, 30);
        expect(removed).toBe(2);
    });

    it('returns 0 when no repos root exists', () => {
        const empty = makeTempDir();
        expect(pruneAllStaleClassifications(empty, 30)).toBe(0);
    });
});
