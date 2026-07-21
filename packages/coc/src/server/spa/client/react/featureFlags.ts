/**
 * Compile-time feature flags.
 * Set to false to completely remove gated UI from the bundle.
 */

/** Enable the welcome modal, first-steps card, and feature tips. */
export const SHOW_WELCOME_TUTORIAL = true;

/** Enable the focused-diff classification UI on the PR Files Changed tab. */
export const SHOW_FOCUSED_DIFF = true;

/** Enable Excalidraw diagram rendering and tools in the chat UI. */
export const SHOW_EXCALIDRAW_DIAGRAMS = true;

/**
 * Route file-path link clicks inside a chat AI response to the docked,
 * read-only source-file canvas panel (carrying any `:line`/`:start-end` info)
 * instead of the floating `MarkdownReviewDialog`. Default ON. When OFF, chat
 * file refs fall back to the floating dialog. Non-chat surfaces (tasks tree,
 * notes) always use the floating dialog regardless of this flag.
 */
export const SHOW_SOURCE_CANVAS_FOR_CHAT_LINKS = true;

/**
 * Enable multi-loop Ralph sessions: "New Loop" button, loop dividers in the
 * workflow pane, and loop-count badge in the session row.
 * Disabled by default — in active development.
 */
export const RALPH_MULTI_LOOP = false;

/**
 * Enable Quick Ask side-notes on assistant chat turns: select text in an
 * assistant message → a floating ✨ Ask AI pill → a cheap one-shot AI lookup →
 * a clickable 💡 side-note bubble collected at the bottom of the message.
 * Side-questions never enter the main conversation thread.
 *
 * Disabled by default — in active development. Set to true to include the
 * selection pill, side-note bubbles, and popover in the bundle. The server
 * endpoints are additionally guarded by the admin `features.quickAskSidenotes`
 * flag.
 */
export const QUICK_ASK_SIDENOTES = false;

