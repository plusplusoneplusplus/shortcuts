/**
 * Compile-time feature flags.
 * Set to false to completely remove gated UI from the bundle.
 */

/** Enable the welcome modal, first-steps card, and feature tips. */
export const SHOW_WELCOME_TUTORIAL = true;

/** Set to `true` to re-enable the top-level Wiki tab in navigation. */
export const SHOW_WIKI_TAB = false;

/** Set to `true` to re-enable the topbar Memory icon. */
export const SHOW_MEMORY_TAB = false;

/** Enable the focused-diff classification UI on the PR Files Changed tab. */
export const SHOW_FOCUSED_DIFF = true;

/** Enable Excalidraw diagram rendering and tools in the chat UI. */
export const SHOW_EXCALIDRAW_DIAGRAMS = true;

/**
 * Enable multi-loop Ralph sessions: "New Loop" button, loop dividers in the
 * workflow pane, and loop-count badge in the session row.
 * Disabled by default — in active development.
 */
export const RALPH_MULTI_LOOP = false;
