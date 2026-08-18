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
const KERNEL_DIR = path.join(LAYOUT_DIR, 'popoutGitReview');
const SOURCE = fs.readFileSync(path.join(LAYOUT_DIR, 'PopOutGitReviewShell.tsx'), 'utf-8');

function kernelSource(file: string): string {
    return fs.readFileSync(path.join(KERNEL_DIR, file), 'utf-8');
}

const ROUTE_SOURCE = kernelSource('popoutGitReviewRoute.ts');
const LIFECYCLE_SOURCE = kernelSource('usePopOutReviewLifecycle.ts');
const COMMIT_SOURCE = kernelSource('CommitReviewContent.tsx');
const PR_SOURCE = kernelSource('PrReviewContent.tsx');
const BRANCH_SOURCE = kernelSource('BranchRangeReviewContent.tsx');

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
            baseMode: 'default-branch',
        });
    });

    it('parses the upstream base mode for branch-range routes', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/branch-range',
            '?workspace=ws1&base=upstream'
        );
        expect(result!.baseMode).toBe('upstream');
    });

    it('falls back to default-branch for an unknown base value', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/branch-range',
            '?workspace=ws1&base=bogus'
        );
        expect(result!.baseMode).toBe('default-branch');
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
            '?workspace=ws1&repo=myrepo&origin=gh_org_repo'
        );
        expect(result).toEqual({
            workspaceId: 'ws1',
            reviewType: 'pr',
            prId: '42',
            repoId: 'myrepo',
            originId: 'gh_org_repo',
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

    it('re-exports parsePopOutGitReviewRoute from the route module', () => {
        expect(SOURCE).toContain('export { parsePopOutGitReviewRoute }');
        expect(ROUTE_SOURCE).toContain('export function parsePopOutGitReviewRoute');
    });

    it('re-exports the PopOutGitReviewParams type from the route module', () => {
        expect(SOURCE).toContain('export type { PopOutGitReviewParams }');
        expect(ROUTE_SOURCE).toContain('export interface PopOutGitReviewParams');
    });

    it('keeps the shell free of per-review-type flow logic', () => {
        // Commit/PR/branch-range flows live in adapters under popoutGitReview/.
        expect(SOURCE).not.toContain('useClassification');
        expect(SOURCE).not.toContain('usePrReviewProgress');
        expect(SOURCE).not.toContain('FileDiffPanel');
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
        expect(SOURCE).toContain('<CommitReviewContent');
    });

    it('renders BranchRangeReviewContent for branch-range reviews', () => {
        expect(SOURCE).toContain('<BranchRangeReviewContent');
        expect(BRANCH_SOURCE).toContain('<BranchRangeOverview');
    });

    it('renders PrReviewContent for PR reviews', () => {
        expect(SOURCE).toContain('<PrReviewContent');
    });

    it('uses createPrDiffSource for PR file diffs', () => {
        expect(PR_SOURCE).toContain('createPrDiffSource');
    });
});

describe('PopOutGitReviewShell: typed client loading', () => {
    it('routes git calls through getCocClientForWorkspace, not getSpaCocClient directly', () => {
        // All git data loading goes through getCocClientForWorkspace so remote workspaces
        // route to the correct remote CoC server instead of the local one.
        const adapters = COMMIT_SOURCE + PR_SOURCE + BRANCH_SOURCE;
        expect(adapters).toContain('getCocClientForWorkspace');
        expect(adapters).not.toContain('getSpaCocClient()');
        expect(COMMIT_SOURCE).toContain('.git.getCommit');
        expect(BRANCH_SOURCE).toContain('.git.getBranchRange');
        expect(BRANCH_SOURCE).toContain('.git.listBranchRangeFiles');
    });

    it('does not own git endpoint strings for shell data loading', () => {
        const adapters = SOURCE + COMMIT_SOURCE + PR_SOURCE + BRANCH_SOURCE;
        expect(adapters).not.toContain('/git/branch-range/files');
        expect(adapters).not.toContain('/git/commits/${encodeURIComponent(commitHash)}');
    });

    it('loads PR diff data through origin-scoped client APIs', () => {
        expect(PR_SOURCE).toContain('getDiffForOrigin(progressOriginId, prId');
        expect(PR_SOURCE).toContain('originId: progressOriginId');
        expect(PR_SOURCE).not.toContain('getDiff(repoId, prId)');
    });
});

