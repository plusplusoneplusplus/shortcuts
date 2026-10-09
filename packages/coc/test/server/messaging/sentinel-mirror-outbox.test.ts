import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepoDataPath } from '../../../src/server/paths';
import {
    SENTINEL_MIRROR_OUTBOX_FILE, SentinelMirrorOutbox, type SentinelMirrorIntent,
} from '../../../src/server/messaging/sentinel-mirror-outbox';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

describe('SentinelMirrorOutbox', () => {
    let dataDir: string;
    let outbox: SentinelMirrorOutbox;
    const intent = (extra: Partial<SentinelMirrorIntent> = {}): SentinelMirrorIntent => ({
        workspaceId: 'workspace-a', processId: 'sentinel', requestId: 'accepted-request',
        role: 'user', content: 'Desktop message',
        destination: { connector: 'whatsapp', chatKey: 'group', bindingId: 'binding' },
        ...extra,
    });
    const admitted = (input = intent(), chunks = ['first', 'second']) => {
        const row = outbox.stage(input);
        outbox.accept(input.workspaceId, row.eventId);
        outbox.prepare(input.workspaceId, row.eventId, chunks);
        return row.eventId;
    };
    const begin = (identity: string, workspaceId = 'workspace-a') => {
        const attempt = outbox.beginPart(workspaceId, identity);
        expect(attempt).toBeTypeOf('string');
        return attempt!;
    };

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-mirror-'));
        outbox = new SentinelMirrorOutbox(dataDir);
    });
    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it.each(['teams', 'whatsapp'] as const)('captures immutable %s destination and deduplicates stable user/answer identities', connector => {
        const input = intent({ destination: { connector, chatKey: 'conversation', threadId: 'root', bindingId: 'binding' } });
        const row = outbox.stage(input);
        input.destination.chatKey = 'rebound';
        expect(outbox.list('workspace-a')[0].destination.chatKey).toBe('conversation');
        const captured = intent({ destination: row.destination });
        expect(outbox.stage(captured).eventId).toBe(row.eventId);
        expect(outbox.stage({
            ...captured, destination: { bindingId: 'binding', threadId: 'root', chatKey: 'conversation', connector },
        }).eventId).toBe(row.eventId);
        expect(() => outbox.stage(input)).toThrow('conflicts');
        expect(() => outbox.stage({ ...captured, content: 'Changed' })).toThrow('conflicts');
        const answer = outbox.stage({ ...captured, role: 'assistant', content: 'Answer' });
        expect(answer.eventId).not.toBe(row.eventId);
        expect(outbox.list('workspace-a')).toHaveLength(2);
        row.content = 'Mutated snapshot';
        expect(outbox.list('workspace-a')[0].content).toBe('Desktop message');
    });

    it('keeps identical process/request IDs isolated by owning workspace, including groups', () => {
        const a = admitted();
        const b = admitted(intent({ workspaceId: 'group-b' }));
        expect(a).not.toBe(b);
        expect(() => outbox.accept('group-b', a)).toThrow('owning workspace');
        outbox.cancel('workspace-a', 'sentinel', 'cancelled');
        expect(outbox.list('group-b')[0].state).toBe('pending');
        expect(outbox.list('workspace-a')[0].state).toBe('cancelled');
    });

    it('never sends staged or rejected admissions and preserves their identity across restart', () => {
        const row = outbox.stage(intent());
        expect(outbox.beginPart('workspace-a', row.eventId)).toBeUndefined();
        expect(() => outbox.prepare('workspace-a', row.eventId, ['text'])).toThrow('not admitted');
        outbox = new SentinelMirrorOutbox(dataDir);
        outbox.recover('workspace-a');
        expect(outbox.list('workspace-a')[0].state).toBe('admitting');
        expect(outbox.reject('workspace-a', row.eventId)).toBe(true);
        expect(outbox.accept('workspace-a', row.eventId)).toBe(false);
        expect(outbox.stage(intent()).state).toBe('cancelled');
        expect(outbox.heads('workspace-a')).toEqual([]);
    });

    it('preserves admission order per conversation without blocking other destinations or threads', () => {
        const first = admitted();
        const next = admitted(intent({ requestId: 'buffered-follow-up' }));
        const other = admitted(intent({ requestId: 'other-request', destination: { connector: 'whatsapp', chatKey: 'other', bindingId: 'other-binding' } }));
        const thread = admitted(intent({ requestId: 'thread-request', destination: { connector: 'teams', chatKey: 'other', threadId: 'root', bindingId: 'thread-binding' } }));
        expect(outbox.heads('workspace-a').map(row => row.eventId)).toEqual([first, other, thread]);
        expect(outbox.beginPart('workspace-a', next)).toBeUndefined();
        outbox.acknowledgePart('workspace-a', first, begin(first), 'one');
        expect(outbox.beginPart('workspace-a', next)).toBeUndefined();
        outbox.acknowledgePart('workspace-a', first, begin(first), 'two');
        expect(outbox.heads('workspace-a').map(row => row.eventId)).toEqual([next, other, thread]);
    });

    it('orders shared destinations across workspaces even within one clock tick or after clock regression', () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00.000Z'));
        const first = admitted(intent({ workspaceId: 'workspace-b' }));
        const second = admitted();
        expect(outbox.headsAcrossWorkspaces(['workspace-a', 'workspace-b', 'workspace-b'])
            .map(row => row.eventId)).toEqual([first]);
        expect(outbox.beginPart('workspace-a', second)).toBeUndefined();
        now.mockReturnValue(Date.parse('2025-12-31T23:59:59.000Z'));
        outbox = new SentinelMirrorOutbox(dataDir);
        outbox.recover('workspace-a');
        outbox.recover('workspace-b');
        const third = admitted(intent({ workspaceId: 'workspace-c' }));
        const rows = ['workspace-a', 'workspace-b', 'workspace-c'].flatMap(workspaceId => outbox.list(workspaceId));
        expect(rows.find(row => row.eventId === third)!.createdAt)
            .toBe('2026-01-01T00:00:00.002Z');
        expect(outbox.beginPart('workspace-c', third)).toBeUndefined();
        const attempt = begin(first, 'workspace-b');
        outbox.acknowledgePart('workspace-b', first, attempt, 'one');
        outbox.acknowledgePart('workspace-b', first, begin(first, 'workspace-b'), 'two');
        expect(outbox.headsAcrossWorkspaces(['workspace-c', 'workspace-b', 'workspace-a'])
            .map(row => row.eventId)).toEqual([second]);
    });

    it('recovers acknowledged progress and retries only remaining unsent parts', () => {
        const identity = admitted();
        const first = begin(identity);
        expect(outbox.acknowledgePart('workspace-a', identity, first, 'one')).toBe(true);
        expect(outbox.acknowledgePart('workspace-a', identity, first, 'one')).toBe(false);
        outbox = new SentinelMirrorOutbox(dataDir);
        outbox.recover('workspace-a');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'pending', nextPart: 1, outboundIds: ['one'] });
        expect(() => outbox.prepare('workspace-a', identity, ['different'])).toThrow('boundaries');
        expect(outbox.prepare('workspace-a', identity, ['first', 'second'])).toBe(false);
        outbox.acknowledgePart('workspace-a', identity, begin(identity), 'two');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'delivered', nextPart: 2, outboundIds: ['one', 'two'] });
        expect(outbox.beginPart('workspace-a', identity)).toBeUndefined();
    });

    it.each(['not-attempted', 'rejected'] as const)('retries definitive %s failure without allowing stale callbacks', outcome => {
        const identity = admitted();
        const first = begin(identity);
        expect(outbox.failPart('workspace-a', identity, first, outcome)).toBe(true);
        outbox = new SentinelMirrorOutbox(dataDir);
        outbox.recover('workspace-a');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'retryable', failure: outcome, nextPart: 0 });
        const retry = begin(identity);
        expect(retry).not.toBe(first);
        expect(outbox.failPart('workspace-a', identity, first, 'unknown')).toBe(false);
        expect(outbox.acknowledgePart('workspace-a', identity, first, 'stale')).toBe(false);
        expect(outbox.acknowledgePart('workspace-a', identity, retry, 'one')).toBe(true);
    });

    it('persists retry backoff and honors the provider cooldown across restart', () => {
        const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-01-01T00:00:00.000Z'));
        const identity = admitted();
        outbox.failPart('workspace-a', identity, begin(identity), 'rejected', 10_000);
        outbox = new SentinelMirrorOutbox(dataDir);
        outbox.recover('workspace-a');
        expect(outbox.list('workspace-a')[0]).toMatchObject({
            state: 'retryable', retryCount: 1, nextAttemptAt: '2026-01-01T00:00:10.000Z',
        });
        expect(outbox.beginPart('workspace-a', identity)).toBeUndefined();
        clock.mockReturnValue(Date.parse('2026-01-01T00:00:10.000Z'));
        outbox.failPart('workspace-a', identity, begin(identity), 'not-attempted', 0);
        expect(outbox.list('workspace-a')[0]).toMatchObject({
            retryCount: 2, nextAttemptAt: '2026-01-01T00:00:12.000Z',
        });
        clock.mockReturnValue(Date.parse('2026-01-01T00:00:12.000Z'));
        expect(outbox.beginPart('workspace-a', identity)).toBeTypeOf('string');
    });

    it.each(['restart', 'failure'] as const)('quarantines unknown %s outcomes and blocks later sends', mode => {
        const identity = admitted();
        const next = admitted(intent({ requestId: 'later' }));
        const attempt = begin(identity);
        if (mode === 'failure') outbox.failPart('workspace-a', identity, attempt, 'unknown');
        outbox = new SentinelMirrorOutbox(dataDir);
        outbox.recover('workspace-a');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'ambiguous', failure: 'unknown', nextPart: 0 });
        expect(outbox.beginPart('workspace-a', identity)).toBeUndefined();
        expect(outbox.beginPart('workspace-a', next)).toBeUndefined();
        expect(outbox.acknowledgePart('workspace-a', identity, attempt, 'late')).toBe(false);
    });

    it.each(['cancelled', 'unbound'] as const)('honors %s while retaining in-flight acknowledgement progress', reason => {
        const identity = admitted();
        const other = admitted(intent({ requestId: 'other', destination: { connector: 'whatsapp', chatKey: 'other', bindingId: 'other-binding' } }));
        const attempt = begin(identity);
        outbox.cancel('workspace-a', 'sentinel', reason, 'binding');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'sending', cancelRequested: true, failure: reason });
        outbox.acknowledgePart('workspace-a', identity, attempt, 'one');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'cancelled', nextPart: 1 });
        expect(outbox.beginPart('workspace-a', identity)).toBeUndefined();
        expect(outbox.beginPart('workspace-a', other)).toBeTypeOf('string');
    });

    it('rejects an empty unbind identity rather than treating it as a process-wide cancellation', () => {
        admitted();
        expect(() => outbox.cancel('workspace-a', 'sentinel', 'unbound', '')).toThrow();
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'pending', cancelRequested: false });
    });

    it('cancels one request and its answer without cancelling another request on the same binding', () => {
        admitted();
        admitted(intent({ requestId: 'later' }));
        admitted(intent({ role: 'assistant', content: 'Matching answer' }));
        outbox.cancel('workspace-a', 'sentinel', 'cancelled', 'binding', 'accepted-request');
        const rows = outbox.list('workspace-a');
        expect(rows.filter(row => row.requestId === 'accepted-request').map(row => row.state))
            .toEqual(['cancelled', 'cancelled']);
        expect(rows.find(row => row.requestId === 'later')?.state).toBe('pending');
        expect(() => outbox.cancel('workspace-a', 'sentinel', 'cancelled', 'binding', '')).toThrow();
    });

    it('orders WhatsApp replies by group conversation regardless of their quoted message IDs', () => {
        const first = admitted(intent({ destination: { connector: 'whatsapp', chatKey: 'group', threadId: 'first-quote', bindingId: 'first' } }));
        const later = admitted(intent({ workspaceId: 'workspace-b', destination: { connector: 'whatsapp', chatKey: 'group', threadId: 'second-quote', bindingId: 'second' } }));
        expect(outbox.headsAcrossWorkspaces(['workspace-b', 'workspace-a']).map(row => row.eventId)).toEqual([first]);
        expect(outbox.beginPart('workspace-b', later)).toBeUndefined();
    });

    it('uses the owning worker registration scope instead of retaining removed workspaces forever', () => {
        admitted();
        const later = admitted(intent({ workspaceId: 'workspace-b' }));
        expect(outbox.beginPart('workspace-b', later)).toBeUndefined();
        expect(() => outbox.beginPart('workspace-b', later, ['workspace-a'])).toThrow('active workspace scope');
        expect(outbox.beginPart('workspace-b', later, ['workspace-b'])).toBeTypeOf('string');
    });

    it('does not advance persisted state after a failed atomic write', () => {
        const row = outbox.stage(intent());
        vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('disk failure'); });
        expect(() => outbox.accept('workspace-a', row.eventId)).toThrow('disk failure');
        expect(outbox.list('workspace-a')[0].state).toBe('admitting');
        expect(fs.readdirSync(path.dirname(getRepoDataPath(dataDir, 'workspace-a', SENTINEL_MIRROR_OUTBOX_FILE))))
            .toEqual([SENTINEL_MIRROR_OUTBOX_FILE]);
        expect(outbox.accept('workspace-a', row.eventId)).toBe(true);
    });

    it('retains a durable sending intent when acknowledgement persistence fails', () => {
        const identity = admitted();
        const attempt = begin(identity);
        vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('disk failure'); });
        expect(() => outbox.acknowledgePart('workspace-a', identity, attempt, 'posted')).toThrow('disk failure');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'sending', nextPart: 0, attemptId: attempt });
        outbox = new SentinelMirrorOutbox(dataDir);
        outbox.recover('workspace-a');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'ambiguous', failure: 'unknown', outboundIds: [] });
        expect(outbox.beginPart('workspace-a', identity)).toBeUndefined();
    });

    it('does not authorize a network attempt or cancellation after persistence failure', () => {
        const identity = admitted();
        vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('disk failure'); });
        expect(() => outbox.beginPart('workspace-a', identity)).toThrow('disk failure');
        expect(outbox.list('workspace-a')[0].state).toBe('pending');
        vi.mocked(fs.renameSync).mockImplementationOnce(() => { throw new Error('disk failure'); });
        expect(() => outbox.cancel('workspace-a', 'sentinel', 'unbound')).toThrow('disk failure');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'pending', cancelRequested: false });
    });

    it('records an unknown outcome even if cancellation raced the send', () => {
        const identity = admitted();
        const attempt = begin(identity);
        outbox.cancel('workspace-a', 'sentinel', 'cancelled');
        outbox.failPart('workspace-a', identity, attempt, 'unknown');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'ambiguous', cancelRequested: true, failure: 'unknown' });
        expect(outbox.beginPart('workspace-a', identity)).toBeUndefined();
    });

    it('retains durable attempt evidence after unknown sends and later unbind cancellation', () => {
        const identity = admitted();
        expect(outbox.list('workspace-a')[0].attemptedPartCount).toBe(0);
        const attempt = begin(identity);
        expect(outbox.list('workspace-a')[0].attemptedPartCount).toBe(1);
        outbox.failPart('workspace-a', identity, attempt, 'unknown');
        outbox.cancel('workspace-a', 'sentinel', 'unbound');
        outbox = new SentinelMirrorOutbox(dataDir);
        outbox.recover('workspace-a');
        expect(outbox.list('workspace-a')[0]).toMatchObject({
            state: 'cancelled', attemptedPartCount: 1, failure: 'unknown',
        });
    });

    it('tracks the attempted chunk prefix rather than counting retries of the same chunk', () => {
        const identity = admitted();
        for (let retry = 0; retry < 3; retry++) {
            outbox.failPart('workspace-a', identity, begin(identity), 'not-attempted');
        }
        expect(outbox.list('workspace-a')[0].attemptedPartCount).toBe(1);
        outbox.acknowledgePart('workspace-a', identity, begin(identity), 'first');
        begin(identity);
        expect(outbox.list('workspace-a')[0].attemptedPartCount).toBe(2);
    });

    it.each(['wrong-owner', 'duplicate', 'invalid-progress', 'extra-routing'] as const)('rejects %s persisted data without exposing content', corruption => {
        const identity = admitted();
        const rows = outbox.list('workspace-a');
        if (corruption === 'wrong-owner') rows[0].workspaceId = 'workspace-b';
        if (corruption === 'duplicate') rows.push(rows[0]);
        if (corruption === 'invalid-progress') rows[0].nextPart = 10;
        const raw = JSON.stringify(rows);
        const file = getRepoDataPath(dataDir, 'workspace-a', SENTINEL_MIRROR_OUTBOX_FILE);
        fs.writeFileSync(file, corruption === 'extra-routing' ? raw.replace('"bindingId":"binding"', '"bindingId":"binding","secret":"sensitive"') : raw);
        expect(() => outbox.list('workspace-a')).toThrow(/Invalid Sentinel mirror/);
        expect(() => outbox.beginPart('workspace-a', identity)).toThrow(/Invalid Sentinel mirror/);
    });

    it('creates no files or historical backlog just by reading/recovering an empty workspace', () => {
        outbox.recover('workspace-a');
        expect(outbox.list('workspace-a')).toEqual([]);
        expect(fs.readdirSync(dataDir)).toEqual([]);
    });

    it('sanitizes malformed JSON errors rather than exposing stored message fragments', () => {
        admitted();
        fs.writeFileSync(getRepoDataPath(dataDir, 'workspace-a', SENTINEL_MIRROR_OUTBOX_FILE), 'private message fragment');
        expect(() => outbox.list('workspace-a')).toThrow(/^Invalid Sentinel mirror outbox$/);
    });
});
