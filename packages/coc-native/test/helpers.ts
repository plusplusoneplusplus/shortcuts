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
 * Remove a temp directory, waiting out the handles Windows still holds.
 *
 * These suites hand real repositories to git and to the addon, and on Windows a
 * just-exited child's handle can outlive the call that spawned it — the delete
 * then fails with EPERM and takes a whole suite's `afterAll` with it. `rm -rf`
 * on the other two platforms does not need this, and retrying costs them
 * nothing.
 */
export function removeDir(dir: string): void {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
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
