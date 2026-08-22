/**
 * Shared setup for the boundary suite.
 *
 * These tests exercise the real compiled addon. When no binary is present (a
 * machine without a Rust toolchain, or a CI job that skipped the native build)
 * they skip loudly rather than silently passing, so a broken build cannot look
 * like a green run.
 */

import { loadNativeFileIndex, nativeFileIndexStatus, resetNativeFileIndexCache } from '../src/loader';
import type { NativeFileIndexAddon } from '../src/types';

resetNativeFileIndexCache();

export const addon: NativeFileIndexAddon | null = loadNativeFileIndex();

if (!addon) {
    // eslint-disable-next-line no-console
    console.warn(
        `[coc-native] SKIPPING boundary tests — addon not loaded: ${nativeFileIndexStatus().reason}. ` +
            'Run `npm run build:native -w packages/coc-native` to build it.',
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
