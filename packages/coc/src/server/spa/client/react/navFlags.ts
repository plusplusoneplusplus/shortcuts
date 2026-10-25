/**
 * Compile-time navigation tab flags.
 *
 * Kept in a dedicated module — separate from featureFlags.ts — so leaf modules
 * like repoSubTabs.ts can read them without pulling in the heavier TopBar module
 * and without tripping the many partial `featureFlags` mocks across the test
 * suite (which would otherwise throw on a missing flag export).
 */

/** Set to `true` to re-enable the topbar Memory icon. */
export const SHOW_MEMORY_TAB = false;
