/**
 * Admin Prompt Routes
 *
 * REST endpoints for viewing built-in prompts and managing per-prompt admin
 * overrides. Prompt metadata lives in `admin-prompt-catalog.ts`.
 */

import { parseBody, sendJSON } from '../core/api-handler';
import { badRequest, forbidden, handleAPIError, invalidJSON, notFound } from '../errors';
import type { Route } from '../types';
import {
    savePromptOverride as writeSavedPromptOverride,
    deletePromptOverride as removePromptOverride,
} from './admin-prompt-overrides';
import { getBuiltInPrompts, getPromptsWithOverrides, validatePromptOverride } from './admin-prompt-catalog';
import type { AdminRouteOptions } from './admin-route-types';

/** Register prompt catalogue and override routes. */
export function registerPromptRoutes(routes: Route[], options: AdminRouteOptions): void {
    const { dataDir } = options;

    // ------------------------------------------------------------------
    // GET /api/admin/prompts — Return built-in prompt default texts
    // (annotated with active overrides when dataDir is available)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/admin/prompts',
        handler: async (_req, res) => {
            sendJSON(res, 200, dataDir ? getPromptsWithOverrides(dataDir) : getBuiltInPrompts());
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/admin/prompts/:id — Save an admin override for a prompt
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/admin\/prompts\/([^/]+)$/,
        handler: async (req, res, match) => {
            const promptId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            if (!promptId) return handleAPIError(res, badRequest('Missing prompt ID'));
            if (!dataDir) return handleAPIError(res, badRequest('dataDir not configured'));

            const builtins = getBuiltInPrompts();
            const prompt = builtins[promptId];
            if (!prompt) return handleAPIError(res, notFound(`prompt '${promptId}'`));
            if (!prompt.editable) return handleAPIError(res, forbidden(`Prompt '${promptId}' is not editable`));

            let body: { text?: unknown };
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }
            if (typeof body.text !== 'string' || !body.text.trim()) {
                return handleAPIError(res, badRequest('Body must contain a non-empty "text" string'));
            }

            const validationError = validatePromptOverride(prompt, body.text);
            if (validationError) return handleAPIError(res, badRequest(validationError));

            try {
                writeSavedPromptOverride(promptId, body.text, dataDir);
            } catch (err) {
                return handleAPIError(res, err);
            }

            sendJSON(res, 200, {
                ...prompt,
                overrideText: body.text,
                hasOverride: true,
                saved: true,
            });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/admin/prompts/:id — Reset a prompt to its built-in default
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/admin\/prompts\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const promptId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
            if (!promptId) return handleAPIError(res, badRequest('Missing prompt ID'));
            if (!dataDir) return handleAPIError(res, badRequest('dataDir not configured'));

            const builtins = getBuiltInPrompts();
            const prompt = builtins[promptId];
            if (!prompt) return handleAPIError(res, notFound(`prompt '${promptId}'`));
            if (!prompt.editable) return handleAPIError(res, forbidden(`Prompt '${promptId}' is not editable`));

            try {
                removePromptOverride(promptId, dataDir);
            } catch (err) {
                return handleAPIError(res, err);
            }

            sendJSON(res, 200, { id: promptId, reset: true });
        },
    });
}
