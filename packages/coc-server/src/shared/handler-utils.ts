/**
 * Shared handler utilities for workspace lookup and body parsing.
 *
 * These helpers eliminate copy-pasted boilerplate across all HTTP API handler files.
 * Both return null on failure (after sending the error response) so callers can do:
 *   const ws = await resolveWorkspaceOrFail(store, match!, res); if (!ws) return;
 *   const body = await parseBodyOrReject(req, res); if (body === null) return;
 */

import * as http from 'http';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/pipeline-core';
import { parseBody } from '../api-handler';
import { handleAPIError, invalidJSON, notFound } from '../errors';

/**
 * Decode the URL parameter, find the workspace in the store, and send a 404 if not found.
 * Returns the workspace on success, or null if the 404 was already sent.
 */
export async function resolveWorkspaceOrFail(
    store: ProcessStore,
    match: RegExpMatchArray,
    res: http.ServerResponse,
): Promise<WorkspaceInfo | null> {
    const id = decodeURIComponent(match[1]);
    const workspaces = await store.getWorkspaces();
    const ws = workspaces.find(w => w.id === id);
    if (!ws) {
        handleAPIError(res, notFound('Workspace'));
        return null;
    }
    return ws;
}

/**
 * Parse the JSON request body, sending a 400 if parsing fails.
 * Returns the parsed body on success, or null if the 400 was already sent.
 */
export async function parseBodyOrReject(
    req: http.IncomingMessage,
    res: http.ServerResponse,
): Promise<any> {
    try {
        return await parseBody(req);
    } catch {
        handleAPIError(res, invalidJSON());
        return null;
    }
}
