/**
 * AC-03 — clone→baseUrl resolver and the React routing hooks.
 *
 * resolveCloneBaseUrl is pure (workspace object or id + repos list → baseUrl).
 * The hooks (useResolveCloneBaseUrl / useCocClient / useCloneWsUrl) read the live
 * ReposContext repo list; ReposContext is mocked so no real fetching occurs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import { tagRemoteWorkspaces } from '../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import type { RepoData } from '../../../../src/server/spa/client/react/repos/repoGrouping';

// ── ReposContext mock (drives the hooks) ─────────────────────────────────────
let mockRepos: RepoData[] = [];
vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: mockRepos, loading: false, fetchRepos: vi.fn(), unseenCounts: {} }),
}));

import {
    resolveCloneBaseUrl,
    useResolveCloneBaseUrl,
    useCocClient,
    useCloneWsUrl,
} from '../../../../src/server/spa/client/react/repos/cloneRouting';
import { getCocClientFor, getSpaCocClient, resetSpaCocClientForTests } from '../../../../src/server/spa/client/react/api/cocClient';

// ── Helpers ──────────────────────────────────────────────────────────────────

function localWs(id: string, name = id): WorkspaceInfo {
    return { id, name, rootPath: `/repos/${id}` };
}

/** Build a remote-tagged workspace via AC-01's tagger so the marker shape stays in sync. */
function remoteWs(id: string, baseUrl: string, serverId = 'srv', serverLabel = 'Server') {
    return tagRemoteWorkspaces({ id: serverId, label: serverLabel }, baseUrl, [localWs(id)], false)[0];
}

function repo(workspace: WorkspaceInfo | ReturnType<typeof remoteWs>): RepoData {
    return { workspace };
}

beforeEach(() => {
    mockRepos = [];
    resetSpaCocClientForTests();
});

afterEach(() => {
    resetSpaCocClientForTests();
});

// ── resolveCloneBaseUrl (pure) ───────────────────────────────────────────────

describe('resolveCloneBaseUrl', () => {
    it('returns the baseUrl when given a remote workspace object directly', () => {
        const ws = remoteWs('w1', 'http://127.0.0.1:4000');
        expect(resolveCloneBaseUrl(ws)).toBe('http://127.0.0.1:4000');
    });

    it('returns undefined for a local workspace object', () => {
        expect(resolveCloneBaseUrl(localWs('w1'))).toBeUndefined();
    });

    it('resolves a remote baseUrl by workspace id via the repos list', () => {
        mockRepos = [repo(localWs('local')), repo(remoteWs('w1', 'http://127.0.0.1:4001'))];
        expect(resolveCloneBaseUrl('w1', mockRepos)).toBe('http://127.0.0.1:4001');
    });

    it('returns undefined for a local id found in the repos list', () => {
        const repos = [repo(localWs('local')), repo(remoteWs('w1', 'http://127.0.0.1:4001'))];
        expect(resolveCloneBaseUrl('local', repos)).toBeUndefined();
    });

    it('returns undefined for an unknown id', () => {
        const repos = [repo(remoteWs('w1', 'http://127.0.0.1:4001'))];
        expect(resolveCloneBaseUrl('nope', repos)).toBeUndefined();
    });

    it('returns undefined for undefined / empty ref', () => {
        expect(resolveCloneBaseUrl(undefined)).toBeUndefined();
        expect(resolveCloneBaseUrl('')).toBeUndefined();
    });

    it('prefers the object marker over a repos lookup', () => {
        // Object says :4000; the repos entry for the same id says :9999 — trust the object.
        const ws = remoteWs('w1', 'http://127.0.0.1:4000');
        const repos = [repo(remoteWs('w1', 'http://127.0.0.1:9999'))];
        expect(resolveCloneBaseUrl(ws, repos)).toBe('http://127.0.0.1:4000');
    });
});

// ── hooks ────────────────────────────────────────────────────────────────────

describe('useResolveCloneBaseUrl', () => {
    it('resolves ids against the live repos list', () => {
        mockRepos = [repo(remoteWs('w1', 'http://127.0.0.1:4002'))];
        const { result } = renderHook(() => useResolveCloneBaseUrl());
        expect(result.current('w1')).toBe('http://127.0.0.1:4002');
        expect(result.current('local')).toBeUndefined();
    });
});

describe('useCocClient', () => {
    it('returns the default singleton for a local / unknown clone', () => {
        mockRepos = [repo(localWs('local'))];
        const { result } = renderHook(() => useCocClient('local'));
        expect(result.current).toBe(getSpaCocClient());
    });

    it('returns the default singleton when no ref is passed', () => {
        const { result } = renderHook(() => useCocClient());
        expect(result.current).toBe(getSpaCocClient());
    });

    it('returns a remote-routed client for a remote clone', () => {
        mockRepos = [repo(remoteWs('w1', 'http://127.0.0.1:4003'))];
        const { result } = renderHook(() => useCocClient('w1'));
        expect(result.current).toBe(getCocClientFor('http://127.0.0.1:4003'));
        expect(result.current.options.baseUrl).toBe('http://127.0.0.1:4003');
        expect(result.current).not.toBe(getSpaCocClient());
    });
});

describe('useCloneWsUrl', () => {
    it('builds page-origin WS URLs for a local clone', () => {
        mockRepos = [repo(localWs('local'))];
        const { result } = renderHook(() => useCloneWsUrl('local'));
        // jsdom default origin is http://localhost:3000 → ws://localhost:3000
        expect(result.current('/ws')).toMatch(/^ws:\/\/localhost(:\d+)?\/ws$/);
    });

    it('builds remote WS URLs for a remote clone', () => {
        mockRepos = [repo(remoteWs('w1', 'http://127.0.0.1:4004'))];
        const { result } = renderHook(() => useCloneWsUrl('w1'));
        expect(result.current('/ws')).toBe('ws://127.0.0.1:4004/ws');
        expect(result.current('/ws/terminal?workspaceId=w1')).toBe('ws://127.0.0.1:4004/ws/terminal?workspaceId=w1');
    });
});
