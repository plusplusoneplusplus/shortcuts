/**
 * Tests for Router git review pop-out URL builders.
 */

import { describe, it, expect } from 'vitest';
import {
    buildGitReviewPopOutUrl,
    buildGitBranchRangePopOutUrl,
    buildGitPrPopOutUrl,
} from '../../../../src/server/spa/client/react/layout/Router';

describe('buildGitReviewPopOutUrl', () => {
    it('builds URL with workspace and commit hash', () => {
        const url = buildGitReviewPopOutUrl('ws-1', 'abc123');
        expect(url).toBe('/?workspace=ws-1#popout/git-review/abc123');
    });

    it('encodes workspace ID', () => {
        const url = buildGitReviewPopOutUrl('ws with space', 'abc123');
        expect(url).toContain('workspace=ws%20with%20space');
    });

    it('encodes commit hash', () => {
        const url = buildGitReviewPopOutUrl('ws1', 'abc/123');
        expect(url).toContain('#popout/git-review/abc%2F123');
    });
});

describe('buildGitBranchRangePopOutUrl', () => {
    it('builds URL with workspace and branch-range type', () => {
        const url = buildGitBranchRangePopOutUrl('ws-1');
        expect(url).toBe('/?workspace=ws-1#popout/git-review/branch-range');
    });

    it('encodes workspace ID', () => {
        const url = buildGitBranchRangePopOutUrl('ws with space');
        expect(url).toContain('workspace=ws%20with%20space');
    });
});

describe('buildGitPrPopOutUrl', () => {
    it('builds URL with workspace, repo, and prId', () => {
        const url = buildGitPrPopOutUrl('ws-1', 'repo-1', '42');
        expect(url).toBe('/?workspace=ws-1&repo=repo-1#popout/git-review/pr/42');
    });

    it('encodes workspace, repo, and prId', () => {
        const url = buildGitPrPopOutUrl('ws with space', 'repo/special', 'pr with space');
        expect(url).toContain('workspace=ws%20with%20space');
        expect(url).toContain('repo=repo%2Fspecial');
        expect(url).toContain('#popout/git-review/pr/pr%20with%20space');
    });

    it('accepts numeric prId', () => {
        const url = buildGitPrPopOutUrl('ws-1', 'my-repo', 123);
        expect(url).toBe('/?workspace=ws-1&repo=my-repo#popout/git-review/pr/123');
    });

    it('includes the origin ID when provided', () => {
        const url = buildGitPrPopOutUrl('ws-1', 'repo-1', '42', 'gh_owner_repo');
        expect(url).toBe('/?workspace=ws-1&repo=repo-1&origin=gh_owner_repo#popout/git-review/pr/42');
    });
});
