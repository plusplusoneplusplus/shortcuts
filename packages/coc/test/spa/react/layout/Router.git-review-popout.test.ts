/**
 * Tests for Router git review pop-out URL builders.
 */

import { describe, it, expect } from 'vitest';
import {
    buildGitReviewPopOutUrl,
    buildGitBranchRangePopOutUrl,
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
