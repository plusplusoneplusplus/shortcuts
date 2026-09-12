/**
 * Source-grep assertions for the workspace right dock wiring in RepoDetail.
 *
 * The dock's own behavior (open/view/width, keep-alive, persistence, resize, the
 * self-toggle rail) is covered by the render test at
 * test/spa/react/workspace-right-dock/. Here we pin how RepoDetail gates and
 * mounts it:
 * - AC-01: the panel body AND the header toggle are gated behind the
 *   `splitWorkspacePanel` flag + desktop breakpoint (via `dockAvailable`), never
 *   unconditionally rendered — and `dockAvailable` is the ONLY gate, since the
 *   unified panel is the one right panel and has no flag to switch against.
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

/**
 * The single `{dockAvailable && …}` render slot that mounts the right-side
 * panel. There is one panel component now, so the guard and the JSX inside it
 * are both pinned here.
 */
const DOCK_SLOT_GUARD = '{dockAvailable && (';

const REPO_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'RepoDetail.tsx'),
    'utf-8',
);

describe('Workspace dock — flag gating (AC-01)', () => {
    it('derives dock availability from the split flag and desktop breakpoint (chromeless included)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('const dockAvailable = splitWorkspacePanelEnabled && !isMobile;');
    });

    it('derives the header controls only for the chrome header (non-chromeless)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('const showHeaderDockControls = dockAvailable && !chromeless;');
    });

    it('gates the header controls on showHeaderDockControls and the panel body on dockAvailable', () => {
        expect(REPO_DETAIL_SOURCE).toContain('{showHeaderDockControls && (');
        expect(REPO_DETAIL_SOURCE).toContain('<WorkspaceDockToggle workspaceId={ws.id} />');
        // Panel body — exactly one `dockAvailable` slot.
        expect(REPO_DETAIL_SOURCE.split(DOCK_SLOT_GUARD).length - 1).toBe(1);
    });

    it('renders the unified panel unconditionally under the slot, with no flag branch', () => {
        // The panel is mounted exactly once and only from the dockAvailable slot:
        // no ternary, and no second right-side component to swap against.
        expect(REPO_DETAIL_SOURCE.split('<UnifiedRightPanel').length - 1).toBe(1);
        expect(REPO_DETAIL_SOURCE).not.toContain('unifiedRightPanelEnabled');
    });

    it('passes the selected clone route into the unified panel', () => {
        const dockIdx = REPO_DETAIL_SOURCE.indexOf('<UnifiedRightPanel');
        const dockEndIdx = REPO_DETAIL_SOURCE.indexOf('/>', dockIdx);
        const dockSource = REPO_DETAIL_SOURCE.slice(dockIdx, dockEndIdx);
        expect(dockSource).toContain('workspaceId={ws.id}');
        expect(dockSource).toContain('routingRef={explorerRoutingRef}');
    });

    it('remounts the Explorer when concrete clone ownership changes', () => {
        const explorerIdx = REPO_DETAIL_SOURCE.indexOf('<ExplorerPanel');
        const explorerEndIdx = REPO_DETAIL_SOURCE.indexOf('/>', explorerIdx);
        const explorerSource = REPO_DETAIL_SOURCE.slice(explorerIdx, explorerEndIdx);
        expect(explorerSource).toContain('key={sourceSelectionId}');
    });

    it('gates the unified panel host on dockAvailable alone', () => {
        expect(REPO_DETAIL_SOURCE).toContain('() => (dockAvailable ? { workspaceId: ws.id, chatId: panelChatId } : null),');
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

describe('Workspace dock — header toggle', () => {
    it('has exactly one panel toggle in the header', () => {
        const count = REPO_DETAIL_SOURCE.split('<WorkspaceDockToggle workspaceId={ws.id} />').length - 1;
        expect(count).toBe(1);
    });

    it('lives inside the header action cluster (top-right)', () => {
        const clusterIdx = REPO_DETAIL_SOURCE.indexOf('ref={overflowContainerRef}');
        const toggleIdx = REPO_DETAIL_SOURCE.indexOf('<WorkspaceDockToggle workspaceId={ws.id} />');
        expect(clusterIdx).toBeGreaterThan(-1);
        expect(toggleIdx).toBeGreaterThan(clusterIdx);
    });
});

describe('Workspace dock — shell placement (AC-03)', () => {
    it('shares one controller between the toggle and the dock body', () => {
        expect(REPO_DETAIL_SOURCE).toContain('const dock = useWorkspaceDock(ws.id);');
    });

    it('mounts the panel as a sibling of the sub-tab content (outermost-right column)', () => {
        const rowIdx = REPO_DETAIL_SOURCE.indexOf('flex flex-row flex-1 min-h-0 min-w-0 overflow-hidden');
        const contentIdx = REPO_DETAIL_SOURCE.indexOf('id="repo-sub-tab-content"');
        const dockIdx = REPO_DETAIL_SOURCE.indexOf('<UnifiedRightPanel');
        // Row wrapper opens before the content, and the dock renders after it.
        expect(rowIdx).toBeGreaterThan(-1);
        expect(contentIdx).toBeGreaterThan(rowIdx);
        expect(dockIdx).toBeGreaterThan(contentIdx);
    });

    it('imports only the state controller, never a second panel body', () => {
        expect(REPO_DETAIL_SOURCE).toContain("import { useWorkspaceDock } from './useWorkspaceDock';");
    });
});
