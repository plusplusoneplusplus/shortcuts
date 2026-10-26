import { createHash } from 'node:crypto';

const maxAgeMs = 30_000;
const maxTargets = 4096;
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A native adapter must establish these facts; raw emotions are not this contract. */
export interface TeamsRobotReactionEvidence {
    conversationId: string;
    messageId: string;
    eventAt: number;
    /** Complete Robot membership for this target, not all reactions or a partial delta. */
    robotUsers: readonly { mri: string; addedAt: number }[];
}

export type TeamsReactionAdmission =
    | { admitted: true; requestId: string; conversationId: string; messageId: string }
    | { admitted: false; reason: 'invalid-evidence' | 'stale' | 'absent' | 'duplicate' | 'out-of-order' | 'capacity' };

/** One instance per registered account/session; reconnect establishes a new live cutoff. */
export function createTeamsReactionAdmission(
    account: { tenantId: string; userId: string },
    startedAt: number,
) {
    if (!guid.test(account.tenantId) || !guid.test(account.userId)
        || !Number.isSafeInteger(startedAt) || startedAt <= 0) {
        throw new Error('Invalid Teams reaction admission session.');
    }
    const tenantId = account.tenantId.toLowerCase();
    const userId = account.userId.toLowerCase();
    const ownMri = `8:orgid:${userId}`;
    const targets = new Map<string, { eventAt: number; ownAt: number | null; latestAddition: number }>();
    let lastNow = startedAt;

    return (evidence: TeamsRobotReactionEvidence, receivedAt = Date.now()): TeamsReactionAdmission => {
        if (!Number.isSafeInteger(receivedAt) || receivedAt < lastNow) {
            return { admitted: false, reason: 'invalid-evidence' };
        }
        lastNow = receivedAt;
        const { conversationId, messageId, eventAt, robotUsers } = evidence;
        if ((conversationId !== '48:notes'
            && !/^19:[^\s/\\?#]+@(?:thread\.v2|unq\.gbl\.spaces)$/.test(conversationId))
            || typeof messageId !== 'string' || !messageId || messageId.length > 4096
            || /[\u0000-\u0020/\\?#]/.test(messageId)
            || !Number.isSafeInteger(eventAt) || eventAt <= 0
            || !Array.isArray(robotUsers) || robotUsers.length > 4096) {
            return { admitted: false, reason: 'invalid-evidence' };
        }
        if (eventAt <= startedAt || eventAt < receivedAt - maxAgeMs || eventAt > receivedAt) {
            return { admitted: false, reason: 'stale' };
        }
        const actors = new Set<string>();
        let ownAt: number | null = null;
        for (const actor of robotUsers) {
            if (!actor || typeof actor.mri !== 'string' || !/^8:orgid:[0-9a-f-]{36}$/i.test(actor.mri)
                || !guid.test(actor.mri.slice('8:orgid:'.length))
                || !Number.isSafeInteger(actor.addedAt) || actor.addedAt <= 0 || actor.addedAt > eventAt) {
                return { admitted: false, reason: 'invalid-evidence' };
            }
            const mri = actor.mri.toLowerCase();
            if (actors.has(mri)) return { admitted: false, reason: 'invalid-evidence' };
            actors.add(mri);
            if (mri === ownMri) ownAt = actor.addedAt;
        }
        for (const [key, target] of targets) {
            if (target.eventAt < receivedAt - maxAgeMs) targets.delete(key);
        }
        const key = JSON.stringify([conversationId, messageId]);
        const previous = targets.get(key);
        if (previous && (eventAt < previous.eventAt
            || (eventAt === previous.eventAt && ownAt !== previous.ownAt)
            || (ownAt !== null && ownAt < previous.latestAddition))) {
            return { admitted: false, reason: 'out-of-order' };
        }
        if (!previous && targets.size >= maxTargets) return { admitted: false, reason: 'capacity' };
        targets.set(key, { eventAt, ownAt, latestAddition: Math.max(previous?.latestAddition ?? 0, ownAt ?? 0) });
        if (ownAt === null) return { admitted: false, reason: 'absent' };
        if (ownAt <= startedAt || ownAt < receivedAt - maxAgeMs) return { admitted: false, reason: 'stale' };
        if (previous && ownAt <= previous.latestAddition) return { admitted: false, reason: 'duplicate' };
        const digest = createHash('sha256')
            .update(JSON.stringify([tenantId, userId, conversationId, messageId, ownAt])).digest('hex');
        return { admitted: true, requestId: `teams-reaction-${digest}`, conversationId, messageId };
    };
}
