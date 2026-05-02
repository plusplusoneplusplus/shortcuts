import { CocApiError, CocClient, CocNetworkError, type CocRequestOptions } from '@plusplusoneplusplus/coc-client';
import { getApiBase } from '../utils/config';

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

export function getSpaCocClient(): CocClient {
    const apiBasePath = getApiBase();
    const wsPath = (globalThis as any).window?.__DASHBOARD_CONFIG__?.wsPath ?? '/ws';
    const key = `${apiBasePath}\n${wsPath}`;

    if (!cachedClient || cachedKey !== key || cachedFetch !== fetch) {
        cachedClient = new CocClient({
            baseUrl: '',
            apiBasePath,
            wsPath,
            fetch: ((input, init) => fetch(input, toLegacyFetchInit(init))) as typeof fetch,
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
