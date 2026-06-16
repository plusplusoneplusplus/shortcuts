/**
 * AC-07 — workspace→baseUrl LOOKUP registry.
 *
 * The registry is the seam non-React services (explorerApi, notesApi, etc.) use
 * to route a remote clone's per-clone REST/WS to its server, while local clones
 * fall through to the default origin client. AC-01's aggregation populates it.
 *
 * Guarantees under test:
 *   • local / unknown ids → undefined → default client (no fallthrough surprises)
 *   • remote ids → their baseUrl → a client pinned to that origin (no LOCAL client)
 *   • registration is a FULL replace (dropped remotes stop resolving)
 *   • cloneApiBase builds an absolute remote REST base for hand-built URLs
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    cloneApiBase,
    cloneWsUrlForWorkspace,
    getCocClientForWorkspace,
    lookupCloneBaseUrl,
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import {
    getCocClientFor,
    getSpaCocClient,
    resetSpaCocClientForTests,
} from '../../../../src/server/spa/client/react/api/cocClient';

beforeEach(() => {
    resetCloneRegistryForTests();
    resetSpaCocClientForTests();
});

afterEach(() => {
    resetCloneRegistryForTests();
    resetSpaCocClientForTests();
});

describe('lookupCloneBaseUrl', () => {
    it('returns undefined for a local / unregistered workspace id', () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000' }]);
        expect(lookupCloneBaseUrl('local-1')).toBeUndefined();
    });

    it('returns the remote baseUrl for a registered remote workspace id', () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000' }]);
        expect(lookupCloneBaseUrl('remote-1')).toBe('http://127.0.0.1:4000');
    });

    it('returns undefined for null/undefined/empty ids', () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000' }]);
        expect(lookupCloneBaseUrl(undefined)).toBeUndefined();
        expect(lookupCloneBaseUrl(null)).toBeUndefined();
        expect(lookupCloneBaseUrl('')).toBeUndefined();
    });

    it('full-replaces on each registration (a dropped remote stops resolving)', () => {
        registerCloneBaseUrls([
            { workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000' },
            { workspaceId: 'remote-2', baseUrl: 'http://127.0.0.1:4001' },
        ]);
        expect(lookupCloneBaseUrl('remote-2')).toBe('http://127.0.0.1:4001');

        // A later refresh only sees remote-1 (remote-2's server went away).
        registerCloneBaseUrls([{ workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000' }]);
        expect(lookupCloneBaseUrl('remote-1')).toBe('http://127.0.0.1:4000');
        expect(lookupCloneBaseUrl('remote-2')).toBeUndefined();
    });

    it('tracks devtunnel port reassignment (same id, new baseUrl)', () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000' }]);
        registerCloneBaseUrls([{ workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:9999' }]);
        expect(lookupCloneBaseUrl('remote-1')).toBe('http://127.0.0.1:9999');
    });

    it('ignores entries with a missing id or baseUrl', () => {
        registerCloneBaseUrls([
            { workspaceId: '', baseUrl: 'http://127.0.0.1:4000' },
            { workspaceId: 'remote-1', baseUrl: '' },
        ]);
        expect(lookupCloneBaseUrl('remote-1')).toBeUndefined();
    });
});

describe('getCocClientForWorkspace', () => {
    it('returns the default LOCAL singleton for a local / unknown id (no fallthrough to a remote)', () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000' }]);
        expect(getCocClientForWorkspace('local-1')).toBe(getSpaCocClient());
        expect(getCocClientForWorkspace(undefined)).toBe(getSpaCocClient());
    });

    it('returns a REMOTE-routed client for a remote id, never the local singleton', () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000' }]);
        const client = getCocClientForWorkspace('remote-1');
        expect(client).toBe(getCocClientFor('http://127.0.0.1:4000'));
        expect(client.options.baseUrl).toBe('http://127.0.0.1:4000');
        // No local fallthrough: the remote clone's client is NOT the default origin one.
        expect(client).not.toBe(getSpaCocClient());
    });

    it('routes two different remote clones to two different servers', () => {
        registerCloneBaseUrls([
            { workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000' },
            { workspaceId: 'remote-2', baseUrl: 'http://127.0.0.1:4001' },
        ]);
        expect(getCocClientForWorkspace('remote-1').options.baseUrl).toBe('http://127.0.0.1:4000');
        expect(getCocClientForWorkspace('remote-2').options.baseUrl).toBe('http://127.0.0.1:4001');
    });
});

describe('cloneApiBase', () => {
    it('returns the default local /api base for a local id', () => {
        // jsdom: no remote registered → the default page-origin api base.
        expect(cloneApiBase('local-1')).toBe('/api');
    });

    it('returns an absolute remote REST base for a remote id', () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000' }]);
        expect(cloneApiBase('remote-1')).toBe('http://127.0.0.1:4000/api');
    });

    it('strips a trailing slash on the remote baseUrl before appending /api', () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000/' }]);
        expect(cloneApiBase('remote-1')).toBe('http://127.0.0.1:4000/api');
    });
});

describe('cloneWsUrlForWorkspace', () => {
    it('builds a page-origin WS URL for a local id', () => {
        expect(cloneWsUrlForWorkspace('/ws', 'local-1')).toMatch(/^ws:\/\/localhost(:\d+)?\/ws$/);
    });

    it('builds a remote WS URL (with verbatim query) for a remote id', () => {
        registerCloneBaseUrls([{ workspaceId: 'remote-1', baseUrl: 'http://127.0.0.1:4000' }]);
        expect(cloneWsUrlForWorkspace('/ws/terminal?workspaceId=remote-1', 'remote-1'))
            .toBe('ws://127.0.0.1:4000/ws/terminal?workspaceId=remote-1');
    });
});
