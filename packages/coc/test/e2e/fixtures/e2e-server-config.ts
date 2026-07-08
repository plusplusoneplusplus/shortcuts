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
 */
export const E2E_SERVER_CONFIG_YAML =
    'showPlanDepTab: true\nfeatures:\n  remoteShell: false\n  splitWorkspacePanel: false\n';
