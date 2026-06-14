/**
 * Tests for hiding the Git and Pull Requests tabs on non-git repos.
 *
 * Verifies that:
 * - BASE_VISIBLE_SUB_TABS includes git (module-level, static)
 * - visibleSubTabs inside the component filters git and pull-requests out when !isGitRepo
 * - Tab fallback redirects git/pull-requests → chats on non-git repos
 * - RepoGitTab is guarded by isGitRepo
 * - PullRequestsTab is guarded by isGitRepo
 * - Ahead/behind badge is only rendered inside the git tab button (which is absent for non-git repos)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { SUB_TABS, VISIBLE_SUB_TABS } from '../../../../src/server/spa/client/react/features/repo-detail/RepoDetail';

const REPO_DETAIL_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'RepoDetail.tsx'),
    'utf-8',
);

// Sub-tab visibility filtering lives in repoSubTabs.ts (shared with the
// remote-first shell); source assertions about the filters read from here.
const REPO_SUB_TABS_SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'repoSubTabs.ts'),
    'utf-8',
);

// ── 1. Git tab present in static BASE_VISIBLE_SUB_TABS (for git repos) ──────

describe('Git tab visible for git repos', () => {
    it('VISIBLE_SUB_TABS includes git', () => {
        expect(VISIBLE_SUB_TABS.find(t => t.key === 'git')).toBeDefined();
    });

    it('SUB_TABS includes git', () => {
        expect(SUB_TABS.find(t => t.key === 'git')).toBeDefined();
    });
});

// ── 2. Git tab hidden for non-git repos via isGitRepo filtering ─────────────

describe('Git tab hidden for non-git repos', () => {
    it('derives isGitRepo from repo.gitInfo', () => {
        expect(REPO_DETAIL_SOURCE).toContain('repo.gitInfo?.isGitRepo');
    });

    it('computes visibleSubTabs by filtering git when !isGitRepo', () => {
        // The shared helper filters VISIBLE_SUB_TABS based on isGitRepo
        expect(REPO_SUB_TABS_SOURCE).toContain('VISIBLE_SUB_TABS');
        expect(REPO_SUB_TABS_SOURCE).toContain("t.key !== 'git'");
    });

    it('filters out pull-requests tab for non-git repos', () => {
        expect(REPO_SUB_TABS_SOURCE).toContain("t.key !== 'pull-requests'");
    });

    it('uses visibleSubTabs (not VISIBLE_SUB_TABS) in the tab strip map', () => {
        expect(REPO_DETAIL_SOURCE).toContain('visibleSubTabs.map');
        // Should NOT use VISIBLE_SUB_TABS.map directly in the render
        expect(REPO_DETAIL_SOURCE).not.toContain('VISIBLE_SUB_TABS.map');
    });

    it('passes visibleSubTabs (not VISIBLE_SUB_TABS) to MobileTabBar', () => {
        expect(REPO_DETAIL_SOURCE).toContain('tabs={visibleSubTabs}');
        expect(REPO_DETAIL_SOURCE).not.toContain('tabs={VISIBLE_SUB_TABS}');
    });
});

// ── 3. Git tab hidden when gitInfo is undefined ─────────────────────────────

describe('Git tab hidden when gitInfo is undefined', () => {
    it('uses optional chaining on gitInfo so undefined is treated as non-git', () => {
        expect(REPO_DETAIL_SOURCE).toContain('repo.gitInfo?.isGitRepo');
    });

    it('isGitRepo is false-ish when gitInfo is undefined (double-bang coercion)', () => {
        expect(REPO_DETAIL_SOURCE).toContain('!!repo.gitInfo?.isGitRepo');
    });
});

// ── 4. Tab fallback on repo switch ──────────────────────────────────────────

describe('Tab fallback on repo switch', () => {
    it('has a useEffect that redirects git tab to chats for non-git repos', () => {
        // Should check activeSubTab === 'git' && !isGitRepo → dispatch chats
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'git'");
        expect(REPO_DETAIL_SOURCE).toContain('!isGitRepo');
        expect(REPO_DETAIL_SOURCE).toContain("tab: 'chats'");
    });

    it('redirects pull-requests tab to activity for non-git repos', () => {
        expect(REPO_DETAIL_SOURCE).toContain("activeSubTab === 'pull-requests'");
    });

    it('dispatches SET_REPO_SUB_TAB to redirect', () => {
        expect(REPO_DETAIL_SOURCE).toContain("type: 'SET_REPO_SUB_TAB'");
    });
});

// ── 5. RepoGitTab not mounted for non-git repos ────────────────────────────

describe('RepoGitTab not mounted for non-git repos', () => {
    it('guards RepoGitTab render with isGitRepo', () => {
        expect(REPO_DETAIL_SOURCE).toContain("isGitRepo && <div style={{ display: activeSubTab === 'git'");
    });
});

// ── 6. PullRequestsTab not mounted for non-git repos ────────────────────────

describe('PullRequestsTab not mounted for non-git repos', () => {
    it('guards PullRequestsTab render with isGitRepo', () => {
        expect(REPO_DETAIL_SOURCE).toContain("isGitRepo && <div style={{ display: activeSubTab === 'pull-requests'");
    });
});

// ── 7. Ahead/behind badge not shown for non-git repos ──────────────────────

describe('Ahead/behind badge scoped to git tab button', () => {
    it('badge is only rendered inside the tab map (which excludes git for non-git repos)', () => {
        // The git-ahead-behind-badge is rendered inside the visibleSubTabs.map callback,
        // specifically inside `t.key === 'git'` guard. Since the git tab is filtered out
        // of visibleSubTabs for non-git repos, the badge naturally doesn't render.
        const mapIdx = REPO_DETAIL_SOURCE.indexOf('visibleSubTabs.map');
        const badgeIdx = REPO_DETAIL_SOURCE.indexOf('git-ahead-behind-badge');
        expect(mapIdx).toBeGreaterThan(-1);
        expect(badgeIdx).toBeGreaterThan(mapIdx);
    });

    it('badge is gated by gitAhead/gitBehind > 0 check', () => {
        expect(REPO_DETAIL_SOURCE).toContain('gitAhead > 0 || gitBehind > 0');
    });
});
