import { CocApiError, isChatStyle } from '@plusplusoneplusplus/coc-client';
import { resolveSentinelTodoMessageContext, type SentinelTodoMessageTarget } from './sentinelTodoMessageContext';

type Gates = Parameters<typeof resolveSentinelTodoMessageContext>[1];
export type SentinelTodoMessageAdmissionResult =
    | { kind: 'admitted'; processId: string; turnIndex: number }
    | { kind: 'blocked'; reason: 'pending' | 'admitted' | 'duplicate-confirmation-required' }
    | { kind: 'failed'; error: string; uncertain: boolean };

const unconfirmed = 'Delivery is unconfirmed. Retrying may queue a duplicate.';
// These route responses reject admission. Timeouts and server/proxy failures do not prove non-delivery.
const rejectionStatuses = new Set([400, 401, 403, 404, 409, 410, 413, 422, 429]);

/** One in-memory dialog attempt. No composer, session, navigation or persistent state. */
export function createSentinelTodoMessageAdmission(target: SentinelTodoMessageTarget) {
    let pending = false;
    let admitted = false;
    let uncertain = false;

    async function attempt(text: string, gates: Gates, signal: AbortSignal, duplicateConfirmed: boolean): Promise<SentinelTodoMessageAdmissionResult> {
        if (pending) return { kind: 'blocked', reason: 'pending' };
        if (admitted) return { kind: 'blocked', reason: 'admitted' };
        if (uncertain && !duplicateConfirmed) return { kind: 'blocked', reason: 'duplicate-confirmation-required' };
        // Set before the first await, including the authoritative reads.
        pending = true;
        let dispatched = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            if (!text.trim()) throw new Error('Write a message before queuing.');
            const prepared = await resolveSentinelTodoMessageContext(target, gates, signal);
            const style = prepared.process.metadata?.chatStyle;
            // Omit model/effort/provider/mode: the existing destination follow-up policy resolves them.
            const request = {
                content: `${prepared.context}\n\n${text.trim()}`,
                deliveryMode: 'enqueue' as const,
                chatStyle: isChatStyle(style) ? style : 'default' as const,
            };
            prepared.assertCurrent();
            dispatched = true;
            // The public send API has no per-call abort option. A deadline settles the UI without
            // claiming cancellation or retrying the write; late responses cannot change this attempt.
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(unconfirmed)), 30_000);
            });
            const response = await Promise.race([
                prepared.client.processes.sendMessage(target.owner.processId, request, { workspace: target.owner.ownerWorkspaceId }),
                timeout,
            ]);
            if (response?.processId !== target.owner.processId
                || typeof response.turnIndex !== 'number' || !Number.isSafeInteger(response.turnIndex) || response.turnIndex < -1) {
                throw new Error(unconfirmed);
            }
            admitted = true;
            uncertain = false;
            return { kind: 'admitted', processId: target.owner.processId, turnIndex: response.turnIndex };
        } catch (error) {
            const rejected = error instanceof CocApiError && rejectionStatuses.has(error.status);
            // A failed preflight/rejected retry cannot erase uncertainty from an earlier attempt.
            if (dispatched && !rejected) uncertain = true;
            const detail = error instanceof CocApiError && error.status === 410
                ? 'The owning Sentinel session has ended. Keep this draft and check its conversation.'
                : error instanceof Error ? error.message : 'Could not queue the message. Try again.';
            return { kind: 'failed', error: uncertain ? `${unconfirmed}${detail === unconfirmed ? '' : ` ${detail}`}` : detail, uncertain };
        } finally {
            if (timer !== undefined) clearTimeout(timer);
            pending = false;
        }
    }

    return {
        submit: (text: string, gates: Gates, signal: AbortSignal) => attempt(text, gates, signal, false),
        /** Call only from a separate explicit duplicate-risk confirmation action. */
        retryAfterDuplicateConfirmation: (text: string, gates: Gates, signal: AbortSignal) => attempt(text, gates, signal, true),
    };
}
