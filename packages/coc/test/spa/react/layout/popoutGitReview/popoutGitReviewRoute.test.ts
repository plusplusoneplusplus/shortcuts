/**
 * Tests for the pure pop-out git review route module: parsing, labels,
 * document titles, and guarded clone-base registration.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    registerCloneBaseUrls: vi.fn(),
    baseUrlByWorkspace: new Map<string, string>(),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    registerCloneBaseUrls: (entries: Array<{ workspaceId: string; baseUrl: string }>) => {
        mocks.registerCloneBaseUrls(entries);
        mocks.baseUrlByWorkspace.clear();
        for (const entry of entries) mocks.baseUrlByWorkspace.set(entry.workspaceId, entry.baseUrl);
    },
    lookupCloneBaseUrl: (workspaceId: string) => mocks.baseUrlByWorkspace.get(workspaceId),
}));

import {
    parsePopOutGitReviewRoute,
    popOutCloneRegistrations,
    popOutGitReviewDocumentTitle,
    popOutGitReviewLabel,
    registerPopOutCloneBases,
    resetPopOutCloneRegistration,
} from '../../../../../src/server/spa/client/react/layout/popoutGitReview/popoutGitReviewRoute';

describe('popOutGitReviewLabel', () => {
    it('shortens the commit hash to 7 chars', () => {
        expect(popOutGitReviewLabel({
            workspaceId: 'ws1',
            reviewType: 'commit',
            commitHash: 'abcdef1234567890',
        })).toBe('Commit abcdef1');
    });

    it('labels PR reviews by number', () => {
        expect(popOutGitReviewLabel({ workspaceId: 'ws1', reviewType: 'pr', prId: '42' })).toBe('PR #42');
    });

    it('labels branch-range reviews', () => {
        expect(popOutGitReviewLabel({ workspaceId: 'ws1', reviewType: 'branch-range' })).toBe('Branch Range Review');
    });
});

describe('popOutGitReviewDocumentTitle', () => {
    const prParams = { workspaceId: 'ws1', reviewType: 'pr' as const, prId: '42' };

    it('falls back to the bare CoC brand without a hostname', () => {
        expect(popOutGitReviewDocumentTitle(prParams)).toBe('PR #42 — CoC');
    });

    it('includes the hostname when the workspace is remote', () => {
        expect(popOutGitReviewDocumentTitle(prParams, { hostname: 'buildbox' })).toBe('PR #42 — CoC @ buildbox');
    });

    it('appends the PR title once it has loaded', () => {
        expect(popOutGitReviewDocumentTitle(prParams, { prTitle: 'Fix risk' })).toBe('PR #42 — Fix risk — CoC');
    });

    it('ignores a stray PR title for non-PR reviews', () => {
        const params = { workspaceId: 'ws1', reviewType: 'commit' as const, commitHash: 'abc1234def' };
        expect(popOutGitReviewDocumentTitle(params, { prTitle: 'Fix risk' })).toBe('Commit abc1234 — CoC');
    });
});

describe('popOutCloneRegistrations', () => {
    it('is empty for a null route', () => {
        expect(popOutCloneRegistrations(null)).toEqual([]);
    });

    it('is empty for a local workspace', () => {
        const params = parsePopOutGitReviewRoute('#popout/git-review/abc123', '?workspace=ws1');
        expect(popOutCloneRegistrations(params)).toEqual([]);
    });

    it('carries the workspace/baseUrl pair for each review type', () => {
        const routes = [
            '#popout/git-review/abc123',
            '#popout/git-review/branch-range',
            '#popout/git-review/pr/42',
        ];
        for (const hash of routes) {
            const params = parsePopOutGitReviewRoute(
                hash,
                '?workspace=ws1&repo=r1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4000',
            );
            expect(popOutCloneRegistrations(params)).toEqual([
                { workspaceId: 'ws1', baseUrl: 'http://127.0.0.1:4000' },
            ]);
        }
    });
});

describe('registerPopOutCloneBases', () => {
    beforeEach(() => {
        mocks.registerCloneBaseUrls.mockClear();
        mocks.baseUrlByWorkspace.clear();
        resetPopOutCloneRegistration();
    });

    it('registers the remote clone before any adapter can issue a request', () => {
        const params = parsePopOutGitReviewRoute(
            '#popout/git-review/pr/42',
            '?workspace=ws1&repo=r1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4000',
        );
        expect(registerPopOutCloneBases(params)).toBe(true);
        expect(mocks.registerCloneBaseUrls).toHaveBeenCalledWith([
            { workspaceId: 'ws1', baseUrl: 'http://127.0.0.1:4000' },
        ]);
        expect(mocks.baseUrlByWorkspace.get('ws1')).toBe('http://127.0.0.1:4000');
    });

    it('does not re-seed the registry on re-render of the same route', () => {
        const params = parsePopOutGitReviewRoute(
            '#popout/git-review/abc123',
            '?workspace=ws1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4000',
        );
        expect(registerPopOutCloneBases(params)).toBe(true);
        expect(registerPopOutCloneBases(params)).toBe(false);
        expect(registerPopOutCloneBases(params)).toBe(false);
        expect(mocks.registerCloneBaseUrls).toHaveBeenCalledTimes(1);
    });

    it('re-seeds when the registry no longer holds the route entry', () => {
        const params = parsePopOutGitReviewRoute(
            '#popout/git-review/abc123',
            '?workspace=ws1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4000',
        );
        registerPopOutCloneBases(params);
        mocks.baseUrlByWorkspace.clear();
        expect(registerPopOutCloneBases(params)).toBe(true);
        expect(mocks.registerCloneBaseUrls).toHaveBeenCalledTimes(2);
    });

    it('registers again when the route points at a different clone', () => {
        const first = parsePopOutGitReviewRoute(
            '#popout/git-review/abc123',
            '?workspace=ws1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4000',
        );
        const second = parsePopOutGitReviewRoute(
            '#popout/git-review/abc123',
            '?workspace=ws1&cloneBaseUrl=http%3A%2F%2F127.0.0.1%3A4001',
        );
        expect(registerPopOutCloneBases(first)).toBe(true);
        expect(registerPopOutCloneBases(second)).toBe(true);
        expect(mocks.baseUrlByWorkspace.get('ws1')).toBe('http://127.0.0.1:4001');
    });

    it('skips registration entirely for local workspaces', () => {
        const params = parsePopOutGitReviewRoute('#popout/git-review/abc123', '?workspace=ws1');
        expect(registerPopOutCloneBases(params)).toBe(false);
        expect(registerPopOutCloneBases(null)).toBe(false);
        expect(mocks.registerCloneBaseUrls).not.toHaveBeenCalled();
    });
});
