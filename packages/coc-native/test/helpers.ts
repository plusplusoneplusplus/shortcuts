/**
 * Shared setup for the boundary suite.
 *
 * These tests exercise the real compiled addon, which is required rather than
 * optional: a missing or broken binary fails this module at import, so a
 * botched native build cannot be mistaken for a green run.
 *
 * `COC_NATIVE=0` is the one case that skips instead. That is an operator
 * deliberately running without the addon, and there is then nothing for a
 * boundary test to exercise.
 */

import { loadNativeFileIndex } from '../src/file-index';
import type { NativeFileIndexAddon } from '../src/file-index';
import { resetNativeAddonCache } from '../src/loader';
import { loadNativeNotesIndex } from '../src/notes-index';
import type { NativeNotesIndexAddon } from '../src/notes-index';

resetNativeAddonCache();

/** True when the addon was deliberately turned off for this run. */
export const disabled = process.env.COC_NATIVE === '0';

// Deliberately unguarded: loadNativeFileIndex() throws when a binary was
// expected and could not be loaded, and that error — naming the triple, the
// paths tried and the fix — is exactly what the runner should print.
export const addon: NativeFileIndexAddon | null = loadNativeFileIndex();

/** The required Notes-index slice of the same compiled addon. */
export const notesAddon: NativeNotesIndexAddon | null = disabled ? null : loadNativeNotesIndex();

if (disabled) {
    // eslint-disable-next-line no-console
    console.warn(
        '[coc-native] SKIPPING native boundary tests — COC_NATIVE=0 disables the addon. ' +
            'Unset it to exercise the real binary.',
    );
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
