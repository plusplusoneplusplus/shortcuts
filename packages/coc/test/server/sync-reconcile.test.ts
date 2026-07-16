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
    isDecodableText,
    localVariantPath,
    planUnionMerge,
    type ReconcileMarker,
    type MergeOutcome,
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

// ── isDecodableText ──────────────────────────────────────────────────────────

describe('isDecodableText', () => {
    it.each([
        ['plain ascii notes', Buffer.from('# Today\n- ship the thing\n')],
        ['an empty file', Buffer.alloc(0)],
        ['multi-byte UTF-8', Buffer.from('café — 日本語 🎉', 'utf8')],
    ])('accepts %s', (_label, buf) => {
        expect(isDecodableText(buf)).toBe(true);
    });

    it('rejects a buffer containing a NUL byte', () => {
        expect(isDecodableText(Buffer.from([0x68, 0x69, 0x00, 0x21]))).toBe(false);
    });

    it('rejects invalid UTF-8 that decoding would corrupt', () => {
        // 0xC3 starts a 2-byte sequence; 0x28 is not a valid continuation byte.
        expect(isDecodableText(Buffer.from([0xc3, 0x28]))).toBe(false);
    });

    it('rejects a PNG header (binary with an early NUL)', () => {
        expect(isDecodableText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]))).toBe(false);
    });
});

// ── localVariantPath ─────────────────────────────────────────────────────────

describe('localVariantPath', () => {
    it.each([
        ['a simple extension', 'diagram.png', 'diagram.local.png'],
        ['a nested path', 'notes/img/photo.jpg', 'notes/img/photo.local.jpg'],
        ['no extension', 'README', 'README.local'],
        ['a double extension (only the last counts)', 'archive.tar.gz', 'archive.tar.local.gz'],
        ['a dotfile', '.gitignore', '.gitignore.local'],
    ])('parks %s as <name>.local<ext>', (_label, input, expected) => {
        expect(localVariantPath(input)).toBe(expected);
    });

    it('keeps the remote version at the original path', () => {
        expect(localVariantPath('b.png')).not.toBe('b.png');
    });

    it('numbers the variant rather than overwriting a real file of that name', () => {
        expect(localVariantPath('b.png', new Set(['b.png', 'b.local.png']))).toBe('b.local-2.png');
    });

    it('keeps numbering past several taken names', () => {
        const taken = new Set(['b.local.png', 'b.local-2.png', 'b.local-3.png']);
        expect(localVariantPath('b.png', taken)).toBe('b.local-4.png');
    });
});

// ── planUnionMerge ───────────────────────────────────────────────────────────

