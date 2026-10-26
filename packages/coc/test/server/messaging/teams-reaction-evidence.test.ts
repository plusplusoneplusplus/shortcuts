import { describe, expect, it } from 'vitest';
import type { TrouterMessageUpdate } from '@plusplusoneplusplus/coc-connector/teams';
import { createTeamsReactionAdmission } from '../../../src/server/messaging/teams-reaction-admission';
import { normalizeTeamsRobotReaction } from '../../../src/server/messaging/teams-reaction-evidence';

const account = { tenantId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' };
const start = Date.parse('2026-01-01T00:00:00.000Z');
const own = (time = start + 1) => ({ mri: `8:orgid:${account.userId}`, time, value: '' });
const robot = (users: unknown = [own()]) => ({ key: 'smilerobot', users });
const update = (changes: Partial<TrouterMessageUpdate> = {}): TrouterMessageUpdate => ({
    conversationId: '48:notes', messageId: 'historical-target', eventTime: new Date(start + 2).toISOString(),
    emotions: [robot()], ...changes,
});
const invalidEmotions = { kind: 'ignored', reason: 'invalid-emotions' };

describe('Teams native Robot evidence normalization', () => {
    it.each(['48:notes', '19:direct@unq.gbl.spaces', '19:group@thread.v2'])(
        'normalizes exact source and captured Robot membership shape for %s', conversationId => {
            expect(normalizeTeamsRobotReaction(update({ conversationId, rootMessageId: 'untrusted-parent' }))).toEqual({
                kind: 'evidence', evidence: {
                    conversationId, messageId: 'historical-target', eventAt: start + 2,
                    robotUsers: [{ mri: own().mri, addedAt: start + 1 }],
                },
            });
        },
    );

    it.each([start + 2, '2026-01-01T00:00:00.002Z', '2026-01-01T00:00:00.0020000Z'])(
        'accepts explicit millisecond or UTC event timestamps: %j', eventTime => {
            expect(normalizeTeamsRobotReaction(update({ eventTime }))).toMatchObject({
                kind: 'evidence', evidence: { eventAt: start + 2 },
            });
        },
    );

    it('accepts UTC seconds and submillisecond precision without fabricating a later millisecond', () => {
        expect(normalizeTeamsRobotReaction(update({
            eventTime: '2026-01-01T00:00:01Z', emotions: [robot([own(start + 1000)])],
        }))).toMatchObject({ kind: 'evidence', evidence: { eventAt: start + 1000 } });
        expect(normalizeTeamsRobotReaction(update({ eventTime: '2026-01-01T00:00:00.0029999Z' })))
            .toMatchObject({ kind: 'evidence', evidence: { eventAt: start + 2 } });
    });

    it.each([
        undefined, null, '', 'invalid', String(start + 2), NaN, Infinity, 0, -1, start + 0.5,
        Number.MAX_SAFE_INTEGER + 1, '2026-02-30T00:00:00Z', '2026-01-01', '2026-01-01T00:00:00',
        '2026-01-01T01:00:00+01:00', '2026-01-01T00:00:00.12345678Z', { time: start + 2 },
    ])('rejects missing, coerced, ambiguous or invalid event times: %j', eventTime => {
        expect(normalizeTeamsRobotReaction(update({ eventTime }))).toEqual({
            kind: 'ignored', reason: 'invalid-event-time',
        });
    });

    it('parses one native JSON string layer and captures detached membership', () => {
        const native = robot();
        const original = [native, { key: 'like', users: [{ mri: 'unrelated' }] }];
        const snapshot = structuredClone(original);
        const result = normalizeTeamsRobotReaction(update({ emotions: original }));
        expect(normalizeTeamsRobotReaction(update({ emotions: JSON.stringify(original) }))).toEqual(result);
        expect(original).toEqual(snapshot);
        native.users = [own(start + 2)];
        expect(result).toMatchObject({ kind: 'evidence', evidence: { robotUsers: [{ addedAt: start + 1 }] } });
    });

    it.each([[], '[]', [robot([])], [{ key: 'like', users: [own()] }],
        [{ key: '1f916_robot', users: [own()] }], [{ key: 'SMILEROBOT', users: [own()] }]]
        .map(emotions => ({ emotions })))(
        'preserves empty or absent exact Robot membership: %j', ({ emotions }) => {
            expect(normalizeTeamsRobotReaction(update({ emotions }))).toMatchObject({
                kind: 'evidence', evidence: { robotUsers: [] },
            });
        },
    );

    it.each([
        null, undefined, {}, '', 'null', '{}', '[', JSON.stringify(JSON.stringify([robot()])),
        [null], [1], [{}], [{ key: '' }], [{ key: 42 }], [{ key: 'x'.repeat(129) }],
        [robot(), robot()], [{ key: 'like' }, { key: 'like' }],
        [{ key: 'smilerobot', value: [own()] }], [robot(null)], [robot({})],
        [robot([null])], [robot([{}])], [robot([{ ...own(), mri: account.userId }])],
        [robot([{ ...own(), mri: '8:orgid:not-a-guid' }])], [robot([{ ...own(), time: String(start + 1) }])],
        [robot([{ ...own(), time: 0 }])], [robot([{ ...own(), time: -1 }])],
        [robot([{ ...own(), time: NaN }])], [robot([{ ...own(), time: Infinity }])],
        [robot([{ ...own(), time: undefined, value: String(start + 1) }])],
        [robot([{ ...own(), time: start + 0.5 }])],
        [robot([{ ...own(), time: start + 3 }])], [robot([own(), own()])],
        [robot([own(), { ...own(), mri: own().mri.toUpperCase() }])],
    ].map(emotions => ({ emotions })))('fails closed on malformed or ambiguous membership: %j', ({ emotions }) => {
        expect(normalizeTeamsRobotReaction(update({ emotions }))).toEqual(invalidEmotions);
    });

    it('normalizes MRI casing and retains complete membership, not just the current actor', () => {
        const other = { mri: '8:orgid:33333333-3333-4333-8333-333333333333', time: start, value: '' };
        expect(normalizeTeamsRobotReaction(update({ emotions: [robot([{ ...own(), mri: own().mri.toUpperCase() }, other])] })))
            .toMatchObject({ kind: 'evidence', evidence: { robotUsers: [
                { mri: own().mri, addedAt: start + 1 }, { mri: other.mri, addedAt: start },
            ] } });
    });

    it('enforces exact serialized, reaction and membership limits', () => {
        const empty = '[]';
        expect(normalizeTeamsRobotReaction(update({ emotions: empty + ' '.repeat(256 * 1024 - empty.length) })))
            .toMatchObject({ kind: 'evidence' });
        expect(normalizeTeamsRobotReaction(update({ emotions: empty + ' '.repeat(256 * 1024 - empty.length + 1) })))
            .toEqual(invalidEmotions);
        expect(normalizeTeamsRobotReaction(update({ emotions: '["' + '\u00e9'.repeat(128 * 1024) + '"]' })))
            .toEqual(invalidEmotions);
        const reactions = Array.from({ length: 256 }, (_, index) => ({ key: `other-${index}` }));
        expect(normalizeTeamsRobotReaction(update({ emotions: reactions }))).toMatchObject({ kind: 'evidence' });
        expect(normalizeTeamsRobotReaction(update({ emotions: [...reactions, robot()] }))).toEqual(invalidEmotions);
        const members = Array.from({ length: 4096 }, (_, index) => ({
            mri: `8:orgid:00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`, time: start + 1,
        }));
        const maximum = normalizeTeamsRobotReaction(update({ emotions: [robot(members)] }));
        if (maximum.kind !== 'evidence') throw new Error('Expected normalized evidence.');
        expect(maximum.evidence.robotUsers).toHaveLength(4096);
        expect(normalizeTeamsRobotReaction(update({ emotions: [robot([...members, own()])] }))).toEqual(invalidEmotions);
    });

    it.each(['48:notifications', '19:channel@thread.tacv2', '19:meeting@thread.skype', '', '19:bad/path@thread.v2'])(
        'rejects unsupported source %j', conversationId => {
            expect(normalizeTeamsRobotReaction(update({ conversationId }))).toEqual({
                kind: 'ignored', reason: 'unsupported-source',
            });
        },
    );
    it.each(['', 'bad/id', 'bad\\id', 'bad?id', 'bad id', 'bad\nid', 'x'.repeat(4097)])(
        'rejects invalid exact target %j', messageId => {
            expect(normalizeTeamsRobotReaction(update({ messageId }))).toEqual({
                kind: 'ignored', reason: 'unsupported-source',
            });
        },
    );

    it('composes with live admission for duplicates, removals, re-additions and reconnect replay rejection', () => {
        const gate = createTeamsReactionAdmission(account, start);
        const admit = (native: TrouterMessageUpdate, receivedAt: number) => {
            const normalized = normalizeTeamsRobotReaction(native);
            if (normalized.kind !== 'evidence') throw new Error('Expected normalized evidence.');
            return gate(normalized.evidence, receivedAt);
        };
        const first = admit(update(), start + 3);
        expect(first.admitted).toBe(true);
        expect(admit(update(), start + 3)).toEqual({ admitted: false, reason: 'duplicate' });
        expect(admit(update({ eventTime: start + 4, emotions: [] }), start + 5))
            .toEqual({ admitted: false, reason: 'absent' });
        const readd = update({ eventTime: start + 6, emotions: [robot([own(start + 6)])] });
        const second = admit(readd, start + 7);
        expect(second.admitted).toBe(true);
        expect(second).not.toEqual(first);
        const normalized = normalizeTeamsRobotReaction({ ...readd, eventTime: start + 9 });
        if (normalized.kind !== 'evidence') throw new Error('Expected normalized evidence.');
        expect(createTeamsReactionAdmission(account, start + 8)(normalized.evidence, start + 10))
            .toEqual({ admitted: false, reason: 'stale' });
    });

    it('leaves freshness, own identity and ordering decisions to the session gate', () => {
        for (const [native, now, reason] of [
            [update({ emotions: [robot([{ ...own(), mri: '8:orgid:33333333-3333-4333-8333-333333333333' }])] }), start + 3, 'absent'],
            [update(), start + 30_002, 'stale'],
            [update({ eventTime: start + 40_001, emotions: [robot([own(start + 40_000)])] }), start + 40_000, 'stale'],
        ] as const) {
            const result = normalizeTeamsRobotReaction(native);
            if (result.kind !== 'evidence') throw new Error('Expected normalized evidence.');
            expect(createTeamsReactionAdmission(account, start)(result.evidence, now)).toEqual({ admitted: false, reason });
        }
    });
});
