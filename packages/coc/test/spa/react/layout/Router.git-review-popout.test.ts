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

    it('includes encoded cloneBaseUrl when provided', () => {
        const url = buildGitReviewPopOutUrl('ws-1', 'abc123', 'http://127.0.0.1:4000');
        expect(url).toContain('cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4000');
        expect(url).toBe('/?workspace=ws-1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4000#popout/git-review/abc123');
    });

    it('omits cloneBaseUrl param when not provided', () => {
        const url = buildGitReviewPopOutUrl('ws-1', 'abc123');
        expect(url).not.toContain('cloneBaseUrl');
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

    it('includes encoded cloneBaseUrl when provided', () => {
        const url = buildGitBranchRangePopOutUrl('ws-1', 'http://127.0.0.1:4001');
        expect(url).toContain('cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4001');
        expect(url).toBe('/?workspace=ws-1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4001#popout/git-review/branch-range');
    });

    it('omits cloneBaseUrl param when not provided', () => {
        const url = buildGitBranchRangePopOutUrl('ws-1');
        expect(url).not.toContain('cloneBaseUrl');
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

    it('includes encoded cloneBaseUrl when provided', () => {
        const url = buildGitPrPopOutUrl('ws-1', 'repo-1', '42', 'gh_owner_repo', 'http://127.0.0.1:4002');
        expect(url).toContain('cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4002');
        expect(url).toBe('/?workspace=ws-1&repo=repo-1&origin=gh_owner_repo&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4002#popout/git-review/pr/42');
    });

    it('omits cloneBaseUrl param when not provided', () => {
        const url = buildGitPrPopOutUrl('ws-1', 'repo-1', '42', 'gh_owner_repo');
        expect(url).not.toContain('cloneBaseUrl');
    });

    it('includes cloneBaseUrl without originId when originId is omitted', () => {
        const url = buildGitPrPopOutUrl('ws-1', 'repo-1', '42', undefined, 'http://127.0.0.1:4003');
        expect(url).toBe('/?workspace=ws-1&repo=repo-1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4003#popout/git-review/pr/42');
    });
});
