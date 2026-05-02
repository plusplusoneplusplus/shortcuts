/**
 * Thin hook exposing fetchApi(path) for React components.
 * Delegates transport behavior to @plusplusoneplusplus/coc-client.
 */

import { requestSpaApi } from '../api/cocClient';

export async function fetchApi(path: string, options?: RequestInit): Promise<any> {
    return requestSpaApi(path, options);
}
