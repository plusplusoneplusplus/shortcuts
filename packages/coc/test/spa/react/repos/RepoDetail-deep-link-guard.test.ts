/**
 * Tests for the sub-tab visibility redirect guard in RepoDetail.
 *
 * The six per-feature ref-guard effects (prevTerminalEnabled, prevNotesEnabled,
 * …) were consolidated into a single visibility-based redirect. This verifies:
 * - A single redirect effect drives the active sub-tab back to 'chats' when the
 *   tab is no longer visible for the workspace's capability set.
 * - The redirect waits for git info to finish loading before acting (avoids the
 *   flaky reset during the async gitInfo load window).
 * - Visibility is decided via the isRepoSubTabVisible helper.
 * - Route memory lives separately in AppContext, so this display fallback does
 *   not erase a remembered deep route when a capability resolves later.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_DETAIL_SOURCE_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'repo-detail', 'RepoDetail.tsx'
);

describe('RepoDetail sub-tab visibility redirect guard', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(REPO_DETAIL_SOURCE_PATH, 'utf-8');
    });

    // ── Consolidated helper + redirect ───────────────────────────────────────

    it('defines the isRepoSubTabVisible helper', () => {
        expect(source).toContain('function isRepoSubTabVisible(');
    });

    it('redirect waits for git info to finish loading before acting', () => {
        expect(source).toContain('if (repo.gitInfoLoading) return;');
    });

    it('redirect skips when the active sub-tab is still visible', () => {
        expect(source).toContain('if (isRepoSubTabVisible(activeSubTab, visibleSubTabs)) return;');
    });

    it('redirect dispatches SET_REPO_SUB_TAB to chats when the tab is hidden', () => {
        const redirectBlock = source.slice(
            source.indexOf('if (isRepoSubTabVisible(activeSubTab, visibleSubTabs)) return;'),
            source.indexOf('if (isRepoSubTabVisible(activeSubTab, visibleSubTabs)) return;') + 200
        );
        expect(redirectBlock).toContain("dispatch({ type: 'SET_REPO_SUB_TAB', tab: 'chats' });");
    });

    // ── Old per-feature transition refs are gone ─────────────────────────────

    it('no longer uses per-feature transition refs', () => {
        expect(source).not.toContain('prevTerminalEnabled');
        expect(source).not.toContain('prevNotesEnabled');
        expect(source).not.toContain('prevWorkflowsEnabled');
        expect(source).not.toContain('prevPullRequestsEnabled');
        expect(source).not.toContain('prevDreamsEnabled');
        expect(source).not.toContain('prevNativeCliSessionsEnabled');
    });

    // ── Route memory decoupled from the display fallback ─────────────────────

    it('documents that route memory is kept separately in AppContext', () => {
        expect(source).toContain('Route memory is kept separately in AppContext');
    });
});
