/**
 * Source-grep assertions for the workspace right dock wiring in RepoDetail.
 *
 * The dock's own behavior (open/view/width, keep-alive, persistence, resize, the
 * self-toggle rail) is covered by the render test at
 * test/spa/react/workspace-right-dock/. Here we pin how RepoDetail gates and
 * mounts it:
 * - AC-01: the dock body AND the header toggle are gated behind the
 *   `splitWorkspacePanel` flag + desktop breakpoint (via `dockAvailable`), never
 *   unconditionally rendered.
 * - AC-04: exactly one header toggle button, in the header action cluster.
 * - AC-03: the dock is a sibling of the sub-tab content (outermost-right column),
 *   mounted regardless of which sub-tab is active, and hidden on mobile.
 * - Remote-shell reachability: the dock BODY renders even when chromeless (so the
 *   terminal stays reachable in the remote-first shell where the Terminal sub-tab
 *   is hidden), while the header button is suppressed there in favour of the
 *   dock's own `selfToggle` rail.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'RepoDetail.tsx'),
    'utf-8',
);

describe('Workspace dock — flag gating (AC-01)', () => {
    it('derives dock availability from the split flag and desktop breakpoint (chromeless included)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('const dockAvailable = splitWorkspacePanelEnabled && !isMobile;');
    });

    it('derives the header toggle only for the chrome header (non-chromeless)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('const showHeaderDockToggle = dockAvailable && !chromeless;');
    });

    it('gates the header toggle on showHeaderDockToggle and the dock body on dockAvailable', () => {
        // Toggle button
        expect(REPO_DETAIL_SOURCE).toContain("data-testid=\"workspace-dock-toggle\"");
        expect(REPO_DETAIL_SOURCE).toContain('{showHeaderDockToggle && (');
        // Dock body
        expect(REPO_DETAIL_SOURCE).toContain('{dockAvailable && <WorkspaceRightDock workspaceId={ws.id} dock={dock} />}');
    });

    it('never renders the dock body unconditionally', () => {
        // Every WorkspaceRightDock usage in the render is guarded by dockAvailable.
        const guarded = REPO_DETAIL_SOURCE.includes('{dockAvailable && <WorkspaceRightDock');
        const usages = REPO_DETAIL_SOURCE.split('<WorkspaceRightDock').length - 1;
        expect(guarded).toBe(true);
        expect(usages).toBe(1);
    });
});

describe('Workspace dock — remote-shell reachability (chromeless)', () => {
    it('does not gate the dock body on non-chromeless (renders in the remote-first shell)', () => {
        // Regression: previously `showDock` required `!chromeless`, so the dock never
        // rendered in the chromeless remote shell — leaving the terminal unreachable
        // once the Terminal sub-tab is hidden by the split-workspace flag. The body is
        // now gated on `dockAvailable` (no `!chromeless`); the remote shell's toggle
        // lives in the global TopBar (see WorkspaceTabsCluster/TopBar tests).
        expect(REPO_DETAIL_SOURCE).not.toContain('splitWorkspacePanelEnabled && !isMobile && !chromeless');
        expect(REPO_DETAIL_SOURCE).not.toContain('const showDock');
    });
});

describe('Workspace dock — header toggle (AC-04)', () => {
    it('has exactly one dock toggle control in the header', () => {
        const count = REPO_DETAIL_SOURCE.split('data-testid="workspace-dock-toggle"').length - 1;
        expect(count).toBe(1);
    });

    it('reflects open/closed state via aria-pressed on the toggle', () => {
        expect(REPO_DETAIL_SOURCE).toContain('aria-pressed={dock.isOpen}');
        expect(REPO_DETAIL_SOURCE).toContain('onClick={dock.toggleOpen}');
    });

    it('lives inside the header action cluster (top-right)', () => {
        const clusterIdx = REPO_DETAIL_SOURCE.indexOf('ref={overflowContainerRef}');
        const toggleIdx = REPO_DETAIL_SOURCE.indexOf('data-testid="workspace-dock-toggle"');
        expect(clusterIdx).toBeGreaterThan(-1);
        expect(toggleIdx).toBeGreaterThan(clusterIdx);
    });
});

describe('Workspace dock — shell placement (AC-03)', () => {
    it('shares one controller between the toggle and the dock body', () => {
        expect(REPO_DETAIL_SOURCE).toContain('const dock = useWorkspaceDock(ws.id);');
    });

    it('mounts the dock as a sibling of the sub-tab content (outermost-right column)', () => {
        const rowIdx = REPO_DETAIL_SOURCE.indexOf('flex flex-row flex-1 min-h-0 min-w-0 overflow-hidden');
        const contentIdx = REPO_DETAIL_SOURCE.indexOf('id="repo-sub-tab-content"');
        const dockIdx = REPO_DETAIL_SOURCE.indexOf('<WorkspaceRightDock');
        // Row wrapper opens before the content, and the dock renders after it.
        expect(rowIdx).toBeGreaterThan(-1);
        expect(contentIdx).toBeGreaterThan(rowIdx);
        expect(dockIdx).toBeGreaterThan(contentIdx);
    });

    it('imports the dock component and hook from WorkspaceRightDock', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { WorkspaceRightDock, useWorkspaceDock } from './WorkspaceRightDock';");
    });
});
