/**
 * Shared setup for the boundary suite.
 *
 * These tests exercise the real compiled addon, which is required rather than
 * optional: a missing or broken binary fails this module at import, so a
 * botched native build cannot be mistaken for a green run. There is no opt-out
 * that turns these suites into skips.
 */

import * as fs from 'fs';

import { loadNativeContentSearch } from '../src/content-search';
import type { NativeContentSearchAddon } from '../src/content-search';
import { loadNativeFileIndex } from '../src/file-index';
import type { NativeFileIndexAddon } from '../src/file-index';
import { loadNativeGit } from '../src/git';
import type { NativeGitAddon } from '../src/git';
import { resetNativeAddonCache } from '../src/loader';
import { loadNativeNotesIndex } from '../src/notes-index';
import type { NativeNotesIndexAddon } from '../src/notes-index';

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
