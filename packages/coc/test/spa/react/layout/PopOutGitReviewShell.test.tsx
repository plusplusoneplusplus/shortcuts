/**
 * Tests for PopOutGitReviewShell — structure and route parsing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    parsePopOutGitReviewRoute,
} from '../../../../src/server/spa/client/react/layout/PopOutGitReviewShell';

const LAYOUT_DIR = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'layout'
);
const SOURCE = fs.readFileSync(path.join(LAYOUT_DIR, 'PopOutGitReviewShell.tsx'), 'utf-8');

// ── Route parsing ─────────────────────────────────────────────────────────────

describe('parsePopOutGitReviewRoute', () => {
    it('parses commit review route', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/abc123',
            '?workspace=ws1'
        );
        expect(result).toEqual({
            workspaceId: 'ws1',
            reviewType: 'commit',
            commitHash: 'abc123',
        });
    });

    it('parses branch-range review route', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/branch-range',
            '?workspace=ws1'
        );
        expect(result).toEqual({
            workspaceId: 'ws1',
            reviewType: 'branch-range',
        });
    });

    it('decodes URI-encoded commit hash', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/abc%2F123',
            '?workspace=ws1'
        );
        expect(result).not.toBeNull();
        expect(result!.commitHash).toBe('abc/123');
    });

    it('returns null for invalid hash prefix', () => {
        expect(parsePopOutGitReviewRoute('#popout/activity/123', '?workspace=ws1')).toBeNull();
        expect(parsePopOutGitReviewRoute('#other', '?workspace=ws1')).toBeNull();
    });

    it('returns null when workspace is missing', () => {
        expect(parsePopOutGitReviewRoute('#popout/git-review/abc123', '')).toBeNull();
    });

    it('returns null when no commit hash or type is specified', () => {
        expect(parsePopOutGitReviewRoute('#popout/git-review', '?workspace=ws1')).toBeNull();
    });

    it('parses PR review route', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/pr/42',
            '?workspace=ws1&repo=myrepo'
        );
        expect(result).toEqual({
            workspaceId: 'ws1',
            reviewType: 'pr',
            prId: '42',
            repoId: 'myrepo',
        });
    });

    it('parses PR route with URI-encoded prId', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/pr/some%2Fpr',
            '?workspace=ws1&repo=r1'
        );
        expect(result).not.toBeNull();
        expect(result!.prId).toBe('some/pr');
        expect(result!.repoId).toBe('r1');
    });

    it('PR route defaults repoId to workspaceId when repo param missing', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/pr/99',
            '?workspace=ws1'
        );
        expect(result).toEqual({
            workspaceId: 'ws1',
            reviewType: 'pr',
            prId: '99',
            repoId: 'ws1',
        });
    });

    it('returns null for PR route without prId', () => {
        expect(parsePopOutGitReviewRoute('#popout/git-review/pr', '?workspace=ws1')).toBeNull();
    });

    it('returns null for hash with only popout prefix', () => {
        expect(parsePopOutGitReviewRoute('#popout', '?workspace=ws1')).toBeNull();
    });
});

// ── Source structure tests ─────────────────────────────────────────────────────

describe('PopOutGitReviewShell: structure', () => {
    it('exports PopOutGitReviewShell component', () => {
        expect(SOURCE).toContain('export function PopOutGitReviewShell');
    });

    it('exports parsePopOutGitReviewRoute helper', () => {
        expect(SOURCE).toContain('export function parsePopOutGitReviewRoute');
    });

    it('exports PopOutGitReviewParams type', () => {
        expect(SOURCE).toContain('export interface PopOutGitReviewParams');
    });
});

describe('PopOutGitReviewShell: providers', () => {
    it('wraps with AppProvider', () => {
        expect(SOURCE).toContain('<AppProvider>');
    });

    it('wraps with QueueProvider', () => {
        expect(SOURCE).toContain('<QueueProvider>');
    });

    it('wraps with ThemeProvider', () => {
        expect(SOURCE).toContain('<ThemeProvider>');
    });

    it('wraps with ToastProvider', () => {
        expect(SOURCE).toContain('<ToastProvider');
    });
});

describe('PopOutGitReviewShell: content components', () => {
    it('renders CommitDetail for commit reviews', () => {
        expect(SOURCE).toContain('<CommitDetail');
    });

    it('renders BranchRangeOverview for branch-range reviews', () => {
        expect(SOURCE).toContain('<BranchRangeOverview');
    });

    it('renders PrReviewContent for PR reviews', () => {
        expect(SOURCE).toContain('<PrReviewContent');
    });

    it('uses createPrDiffSource for PR file diffs', () => {
        expect(SOURCE).toContain('createPrDiffSource');
    });
});

describe('PopOutGitReviewShell: typed client loading', () => {
    it('loads git review data through the shared SPA CoC client', () => {
        expect(SOURCE).toContain('getSpaCocClient');
        expect(SOURCE).toContain('.git.getCommit');
        expect(SOURCE).toContain('.git.getBranchRange');
        expect(SOURCE).toContain('.git.listBranchRangeFiles');
    });

    it('does not own git endpoint strings for shell data loading', () => {
        expect(SOURCE).not.toContain('/git/branch-range/files');
        expect(SOURCE).not.toContain('/git/commits/${encodeURIComponent(commitHash)}');
    });
});

describe('PopOutGitReviewShell: BroadcastChannel communication', () => {
    it('uses useGitReviewPopOutChannel hook', () => {
        expect(SOURCE).toContain('useGitReviewPopOutChannel');
    });

    it('sends git-review-popout-opened on mount', () => {
        expect(SOURCE).toContain("'git-review-popout-opened'");
    });

    it('sends git-review-popout-closed on beforeunload', () => {
        expect(SOURCE).toContain("'git-review-popout-closed'");
        expect(SOURCE).toContain("'beforeunload'");
    });

    it('closes window on git-review-popout-restore message', () => {
        expect(SOURCE).toContain("'git-review-popout-restore'");
        expect(SOURCE).toContain("window.close()");
    });
});

describe('PopOutGitReviewShell: route parsing in shell', () => {
    it('reads workspaceId from URLSearchParams', () => {
        expect(SOURCE).toContain("URLSearchParams");
        expect(SOURCE).toContain("'workspace'");
    });

    it('renders invalid URL message for unknown routes', () => {
        expect(SOURCE).toContain("Invalid pop-out URL");
    });
});

describe('PopOutGitReviewShell: data-testid', () => {
    it('has data-testid for the shell container', () => {
        expect(SOURCE).toContain('data-testid="popout-git-review-shell"');
    });

    it('has data-testid for the title', () => {
        expect(SOURCE).toContain('data-testid="popout-git-review-title"');
    });
});
