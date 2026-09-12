/**
 * Workspace-scoped REST API for language-server configuration.
 *
 * Configuration is the only persisted state: open buffers, diagnostics, and
 * connections stay in memory. Routes stay language-neutral — nothing here
 * knows that TypeScript ships as a preset.
 */

import { sendJSON } from '../core/api-handler';
import { parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import { getActiveLanguageServerManager } from './active';
import type { LanguageServerManager } from './manager';
import { mergeWithBuiltIns } from './presets';
import type { LanguageServerConfig } from './repository';
import {
    readLanguageServerConfigWithStatus,
    resolveLanguageServerDefinitions,
    writeLanguageServerConfig,
} from './repository';
import type { LanguageServerDefinition } from './types';

/** Body of a read response: stored config plus what the workspace would start. */
interface LanguageServerConfigResponse {
    enabled: boolean;
    /** Definitions as stored for this workspace, without preset layering. */
    definitions: LanguageServerDefinition[];
    /** Presets layered with workspace overrides — what settings should render. */
    effective: LanguageServerDefinition[];
    /** The subset that may actually start; empty while support is disabled. */
    startable: LanguageServerDefinition[];
    status: 'ok' | 'missing' | 'invalid';
    warnings: { kind: string; message: string }[];
    runtimes: Array<{
        sessionId: string;
        definitionId: string;
        displayName: string;
        projectRoot: string;
        status: ReturnType<LanguageServerManager['listStates']>[number]['status'];
        detail?: string;
        runtime?: string;
        recoveryCommand?: string;
        lastAttemptAt?: string;
    }>;
}

function buildResponse(
    dataDir: string,
    workspaceId: string,
    manager = getActiveLanguageServerManager(),
): LanguageServerConfigResponse {
    const { value, status, warnings } = readLanguageServerConfigWithStatus(dataDir, workspaceId);
    return {
        enabled: value.enabled,
        definitions: value.definitions,
        effective: mergeWithBuiltIns(value.definitions),
        startable: resolveLanguageServerDefinitions(dataDir, workspaceId),
        status,
        // The on-disk path is a server detail and stays out of the browser payload.
        warnings: warnings.map(({ kind, message }) => ({ kind, message })),
        runtimes: (manager?.listStates(workspaceId) ?? []).map((runtime) => ({
            sessionId: runtime.sessionId,
            definitionId: runtime.definitionId,
            displayName: runtime.displayName,
            projectRoot: runtime.projectRoot,
            status: runtime.status,
            detail: runtime.detail,
            runtime: runtime.runtime,
            recoveryCommand: runtime.recoveryCommand,
            lastAttemptAt: runtime.lastAttemptAt,
        })),
    };
}

/**
 * Mutates the `routes` array in-place.
 *
 * @param dataDir - Resolved CoC data directory; config lives under
 *   `repos/<workspaceId>/language-servers.json`.
 */
export function registerLanguageServerRoutes(
    routes: Route[],
    dataDir: string,
    getManager: () => LanguageServerManager | undefined = getActiveLanguageServerManager,
): void {
    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/language-servers — Read the workspace config
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/language-servers$/,
        handler: async (_req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            sendJSON(res, 200, buildResponse(dataDir, workspaceId, getManager()));
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/language-servers\/retry$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) {
                return;
            }
            const workspaceId = decodeURIComponent(match![1]);
            const sessionId = typeof body === 'object' && body !== null && !Array.isArray(body)
                ? (body as { sessionId?: unknown }).sessionId
                : undefined;
            if (typeof sessionId !== 'string' || !sessionId) {
                return sendJSON(res, 400, { error: 'sessionId is required' });
            }
            const manager = getManager();
            if (!manager) {
                return sendJSON(res, 503, { error: 'Language-server runtime is unavailable' });
            }
            if (!await manager.retry(workspaceId, sessionId)) {
                return sendJSON(res, 404, { error: 'Language-server session was not found' });
            }
            sendJSON(res, 200, buildResponse(dataDir, workspaceId, manager));
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/workspaces/:id/language-servers — Replace the workspace config
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/language-servers$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) {
                return;
            }
            const workspaceId = decodeURIComponent(match![1]);
            save(res, dataDir, workspaceId, body, 'replace', getManager());
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/language-servers — Merge into the config
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/language-servers$/,
        handler: async (req, res, match) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) {
                return;
            }
            const workspaceId = decodeURIComponent(match![1]);
            save(res, dataDir, workspaceId, body, 'patch', getManager());
        },
    });
}

/**
 * Validate and persist. A `replace` write treats omitted fields as their
 * defaults; a `patch` write leaves them at their stored values.
 *
 * A field-level error aborts the whole write, so the last valid configuration
 * survives an invalid submission and the UI can address errors by field path.
 */
function save(
    res: Parameters<typeof sendJSON>[0],
    dataDir: string,
    workspaceId: string,
    body: unknown,
    mode: 'replace' | 'patch',
    manager?: LanguageServerManager,
): void {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        return sendJSON(res, 400, { error: 'Request body must be a JSON object', errors: [] });
    }
    const patch = body as Record<string, unknown>;

    const fieldError = (field: string, message: string): void => sendJSON(res, 400, {
        error: 'Invalid language-server configuration',
        errors: [{ field, message }],
    });
    if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') {
        return fieldError('enabled', 'enabled must be a boolean');
    }
    if (patch.definitions !== undefined && !Array.isArray(patch.definitions)) {
        return fieldError('definitions', 'definitions must be an array');
    }

    const stored = readLanguageServerConfigWithStatus(dataDir, workspaceId).value;
    const base: LanguageServerConfig = mode === 'patch' ? stored : { enabled: false, definitions: [] };
    const result = writeLanguageServerConfig(dataDir, workspaceId, {
        enabled: patch.enabled !== undefined ? patch.enabled === true : base.enabled,
        definitions: (patch.definitions as LanguageServerDefinition[] | undefined) ?? base.definitions,
    });
    if (!result.ok) {
        return sendJSON(res, 400, {
            error: 'Invalid language-server configuration',
            // Re-anchor field paths on the request body so the UI can address
            // the offending input directly.
            errors: result.errors.map((e) => ({ ...e, field: `definitions.${e.field}` })),
            // Echo what remains on disk so the UI can restore the last valid state.
            config: { enabled: stored.enabled, definitions: stored.definitions },
        });
    }
    sendJSON(res, 200, buildResponse(dataDir, workspaceId, manager));
}
