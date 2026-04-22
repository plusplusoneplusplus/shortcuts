/**
 * Tests for useBranchRangeCache — module-level branch range caching per workspace.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getBranchRangeCache,
    setBranchRangeCache,
    clearBranchRangeCache,
    _clearBranchRangeCache,
    _getBranchRangeCacheSize,
} from '../../../../src/server/spa/client/react/features/git/hooks/useBranchRangeCache';
import type { CachedBranchRange } from '../../../../src/server/spa/client/react/features/git/hooks/useBranchRangeCache';

const SAMPLE_CACHE: CachedBranchRange = {
    data: {
        baseRef: 'origin/main',
        headRef: 'feature-branch',
        commitCount: 3,
        additions: 42,
        deletions: 10,
        mergeBase: 'abc123',
        branchName: 'feature-branch',
        fileCount: 5,
    },
    files: [{ path: 'src/foo.ts', additions: 20, deletions: 5 }],
    ahead: 3,
    behind: 1,
    branchName: 'feature-branch',
    onDefaultBranch: false,
};

const DEFAULT_BRANCH_CACHE: CachedBranchRange = {
    data: null,
    files: [],
    ahead: 0,
    behind: 0,
    branchName: 'main',
    onDefaultBranch: true,
};

beforeEach(() => {
    _clearBranchRangeCache();
});

describe('getBranchRangeCache', () => {
    it('returns undefined for unknown workspace', () => {
        expect(getBranchRangeCache('unknown-ws')).toBeUndefined();
    });

    it('returns cached value after set', () => {
        setBranchRangeCache('ws1', SAMPLE_CACHE);
        expect(getBranchRangeCache('ws1')).toBe(SAMPLE_CACHE);
    });
});

describe('setBranchRangeCache', () => {
    it('stores separate entries per workspace', () => {
        setBranchRangeCache('ws1', SAMPLE_CACHE);
        setBranchRangeCache('ws2', DEFAULT_BRANCH_CACHE);
        expect(getBranchRangeCache('ws1')).toBe(SAMPLE_CACHE);
        expect(getBranchRangeCache('ws2')).toBe(DEFAULT_BRANCH_CACHE);
        expect(_getBranchRangeCacheSize()).toBe(2);
    });

    it('overwrites existing entry for same workspace', () => {
        setBranchRangeCache('ws1', SAMPLE_CACHE);
        setBranchRangeCache('ws1', DEFAULT_BRANCH_CACHE);
        expect(getBranchRangeCache('ws1')).toBe(DEFAULT_BRANCH_CACHE);
        expect(_getBranchRangeCacheSize()).toBe(1);
    });
});

describe('clearBranchRangeCache', () => {
    it('removes only the specified workspace entry', () => {
        setBranchRangeCache('ws1', SAMPLE_CACHE);
        setBranchRangeCache('ws2', DEFAULT_BRANCH_CACHE);
        clearBranchRangeCache('ws1');
        expect(getBranchRangeCache('ws1')).toBeUndefined();
        expect(getBranchRangeCache('ws2')).toBe(DEFAULT_BRANCH_CACHE);
    });

    it('is a no-op for unknown workspace', () => {
        setBranchRangeCache('ws1', SAMPLE_CACHE);
        clearBranchRangeCache('unknown');
        expect(_getBranchRangeCacheSize()).toBe(1);
    });
});

describe('_clearBranchRangeCache', () => {
    it('empties the entire cache', () => {
        setBranchRangeCache('ws1', SAMPLE_CACHE);
        setBranchRangeCache('ws2', DEFAULT_BRANCH_CACHE);
        _clearBranchRangeCache();
        expect(_getBranchRangeCacheSize()).toBe(0);
    });
});

describe('RepoGitTab integration', () => {
    it('RepoGitTab.tsx imports useBranchRangeCache', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'RepoGitTab.tsx'),
            'utf-8',
        );
        expect(source).toContain("from './hooks/useBranchRangeCache'");
    });

    it('fetchBranchRange checks cache before fetching', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'RepoGitTab.tsx'),
            'utf-8',
        );
        expect(source).toContain('getBranchRangeCache(workspaceId)');
    });

    it('fetchBranchRange populates cache after fetch', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'RepoGitTab.tsx'),
            'utf-8',
        );
        expect(source).toContain('setBranchRangeCache(workspaceId,');
    });

    it('refresh=true clears cache before fetching', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'RepoGitTab.tsx'),
            'utf-8',
        );
        expect(source).toContain('clearBranchRangeCache(workspaceId)');
    });

    it('WebSocket git-changed handler does NOT call refreshAll', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'RepoGitTab.tsx'),
            'utf-8',
        );
        // Extract the WebSocket handler block
        const wsHandlerStart = source.indexOf("// WebSocket: auto-refresh on git-changed");
        const wsHandlerEnd = source.indexOf("// Pull job polling helpers");
        const wsBlock = source.slice(wsHandlerStart, wsHandlerEnd);
        // The handler should NOT call refreshAll — only fetchCommits + setWorkingChangesRefreshKey
        expect(wsBlock).not.toContain('refreshAll()');
        expect(wsBlock).toContain('fetchCommits(true, 0, searchQuery)');
        expect(wsBlock).toContain('setWorkingChangesRefreshKey');
    });

    it('refreshAll still calls fetchBranchRange(true) for manual refresh', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'RepoGitTab.tsx'),
            'utf-8',
        );
        // refreshAll should still call fetchBranchRange(true)
        const refreshAllStart = source.indexOf('const refreshAll = useCallback');
        const refreshAllEnd = source.indexOf('// Load more commits');
        const refreshAllBlock = source.slice(refreshAllStart, refreshAllEnd);
        expect(refreshAllBlock).toContain('fetchBranchRange(true)');
    });
});
