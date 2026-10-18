/** Shell wiring checks complement the panel's rendered keep-alive/owner tests. */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
const react = path.join(__dirname, '../../../../src/server/spa/client/react');
const repo = fs.readFileSync(path.join(react, 'features/repo-detail/RepoDetail.tsx'), 'utf-8');
const group = fs.readFileSync(path.join(react, 'repos/RepoGroupView.tsx'), 'utf-8');

describe('workspace panel shell wiring', () => {
    it.each([['repo', repo], ['group', group]])('mounts one %s panel at every breakpoint without placement configuration', (_, source) => {
        expect(source.split('<UnifiedRightPanel').length - 1).toBe(1);
        expect(source).not.toContain('dockAvailable');
        expect(source).not.toContain('unifiedRightPanelEnabled');
        expect(source).toContain('<UnifiedPanelHostProvider host={unifiedPanelHost}>');
        expect(source).toContain('dock.isOpen && (isMobile || dockExpansion)');
    });
    it('keeps repo WI/PR screens out of page layout', () => {
        expect(repo).not.toContain('<WorkItemsTab');
        expect(repo).not.toContain('<PullRequestsTab');
    });
    it('preserves concrete clone routing into the repo panel', () => {
        const slot = repo.slice(repo.indexOf('<UnifiedRightPanel'));
        expect(slot).toContain('workspaceId={ws.id}');
        expect(slot).toContain('routingRef={explorerRoutingRef}');
    });
    it('keeps the panel beside mounted workspace content', () => {
        expect(repo.indexOf('<UnifiedRightPanel')).toBeGreaterThan(repo.indexOf('id="repo-sub-tab-content"'));
        expect(repo).toContain("style={dockExpanded ? { display: 'none' } : undefined}");
    });
    it('uses the same controller for header visibility and panel body', () => {
        expect(repo).toContain('const dock = useWorkspaceDock(ws.id);');
        expect(repo).toContain('const showHeaderDockControls = !chromeless;');
        expect(repo).toContain('<WorkspaceDockToggle workspaceId={ws.id} />');
    });
});
