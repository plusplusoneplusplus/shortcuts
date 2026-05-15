import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ClientRequest } from 'http';
import { EventEmitter } from 'events';

// Mock modules before any imports that use them
vi.mock('fs/promises');
vi.mock('https', () => ({
    get: vi.fn(),
}));
vi.mock('azure-devops-node-api', () => ({
    getBearerHandler: vi.fn(() => ({ token: 'fake-token' })),
    // Use a regular function (not arrow) so the mock is constructible with `new`.
    // In vitest 4, arrow functions cannot be invoked as constructors.
    WebApi: vi.fn(function (this: any) {}),
}));

import * as fs from 'fs/promises';
import * as https from 'https';
import {
    resolveAdoUserIdFromConnectionData,
    getOrResolveAdoUserId,
} from '../../src/ado/ado-identity-resolver';

const mockedFs = vi.mocked(fs);
const mockedHttpsGet = vi.mocked(https.get);

const ORG_URL = 'https://dev.azure.com/myorg';
const BEARER = 'bearer-token-123';
const FAKE_GUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

/** Helper: create a fake IncomingMessage that emits the given body. */
function fakeResponse(body: string, statusCode = 200): IncomingMessage {
    const res = new EventEmitter() as IncomingMessage;
    res.statusCode = statusCode;
    process.nextTick(() => {
        res.emit('data', body);
        res.emit('end');
    });
    return res;
}

/** Helper: stub https.get to invoke callback with the given response. */
function stubHttpsGet(body: string, statusCode = 200): void {
    mockedHttpsGet.mockImplementation((_url: unknown, _opts: unknown, cb?: unknown) => {
        const callback = cb as (res: IncomingMessage) => void;
        callback(fakeResponse(body, statusCode));
        const req = new EventEmitter() as ClientRequest;
        req.end = vi.fn().mockReturnThis();
        return req;
    });
}

/** Helper: stub https.get to emit an error on the request. */
function stubHttpsGetError(errorMessage: string): void {
    mockedHttpsGet.mockImplementation((_url: unknown, _opts: unknown, _cb?: unknown) => {
        const req = new EventEmitter() as ClientRequest;
        req.end = vi.fn().mockReturnThis();
        process.nextTick(() => req.emit('error', new Error(errorMessage)));
        return req;
    });
}

describe('resolveAdoUserIdFromConnectionData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns the authenticatedUser.id from a successful response', async () => {
        stubHttpsGet(JSON.stringify({ authenticatedUser: { id: FAKE_GUID } }));

        const result = await resolveAdoUserIdFromConnectionData(ORG_URL, BEARER);

        expect(result).toBe(FAKE_GUID);
        expect(mockedHttpsGet).toHaveBeenCalledOnce();
        const calledUrl = mockedHttpsGet.mock.calls[0][0];
        expect(calledUrl).toBe('https://dev.azure.com/myorg/_apis/connectionData');
    });

    it('strips trailing slash from orgUrl', async () => {
        stubHttpsGet(JSON.stringify({ authenticatedUser: { id: FAKE_GUID } }));

        await resolveAdoUserIdFromConnectionData(ORG_URL + '/', BEARER);

        const calledUrl = mockedHttpsGet.mock.calls[0][0];
        expect(calledUrl).toBe('https://dev.azure.com/myorg/_apis/connectionData');
    });

    it('returns null when authenticatedUser is missing', async () => {
        stubHttpsGet(JSON.stringify({ someOtherField: 'value' }));

        const result = await resolveAdoUserIdFromConnectionData(ORG_URL, BEARER);
        expect(result).toBeNull();
    });

    it('returns null when authenticatedUser.id is missing', async () => {
        stubHttpsGet(JSON.stringify({ authenticatedUser: { name: 'no-id-here' } }));

        const result = await resolveAdoUserIdFromConnectionData(ORG_URL, BEARER);
        expect(result).toBeNull();
    });

    it('returns null on invalid JSON response', async () => {
        stubHttpsGet('this is not json');

        const result = await resolveAdoUserIdFromConnectionData(ORG_URL, BEARER);
        expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
        stubHttpsGetError('ECONNREFUSED');

        const result = await resolveAdoUserIdFromConnectionData(ORG_URL, BEARER);
        expect(result).toBeNull();
    });
});

describe('getOrResolveAdoUserId', () => {
    const FAKE_DIR = '/fake/.coc';

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns cached adoId when available (Tier 1)', async () => {
        const cache = {
            token: 'tok',
            expiresAt: Date.now() + 3600000,
            account: { upn: 'user@example.com', displayName: 'User', adoId: FAKE_GUID },
        };
        mockedFs.readFile.mockResolvedValue(JSON.stringify(cache));

        const result = await getOrResolveAdoUserId(ORG_URL, BEARER, FAKE_DIR);
        expect(result).toBe(FAKE_GUID);
        // Should NOT call https (connectionData) when cache has adoId
        expect(mockedHttpsGet).not.toHaveBeenCalled();
    });

    it('falls back to Connection Data API when cache is empty (Tier 2)', async () => {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        mockedFs.readFile.mockRejectedValue(err);

        stubHttpsGet(JSON.stringify({ authenticatedUser: { id: FAKE_GUID } }));

        const result = await getOrResolveAdoUserId(ORG_URL, BEARER, FAKE_DIR);
        expect(result).toBe(FAKE_GUID);
    });

    it('falls back to Connection Data API when cache has no adoId and no UPN', async () => {
        const cache = {
            token: 'tok',
            expiresAt: Date.now() + 3600000,
            account: { upn: '', displayName: 'User', adoId: null },
        };
        mockedFs.readFile.mockResolvedValue(JSON.stringify(cache));

        stubHttpsGet(JSON.stringify({ authenticatedUser: { id: FAKE_GUID } }));

        const result = await getOrResolveAdoUserId(ORG_URL, BEARER, FAKE_DIR);
        expect(result).toBe(FAKE_GUID);
    });

    it('returns null when all tiers fail', async () => {
        const err = new Error('ENOENT') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        mockedFs.readFile.mockRejectedValue(err);

        stubHttpsGetError('ECONNREFUSED');

        const result = await getOrResolveAdoUserId(ORG_URL, BEARER, FAKE_DIR);
        expect(result).toBeNull();
    });

    it('tries VSSPS before connectionData when UPN is available (Tier 1b)', async () => {
        const cache = {
            token: 'tok',
            expiresAt: Date.now() + 3600000,
            account: { upn: 'user@example.com', displayName: 'User', adoId: null },
        };
        mockedFs.readFile.mockResolvedValue(JSON.stringify(cache));

        // VSSPS will fail (mock WebApi doesn't implement real APIs),
        // then connectionData succeeds
        stubHttpsGet(JSON.stringify({ authenticatedUser: { id: FAKE_GUID } }));

        const result = await getOrResolveAdoUserId(ORG_URL, BEARER, FAKE_DIR);
        expect(result).toBe(FAKE_GUID);
    });
});
