/**
 * Shared model for the virtual-workspace shell header (My Work / My Life).
 *
 * Virtual workspaces have no real repo / git context, so they can't flow through
 * `RemoteScopeCluster` / `WorkspaceTabsCluster` (which assume a `RepoData` with
 * git info, clone grouping, remote/PR/WI links, unseen counts, …). Instead they
 * describe themselves with this lightweight config, rendered by
 * `VirtualWorkspaceShellHeader` (remote-first desktop TopBar) and
 * `VirtualWorkspaceInlineHeader` (classic shell / mobile, in the view body).
 */
import type { RepoSubTab } from '../../types/dashboard';

export interface VirtualWorkspaceHeaderTab {
    key: RepoSubTab;
    label: string;
    shortcut?: string;
}

export interface VirtualWorkspaceHeaderAction {
    /** Stable key used to track which action is currently running. */
    key: string;
    /** `data-testid` for the button (kept stable across both header variants). */
    testId: string;
    title: string;
    idleLabel: string;
    busyLabel: string;
    /** Prefix for the status line shown when the action throws. */
    errorLabel: string;
    /**
     * Runs the action. Resolves to a status message to display, or `null` for no
     * message. May perform side effects (e.g. navigate to a generated note).
     */
    run: () => Promise<string | null>;
}

export interface VirtualWorkspaceHeaderConfig {
    workspaceId: string;
    /** Leading glyph shown in the identity chip. */
    icon: string;
    label: string;
    /** Prefix for the header / tab / status test ids (e.g. `my-work`). */
    testIdPrefix: string;
    tabs: VirtualWorkspaceHeaderTab[];
    actions: VirtualWorkspaceHeaderAction[];
}
