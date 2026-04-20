/**
 * Utility to detect pure-JSON content in AI responses.
 */

/**
 * Returns true if `content` is a valid JSON object or array (not a primitive).
 * Only call on non-streaming (finalized) content.
 */
export function isJsonResponse(content: string): boolean {
    const trimmed = content.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false;
    try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed === 'object' && parsed !== null;
    } catch {
        return false;
    }
}
