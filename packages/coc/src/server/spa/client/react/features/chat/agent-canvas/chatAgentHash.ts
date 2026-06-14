// Deep-link helper for the selected sub-agent in the Agents view. The chosen
// sub-agent rides as an `agent=<id>` query param on the chat hash, coexisting
// with `view=agents`. Pure string functions, mirroring chatViewHash.ts.

/** Read the selected sub-agent id from a raw `location.hash`, or null if unset. */
export function readAgentFromHash(rawHash: string): string | null {
    const qIndex = rawHash.indexOf('?');
    if (qIndex < 0) {
        return null;
    }
    const agent = new URLSearchParams(rawHash.slice(qIndex + 1)).get('agent');
    return agent && agent.trim() ? agent : null;
}

/**
 * Return `rawHash` with the `agent` param set to `agentId`, or removed when
 * `agentId` is null. Preserves the path, leading `#`, and any other query params
 * (including `view`). Returns a value directly comparable to `location.hash`.
 */
export function applyAgentToHash(rawHash: string, agentId: string | null): string {
    const hasLeadingHash = rawHash.startsWith('#');
    const body = hasLeadingHash ? rawHash.slice(1) : rawHash;
    const qIndex = body.indexOf('?');
    const path = qIndex < 0 ? body : body.slice(0, qIndex);
    const params = new URLSearchParams(qIndex < 0 ? '' : body.slice(qIndex + 1));
    if (agentId) {
        params.set('agent', agentId);
    } else {
        params.delete('agent');
    }
    const query = params.toString();
    const result = query ? `${path}?${query}` : path;
    return (hasLeadingHash ? '#' : '') + result;
}
