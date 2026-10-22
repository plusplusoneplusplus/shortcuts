import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    ownsRemoteDelegationReceipt, parseRemoteDelegationClaim, RemoteDelegationRefusedError, remoteDelegationTokenDigest,
    type RemoteDelegationClaim,
} from '../../../src/server/delegation/remote-delegation-auth';
import {
    REMOTE_DELEGATION_REQUESTS_FILE, RemoteDelegationRequestStore,
} from '../../../src/server/delegation/remote-delegation-request-store';
import { getRepoDataPath } from '../../../src/server/paths';

const workspaceId = 'origin-repo';
const destination = { serverId: 'destination-alias', serverIdentity: 'destination-owner', workspaceId: 'destination-repo' };
const reservation = {
    parent: { workspaceId, processId: 'sentinel-1' }, destination,
    kind: 'launch' as const, intentDigest: 'a'.repeat(64), title: 'Fix login',
    messagingOrigin: { connector: 'teams' as const, chatKey: 'private-chat', threadId: 'private-thread' },
};
const claim: RemoteDelegationClaim = {
    version: 1, requestId: randomUUID(), originServerIdentity: 'origin-owner',
    parent: { workspaceId, processId: 'sentinel-1' },
    destination: { serverIdentity: destination.serverIdentity, workspaceId: destination.workspaceId },
    kind: 'launch', intentDigest: 'a'.repeat(64), proofToken: 'b'.repeat(64),
};

describe('origin per-request receipt secret', () => {
    let dataDir: string;
    const file = () => getRepoDataPath(dataDir, workspaceId, REMOTE_DELEGATION_REQUESTS_FILE);
    const restart = () => new RemoteDelegationRequestStore(dataDir);
    beforeEach(() => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-delegation-auth-')); });
    afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

    it('keeps a random private secret stable across restart and immutable reservation replay', () => {
        const request = restart().reserve(reservation);
        expect(request.proofToken).toMatch(/^[a-f0-9]{64}$/);
        expect(restart().reserve(reservation).proofToken).not.toBe(request.proofToken);
        expect(restart().reserve({ ...reservation, requestId: request.requestId }).proofToken).toBe(request.proofToken);
        // POSIX mode is applied to temporary publication as well as the saved ledger.
        if (process.platform !== 'win32') expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    });

    it('never backfills a secret for an old tokenless reservation', () => {
        const request = restart().reserve(reservation);
        const rows = JSON.parse(fs.readFileSync(file(), 'utf8'));
        delete rows[0].proofToken;
        const bytes = JSON.stringify(rows);
        fs.writeFileSync(file(), bytes);
        expect(restart().reserve({ ...reservation, requestId: request.requestId }).proofToken).toBeUndefined();
        expect(fs.readFileSync(file(), 'utf8')).toBe(bytes);
    });

    it('exposes no origin proof surface for a destination to call back', () => {
        expect(RemoteDelegationRequestStore.prototype).not.toHaveProperty('proveOrigin');
    });
});

describe('sender-only destination claim parsing', () => {
    it('accepts an exact claim for this destination without any network or registry input', () => {
        expect(parseRemoteDelegationClaim(structuredClone(claim), destination.serverIdentity)).toEqual(claim);
    });

    it.each([
        ['self origin', { originServerIdentity: destination.serverIdentity }],
        ['other destination', { destination: { ...claim.destination, serverIdentity: 'other-server' } }],
        ['callback URL', { callbackUrl: 'http://attacker.invalid' }],
        ['path traversal', { parent: { ...claim.parent, workspaceId: '../outside' } }],
        ['windows path', { destination: { ...claim.destination, workspaceId: '..\\outside' } }],
        ['short secret', { proofToken: 'b'.repeat(63) }],
        ['missing secret', { proofToken: undefined }],
        ['wrong version', { version: 2 }],
        ['launch target', { targetProcessId: 'chat' }],
        ['untargeted follow-up', { kind: 'follow-up' }],
    ])('refuses a %s claim', (_label, change) => {
        expect(() => parseRemoteDelegationClaim({ ...claim, ...change }, destination.serverIdentity))
            .toThrow(RemoteDelegationRefusedError);
    });

    it('binds ownership to a digest of the exact secret and never matches a legacy row', () => {
        const digest = remoteDelegationTokenDigest(claim.proofToken);
        expect(digest).toMatch(/^[a-f0-9]{64}$/);
        expect(digest).not.toBe(claim.proofToken);
        expect(ownsRemoteDelegationReceipt(digest, claim.proofToken)).toBe(true);
        expect(ownsRemoteDelegationReceipt(digest, 'c'.repeat(64))).toBe(false);
        expect(ownsRemoteDelegationReceipt(undefined, claim.proofToken)).toBe(false);
    });
});
