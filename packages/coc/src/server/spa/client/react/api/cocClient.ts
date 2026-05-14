import { buildApiUrl, CocApiError, CocClient, CocNetworkError, type CocRequestOptions, type QueryPrimitive } from '@plusplusoneplusplus/coc-client';
import { getApiBase, isContainerMode, getCurrentAgentId, isAgentAuthenticated, getAuthenticatedAgentAddress, hasServerSideAuth } from '../utils/config';
import { relayFetch } from '../utils/agent-relay';

let cachedClient: CocClient | undefined;
let cachedKey = '';
let cachedFetch: typeof fetch | undefined;

function toLegacyFetchInit(init?: RequestInit): RequestInit {
    if (!init) return {};

    const next: RequestInit = {};
    if (init.method && init.method !== 'GET') {
        next.method = init.method;
    }
    if (init.body !== undefined) {
        next.body = init.body;
    }
    if (init.signal !== undefined) {
        next.signal = init.signal;
    }
    if (init.headers instanceof Headers) {
        const headers: Record<string, string> = {};
        init.headers.forEach((value, key) => {
            headers[key.toLowerCase() === 'content-type' ? 'Content-Type' : key] = value;
        });
        if (Object.keys(headers).length > 0) {
            next.headers = headers;
        }
    } else if (init.headers !== undefined) {
        next.headers = init.headers;
    }

    return next;
}

/**
 * Create a relay-aware fetch function. For authenticated devtunnel agents,
 * routes requests through the agent relay popup instead of the container proxy.
 */
function createRelayAwareFetch(): typeof fetch {
    return ((input: RequestInfo | URL, init?: RequestInit) => {
        const cleanInit = toLegacyFetchInit(init);

        // Check if current agent is an authenticated devtunnel agent
        if (isContainerMode()) {
            const agentId = getCurrentAgentId();
            // If agent has server-side tunnel auth, skip relay — let
            // the request go to the container proxy which injects the token
            if (agentId && hasServerSideAuth(agentId)) {
                return fetch(input, cleanInit);
            }
            if (agentId && isAgentAuthenticated(agentId)) {
                const agentAddr = getAuthenticatedAgentAddress(agentId);
                if (agentAddr) {
                    // Rewrite the URL: /api/agent/<id>/path → /api/path (on agent domain)
                    const inputStr = typeof input === 'string' ? input : input.toString();
                    const agentPrefix = `/api/agent/${encodeURIComponent(agentId)}`;
                    if (inputStr.startsWith(agentPrefix)) {
                        const agentPath = inputStr.slice(agentPrefix.length) || '/';
                        const apiPath = '/api' + agentPath;
                        const headers: Record<string, string> = {};
                        if (cleanInit.headers && typeof cleanInit.headers === 'object' && !Array.isArray(cleanInit.headers)) {
                            Object.assign(headers, cleanInit.headers);
                        }
                        return relayFetch(agentAddr, apiPath, {
                            method: (cleanInit.method as string) || 'GET',
                            headers,
                            body: cleanInit.body as string | undefined,
                        }).then(({ status, data }) => {
                            // Return a fetch-Response-like object
                            const body = typeof data === 'string' ? data : JSON.stringify(data);
                            return new Response(body, {
                                status,
                                headers: { 'Content-Type': typeof data === 'string' ? 'text/plain' : 'application/json' },
                            });
                        });
                    }
                }
            }
        }

        return fetch(input, cleanInit);
    }) as typeof fetch;
}

export function getSpaCocClient(): CocClient {
    const apiBasePath = getApiBase();
    const wsPath = (globalThis as any).window?.__DASHBOARD_CONFIG__?.wsPath ?? '/ws';
    const key = `${apiBasePath}\n${wsPath}`;

    if (!cachedClient || cachedKey !== key || cachedFetch !== fetch) {
        cachedClient = new CocClient({
            baseUrl: '',
            apiBasePath,
            wsPath,
            fetch: createRelayAwareFetch(),
        });
        cachedKey = key;
        cachedFetch = fetch;
    }

    return cachedClient;
}

export function toSpaCocRequestOptions(options?: RequestInit): CocRequestOptions {
    return {
        method: options?.method,
        headers: options?.headers,
        rawBody: options?.body ?? undefined,
        signal: options?.signal ?? undefined,
    };
}

export function getSpaApiUrl(path: string, query?: Record<string, QueryPrimitive | QueryPrimitive[]>): string {
    return buildApiUrl('', getApiBase(), path, query);
}

export function translateSpaCocClientError(error: unknown): never {
    if (error instanceof CocApiError) {
        throw new Error(`API error: ${error.status} ${error.statusText}`);
    }
    if (error instanceof CocNetworkError && error.cause instanceof Error) {
        throw new Error(error.cause.message);
    }
    if (error instanceof CocNetworkError && error.cause !== undefined) {
        throw error.cause;
    }
    throw error;
}

export function getSpaCocClientErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof CocApiError) {
        const body = error.body;
        if (body && typeof body === 'object') {
            const record = body as Record<string, unknown>;
            if (typeof record.error === 'string') return record.error;
            if (record.error && typeof record.error === 'object') {
                const nested = record.error as Record<string, unknown>;
                if (typeof nested.message === 'string') return nested.message;
            }
            if (typeof record.message === 'string') return record.message;
        }
        return error.message || fallback;
    }
    if (error instanceof CocNetworkError && error.cause instanceof Error) {
        return error.cause.message || fallback;
    }
    if (error instanceof Error) {
        return error.message || fallback;
    }
    return fallback;
}

export async function requestSpaApi<T = unknown>(path: string, options?: RequestInit): Promise<T> {
    try {
        return await getSpaCocClient().request<T>(path, toSpaCocRequestOptions(options));
    } catch (error) {
        translateSpaCocClientError(error);
    }
}

export function resetSpaCocClientForTests(): void {
    cachedClient = undefined;
    cachedKey = '';
    cachedFetch = undefined;
}
