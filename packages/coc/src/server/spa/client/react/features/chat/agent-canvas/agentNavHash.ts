// Deep-link helpers for the chat's agent navigation state. Back-compat:
// `?agent=<id>` opens that agent, `?view=agents` opens the map, and no params
// opens the thread. Writing keeps the legacy `view=agents` vocabulary for map.

export type AgentNav =
    | { kind: 'thread' }
    | { kind: 'map' }
    | { kind: 'agent'; id: string };

function splitHash(rawHash: string): { hasLeadingHash: boolean; path: string; params: URLSearchParams } {
    const hasLeadingHash = rawHash.startsWith('#');
    const body = hasLeadingHash ? rawHash.slice(1) : rawHash;
    const qIndex = body.indexOf('?');
    const path = qIndex < 0 ? body : body.slice(0, qIndex);
    const params = new URLSearchParams(qIndex < 0 ? '' : body.slice(qIndex + 1));
    return { hasLeadingHash, path, params };
}

function joinHash(hasLeadingHash: boolean, path: string, params: URLSearchParams): string {
    const query = params.toString();
    const result = query ? `${path}?${query}` : path;
    return (hasLeadingHash ? '#' : '') + result;
}

export function readAgentNavFromHash(hash: string): AgentNav {
    const qIndex = hash.indexOf('?');
    if (qIndex < 0) {
        return { kind: 'thread' };
    }
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    const agent = params.get('agent');
    if (agent && agent.trim()) {
        return { kind: 'agent', id: agent };
    }
    if (params.get('view') === 'agents') {
        return { kind: 'map' };
    }
    return { kind: 'thread' };
}

export function applyAgentNavToHash(hash: string, nav: AgentNav): string {
    const { hasLeadingHash, path, params } = splitHash(hash);
    params.delete('agent');
    params.delete('view');
    if (nav.kind === 'map') {
        params.set('view', 'agents');
    } else if (nav.kind === 'agent') {
        params.set('agent', nav.id);
    }
    return joinHash(hasLeadingHash, path, params);
}
