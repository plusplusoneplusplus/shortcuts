/**
 * Thin hook exposing fetchApi(path) for React components.
 * Delegates transport behavior to @plusplusoneplusplus/coc-client.
 */

import { CocApiError, CocNetworkError } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../api/cocClient';

export async function fetchApi(path: string, options?: RequestInit): Promise<any> {
    try {
        return await getSpaCocClient().request(path, {
            method: options?.method,
            headers: options?.headers,
            rawBody: options?.body ?? undefined,
            signal: options?.signal ?? undefined,
        });
    } catch (error) {
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
}
