import { CocClient } from '@plusplusoneplusplus/coc-client';
import { getApiBase } from '../utils/config';

let cachedClient: CocClient | undefined;
let cachedKey = '';

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

export function getSpaCocClient(): CocClient {
    const apiBasePath = getApiBase();
    const wsPath = (globalThis as any).window?.__DASHBOARD_CONFIG__?.wsPath ?? '/ws';
    const key = `${apiBasePath}\n${wsPath}`;

    if (!cachedClient || cachedKey !== key) {
        cachedClient = new CocClient({
            baseUrl: '',
            apiBasePath,
            wsPath,
            fetch: ((input, init) => fetch(input, toLegacyFetchInit(init))) as typeof fetch,
        });
        cachedKey = key;
    }

    return cachedClient;
}

export function resetSpaCocClientForTests(): void {
    cachedClient = undefined;
    cachedKey = '';
}
