/**
 * Thin hook exposing fetchApi(path) for React components.
 * Mirrors the fetchApi in core.ts but throws on error instead of returning null.
 */

import { getApiBase } from '../utils/config';

export async function fetchApi(path: string): Promise<any> {
    const res = await fetch(getApiBase() + path);
    if (!res.ok) {
        throw new Error(`API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
}

export function useApi() {
    return { fetchApi };
}