describe('planUnionMerge', () => {
    const tree = (files: Record<string, string | Buffer>): Map<string, Buffer> =>
        new Map(Object.entries(files).map(([p, c]) => [p, Buffer.isBuffer(c) ? c : Buffer.from(c)]));

    const outcomeOf = (plan: ReturnType<typeof planUnionMerge>, p: string): MergeOutcome | undefined =>
        plan.entries.find(e => e.path === p)?.outcome;

    const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);
    const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x02]);

    it('adds a local-only file', () => {
        const plan = planUnionMerge(tree({ 'a.md': 'A' }), tree({}));
        expect(outcomeOf(plan, 'a.md')).toBe('addedFromLocal');
    });

    it('keeps a remote-only file — the mirror-delete bug this fixes', () => {
        const plan = planUnionMerge(tree({}), tree({ 'd.md': 'D' }));
        expect(outcomeOf(plan, 'd.md')).toBe('keptFromRemote');
    });

    it('treats byte-identical files as a no-op', () => {
        const plan = planUnionMerge(tree({ 'a.md': 'same' }), tree({ 'a.md': 'same' }));
        expect(outcomeOf(plan, 'a.md')).toBe('identical');
        expect(plan.combined).toEqual([]);
    });

    it('marks differing text on both sides for combining', () => {
        const plan = planUnionMerge(tree({ 'b.md': 'mine' }), tree({ 'b.md': 'theirs' }));
        expect(outcomeOf(plan, 'b.md')).toBe('combined');
        expect(plan.combined).toEqual(['b.md']);
    });

    it('never deletes: every path from either side survives the plan', () => {
        const plan = planUnionMerge(
            tree({ 'a.md': 'A', 'b.md': 'B-local', 'c.md': 'C' }),
            tree({ 'b.md': 'B-remote', 'd.md': 'D', 'e.md': 'E' }),
        );
        expect(plan.entries.map(e => e.path)).toEqual(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']);
    });

    it('produces the north-star demo counts', () => {
        // Local A, B (edited), C  ×  remote B (different), D, E → 5 notes, B combined.
        const plan = planUnionMerge(
            tree({ 'a.md': 'A', 'b.md': 'B-local', 'c.md': 'C' }),
            tree({ 'b.md': 'B-remote', 'd.md': 'D', 'e.md': 'E' }),
        );
        expect(plan.counts).toEqual({
            'identical': 0,
            'addedFromLocal': 2,
            'keptFromRemote': 2,
            'combined': 1,
            'keptBothBinary': 0,
        });
        expect(plan.combined).toEqual(['b.md']);
        expect(plan.flagged).toEqual([]);
    });

    it('keeps both sides of a differing binary and flags it for review', () => {
        const plan = planUnionMerge(tree({ 'img.png': PNG_A }), tree({ 'img.png': PNG_B }));
        const entry = plan.entries.find(e => e.path === 'img.png');
        expect(entry?.outcome).toBe('keptBothBinary');
        // Remote keeps the original path; local is parked beside it.
        expect(entry?.localVariantPath).toBe('img.local.png');
        expect(plan.flagged).toEqual(['img.png']);
    });

    it('does not send a binary collision to the text conflict resolver', () => {
        const plan = planUnionMerge(tree({ 'img.png': PNG_A }), tree({ 'img.png': PNG_B }));
        expect(plan.combined).toEqual([]);
    });

    it('treats identical binaries as a no-op rather than keeping both', () => {
        const plan = planUnionMerge(tree({ 'img.png': PNG_A }), tree({ 'img.png': PNG_A }));
        expect(outcomeOf(plan, 'img.png')).toBe('identical');
        expect(plan.flagged).toEqual([]);
    });

    it('keeps both when only one side is binary', () => {
        const plan = planUnionMerge(tree({ 'note.md': 'text' }), tree({ 'note.md': PNG_A }));
        expect(outcomeOf(plan, 'note.md')).toBe('keptBothBinary');
    });

    it('dodges a real remote file when naming a binary variant', () => {
        const plan = planUnionMerge(
            tree({ 'img.png': PNG_A }),
            tree({ 'img.png': PNG_B, 'img.local.png': Buffer.from([0x01, 0x00]) }),
        );
        const entry = plan.entries.find(e => e.path === 'img.png');
        expect(entry?.localVariantPath).toBe('img.local-2.png');
        // ...and the pre-existing remote file is itself preserved, not clobbered.
        expect(outcomeOf(plan, 'img.local.png')).toBe('keptFromRemote');
    });

    it('gives two binary collisions distinct variant paths', () => {
        const plan = planUnionMerge(
            tree({ 'x/img.png': PNG_A, 'y/img.png': PNG_A }),
            tree({ 'x/img.png': PNG_B, 'y/img.png': PNG_B }),
        );
        const variants = plan.entries.filter(e => e.localVariantPath).map(e => e.localVariantPath);
        expect(variants).toEqual(['x/img.local.png', 'y/img.local.png']);
        expect(new Set(variants).size).toBe(2);
    });

    it('counts add up to the total number of paths', () => {
        const plan = planUnionMerge(
            tree({ 'a.md': 'A', 'same.md': 'S', 'b.md': 'mine', 'img.png': PNG_A }),
            tree({ 'same.md': 'S', 'b.md': 'theirs', 'img.png': PNG_B, 'd.md': 'D' }),
        );
        const total = Object.values(plan.counts).reduce((a, b) => a + b, 0);
        expect(total).toBe(plan.entries.length);
        expect(total).toBe(5);
    });

    it('is empty for two empty trees', () => {
        const plan = planUnionMerge(tree({}), tree({}));
        expect(plan.entries).toEqual([]);
        expect(plan.combined).toEqual([]);
        expect(plan.flagged).toEqual([]);
    });

    it('sorts entries so the same trees always plan the same way', () => {
        const plan = planUnionMerge(tree({ 'z.md': 'Z', 'a.md': 'A' }), tree({ 'm.md': 'M' }));
        expect(plan.entries.map(e => e.path)).toEqual(['a.md', 'm.md', 'z.md']);
    });

    it('is idempotent: re-planning an applied merge is a pure no-op', () => {
        // A reconcile that died before writing its marker re-runs against the tree
        // it already merged; nothing may be combined or flagged a second time.
        const merged = tree({ 'a.md': 'A', 'b.md': 'B-combined', 'c.md': 'C', 'd.md': 'D', 'e.md': 'E' });
        const plan = planUnionMerge(merged, merged);
        expect(plan.counts.identical).toBe(5);
        expect(plan.combined).toEqual([]);
        expect(plan.flagged).toEqual([]);
    });
});
