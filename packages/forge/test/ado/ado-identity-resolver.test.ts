import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ClientRequest } from 'http';
import { EventEmitter } from 'events';

vi.mock('https', () => ({ get: vi.fn() }));
vi.mock('fs/promises', () => ({ readFile: vi.fn(), writeFile: vi.fn() }));

import * as https from 'https';
import * as fs from 'fs/promises';
import { getOrResolveAdoUserId, resolveAdoUserIdFromConnectionData } from '../../src/ado/ado-identity-resolver';

const ORG_URL = 'https://dev.azure.com/example-org';
const BEARER = 'test-bearer-token';
const ID = '00000000-0000-0000-0000-000000000001';

function stubResponse(body: string, statusCode = 200): void {
    vi.mocked(https.get).mockImplementation((_url: unknown, _opts: unknown, cb?: unknown) => {
        const res = new EventEmitter() as IncomingMessage;
        res.statusCode = statusCode;
        (cb as (res: IncomingMessage) => void)(res);
        process.nextTick(() => { res.emit('data', body); res.emit('end'); });
        return new EventEmitter() as ClientRequest;
    });
}

beforeEach(() => vi.clearAllMocks());

describe('ADO token-bound identity', () => {
    it('uses the supplied bearer token and strips the organization trailing slash', async () => {
        stubResponse(JSON.stringify({ authenticatedUser: { id: ID } }));
        expect(await resolveAdoUserIdFromConnectionData(ORG_URL + '/', BEARER)).toBe(ID);
        expect(https.get).toHaveBeenCalledWith(
            `${ORG_URL}/_apis/connectionData`,
            { headers: { Authorization: `Bearer ${BEARER}`, Accept: 'application/json' } },
            expect.any(Function),
        );
    });

    it.each([
        '{}',
        '{"authenticatedUser":{}}',
        '{"authenticatedUser":{"id":42}}',
        '{"authenticatedUser":{"id":""}}',
        'not JSON',
    ])('returns null for an invalid identity response: %s', async body => {
        stubResponse(body);
        expect(await getOrResolveAdoUserId(ORG_URL, BEARER)).toBeNull();
    });

    it('does not accept an identity from a failed HTTP response', async () => {
        stubResponse(JSON.stringify({ authenticatedUser: { id: ID } }), 401);
        expect(await getOrResolveAdoUserId(ORG_URL, BEARER)).toBeNull();
    });

    it('logs request failure and returns null for best-effort identity lookup', async () => {
        vi.mocked(https.get).mockImplementation(() => {
            const req = new EventEmitter() as ClientRequest;
            process.nextTick(() => req.emit('error', new Error('request failed')));
            return req;
        });
        expect(await getOrResolveAdoUserId(ORG_URL, BEARER)).toBeNull();
    });

    it('resolves each token and organization without reading stale account data or persisting tokens', async () => {
        stubResponse(JSON.stringify({ authenticatedUser: { id: ID } }));
        expect(await getOrResolveAdoUserId(ORG_URL, BEARER)).toBe(ID);
        stubResponse(JSON.stringify({ authenticatedUser: { id: 'other-identity' } }));
        expect(await getOrResolveAdoUserId('https://dev.azure.com/other-org', 'other-token')).toBe('other-identity');
        expect(https.get).toHaveBeenCalledTimes(2);
        expect(fs.readFile).not.toHaveBeenCalled();
        expect(fs.writeFile).not.toHaveBeenCalled();
    });
});
