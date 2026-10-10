import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepoDataPath } from '../../../src/server/paths';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import {
    SENTINEL_MIRROR_OUTBOX_FILE, SentinelMirrorImportError, SentinelMirrorOutbox, type SentinelMirrorEntry, type SentinelMirrorIntent,
} from '../../../src/server/messaging/sentinel-mirror-outbox';

type Seam = { transact<T>(mutation: () => T): T };
/** Fails the next ledger transaction after its mutation ran, rolling it back like a failed disk write. */
function failNextWrite(outbox: SentinelMirrorOutbox) {
    const seam = outbox as unknown as Seam;
    const original = seam.transact.bind(outbox);
    vi.spyOn(seam, 'transact').mockImplementationOnce(mutation => original(() => {
        mutation();
        throw new Error('disk failure');
    }));
}

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
        outbox.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });
    const reopen = () => {
        outbox.close();
        outbox = new SentinelMirrorOutbox(dataDir);
    };
    const sql = (statement: string, ...args: unknown[]) => {
        const db = new NativeDatabase(path.join(dataDir, 'processes.db'));
        try { db.prepare(statement).run(...args); } finally { db.close(); }
    };

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
        reopen();
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
        reopen();
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
        reopen();
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
        reopen();
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
        reopen();
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
        reopen();
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

    it('does not advance persisted state after a failed write', () => {
        const row = outbox.stage(intent());
        failNextWrite(outbox);
        expect(() => outbox.accept('workspace-a', row.eventId)).toThrow('disk failure');
        expect(outbox.list('workspace-a')[0].state).toBe('admitting');
        expect(outbox.requestState('workspace-a', 'sentinel', 'accepted-request')?.admission).toBe('staged');
        expect(outbox.accept('workspace-a', row.eventId)).toBe(true);
        expect(outbox.requestState('workspace-a', 'sentinel', 'accepted-request')?.admission).toBe('accepted');
    });

    it('retains a durable sending intent when acknowledgement persistence fails', () => {
        const identity = admitted();
        const attempt = begin(identity);
        failNextWrite(outbox);
        expect(() => outbox.acknowledgePart('workspace-a', identity, attempt, 'posted')).toThrow('disk failure');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'sending', nextPart: 0, attemptId: attempt, outboundIds: [] });
        reopen();
        outbox.recover('workspace-a');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'ambiguous', failure: 'unknown', outboundIds: [] });
        expect(outbox.beginPart('workspace-a', identity)).toBeUndefined();
    });

    it('does not authorize a network attempt or cancellation after persistence failure', () => {
        const identity = admitted();
        failNextWrite(outbox);
        expect(() => outbox.beginPart('workspace-a', identity)).toThrow('disk failure');
        expect(outbox.list('workspace-a')[0].state).toBe('pending');
        failNextWrite(outbox);
        expect(() => outbox.cancel('workspace-a', 'sentinel', 'unbound')).toThrow('disk failure');
        expect(outbox.list('workspace-a')[0]).toMatchObject({ state: 'pending', cancelRequested: false });
        expect(outbox.requestState('workspace-a', 'sentinel', 'accepted-request')?.answer).toBe('awaiting');
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
        reopen();
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

    it.each(['wrong-owner', 'identity', 'invalid-progress'] as const)('rejects %s stored rows without exposing content', corruption => {
        const identity = admitted();
        if (corruption === 'wrong-owner') sql('UPDATE sentinel_mirror_deliveries SET process_id = ? WHERE event_id = ?', 'other', identity);
        if (corruption === 'identity') sql('UPDATE sentinel_mirror_deliveries SET request_id = ? WHERE event_id = ?', 'forged', identity);
        if (corruption === 'invalid-progress') sql('UPDATE sentinel_mirror_deliveries SET next_part = 10 WHERE event_id = ?', identity);
        expect(() => outbox.list('workspace-a')).toThrow(/^Invalid Sentinel mirror outbox$/);
        expect(() => outbox.beginPart('workspace-a', identity)).toThrow(/^Invalid Sentinel mirror outbox$/);
    });

    it('creates no legacy JSON ledger or historical backlog just by reading/recovering an empty workspace', () => {
        outbox.recover('workspace-a');
        expect(outbox.list('workspace-a')).toEqual([]);
        expect(outbox.activeRequests(0, 32)).toEqual([]);
        expect(fs.existsSync(getRepoDataPath(dataDir, 'workspace-a', SENTINEL_MIRROR_OUTBOX_FILE))).toBe(false);
    });

    describe('request answer tracking', () => {
        it('keeps a delivered user request active until its answer is materialized exactly once', () => {
            const identity = admitted(intent(), ['only']);
            outbox.acknowledgePart('workspace-a', identity, begin(identity), 'sent');
            expect(outbox.list('workspace-a')[0].state).toBe('delivered');
            expect(outbox.activeRequests(0, 32).map(row => row.requestId)).toEqual(['accepted-request']);
            const user = outbox.list('workspace-a')[0];
            const answer = outbox.materializeAnswer(user, 'Answer');
            expect(answer).toMatchObject({ role: 'assistant', state: 'pending', content: 'Answer' });
            expect(outbox.materializeAnswer(user, 'Different repeated completion').eventId).toBe(answer.eventId);
            expect(outbox.list('workspace-a').filter(row => row.role === 'assistant')).toHaveLength(1);
            expect(outbox.requestState('workspace-a', 'sentinel', 'accepted-request')?.answer).toBe('materialized');
            expect(outbox.activeRequests(0, 32)).toEqual([]);
        });

        it('suppresses unanswered requests on cancellation and excludes rejected admissions', () => {
            admitted();
            const rejected = outbox.stage(intent({ requestId: 'rejected' }));
            outbox.reject('workspace-a', rejected.eventId);
            outbox.cancel('workspace-a', 'sentinel', 'unbound', 'binding', 'accepted-request');
            expect(outbox.requestState('workspace-a', 'sentinel', 'accepted-request')?.answer).toBe('suppressed');
            expect(outbox.requestState('workspace-a', 'sentinel', 'rejected')?.admission).toBe('rejected');
            expect(outbox.activeRequests(0, 32)).toEqual([]);
        });

        it('pages active requests and omits attachment bytes from scheduler listings', () => {
            for (let index = 0; index < 5; index++) admitted(intent({ requestId: `request-${index}` }));
            const first = outbox.activeRequests(0, 2);
            const second = outbox.activeRequests(first[1].seq, 2);
            expect([...first, ...second].map(row => row.requestId)).toEqual(['request-0', 'request-1', 'request-2', 'request-3']);
            const withBytes = outbox.stage(intent({
                requestId: 'bytes', attachments: [{ name: 'a.txt', mimeType: 'text/plain', size: 1, sha256: 'a'.repeat(64), data: 'YQ==' }],
            }));
            expect(outbox.activeRequests(0, 32).find(row => row.requestId === 'bytes')!.attachments![0].data).toBeUndefined();
            expect(outbox.get('workspace-a', withBytes.eventId).attachments![0].data).toBe('YQ==');
        });

        it('keeps active work proportional to unfinished requests as finished receipts grow', () => {
            const active = admitted(intent({ requestId: 'still-active' }));
            const counts: number[] = [];
            for (const total of [1_000, 100_000]) {
                const db = new NativeDatabase(path.join(dataDir, 'processes.db'));
                try {
                    db.transaction(() => {
                        const delivery = db.prepare(`INSERT OR IGNORE INTO sentinel_mirror_deliveries (event_id, workspace_id, process_id, request_id,
                            role, connector, chat_key, binding_id, destination_key, content, chunks, state, next_part, seq, created_at)
                            VALUES (?, 'workspace-a', 'sentinel', ?, 'user', 'whatsapp', 'group', 'binding', '["whatsapp","group",null]',
                            'old', '["old"]', 'delivered', 1, ?, '2020-01-01T00:00:00.000Z')`);
                        const request = db.prepare(`INSERT OR IGNORE INTO sentinel_mirror_requests (workspace_id, process_id, request_id, connector,
                            chat_key, binding_id, admission, answer, seq, created_at)
                            VALUES ('workspace-a', 'sentinel', ?, 'whatsapp', 'group', 'binding', 'accepted', 'materialized', ?, '2020-01-01T00:00:00.000Z')`);
                        const receipt = db.prepare(`INSERT OR IGNORE INTO sentinel_mirror_receipts (event_id, part_index, outbound_id, connector, chat_key, acknowledged_at)
                            VALUES (?, 0, ?, 'whatsapp', 'group', '2020-01-01T00:00:00.000Z')`);
                        for (let index = 0; index < total; index++) {
                            delivery.run(`finished-${index}`, `finished-${index}`, index + 1);
                            request.run(`finished-${index}`, index + 1);
                            receipt.run(`finished-${index}`, `outbound-${index}`);
                        }
                    })();
                } finally { db.close(); }
                counts.push(outbox.activeRequests(0, 32).length + outbox.headsAcrossWorkspaces().length + outbox.sending().length);
            }
            expect(counts).toEqual([2, 2]);
            expect(outbox.headsAcrossWorkspaces().map(row => row.eventId)).toEqual([active]);
        });

        it('uses active-state, destination-head and retry-deadline indexes', () => {
            const db = new NativeDatabase(path.join(dataDir, 'processes.db'));
            try {
                const plan = (statement: string) => (db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all() as Array<{ detail: string }>)
                    .map(row => row.detail).join('\n');
                expect(plan(`SELECT * FROM sentinel_mirror_requests WHERE (admission = 'staged' OR (admission = 'accepted' AND answer = 'awaiting')) AND seq > 0 ORDER BY seq LIMIT 32`))
                    .toContain('idx_sentinel_mirror_requests_active');
                expect(plan(`SELECT * FROM sentinel_mirror_deliveries WHERE state NOT IN ('delivered', 'cancelled') ORDER BY seq`))
                    .toMatch(/idx_sentinel_mirror_deliveries_(heads|seq)/);
                expect(plan(`SELECT MIN(next_attempt_at) FROM sentinel_mirror_deliveries WHERE state = 'retryable' AND next_attempt_at IS NOT NULL`))
                    .toContain('idx_sentinel_mirror_deliveries_retry');
                expect(plan(`SELECT * FROM sentinel_mirror_deliveries WHERE request_id = 'r' AND role = 'user' AND connector = 'whatsapp' AND chat_key = 'g'`))
                    .toContain('idx_sentinel_mirror_deliveries_request');
            } finally { db.close(); }
        });
    });

    describe('legacy JSON import', () => {
        const ledger = () => getRepoDataPath(dataDir, 'workspace-a', SENTINEL_MIRROR_OUTBOX_FILE);
        const legacyRows = (): SentinelMirrorEntry[] => {
            const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-mirror-legacy-'));
            const builder = new SentinelMirrorOutbox(scratch);
            try {
                const user = builder.stage(intent({ requestId: 'delivered-no-answer' }));
                builder.accept('workspace-a', user.eventId);
                builder.prepare('workspace-a', user.eventId, ['one']);
                builder.acknowledgePart('workspace-a', user.eventId, builder.beginPart('workspace-a', user.eventId)!, 'out-1');
                const answered = builder.stage(intent({ requestId: 'answered' }));
                builder.accept('workspace-a', answered.eventId);
                builder.prepare('workspace-a', answered.eventId, ['two']);
                builder.acknowledgePart('workspace-a', answered.eventId, builder.beginPart('workspace-a', answered.eventId)!, 'out-2');
                const answer = builder.materializeAnswer(builder.get('workspace-a', answered.eventId), 'Reply');
                builder.prepare('workspace-a', answer.eventId, ['three']);
                builder.beginPart('workspace-a', answer.eventId);
                return builder.list('workspace-a');
            } finally {
                builder.close();
                fs.rmSync(scratch, { recursive: true, force: true });
            }
        };

        it('imports once without sending, quarantining unresolved attempts and keeping unanswered requests active', () => {
            const rows = legacyRows();
            fs.mkdirSync(path.dirname(ledger()), { recursive: true });
            fs.writeFileSync(ledger(), JSON.stringify(rows));
            expect(outbox.isImported('workspace-a')).toBe(false);
            expect(outbox.importLegacy('workspace-a')).toBe(3);
            expect(outbox.importLegacy('workspace-a')).toBe(0);
            expect(fs.existsSync(ledger())).toBe(true);
            const imported = outbox.list('workspace-a');
            expect(imported.map(row => [row.requestId, row.role, row.state])).toEqual([
                ['delivered-no-answer', 'user', 'delivered'],
                ['answered', 'user', 'delivered'],
                ['answered', 'assistant', 'ambiguous'],
            ]);
            expect(imported[2]).toMatchObject({ failure: 'unknown' });
            expect(imported[2]).not.toHaveProperty('attemptId');
            expect(imported[0].outboundIds).toEqual(['out-1']);
            expect(outbox.activeRequests(0, 32).map(row => row.requestId)).toEqual(['delivered-no-answer']);
            expect(outbox.requestState('workspace-a', 'sentinel', 'answered')?.answer).toBe('materialized');
            expect(outbox.receipts(0, 10).map(receipt => receipt.outboundId)).toEqual(['out-1', 'out-2']);
            // Runtime never reads JSON again: later edits to the original file are ignored.
            fs.writeFileSync(ledger(), 'not json');
            expect(outbox.importLegacy('workspace-a')).toBe(0);
            expect(outbox.list('workspace-a')).toHaveLength(3);
        });

        it('marks a workspace without a legacy ledger as imported', () => {
            expect(outbox.importLegacy('workspace-a')).toBe(0);
            expect(outbox.isImported('workspace-a')).toBe(true);
        });

        it.each(['malformed-json', 'wrong-owner', 'duplicate', 'invalid-progress', 'extra-routing'] as const)(
            'fails visibly on %s input and preserves the source file', corruption => {
                const rows = legacyRows();
                if (corruption === 'wrong-owner') rows[0].workspaceId = 'workspace-b';
                if (corruption === 'duplicate') rows.push(rows[0]);
                if (corruption === 'invalid-progress') rows[0].nextPart = 10;
                const raw = corruption === 'malformed-json' ? 'private message fragment'
                    : corruption === 'extra-routing' ? JSON.stringify(rows).replace('"bindingId":"binding"', '"bindingId":"binding","secret":"sensitive"')
                        : JSON.stringify(rows);
                fs.mkdirSync(path.dirname(ledger()), { recursive: true });
                fs.writeFileSync(ledger(), raw);
                expect(() => outbox.importLegacy('workspace-a')).toThrow(SentinelMirrorImportError);
                try { outbox.importLegacy('workspace-a'); } catch (error) {
                    expect(String(error)).not.toMatch(/private|sensitive/);
                }
                expect(fs.readFileSync(ledger(), 'utf8')).toBe(raw);
                expect(outbox.isImported('workspace-a')).toBe(false);
                expect(outbox.list('workspace-a')).toEqual([]);
            });
    });
});
