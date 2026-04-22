/**
 * Tests for useCommitsCache — module-level commits caching per workspace.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getCommitsCache,
    setCommitsCache,
    clearCommitsCache,
    _clearCommitsCache,
    _getCommitsCacheSize,
} from '../../../../src/server/spa/client/react/features/git/hooks/useCommitsCache';
import type { CachedCommits } from '../../../../src/server/spa/client/react/features/git/hooks/useCommitsCache';

const SAMPLE_COMMIT = { hash: 'abc123', message: 'feat: add cache', author: 'dev', date: '2026-01-01' } as any;

const SAMPLE_CACHE: CachedCommits = {
    commits: [SAMPLE_COMMIT],
    unpushedCount: 1,
    hasMore: false,
};

const EMPTY_CACHE: CachedCommits = {
    commits: [],
    unpushedCount: 0,
    hasMore: false,
};

beforeEach(() => {
    _clearCommitsCache();
});

describe('getCommitsCache', () => {
    it('returns undefined for unknown workspace', () => {
        expect(getCommitsCache('unknown-ws')).toBeUndefined();
    });

    it('returns cached value after set', () => {
        setCommitsCache('ws1', SAMPLE_CACHE);
        expect(getCommitsCache('ws1')).toBe(SAMPLE_CACHE);
    });
});

describe('setCommitsCache', () => {
    it('stores separate entries per workspace', () => {
        setCommitsCache('ws1', SAMPLE_CACHE);
        setCommitsCache('ws2', EMPTY_CACHE);
        expect(getCommitsCache('ws1')).toBe(SAMPLE_CACHE);
        expect(getCommitsCache('ws2')).toBe(EMPTY_CACHE);
        expect(_getCommitsCacheSize()).toBe(2);
    });

    it('overwrites existing entry for same workspace', () => {
        setCommitsCache('ws1', SAMPLE_CACHE);
        setCommitsCache('ws1', EMPTY_CACHE);
        expect(getCommitsCache('ws1')).toBe(EMPTY_CACHE);
        expect(_getCommitsCacheSize()).toBe(1);
    });
});

describe('clearCommitsCache', () => {
    it('removes only the specified workspace entry', () => {
        setCommitsCache('ws1', SAMPLE_CACHE);
        setCommitsCache('ws2', EMPTY_CACHE);
        clearCommitsCache('ws1');
        expect(getCommitsCache('ws1')).toBeUndefined();
        expect(getCommitsCache('ws2')).toBe(EMPTY_CACHE);
    });

    it('is a no-op for unknown workspace', () => {
        setCommitsCache('ws1', SAMPLE_CACHE);
        clearCommitsCache('unknown');
        expect(_getCommitsCacheSize()).toBe(1);
    });
});

describe('_clearCommitsCache', () => {
    it('empties the entire cache', () => {
        setCommitsCache('ws1', SAMPLE_CACHE);
        setCommitsCache('ws2', EMPTY_CACHE);
        _clearCommitsCache();
        expect(_getCommitsCacheSize()).toBe(0);
    });
});

describe('RepoGitTab integration', () => {
    let source: string;

    beforeEach(async () => {
        const fs = await import('fs');
        const path = await import('path');
        source = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'features', 'git', 'RepoGitTab.tsx'),
            'utf-8',
        );
    });

    it('RepoGitTab.tsx imports useCommitsCache', () => {
        expect(source).toContain("from './hooks/useCommitsCache'");
    });

    it('fetchCommits checks cache when refresh=false and skipOffset=0', () => {
        expect(source).toContain('getCommitsCache(workspaceId)');
    });

    it('fetchCommits populates cache after network fetch', () => {
        expect(source).toContain('setCommitsCache(workspaceId,');
    });

    it('fetchCommits clears cache when refresh=true', () => {
        expect(source).toContain('clearCommitsCache(workspaceId)');
    });

    it('fetchCommits does not cache search results', () => {
        // Cache write must be guarded by !search
        expect(source).toContain('!search');
    });

    it('refreshAll calls fetchCommits(true, ...) to bypass cache', () => {
        const refreshAllStart = source.indexOf('const refreshAll = useCallback');
        const refreshAllEnd = source.indexOf('// Load more commits');
        const refreshAllBlock = source.slice(refreshAllStart, refreshAllEnd);
        expect(refreshAllBlock).toContain('fetchCommits(true, 0,');
    });

    it('WebSocket git-changed handler clears commits cache on git-changed events', () => {
        // WebSocket fires fetchCommits(true, ...) which clears the cache
        const wsHandlerStart = source.indexOf('// WebSocket: auto-refresh on git-changed');
        const wsHandlerEnd = source.indexOf('// Pull job polling helpers');
        const wsBlock = source.slice(wsHandlerStart, wsHandlerEnd);
        expect(wsBlock).toContain('fetchCommits(true, 0,');
    });
});
