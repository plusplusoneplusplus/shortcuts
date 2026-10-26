import type { TrouterMessageUpdate } from '@plusplusoneplusplus/coc-connector/teams';
import type { TeamsRobotReactionEvidence } from './teams-reaction-admission';

export type TeamsReactionEvidenceResult =
    | { kind: 'evidence'; evidence: TeamsRobotReactionEvidence }
    | { kind: 'ignored'; reason: 'unsupported-source' | 'invalid-event-time' | 'invalid-emotions' };

const mriPattern = /^8:orgid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const utcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/;

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function eventTimestamp(value: unknown): number | undefined {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : undefined;
    if (typeof value !== 'string' || !utcPattern.test(value)) return undefined;
    const timestamp = Date.parse(value);
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0
        || new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)) return undefined;
    return timestamp;
}

/** Native snapshot normalization only; the registered-session gate still decides live admission. */
export function normalizeTeamsRobotReaction(update: TrouterMessageUpdate): TeamsReactionEvidenceResult {
    const { conversationId, messageId } = update;
    if (typeof conversationId !== 'string' || (conversationId !== '48:notes'
        && !/^19:[^\s/\\?#]+@(?:thread\.v2|unq\.gbl\.spaces)$/.test(conversationId))
        || typeof messageId !== 'string' || !messageId || messageId.length > 4096
        || /[\u0000-\u0020/\\?#]/.test(messageId)) {
        return { kind: 'ignored', reason: 'unsupported-source' };
    }
    const eventAt = eventTimestamp(update.eventTime);
    if (eventAt === undefined) return { kind: 'ignored', reason: 'invalid-event-time' };
    let emotions = update.emotions;
    if (typeof emotions === 'string') {
        if (Buffer.byteLength(emotions, 'utf8') > 256 * 1024) return { kind: 'ignored', reason: 'invalid-emotions' };
        try { emotions = JSON.parse(emotions); }
        catch { return { kind: 'ignored', reason: 'invalid-emotions' }; }
    }
    if (!Array.isArray(emotions) || emotions.length > 256) return { kind: 'ignored', reason: 'invalid-emotions' };
    const keys = new Set<string>();
    const robotUsers: { mri: string; addedAt: number }[] = [];
    for (const emotion of emotions) {
        if (!record(emotion) || typeof emotion.key !== 'string' || !emotion.key || emotion.key.length > 128
            || keys.has(emotion.key)) return { kind: 'ignored', reason: 'invalid-emotions' };
        keys.add(emotion.key);
        if (emotion.key !== 'smilerobot') continue;
        if (!Array.isArray(emotion.users) || emotion.users.length > 4096) {
            return { kind: 'ignored', reason: 'invalid-emotions' };
        }
        const actors = new Set<string>();
        for (const user of emotion.users) {
            if (!record(user) || typeof user.mri !== 'string' || !mriPattern.test(user.mri)
                || typeof user.time !== 'number' || !Number.isSafeInteger(user.time)
                || user.time <= 0 || user.time > eventAt) {
                return { kind: 'ignored', reason: 'invalid-emotions' };
            }
            const mri = user.mri.toLowerCase();
            if (actors.has(mri)) return { kind: 'ignored', reason: 'invalid-emotions' };
            actors.add(mri);
            robotUsers.push({ mri, addedAt: user.time });
        }
    }
    return { kind: 'evidence', evidence: { conversationId, messageId, eventAt, robotUsers } };
}
