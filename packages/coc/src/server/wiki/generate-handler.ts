/**
 * Wiki Generate Handler
 *
 * HTTP/SSE adapters over the generation domain layer in `./generation`.
 * These functions only parse and validate input, claim the wiki through the
 * generation registry, pipe generation events to SSE, and shape JSON errors.
 * All lifecycle logic lives in the runners, registry, adapter and status
 * service so it can be exercised without an HTTP server.
 *
 * Routes (flat — registered in wiki-routes.ts):
 *   POST /api/wikis/:wikiId/admin/generate          — Start generation (SSE)
 *   POST /api/wikis/:wikiId/admin/generate/cancel    — Cancel running generation
 *   GET  /api/wikis/:wikiId/admin/generate/status    — Get phase cache status
 *   POST /api/wikis/:wikiId/admin/generate/component/:id — Regenerate single component
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as path from 'path';
import { readBody } from './ask-handler';
import { sendJson, send400, send404, send500 } from '../shared/router';
import type { WikiProvider } from './wiki-backend';
import {
    createSseEventSink,
    defaultCacheStatusService,
    defaultDeepWikiAdapter,
    defaultGenerationRegistry,
    runComponentRegeneration,
    runWikiGeneration,
    type DeepWikiAdapter,
    type GenerationState,
    type WikiGenerationRegistry,
} from './generation';

// Re-exported so existing importers keep working.
export { collectCacheMetadata } from './generation';
export type { CacheMetadataStats } from './generation';

// ============================================================================
// Types
// ============================================================================

export interface GenerateRequest {
    startPhase: number;
    endPhase: number;
    force?: boolean;
}

/** Optional collaborators — callers inject these to avoid shared global state. */
export interface GenerateHandlerDeps {
    registry?: WikiGenerationRegistry;
    adapter?: DeepWikiAdapter;
}

const SSE_HEADERS = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
} as const;

// ============================================================================
// Start Generation
// ============================================================================

/**
 * POST /api/wikis/:wikiId/admin/generate — Start phase generation with SSE streaming.
 */
export async function handleStartGenerate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    wikiId: string,
    wikiProvider: WikiProvider,
    deps: GenerateHandlerDeps = {},
): Promise<void> {
    const registry = deps.registry ?? defaultGenerationRegistry;

    const wiki = wikiProvider.get(wikiId);
    if (!wiki) {
        sendJson(res, { error: `Wiki not found: ${wikiId}` }, 404);
        return;
    }

    if (registry.isRunning(wikiId)) {
        sendJson(res, { error: 'Generation already in progress for this wiki' }, 409);
        return;
    }

    if (!wiki.registration.repoPath) {
        send400(res, 'No repository path configured for this wiki.');
        return;
    }

    const body = await readBody(req);
    let request: GenerateRequest;
    try {
        request = JSON.parse(body);
    } catch {
        send400(res, 'Request body must be valid JSON');
        return;
    }

    const startPhase = request.startPhase !== undefined ? request.startPhase : 1;
    const endPhase = request.endPhase !== undefined ? request.endPhase : 5;

    if (!Number.isInteger(startPhase) || startPhase < 1 || startPhase > 5) {
        send400(res, `Invalid startPhase: ${startPhase}. Must be 1-5.`);
        return;
    }
    if (!Number.isInteger(endPhase) || endPhase < 1 || endPhase > 5) {
        send400(res, `Invalid endPhase: ${endPhase}. Must be 1-5.`);
        return;
    }
    if (endPhase < startPhase) {
        send400(res, `endPhase (${endPhase}) must be >= startPhase (${startPhase}).`);
        return;
    }

    // Claim the wiki before streaming — a racing request must still get 409.
    const handle = registry.start(wikiId, startPhase);
    if (!handle) {
        sendJson(res, { error: 'Generation already in progress for this wiki' }, 409);
        return;
    }

    // No redundant CORS — the router handles it.
    res.writeHead(200, { ...SSE_HEADERS });

    const emit = createSseEventSink(res);

    try {
        await runWikiGeneration({
            wiki,
            startPhase,
            endPhase,
            force: !!request.force,
            emit,
            handle,
            adapter: deps.adapter ?? defaultDeepWikiAdapter,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: 'error', message });
        emit({ type: 'done', success: false, error: message });
    } finally {
        handle.finish();
        res.end();
    }
}

// ============================================================================
// Cancel Generation
// ============================================================================

/**
 * POST /api/wikis/:wikiId/admin/generate/cancel — Cancel running generation.
 */
