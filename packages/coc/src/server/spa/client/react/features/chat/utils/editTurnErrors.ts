import { getSpaCocClientErrorMessage } from '../../../api/cocClient';

/**
 * Pull the typed `code` out of an API error, when the error carries one.
 *
 * `CocApiError` already lifts the code to a top-level field, and that is where
 * it actually shows up: the server answers through `handleAPIError`, whose body
 * is `{ error: { code, message } }`, so a bare `body.code` is never populated
 * for these routes. Both nestings are still read as a fallback for error shapes
 * that never went through the typed client.
 */
function extractErrorCode(err: unknown): string | null {
    const e = err as { code?: unknown; body?: unknown } | null;
    if (typeof e?.code === 'string') return e.code;
    const body = e?.body;
    if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        const nested = record.error;
        if (nested && typeof nested === 'object') {
            const code = (nested as Record<string, unknown>).code;
            if (typeof code === 'string') return code;
        }
        if (typeof record.code === 'string') return record.code;
    }
    return null;
}

/**
 * Turn a failed rewind into a message that fits under the inline editor.
 *
 * The one code worth rewriting is `CONVERSATION_NOT_IDLE` (409): the server's
 * own wording talks about rewinding, which is an implementation detail the
 * "Edit message" user never asked for. Everything else already carries a
 * readable server message, so it passes through unchanged.
 */
export function getEditTurnRewindErrorMessage(err: unknown): string {
    if (extractErrorCode(err) === 'CONVERSATION_NOT_IDLE') {
        return 'Could not edit — the conversation is busy. Wait for it to finish, then try again.';
    }
    return getSpaCocClientErrorMessage(err, 'Failed to edit the message.');
}
