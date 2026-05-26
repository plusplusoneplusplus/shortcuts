/**
 * Prompt Suggestion REST API Handler
 *
 * Serves the inline ghost-text autocomplete used by EnqueueDialog and
 * FollowUpInputArea. Returns a single best completion suffix from deterministic
 * history or opt-in AI generation grounded in workspace-scoped user history.
 *
 * Route: GET /api/prompt-suggestions?prefix=<encoded>
 * Response: { completion: string | null, source?: 'ai' | 'history', historySource?: 'initial' | 'follow-up' }
 *
 * Suggestions are silently disabled (returns null) unless the global
 * preference `promptAutocomplete.enabled` is explicitly set to true.
 */

import * as url from 'url';
import { sendJSON } from '../core/api-handler';
import { readGlobalPreferences } from '../preferences-handler';
import type { Route } from '../types';
import type { ISDKService, ProcessStore } from '@plusplusoneplusplus/forge';
import { PromptAutocompleteService, type PromptAutocompleteMode, type PromptAutocompleteSurface } from './prompt-autocomplete-service';

// ============================================================================
// Types
// ============================================================================

/** Narrow interface for the prompt-completion store method. */
export interface PromptCompletionStore {
    getBestPromptCompletion(
        prefix: string,
        opts?: { minPrefixLen?: number },
    ): { completion: string; source: 'initial' | 'follow-up' } | null;
}

// ============================================================================
// Route registration
// ============================================================================

export function registerPromptSuggestionRoutes(
    routes: Route[],
    store: ProcessStore | PromptCompletionStore,
    dataDir?: string,
    aiService?: ISDKService,
): void {
    const service = new PromptAutocompleteService({
        store: store as ProcessStore,
        dataDir,
        aiService,
    });

    // Pre-warm the autocomplete pipeline (spawn SDK client + warm AI session)
    // at startup so the first user keystroke doesn't pay the multi-second
    // cold-start cost.
    if (aiService) {
        void service.prewarm();
    }

    routes.push({
        method: 'GET',
        pattern: /^\/api\/prompt-suggestions$/,
        handler: async (req, res) => {
            try {
                // Silent no-op unless feature is explicitly enabled via global preferences.
                if (dataDir) {
                    try {
                        const prefs = readGlobalPreferences(dataDir);
                        if (prefs.promptAutocomplete?.enabled !== true) {
                            sendJSON(res, 200, { completion: null });
                            return;
                        }
                    } catch {
                        // Bad preferences file shouldn't break autocomplete — treat as disabled.
                        sendJSON(res, 200, { completion: null });
                        return;
                    }
                } else {
                    // No dataDir means no way to read the opt-in preference: stay disabled.
                    sendJSON(res, 200, { completion: null });
                    return;
                }

                const parsed = url.parse(req.url || '', true);
                const rawPrefix = parsed.query['prefix'];
                const prefix = typeof rawPrefix === 'string' ? rawPrefix : '';
                if (!prefix) {
                    sendJSON(res, 200, { completion: null });
                    return;
                }
                const result = await service.getCompletion({
                    prefix,
                    workspaceId: getStringQuery(parsed.query['workspaceId']),
                    processId: getStringQuery(parsed.query['processId']),
                    surface: parseSurface(getStringQuery(parsed.query['surface'])),
                    mode: parseMode(getStringQuery(parsed.query['mode'])),
                });
                sendJSON(res, 200, result);
            } catch {
                // Never propagate autocomplete failures to the client.
                sendJSON(res, 200, { completion: null });
            }
        },
    });
}

function getStringQuery(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseSurface(value: string | undefined): PromptAutocompleteSurface | undefined {
    return value === 'queue' || value === 'follow-up' ? value : undefined;
}

function parseMode(value: string | undefined): PromptAutocompleteMode | undefined {
    return value === 'hybrid' || value === 'ai' || value === 'history' ? value : undefined;
}