describe('PopOutGitReviewShell: remote clone registry bootstrap', () => {
    it('imports registerCloneBaseUrls for registry seeding', () => {
        expect(ROUTE_SOURCE).toContain('registerCloneBaseUrls');
    });

    it('seeds registry from cloneBaseUrl param when present', () => {
        // The shell seeds the registry with the workspace/baseUrl pair before any
        // child renders, so all workspace-scoped calls inside the popout route to
        // the remote server. The guard keeps re-renders from re-seeding it.
        expect(SOURCE).toContain('registerPopOutCloneBases(params)');
        expect(ROUTE_SOURCE).toContain('cloneBaseUrl');
        expect(ROUTE_SOURCE).toContain('registerCloneBaseUrls(registrations)');
    });

    it('parses cloneBaseUrl from URL search params for commit route', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/abc123',
            '?workspace=ws1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4000'
        );
        expect(result).not.toBeNull();
        expect(result!.cloneBaseUrl).toBe('http://127.0.0.1:4000');
    });

    it('parses cloneBaseUrl for branch-range route', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/branch-range',
            '?workspace=ws2&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4001'
        );
        expect(result).not.toBeNull();
        expect(result!.cloneBaseUrl).toBe('http://127.0.0.1:4001');
    });

    it('parses cloneBaseUrl for PR route', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/pr/42',
            '?workspace=ws3&repo=r1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4002'
        );
        expect(result).not.toBeNull();
        expect(result!.cloneBaseUrl).toBe('http://127.0.0.1:4002');
    });

    it('omits cloneBaseUrl for local workspaces (no param in URL)', () => {
        const result = parsePopOutGitReviewRoute(
            '#popout/git-review/abc123',
            '?workspace=ws1'
        );
        expect(result).not.toBeNull();
        expect(result!.cloneBaseUrl).toBeUndefined();
    });

    it('surfaces listBranchRangeFiles errors instead of swallowing them', () => {
        // Branch-range calls must NOT use .catch(() => ({ files: [] })) — that would
        // silently hide remote routing failures and show an empty list with no message.
        expect(BRANCH_SOURCE).not.toContain('.catch(() => ({ files: [] }))');
    });
});

describe('PopOutGitReviewShell: BroadcastChannel communication', () => {
    it('drives the channel through the shared lifecycle hook', () => {
        expect(SOURCE).toContain('usePopOutReviewLifecycle');
        expect(LIFECYCLE_SOURCE).toContain('useGitReviewPopOutChannel');
    });

    it('sends git-review-popout-opened on mount', () => {
        expect(LIFECYCLE_SOURCE).toContain("'git-review-popout-opened'");
    });

    it('sends git-review-popout-closed on beforeunload', () => {
        expect(LIFECYCLE_SOURCE).toContain("'git-review-popout-closed'");
        expect(LIFECYCLE_SOURCE).toContain("'beforeunload'");
    });

    it('closes window on git-review-popout-restore message', () => {
        expect(LIFECYCLE_SOURCE).toContain("'git-review-popout-restore'");
        expect(LIFECYCLE_SOURCE).toContain("window.close()");
    });
});

describe('PopOutGitReviewShell: route parsing in shell', () => {
    it('reads workspaceId from URLSearchParams', () => {
        expect(ROUTE_SOURCE).toContain("URLSearchParams");
        expect(ROUTE_SOURCE).toContain("'workspace'");
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

    it('has data-testid for the PR title toggle button', () => {
        expect(SOURCE).toContain('data-testid="popout-pr-title-toggle"');
    });

    it('has data-testid for the collapsible PR title description row', () => {
        expect(SOURCE).toContain('data-testid="popout-pr-title-description"');
    });
});

describe('PopOutGitReviewShell: PR title collapsible', () => {
    it('passes onTitleLoaded callback to PrReviewContent', () => {
        expect(SOURCE).toContain('onTitleLoaded');
    });

    it('tracks titleExpanded state for the collapsible PR title', () => {
        expect(SOURCE).toContain('titleExpanded');
        expect(SOURCE).toContain('setTitleExpanded');
    });

    it('tracks prTitle state to hold fetched PR title', () => {
        expect(SOURCE).toContain('prTitle');
        expect(SOURCE).toContain('setPrTitle');
    });

    it('includes PR title in document.title when available', () => {
        // The document.title effect should use prTitle in its dependency array
        expect(SOURCE).toContain('prTitle');
    });
});