export function handleCancelGenerate(
    res: http.ServerResponse,
    wikiId: string,
    deps: GenerateHandlerDeps = {},
): void {
    const registry = deps.registry ?? defaultGenerationRegistry;

    if (!registry.cancel(wikiId)) {
        sendJson(res, { success: false, error: 'No generation in progress for this wiki' });
        return;
    }

    sendJson(res, { success: true });
}

// ============================================================================
// Generation Status
// ============================================================================

/**
 * GET /api/wikis/:wikiId/admin/generate/status — Get phase cache status.
 */
export function handleGetGenerateStatus(
    res: http.ServerResponse,
    wikiId: string,
    wikiProvider: WikiProvider,
    deps: GenerateHandlerDeps = {},
): void {
    const registry = deps.registry ?? defaultGenerationRegistry;

    const wiki = wikiProvider.get(wikiId);
    if (!wiki) {
        sendJson(res, { error: `Wiki not found: ${wikiId}` }, 404);
        return;
    }

    try {
        const outputDir = wiki.registration.wikiDir;
        // Without a repo path nothing can be generated, so report no phases at all.
        const available = !!wiki.registration.repoPath;
        const phases = available
            ? defaultCacheStatusService.getPhaseStatuses(wiki, outputDir)
            : {};
        const metadata = defaultCacheStatusService.collectMetadata(wiki, path.resolve(outputDir));
        const state = registry.get(wikiId);

        sendJson(res, {
            running: state?.running ?? false,
            currentPhase: state?.currentPhase,
            phases,
            repoPath: wiki.registration.repoPath,
            available,
            metadata,
        });
    } catch (error) {
        send500(res, `Failed to get generation status: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ============================================================================
// Single-Component Article Regeneration
// ============================================================================

/**
 * POST /api/wikis/:wikiId/admin/generate/component/:componentId
 */
export async function handleComponentRegenerate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    wikiId: string,
    componentId: string,
    wikiProvider: WikiProvider,
    deps: GenerateHandlerDeps = {},
): Promise<void> {
    const registry = deps.registry ?? defaultGenerationRegistry;
    const adapter = deps.adapter ?? defaultDeepWikiAdapter;

    const wiki = wikiProvider.get(wikiId);
    if (!wiki) {
        sendJson(res, { error: `Wiki not found: ${wikiId}` }, 404);
        return;
    }

    if (!wiki.registration.repoPath) {
        sendJson(res, { error: 'No repository path configured.' }, 503);
        return;
    }

    if (registry.isRunning(wikiId)) {
        sendJson(res, { error: 'A generation is already in progress for this wiki' }, 409);
        return;
    }

    const graph = wiki.wikiData.graph;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const componentInfo = graph.components.find((m: any) => m.id === componentId);
    if (!componentInfo) {
        send404(res, `Component not found: ${componentId}`);
        return;
    }

    // Body is optional; a malformed one just falls back to defaults.
    await readBody(req);

    const cache = await adapter.loadCache();
    const analysis = cache.getCachedAnalysis(componentId, wiki.registration.wikiDir);
    const detail = wiki.wikiData.getComponentDetail(componentId);
    const componentAnalysis = analysis || detail?.analysis;

    if (!componentAnalysis) {
        sendJson(res, { error: `No analysis cached for component "${componentId}". Run Phase 3 (Analysis) first.` }, 412);
        return;
    }

    const handle = registry.start(wikiId, 4);
    if (!handle) {
        sendJson(res, { error: 'A generation is already in progress for this wiki' }, 409);
        return;
    }

    res.writeHead(200, { ...SSE_HEADERS });

    const emit = createSseEventSink(res);

    try {
        await runComponentRegeneration({
            wiki,
            componentId,
            componentInfo,
            analysis: componentAnalysis,
            graph,
            emit,
            handle,
            adapter,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: 'error', message });
        emit({ type: 'done', success: false, componentId, error: message });
    } finally {
        handle.finish();
        res.end();
    }
}

// ============================================================================
// Testing Utilities
// ============================================================================

/** Get per-wiki generation state from the default registry (for testing). */
export function getGenerationState(wikiId: string): GenerationState | null {
    return defaultGenerationRegistry.get(wikiId);
}

/** Reset per-wiki generation state on the default registry (for testing). */
export function resetGenerationState(wikiId: string): void {
    defaultGenerationRegistry.reset(wikiId);
}

/** Reset all generation states on the default registry (for testing). */
export function resetAllGenerationStates(): void {
    defaultGenerationRegistry.resetAll();
}
