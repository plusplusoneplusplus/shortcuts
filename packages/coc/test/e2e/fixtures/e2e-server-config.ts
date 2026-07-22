/**
 * Admin config the E2E server boots with.
 *
 * Kept as a standalone constant with no heavy imports (no Playwright, no
 * compiled server bundle) so it can be both consumed by the Playwright
 * server-fixture and asserted by a plain vitest unit test.
 *
 * - `showPlanDepTab: true` — many specs navigate the deprecated Plans/Tasks
 *   sub-tab, which is gated off by default.
 * - `features.remoteShell` / `features.splitWorkspacePanel` ship default-on in
 *   production, but they replace the whole repo shell (splitWorkspacePanel hides
 *   the standalone Git sub-tab and folds Activity into a split "Workspace" pane;
 *   remoteShell swaps the repo tab strip for the remote-first header and moves
 *   the status cluster into the sidebar footer). The existing E2E suite is
 *   written against the classic shell, so a resolved config with these on makes
 *   shared helpers (e.g. navigateToGitTab clicking
 *   `.repo-sub-tab[data-subtab="git"]`, or waiting on `ws-status-indicator`)
 *   hang until the test times out. Pin both off so the suite exercises the
 *   layout it targets.
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
    'showPlanDepTab: true\nfeatures:\n  remoteShell: false\n  scopeSwitcher: false\n  splitWorkspacePanel: false\n  commitChatLens: false\neffortLevels:\n  enabled: false\n';
