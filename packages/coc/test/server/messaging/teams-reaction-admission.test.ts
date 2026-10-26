import { describe, expect, it } from 'vitest';
import { createTeamsReactionAdmission, type TeamsRobotReactionEvidence } from '../../../src/server/messaging/teams-reaction-admission';

const account = { tenantId: '11111111-1111-4111-8111-111111111111', userId: '22222222-2222-4222-8222-222222222222' };
const other = '8:orgid:33333333-3333-4333-8333-333333333333';
const start = 1_800_000_000_000;
const own = (addedAt = start + 1) => ({ mri: `8:orgid:${account.userId}`, addedAt });
const evidence = (changes: Partial<TeamsRobotReactionEvidence> = {}): TeamsRobotReactionEvidence => ({
    conversationId: '48:notes', messageId: 'old-message', eventAt: start + 2, robotUsers: [own()], ...changes,
});
const gate = () => createTeamsReactionAdmission(account, start);

describe('Teams live Robot admission', () => {
    it.each(['48:notes', '19:direct@unq.gbl.spaces', '19:group@thread.v2'])(
        'admits exact own identity in %s without requiring target author or age', conversationId => {
            expect(gate()(evidence({ conversationId }), start + 3)).toMatchObject({
                admitted: true, conversationId, messageId: 'old-message', requestId: expect.stringMatching(/^teams-reaction-[a-f0-9]{64}$/),
            });
        },
    );

    it('normalizes account/MRI casing and snapshots the account at construction', () => {
        const local = { ...account };
        const admit = createTeamsReactionAdmission(local, start);
        local.userId = other.slice('8:orgid:'.length);
        expect(admit(evidence({ robotUsers: [{ ...own(), mri: own().mri.toUpperCase() }] }), start + 3).admitted).toBe(true);
    });

    it.each([
        { robotUsers: [] }, { robotUsers: [{ mri: other, addedAt: start + 1 }] },
    ])('ignores absent and foreign Robot membership', ({ robotUsers }) => {
        expect(gate()(evidence({ robotUsers }), start + 3)).toEqual({ admitted: false, reason: 'absent' });
    });

    it('deduplicates repeated snapshots and updates caused by other users', () => {
        const admit = gate();
        expect(admit(evidence(), start + 3).admitted).toBe(true);
        expect(admit(evidence(), start + 3)).toEqual({ admitted: false, reason: 'duplicate' });
        expect(admit(evidence({ eventAt: start + 4, robotUsers: [own(), { mri: other, addedAt: start + 4 }] }), start + 5))
            .toEqual({ admitted: false, reason: 'duplicate' });
    });

    it('admits a removal/re-add as a distinct request without replaying an earlier addition', () => {
        const admit = gate();
        const first = admit(evidence(), start + 3);
        expect(admit(evidence({ eventAt: start + 4, robotUsers: [] }), start + 5))
            .toEqual({ admitted: false, reason: 'absent' });
        expect(admit(evidence({ eventAt: start + 6 }), start + 7))
            .toEqual({ admitted: false, reason: 'duplicate' });
        const second = admit(evidence({ eventAt: start + 8, robotUsers: [own(start + 8)] }), start + 9);
        expect(second.admitted).toBe(true);
        expect(second).not.toEqual(first);
    });

    it('accepts a timestamp-distinct re-add even when its intervening removal was not delivered', () => {
        const admit = gate();
        admit(evidence(), start + 3);
        expect(admit(evidence({ eventAt: start + 4, robotUsers: [own(start + 4)] }), start + 5).admitted).toBe(true);
    });

    it('rejects ambiguous same-millisecond membership changes', () => {
        const admit = gate();
        admit(evidence(), start + 3);
        expect(admit(evidence({ robotUsers: [] }), start + 3)).toEqual({ admitted: false, reason: 'out-of-order' });
    });

    it('rejects older snapshots, including late removals and old additions with newer envelope times', () => {
        const admit = gate();
        admit(evidence({ eventAt: start + 10, robotUsers: [own(start + 9)] }), start + 11);
        expect(admit(evidence({ robotUsers: [] }), start + 12)).toEqual({ admitted: false, reason: 'out-of-order' });
        expect(admit(evidence({ eventAt: start + 13 }), start + 14)).toEqual({ admitted: false, reason: 'out-of-order' });
    });

    it.each([
        { eventAt: start }, { eventAt: start + 4 },
        { robotUsers: [own(start)] }, { robotUsers: [own(start - 1)] },
    ])('rejects pre-session or future evidence %j', changes => {
        expect(gate()(evidence(changes), start + 3)).toEqual({ admitted: false, reason: 'stale' });
    });

    it('does not catch up an old addition in a fresh envelope after reconnect', () => {
        const first = gate()(evidence(), start + 3);
        expect(first.admitted).toBe(true);
        const reconnected = createTeamsReactionAdmission(account, start + 10);
        expect(reconnected(evidence({ eventAt: start + 11 }), start + 12)).toEqual({ admitted: false, reason: 'stale' });
        expect(reconnected(evidence({ eventAt: start + 13, robotUsers: [own(start + 13)] }), start + 14).admitted).toBe(true);
    });

    it('uses stable request identity across independent observers but isolates account, chat and target', () => {
        const result = gate()(evidence(), start + 3);
        expect(gate()(evidence(), start + 3)).toEqual(result);
        expect(gate()(evidence({ messageId: 'another' }), start + 3)).not.toEqual(result);
        expect(gate()(evidence({ conversationId: '19:group@thread.v2' }), start + 3)).not.toEqual(result);
        expect(createTeamsReactionAdmission({ ...account, tenantId: account.userId }, start)(evidence(), start + 3)).not.toEqual(result);
    });

    it('keeps independent message targets separate', () => {
        const admit = gate();
        expect(admit(evidence(), start + 3).admitted).toBe(true);
        expect(admit(evidence({ messageId: 'another' }), start + 3).admitted).toBe(true);
    });

    it('measures the exact 30-second event and addition freshness boundary', () => {
        expect(gate()(evidence(), start + 30_001).admitted).toBe(true);
        expect(gate()(evidence(), start + 30_002)).toEqual({ admitted: false, reason: 'stale' });
        expect(gate()(evidence({ eventAt: start + 30_002 }), start + 30_002)).toEqual({ admitted: false, reason: 'stale' });
    });

    it.each(['48:notifications', '19:channel@thread.tacv2', '19:meeting@thread.skype', '', '19:bad/path@thread.v2'])(
        'rejects unsupported or unsafe chat %j', conversationId => {
            expect(gate()(evidence({ conversationId }), start + 3)).toEqual({ admitted: false, reason: 'invalid-evidence' });
        },
    );

    it.each(['', 'bad/id', 'bad\\id', 'bad\nid', 'bad id', 'bad?id', 'x'.repeat(4097)])(
        'rejects unsafe message IDs', messageId => {
            expect(gate()(evidence({ messageId }), start + 3)).toEqual({ admitted: false, reason: 'invalid-evidence' });
        },
    );

    it.each([NaN, Infinity, 0, -1, start + 0.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid event times %s', eventAt => {
            expect(gate()(evidence({ eventAt }), start + 3)).toEqual({ admitted: false, reason: 'invalid-evidence' });
        },
    );

    it.each([
        [{ ...own(), addedAt: NaN }], [{ ...own(), addedAt: start + 3 }], [{ ...own(), addedAt: 0 }],
        [{ ...own(), mri: account.userId }], [{ ...own(), mri: `8:orgid:${account.userId}-suffix` }],
        [own(), own()], [own(), { ...own(), mri: own().mri.toUpperCase() }],
        Array.from({ length: 4097 }, () => own()),
    ].map(robotUsers => ({ robotUsers })))('rejects invalid or ambiguous actor evidence', ({ robotUsers }) => {
        expect(gate()(evidence({ robotUsers }), start + 3)).toEqual({ admitted: false, reason: 'invalid-evidence' });
    });

    it('does not mutate caller evidence or retain a mutable actor array', () => {
        const admit = gate();
        const input = evidence();
        const before = structuredClone(input);
        admit(input, start + 3);
        expect(input).toEqual(before);
        input.robotUsers = [];
        expect(admit(evidence(), start + 3)).toEqual({ admitted: false, reason: 'duplicate' });
    });

    it('rejects clock rollback without reopening an addition', () => {
        const admit = gate();
        admit(evidence(), start + 5);
        expect(admit(evidence(), start + 4)).toEqual({ admitted: false, reason: 'invalid-evidence' });
        expect(admit(evidence(), start + 5)).toEqual({ admitted: false, reason: 'duplicate' });
    });

    it('bounds fresh target state without evicting deduplication evidence and safely expires old entries', () => {
        const admit = gate();
        for (let index = 0; index < 4096; index++) {
            expect(admit(evidence({ messageId: String(index) }), start + 3).admitted).toBe(true);
        }
        expect(admit(evidence({ messageId: 'overflow' }), start + 3)).toEqual({ admitted: false, reason: 'capacity' });
        expect(admit(evidence({ messageId: '0' }), start + 3)).toEqual({ admitted: false, reason: 'duplicate' });
        expect(admit(evidence({ messageId: 'overflow', eventAt: start + 30_003, robotUsers: [own(start + 30_003)] }), start + 30_003).admitted)
            .toBe(true);
        expect(admit(evidence({ messageId: '0', eventAt: start + 30_004 }), start + 30_004))
            .toEqual({ admitted: false, reason: 'stale' });
    });

    it.each([
        { ...account, userId: '' }, { ...account, tenantId: 'invalid' },
    ])('rejects an unpinned account at construction', invalid => {
        expect(() => createTeamsReactionAdmission(invalid, start)).toThrow('Invalid Teams reaction admission session.');
    });

    it.each([NaN, Infinity, 0, -1, start + 0.5])('rejects invalid session cutoffs', cutoff => {
        expect(() => createTeamsReactionAdmission(account, cutoff)).toThrow('Invalid Teams reaction admission session.');
    });
});
