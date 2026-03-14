/**
 * Thin hook exposing fetchApi(path) for React components.
 * Mirrors the fetchApi in core.ts but throws on error instead of returning null.
 */

import { getApiBase } from '../utils/config';

export async function fetchApi(path: string, options?: RequestInit): Promise<any> {
    const url = getApiBase() + path;
    const res = await fetch(url, options ?? {});
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    // 204 No Content — no body to parse
    if (res.status === 204) return undefined;
    return res.json();
}

export function useApi() {
    return { fetchApi };
}
