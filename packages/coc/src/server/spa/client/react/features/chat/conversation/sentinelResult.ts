import { z } from 'zod';
import { SENTINEL_JOB_REVIEW_PREFIX } from '../../../../../../delegation/sentinel-job-review-instructions';
import type { ClientConversationTurn } from '../../../types/dashboard';
import { buildRemoteCloneKey, parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import { lookupCloneBaseUrl } from '../../../repos/cloneRegistry';

const id = z.string().min(1);
const resultSchema = z.object({
    parent: z.object({ workspaceId: id, processId: id }).strict(),
    child: z.object({ workspaceId: id, processId: id, sessionId: id.optional() }).strict(),
    jobId: id,
    title: z.string().min(1).max(80),
    repository: z.object({ workspaceId: id, name: z.string().optional(), rootPath: z.string().optional() }).strict(),
    terminalEventId: id,
    outcome: z.enum(['completed', 'failed', 'cancelled', 'capped']),
    summary: z.string().max(8_000),
    reason: z.string().max(2_000).optional(),
    links: z.array(z.string().min(1).max(2_000)).max(20),
    todo: z.object({
        id, revision: z.number().int().nonnegative(), title: z.string(),
        completionCondition: z.string(), status: z.string(),
    }).strict().optional(),
}).strict();

export interface SentinelResult {
    data: z.infer<typeof resultSchema>;
    rawJson: string;
}

/** Fail closed: quoted JSON and ordinary user prompts are not automated result deliveries. */
export function parseSentinelResult(
    turn: ClientConversationTurn, text: string, workspaceId?: string, processId?: string,
): SentinelResult | null {
    if (turn.role !== 'user' || turn.streaming || turn.displayOnly || turn.pasteExternalized
        || !/^delegated-review-[a-f0-9]{64}$/.test(turn.relayRequestId ?? '')
        || !workspaceId || !processId
        || !text.startsWith(`${SENTINEL_JOB_REVIEW_PREFIX}\n`)) return null;
    const rawJson = text.slice(SENTINEL_JOB_REVIEW_PREFIX.length + 1);
    let value: unknown;
    try {
        value = JSON.parse(rawJson);
    } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
    }
    const parsed = resultSchema.safeParse(value);
    if (!parsed.success) return null;
    const data = parsed.data;
    if (data.parent.workspaceId !== workspaceId || data.parent.processId !== processId
        || data.repository.workspaceId !== data.child.workspaceId
        || data.jobId !== data.child.processId) return null;
    return { data, rawJson };
}

/** Child-supplied links never select a server. Local children inherit the conversation's owner. */
export function sentinelResultJobHref(result: SentinelResult, sourceSelectionId?: string, sourceBaseUrl?: string): string | null {
    const owner = parseRemoteCloneKey(sourceSelectionId);
    const selectionId = owner
        ? buildRemoteCloneKey(owner.serverId, result.data.child.workspaceId)
        : result.data.child.workspaceId;
    const hash = `#repos/${encodeURIComponent(selectionId)}/chats/${encodeURIComponent(result.data.child.processId)}`;
    // Explicit owner endpoints take precedence over registry routing.
    if (sourceBaseUrl) {
        let url: URL;
        try {
            url = new URL(sourceBaseUrl, window.location.href);
        } catch (error) {
            if (error instanceof TypeError) return null;
            throw error;
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        url.hash = `repos/${encodeURIComponent(result.data.child.workspaceId)}/chats/${encodeURIComponent(result.data.child.processId)}`;
        return url.href;
    }
    if (owner) return hash;
    if (sourceSelectionId?.startsWith('remote:')) return null;
    if (!sourceSelectionId && lookupCloneBaseUrl(result.data.parent.workspaceId)) return null;
    return hash;
}
