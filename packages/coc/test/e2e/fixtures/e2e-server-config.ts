/**
 * Admin config the E2E server boots with.
 *
 * Kept as a standalone constant with no heavy imports (no Playwright, no
 * compiled server bundle) so it can be both consumed by the Playwright
 * server-fixture and asserted by a plain vitest unit test.
 *
 * - `showPlanDepTab: true` — many specs navigate the deprecated Plans/Tasks
 *   sub-tab, which is gated off by default.
 * - `features.scopeSwitcher` also ships default-on; it swaps the My Work / My
 *   Life toggles and the workspace identity chip for a sliding segmented switcher
 *   in the remote-first header. Pin it off so the header stays what the specs target.
 * - `features.commitChatLens` also ships default-on, and it reroutes unpinned
 *   commit/PR review chat into a bottom-right lens instead of the inline
 *   `commit-chat-panel`. commit-chat-binding.spec.ts opens unpinned commit chat
 *   via `toggle-chat-btn` and asserts the classic panel, so it hangs with the
 *   lens on. Pin it off here; commit-chat-lens.spec.ts re-enables it per-test
 *   through the live admin API.
 * - `effortLevels.enabled` graduated to default-on, but it swaps the model
 *   picker + reasoning-effort controls in every composer for a single effort-tier
 *   selector. The AI-action dialogs (ai-actions.spec.ts) and the commit-chat lens
 *   composer (commit-chat-lens.spec.ts) assert the classic `*-model-picker-chip` /
 *   `compact-ai-settings-model-control`, which disappear in tier mode, and the
 *   enqueued tasks then carry a resolved tier model instead of the picker default.
 *   Pin it off so the suite exercises the model-picker UI it targets.
 */
export const E2E_SERVER_CONFIG_YAML =
    'showPlanDepTab: true\nfeatures:\n  scopeSwitcher: false\n  commitChatLens: false\neffortLevels:\n  enabled: false\n';
