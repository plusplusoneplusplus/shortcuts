/**
 * Thin hook exposing fetchApi(path) for React components.
 * Mirrors the fetchApi in core.ts but throws on error instead of returning null.
 */

import { getApiBase } from '../utils/config';

export async function fetchApi(path: string, options?: RequestInit): Promise<any> {
    const url = getApiBase() + path;
    const res = options ? await fetch(url, options) : await fetch(url);
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

export function useApi() {
    return { fetchApi };
}
