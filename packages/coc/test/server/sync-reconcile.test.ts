/**
 * Sync Reconcile Primitive Tests
 *
 * Covers the detection layer the initial-reconcile phase is built on: marker
 * location/round-trip, the "collapse to null" tolerance rules, unrelated-history
 * error matching, the reconcile predicate, and the notes-tree emptiness walk.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    RECONCILE_MARKER_NAME,
    RECONCILE_MARKER_VERSION,
    reconcileMarkerPath,
    readReconcileMarker,
    writeReconcileMarker,
    isUnrelatedHistoriesError,
    shouldReconcile,
    isNotesTreeNonEmpty,
    type ReconcileMarker,
} from '../../src/server/sync/sync-reconcile';

const SAMPLE: ReconcileMarker = {
    version: RECONCILE_MARKER_VERSION,
    mergedCommit: '0123456789abcdef0123456789abcdef01234567',
    reconciledAt: '2026-07-16T12:00:00.000Z',
};

// ── Marker path ──────────────────────────────────────────────────────────────

describe('reconcileMarkerPath', () => {
    it('resolves inside the sync repo .git directory', () => {
        const repo = path.join('some', 'sync', 'my-life');
        expect(reconcileMarkerPath(repo)).toBe(path.join(repo, '.git', RECONCILE_MARKER_NAME));
    });

    it('keeps the marker out of the working tree so it is never committed', () => {
        const repo = path.join('some', 'sync', 'my-life');
        const rel = path.relative(repo, reconcileMarkerPath(repo));
        // Anything git would add lives outside .git; the marker must be under it.
        expect(rel.split(path.sep)[0]).toBe('.git');
    });
});

// ── Marker read/write ────────────────────────────────────────────────────────

describe('reconcile marker read/write', () => {
    let repoDir: string;

    beforeEach(() => {
        repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-reconcile-'));
    });

    afterEach(() => {
        fs.rmSync(repoDir, { recursive: true, force: true });
    });

    it('round-trips a marker', async () => {
        await writeReconcileMarker(repoDir, SAMPLE);
        expect(await readReconcileMarker(repoDir)).toEqual(SAMPLE);
    });

    it('creates the .git directory when writing', async () => {
        expect(fs.existsSync(path.join(repoDir, '.git'))).toBe(false);
        await writeReconcileMarker(repoDir, SAMPLE);
        expect(fs.existsSync(reconcileMarkerPath(repoDir))).toBe(true);
    });

    it('overwrites an existing marker', async () => {
        await writeReconcileMarker(repoDir, SAMPLE);
        const next = { ...SAMPLE, mergedCommit: 'f'.repeat(40), reconciledAt: '2026-07-17T09:30:00.000Z' };
        await writeReconcileMarker(repoDir, next);
        expect(await readReconcileMarker(repoDir)).toEqual(next);
    });

    it('leaves no temp file behind', async () => {
        await writeReconcileMarker(repoDir, SAMPLE);
        const files = fs.readdirSync(path.join(repoDir, '.git'));
        expect(files).toEqual([RECONCILE_MARKER_NAME]);
    });

    it('returns null when the marker is absent', async () => {
        expect(await readReconcileMarker(repoDir)).toBeNull();
    });

    it('returns null when the sync repo itself does not exist', async () => {
        expect(await readReconcileMarker(path.join(repoDir, 'nope'))).toBeNull();
    });

    it('returns null on corrupt JSON rather than throwing', async () => {
        await fs.promises.mkdir(path.join(repoDir, '.git'), { recursive: true });
        await fs.promises.writeFile(reconcileMarkerPath(repoDir), '{"version": 1, "mergedCo');
        expect(await readReconcileMarker(repoDir)).toBeNull();
    });

    it.each([
        ['missing mergedCommit', { version: 1, reconciledAt: SAMPLE.reconciledAt }],
        ['missing reconciledAt', { version: 1, mergedCommit: SAMPLE.mergedCommit }],
        ['missing version', { mergedCommit: SAMPLE.mergedCommit, reconciledAt: SAMPLE.reconciledAt }],
        ['empty mergedCommit', { ...SAMPLE, mergedCommit: '' }],
        ['empty reconciledAt', { ...SAMPLE, reconciledAt: '' }],
        ['wrong-typed version', { ...SAMPLE, version: '1' }],
        ['a JSON array', []],
        ['JSON null', null],
    ])('returns null for a marker with %s', async (_label, payload) => {
        await fs.promises.mkdir(path.join(repoDir, '.git'), { recursive: true });
        await fs.promises.writeFile(reconcileMarkerPath(repoDir), JSON.stringify(payload));
        expect(await readReconcileMarker(repoDir)).toBeNull();
    });

    it('treats an untrusted marker as absent, so reconcile re-runs and deletes stay guarded', async () => {
        await fs.promises.mkdir(path.join(repoDir, '.git'), { recursive: true });
        await fs.promises.writeFile(reconcileMarkerPath(repoDir), 'not json at all');

        const marker = await readReconcileMarker(repoDir);
        expect(shouldReconcile({
            markerPresent: marker !== null,
            localTreeNonEmpty: true,
            remoteHasCommits: true,
        })).toBe(true);
    });
});

// ── Unrelated histories detection ────────────────────────────────────────────

describe('isUnrelatedHistoriesError', () => {
    it('matches the real git failure message', () => {
        expect(isUnrelatedHistoriesError('fatal: refusing to merge unrelated histories')).toBe(true);
    });

    it('matches when embedded in a wrapped Error message with surrounding output', () => {
        const message = [
            'Command failed: git pull --no-rebase origin HEAD',
            'fatal: refusing to merge unrelated histories',
            '',
        ].join('\n');
        expect(isUnrelatedHistoriesError(message)).toBe(true);
    });

    it('is case-insensitive', () => {
        expect(isUnrelatedHistoriesError('FATAL: Refusing To Merge Unrelated Histories')).toBe(true);
    });

    it.each([
        ['a merge conflict', 'CONFLICT (content): Merge conflict in b.md'],
        ['a missing remote ref', "fatal: couldn't find remote ref HEAD"],
        ['an auth failure', 'fatal: Authentication failed for origin'],
        ['an empty message', ''],
    ])('does not match %s', (_label, message) => {
        expect(isUnrelatedHistoriesError(message)).toBe(false);
    });
});

// ── shouldReconcile ──────────────────────────────────────────────────────────

describe('shouldReconcile', () => {
    it('enters reconcile with no marker, a non-empty local tree, and a remote with commits', () => {
        expect(shouldReconcile({ markerPresent: false, localTreeNonEmpty: true, remoteHasCommits: true })).toBe(true);
    });

    it('skips reconcile once the marker exists (runs exactly once)', () => {
        expect(shouldReconcile({ markerPresent: true, localTreeNonEmpty: true, remoteHasCommits: true })).toBe(false);
    });

    it('skips reconcile when the local tree is empty (nothing to union in)', () => {
        expect(shouldReconcile({ markerPresent: false, localTreeNonEmpty: false, remoteHasCommits: true })).toBe(false);
    });

    it('skips reconcile against an empty remote (normal first push is correct)', () => {
        expect(shouldReconcile({ markerPresent: false, localTreeNonEmpty: true, remoteHasCommits: false })).toBe(false);
    });

    it('requires all three conditions', () => {
        for (const markerPresent of [true, false]) {
            for (const localTreeNonEmpty of [true, false]) {
                for (const remoteHasCommits of [true, false]) {
                    const expected = !markerPresent && localTreeNonEmpty && remoteHasCommits;
                    expect(shouldReconcile({ markerPresent, localTreeNonEmpty, remoteHasCommits })).toBe(expected);
                }
            }
        }
    });
});

// ── isNotesTreeNonEmpty ──────────────────────────────────────────────────────

describe('isNotesTreeNonEmpty', () => {
    let dir: string;
    const IGNORE: ReadonlySet<string> = new Set(['.git', '.lock']);

    const write = (rel: string, content = 'x') => {
        const p = path.join(dir, rel);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-notes-tree-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('is false for a missing directory', async () => {
        expect(await isNotesTreeNonEmpty(path.join(dir, 'nope'), IGNORE)).toBe(false);
    });

    it('is false for an empty directory', async () => {
        expect(await isNotesTreeNonEmpty(dir, IGNORE)).toBe(false);
    });

    it('is true for a single top-level file', async () => {
        write('a.md');
        expect(await isNotesTreeNonEmpty(dir, IGNORE)).toBe(true);
    });

    it('is true for a file nested several levels deep', async () => {
        write(path.join('one', 'two', 'three', 'deep.md'));
        expect(await isNotesTreeNonEmpty(dir, IGNORE)).toBe(true);
    });

    it('is false when only ignored names are present', async () => {
        write(path.join('.git', 'HEAD'), 'ref: refs/heads/main\n');
        write('.lock', '1234');
        expect(await isNotesTreeNonEmpty(dir, IGNORE)).toBe(false);
    });

    it('is false for a tree of empty directories', async () => {
        fs.mkdirSync(path.join(dir, 'a', 'b', 'c'), { recursive: true });
        expect(await isNotesTreeNonEmpty(dir, IGNORE)).toBe(false);
    });

    it('finds a real note alongside ignored names', async () => {
        write(path.join('.git', 'HEAD'), 'ref: refs/heads/main\n');
        write(path.join('journal', 'today.md'));
        expect(await isNotesTreeNonEmpty(dir, IGNORE)).toBe(true);
    });

    it('counts an empty file as content', async () => {
        write('empty.md', '');
        expect(await isNotesTreeNonEmpty(dir, IGNORE)).toBe(true);
    });

    it('treats every name as syncable when no ignore set is given', async () => {
        write(path.join('.git', 'HEAD'), 'ref: refs/heads/main\n');
        expect(await isNotesTreeNonEmpty(dir)).toBe(true);
    });
});
