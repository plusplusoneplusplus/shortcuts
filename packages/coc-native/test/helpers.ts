/**
 * Shared setup for the boundary suite.
 *
 * These tests exercise the real compiled addon, which is required rather than
 * optional: a missing or broken binary fails this module at import, so a
 * botched native build cannot be mistaken for a green run. There is no opt-out
 * that turns these suites into skips.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { loadNativeContentSearch } from '../src/content-search';
import type { NativeContentSearchAddon } from '../src/content-search';
import { loadNativeFileIndex } from '../src/file-index';
import type { NativeFileIndexAddon } from '../src/file-index';
import { loadNativeGit } from '../src/git';
import type { NativeGitAddon } from '../src/git';
import { resetNativeAddonCache } from '../src/loader';
import { loadNativeNotesFs } from '../src/notes-fs';
import type { NativeNotesFsAddon } from '../src/notes-fs';
import { loadNativeNotesIndex } from '../src/notes-index';
import type { NativeNotesIndexAddon } from '../src/notes-index';
import { loadNativeSymbolIndex } from '../src/symbol-index';
import type { NativeSymbolIndexAddon } from '../src/symbol-index';

resetNativeAddonCache();

// Deliberately unguarded: loadNativeFileIndex() throws when a binary could not
// be loaded, and that error — naming the triple, the paths tried and the fix —
// is exactly what the runner should print.
export const addon: NativeFileIndexAddon = loadNativeFileIndex();

/** The required content-search slice of the same compiled addon. */
export const contentSearchAddon: NativeContentSearchAddon = loadNativeContentSearch();

/** The required git slice of the same compiled addon. */
export const gitAddon: NativeGitAddon = loadNativeGit();

/** The required Notes-index slice of the same compiled addon. */
export const notesAddon: NativeNotesIndexAddon = loadNativeNotesIndex();

/** The required Notes-filesystem slice of the same compiled addon. */
export const notesFsAddon: NativeNotesFsAddon = loadNativeNotesFs();

/** The required persistent symbol-index slice of the same compiled addon. */
export const symbolIndexAddon: NativeSymbolIndexAddon = loadNativeSymbolIndex();

/**
 * Remove a temp directory, best effort.
 *
 * These suites hand real repositories to git and to the addon, and on Windows
 * the handles that keeps open — a just-exited child's, or a pack file gix
 * mapped — can outlive the call that opened them. The delete then fails with
 * EPERM, and because this runs from `afterAll` it fails the whole suite: 293
 * passing tests reported as red because a temp directory would not go away.
 *
 * So retry, then give up quietly. Every caller is tearing down a directory
 * under the OS temp root, where the one cost of leaving it behind is the disk
 * the OS reclaims on its own. Nothing here asserts on the delete, and the one
 * delete this suite does depend on — `index.lock`, which every later git
 * command in the repository trips over — deliberately does not come through
 * here.
 */
export function removeDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch {
        // Reclaimed with the temp root; never worth a red suite.
    }
}

/** Deterministic PRNG, so a parity failure reproduces from the seed alone. */
export function makeRandom(seed: number): () => number {
    let state = seed >>> 0 || 1;
    return () => {
        // xorshift32
        state ^= state << 13;
        state >>>= 0;
        state ^= state >>> 17;
        state ^= state << 5;
        state >>>= 0;
        return state / 0x100000000;
    };
}

/**
 * The `codex-file-diff-*` directories `diff_no_index` creates under the system
 * temp root, by entry name.
 */
export function diffTempDirs(): string[] {
    return fs.readdirSync(os.tmpdir()).filter(entry => entry.startsWith('codex-file-diff-'));
}

/**
 * The directories that appeared since `before` and are still there.
 *
 * The system temp root is shared — with the other vitest workers, and with
 * everything else on the machine — so "its contents are unchanged" is not a
 * property of the code under test and fails at random when another worker has
 * a diff in flight. What is a property of the code under test: whatever it
 * created is gone when it returns. So diff against the snapshot and wait out
 * the entries that drain on their own; a real leak never drains and comes back
 * named.
 */
export async function leakedDiffTempDirs(before: string[], timeoutMs = 5000): Promise<string[]> {
    const known = new Set(before);
    let extra = diffTempDirs().filter(entry => !known.has(entry));
    const deadline = Date.now() + timeoutMs;
    while (extra.length > 0 && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
        extra = extra.filter(entry => fs.existsSync(path.join(os.tmpdir(), entry)));
    }
    return extra;
}
