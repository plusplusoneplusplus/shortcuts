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
        {
            file: 'src/a.ts',
            hunkIndex: 0,
            category: 'logic',
            intensity: 'high',
            reason: 'New code',
            summaryComment: 'Adds a new behavior path that reviewers should inspect.',
        },
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

    it('places origin-scoped files under <dataDir>/repos/<originId>/classifications', () => {
        const paths = classificationPaths('/data', 'ws1', 'repo', '42', 'abcdef', {
            storageOriginId: 'gh_org_repo',
        });
        expect(paths.dir).toBe(path.join('/data', 'repos', 'gh_org_repo', 'classifications'));
        expect(paths.resultPath.endsWith('42_abcdef.json')).toBe(true);
        expect(paths.pendingPath.endsWith('42_abcdef.json.pending')).toBe(true);
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
            classifications: [{
                file: 'b.ts',
                hunkIndex: 0,
                category: 'test',
                intensity: 'low',
                reason: 'Add',
                testFidelityComment: 'Medium fidelity: exercises the public API with mocked storage.',
            }],
        };
        writeClassification(dataDir, 'ws', 'repo', '1', 'sha', next);
        const read = readClassification(dataDir, 'ws', 'repo', '1', 'sha');
        expect(read?.result.classifications).toHaveLength(1);
        expect(read?.result.classifications[0].file).toBe('b.ts');
    });

    it('migrates legacy workspace/repo classifications into the origin scope on read', () => {
        writeClassification(dataDir, 'ws-a', 'repo', '1', 'sha', validResult, {
            processId: 'legacy-process',
            createdAt: '2026-01-01T00:00:00.000Z',
        });

        const scope = {
            storageOriginId: 'gh_org_repo',
            legacyScopes: [{ workspaceId: 'ws-a', repoId: 'repo' }],
        };
        const read = readClassification(dataDir, 'ws-b', 'repo', '1', 'sha', scope);

        expect(read?.processId).toBe('legacy-process');
        const originPaths = classificationPaths(dataDir, 'ws-b', 'repo', '1', 'sha', scope);
        expect(fs.existsSync(originPaths.resultPath)).toBe(true);
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

    it('migrates and clears legacy pending markers for origin-scoped reads', () => {
        writePending(dataDir, 'ws-a', 'repo', '1', 'sha', 'legacy-task', {
            startedAt: '2026-01-01T00:00:00.000Z',
        });
        const scope = {
            storageOriginId: 'gh_org_repo',
            legacyScopes: [{ workspaceId: 'ws-a', repoId: 'repo' }],
        };

        const pending = readPending(dataDir, 'ws-b', 'repo', '1', 'sha', scope);
        expect(pending?.processId).toBe('legacy-task');
        const originPaths = classificationPaths(dataDir, 'ws-b', 'repo', '1', 'sha', scope);
        expect(fs.existsSync(originPaths.pendingPath)).toBe(true);

        clearPending(dataDir, 'ws-b', 'repo', '1', 'sha', scope);
        expect(readPending(dataDir, 'ws-b', 'repo', '1', 'sha', scope)).toBeUndefined();
        expect(readPending(dataDir, 'ws-a', 'repo', '1', 'sha')).toBeUndefined();
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
            classifications: [{
                file: 'a',
                hunkIndex: -1,
                category: 'logic',
                intensity: 'high',
                reason: 'x',
                summaryComment: 'Changes logic.',
            }],
        });
        expect(v.ok).toBe(false);
    });

    it('accepts simple function hunks without rich review comments', () => {
        const v = validateClassificationResult({
            classifications: [{
                file: 'src/format.ts',
                hunkIndex: 0,
                category: 'simple',
                intensity: 'low',
                reason: 'Adds a deterministic string formatter',
            }],
        });
        expect(v.ok).toBe(true);
        if (v.ok) expect(v.classifications[0].category).toBe('simple');
    });

    it('requires testFidelityComment only for test hunks', () => {
        const missing = validateClassificationResult({
            classifications: [{ file: 'a.test.ts', hunkIndex: 0, category: 'test', intensity: 'low', reason: 'Adds a test' }],
        });
        expect(missing.ok).toBe(false);
        if (!missing.ok) expect(missing.error).toMatch(/testFidelityComment/);

        const present = validateClassificationResult({
            classifications: [{
                file: 'a.test.ts',
                hunkIndex: 0,
                category: 'test',
                intensity: 'low',
                reason: 'Adds a test',
                testFidelityComment: 'High fidelity: covers the real handler through its public API.',
            }],
        });
        expect(present.ok).toBe(true);
    });

    it('requires summaryComment for logic hunks', () => {
        const missing = validateClassificationResult({
            classifications: [{ file: 'src/a.ts', hunkIndex: 0, category: 'logic', intensity: 'low', reason: 'Changes behavior' }],
        });
        expect(missing.ok).toBe(false);
        if (!missing.ok) expect(missing.error).toMatch(/summaryComment/);

        const present = validateClassificationResult({
            classifications: [{
                file: 'src/a.ts',
                hunkIndex: 0,
                category: 'logic',
                intensity: 'low',
                reason: 'Changes behavior',
                summaryComment: 'The handler now returns cached data for warm requests.',
            }],
        });
        expect(present.ok).toBe(true);
    });

    it('preserves valid critical existing-function metadata', () => {
        const v = validateClassificationResult({
            classifications: [{
                file: 'src/routes.ts',
                hunkIndex: 0,
                category: 'logic',
                intensity: 'high',
                reason: 'Changes route behavior',
                summaryComment: 'The route now rejects unauthenticated writes before persistence.',
                critical: {
                    label: 'route handler',
                    impactSummary: 'Affects every write request to the route.',
                    usages: [{
                        file: 'src/server.ts',
                        symbol: 'registerRoutes',
                        line: 12,
                        description: 'Server startup registers the changed route.',
                    }],
                    callPath: [
                        { file: 'src/server.ts', symbol: 'startServer', line: 8 },
                        { file: 'src/routes.ts', symbol: 'POST /items', line: 34 },
                    ],
                },
            }],
        });
        expect(v.ok).toBe(true);
        if (v.ok) {
            expect(v.classifications[0].critical?.label).toBe('route handler');
            expect(v.classifications[0].critical?.usages).toHaveLength(1);
            expect(v.classifications[0].critical?.callPath).toHaveLength(2);
        }
    });

    it('rejects malformed critical metadata instead of dropping it', () => {
        const tooManyUsages = validateClassificationResult({
            classifications: [{
                file: 'src/a.ts',
                hunkIndex: 0,
                category: 'logic',
                intensity: 'high',
                reason: 'Changes exported behavior',
                summaryComment: 'The exported function now changes its return contract.',
                critical: {
                    label: 'exported API',
                    impactSummary: 'Callers observe a new return value.',
                    usages: [
                        { file: 'a.ts', description: 'caller 1' },
                        { file: 'b.ts', description: 'caller 2' },
                        { file: 'c.ts', description: 'caller 3' },
                        { file: 'd.ts', description: 'caller 4' },
                    ],
                    callPath: [{ file: 'a.ts', symbol: 'run' }],
                },
            }],
        });
        expect(tooManyUsages.ok).toBe(false);
        if (!tooManyUsages.ok) expect(tooManyUsages.error).toMatch(/at most 3/);

        const missingEvidenceNote = validateClassificationResult({
            classifications: [{
                file: 'src/a.ts',
                hunkIndex: 0,
                category: 'logic',
                intensity: 'high',
                reason: 'Changes exported behavior',
                summaryComment: 'The exported function now changes its return contract.',
                critical: {
                    label: 'exported API',
                    impactSummary: 'Callers observe a new return value.',
                    usages: [],
                    callPath: [{ file: 'a.ts', symbol: 'run' }],
                },
            }],
        });
        expect(missingEvidenceNote.ok).toBe(false);
        if (!missingEvidenceNote.ok) expect(missingEvidenceNote.error).toMatch(/usageNotDetermined/);
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

    it('prunes the canonical origin directory when a storage scope is supplied', () => {
        const scope = 'gh_owner_repo';
        writeClassification(dataDir, 'ws-clone', 'repo', 'old', 'sha', validResult, { storageScope: scope });
        const { resultPath } = classificationPaths(dataDir, 'ws-clone', 'repo', 'old', 'sha', scope);
        const ancient = Date.now() - 40 * 24 * 60 * 60 * 1000;
        fs.utimesSync(resultPath, ancient / 1000, ancient / 1000);

        // Pruning with only the workspace id misses the origin directory.
        expect(pruneStaleClassifications(dataDir, 'ws-clone', 30)).toBe(0);
        expect(fs.existsSync(resultPath)).toBe(true);

        // Supplying the origin scope targets the canonical directory.
        expect(pruneStaleClassifications(dataDir, 'ws-clone', 30, scope)).toBe(1);
        expect(fs.existsSync(resultPath)).toBe(false);
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
