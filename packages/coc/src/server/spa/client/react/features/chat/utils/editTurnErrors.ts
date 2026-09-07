import { getSpaCocClientErrorMessage } from '../../../api/cocClient';

/** Pull the typed `code` out of an API error body, when the error carries one. */
function extractErrorCode(err: unknown): string | null {
    const body = (err as { body?: unknown } | null)?.body;
    if (body && typeof body === 'object') {
        const code = (body as Record<string, unknown>).code;
        if (typeof code === 'string') return code;
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
