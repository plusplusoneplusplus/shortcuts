/**
 * Wiki Generate Handler
 *
 * Server-side handler for per-wiki phase regeneration.
 * Adapted from deep-wiki's generate-handler for multi-wiki CoC server.
 *
 * Uses a per-wiki Map for generation state (not module singleton).
 * Delegates actual generation to deep-wiki's public API via dynamic imports.
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
import * as fs from 'fs';
import { sendSSE, readBody } from './ask-handler';
import { sendJson, send400, send404, send500 } from '@plusplusoneplusplus/coc-server';
import type { WikiManager } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Dynamic Import Helper
// ============================================================================

// Deep-wiki modules are loaded dynamically to avoid a hard compile-time
// dependency (coc does not list deep-wiki in its package.json dependencies).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function importDeepWiki(subpath: string): Promise<any> {
    // Use Function constructor to prevent TypeScript from resolving the module
    // specifier at compile time.  At runtime the monorepo workspace link makes
    // `@plusplusoneplusplus/deep-wiki` resolvable.
    const modulePath = `@plusplusoneplusplus/deep-wiki/dist/${subpath}`;
    return import(modulePath);
}

// ============================================================================
// Types
// ============================================================================

export interface GenerateRequest {
    startPhase: number;
    endPhase: number;
    force?: boolean;
}

interface GenerationState {
    running: boolean;
    currentPhase: number;
    cancelled: boolean;
    startTime: number;
}

// Per-wiki generation state — replaces module-level singleton
const generationStates = new Map<string, GenerationState>();

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
    wikiManager: WikiManager,
): Promise<void> {
    const wiki = wikiManager.get(wikiId);
    if (!wiki) {
        sendJson(res, { error: `Wiki not found: ${wikiId}` }, 404);
        return;
    }

    // Check if generation is already running for this wiki
    const existingState = generationStates.get(wikiId);
    if (existingState?.running) {
        sendJson(res, { error: 'Generation already in progress for this wiki' }, 409);
        return;
    }

    if (!wiki.registration.repoPath) {
        send400(res, 'No repository path configured for this wiki.');
        return;
    }

    // Parse request body
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

    // Set up SSE response (no redundant CORS — router handles it)
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    // Initialize per-wiki generation state
    const state: GenerationState = {
        running: true,
        currentPhase: startPhase,
        cancelled: false,
        startTime: Date.now(),
    };
    generationStates.set(wikiId, state);

    const isCancelled = () => state.cancelled;

    try {
        await runGeneration(res, wiki, startPhase, endPhase, !!request.force, isCancelled, state);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendSSE(res, { type: 'error', message });
        sendSSE(res, { type: 'done', success: false, error: message });
    } finally {
        generationStates.delete(wikiId);
        res.end();
    }
}

// ============================================================================
// Generation Execution (delegates to deep-wiki phases)
// ============================================================================

async function runGeneration(
    res: http.ServerResponse,
    wiki: { registration: { repoPath?: string; wikiDir: string }; wikiData: { graph: any; reload: () => void } },
    startPhase: number,
    endPhase: number,
    force: boolean,
    isCancelled: () => boolean,
    state: GenerationState,
): Promise<void> {
    const repoPath = path.resolve(wiki.registration.repoPath!);
    const outputDir = wiki.registration.wikiDir;
    const totalStartTime = Date.now();

    const options = {
        output: outputDir,
        depth: 'normal' as const,
        force,
        useCache: !force,
        verbose: false,
        phase: startPhase,
        endPhase,
    };

    // Dynamically import deep-wiki internals (no compile-time dependency)
    const phases = await importDeepWiki('commands/phases');
    const { runPhase1, runPhase2Consolidation, runPhase3Analysis, runPhase4Writing, runPhase5Website } = phases;
    const cacheModule = await importDeepWiki('cache');
    const { getCachedGraphAny, getCachedGraph, getCachedAnalyses, getCachedConsolidationAny, getCachedConsolidation } = cacheModule;
    const { UsageTracker } = await importDeepWiki('usage-tracker');
    const { checkAIAvailability } = await importDeepWiki('ai-invoker');

    // Check AI availability for phases 1-4
    if (endPhase <= 4 || startPhase <= 4) {
        const availability = await checkAIAvailability();
        if (!availability.available) {
            sendSSE(res, { type: 'error', message: `Copilot SDK not available: ${availability.reason || 'Unknown'}` });
            sendSSE(res, { type: 'done', success: false, error: 'AI service unavailable' });
            return;
        }
    }

    const usageTracker = new UsageTracker();
    let graph: any;
    let analyses: any[] | undefined;
    let reanalyzedComponentIds: string[] | undefined;

    // Phase 1: Discovery
    if (startPhase <= 1 && endPhase >= 1) {
        if (isCancelled()) { sendSSE(res, { type: 'done', success: false, error: 'Cancelled' }); return; }
        state.currentPhase = 1;
        sendSSE(res, { type: 'status', phase: 1, state: 'running', message: 'Starting discovery...' });
        const phaseStart = Date.now();
        try {
            const result = await runPhase1(repoPath, options, isCancelled);
            if (result.exitCode !== undefined) {
                sendSSE(res, { type: 'error', phase: 1, message: `Discovery failed (exit code ${result.exitCode})` });
                sendSSE(res, { type: 'done', success: false, error: 'Phase 1 failed' }); return;
            }
            graph = result.graph!;
            if (result.tokenUsage) usageTracker.addUsage('discovery', result.tokenUsage);
            sendSSE(res, { type: 'phase-complete', phase: 1, success: true, duration: Date.now() - phaseStart, message: `Discovered ${graph.components.length} components` });
        } catch (error) {
            sendSSE(res, { type: 'error', phase: 1, message: error instanceof Error ? error.message : String(error) });
            sendSSE(res, { type: 'done', success: false, error: 'Phase 1 failed' }); return;
        }
    } else if (startPhase > 1) {
        const cached = getCachedGraphAny(outputDir) ?? await getCachedGraph(repoPath, outputDir);
        if (!cached) {
            sendSSE(res, { type: 'error', message: 'No cached component graph found. Run Discovery first.' });
            sendSSE(res, { type: 'done', success: false, error: 'Missing prerequisite: Discovery' }); return;
        }
        graph = cached.graph;
        sendSSE(res, { type: 'log', phase: startPhase, message: `Loaded cached component graph (${graph.components.length} components)` });
    }

    if (!graph) {
        sendSSE(res, { type: 'error', message: 'No component graph available' });
        sendSSE(res, { type: 'done', success: false, error: 'No component graph' }); return;
    }

    // Phase 2: Consolidation
    if (startPhase <= 2 && endPhase >= 2) {
        if (isCancelled()) { sendSSE(res, { type: 'done', success: false, error: 'Cancelled' }); return; }
        state.currentPhase = 2;
        sendSSE(res, { type: 'status', phase: 2, state: 'running', message: 'Starting consolidation...' });
        const phaseStart = Date.now();
        try {
            const result = await runPhase2Consolidation(repoPath, graph, options, usageTracker);
            graph = result.graph;
            sendSSE(res, { type: 'phase-complete', phase: 2, success: true, duration: Date.now() - phaseStart, message: `Consolidated to ${graph.components.length} components` });
        } catch (error) {
            sendSSE(res, { type: 'error', phase: 2, message: error instanceof Error ? error.message : String(error) });
            sendSSE(res, { type: 'done', success: false, error: 'Phase 2 failed' }); return;
        }
    } else if (startPhase > 2 && graph.components.length > 0) {
        // When skipping Phase 2, load the consolidated graph from cache so
        // downstream phases operate on the reduced component set.
        const consolidatedCache = getCachedConsolidationAny(outputDir, graph.components.length)
            ?? await getCachedConsolidation(repoPath, outputDir, graph.components.length);
        if (consolidatedCache) {
            const prevCount = graph.components.length;
            graph = consolidatedCache.graph;
            sendSSE(res, { type: 'log', phase: startPhase, message: `Loaded consolidated graph (${prevCount} → ${graph.components.length} components)` });
        }
    }

    // Phase 3: Analysis
    if (startPhase <= 3 && endPhase >= 3) {
        if (isCancelled()) { sendSSE(res, { type: 'done', success: false, error: 'Cancelled' }); return; }
        state.currentPhase = 3;
        sendSSE(res, { type: 'status', phase: 3, state: 'running', message: 'Starting analysis...' });
        const phaseStart = Date.now();
        try {
            const result = await runPhase3Analysis(repoPath, graph, options, isCancelled, usageTracker);
            if (result.exitCode !== undefined) {
                sendSSE(res, { type: 'error', phase: 3, message: `Analysis failed (exit code ${result.exitCode})` });
                sendSSE(res, { type: 'done', success: false, error: 'Phase 3 failed' }); return;
            }
            analyses = result.analyses!;
            reanalyzedComponentIds = result.reanalyzedComponentIds;
            sendSSE(res, { type: 'phase-complete', phase: 3, success: true, duration: Date.now() - phaseStart, message: `Analyzed ${analyses!.length} components` });
        } catch (error) {
            sendSSE(res, { type: 'error', phase: 3, message: error instanceof Error ? error.message : String(error) });
            sendSSE(res, { type: 'done', success: false, error: 'Phase 3 failed' }); return;
        }
    } else if (startPhase > 3 && endPhase >= 4) {
        const cached = getCachedAnalyses(outputDir);
        if (!cached || cached.length === 0) {
            sendSSE(res, { type: 'error', message: 'No cached analyses found. Run Analysis first.' });
            sendSSE(res, { type: 'done', success: false, error: 'Missing prerequisite: Analysis' }); return;
        }
        // Filter to only analyses whose component IDs exist in the current
        // (possibly consolidated) graph — stale files from pre-consolidation
        // runs may still be on disk.
        const graphIds = new Set(graph.components.map((m: any) => m.id));
        analyses = graphIds.size > 0
            ? cached.filter((a: any) => graphIds.has(a.componentId))
            : cached;
        sendSSE(res, { type: 'log', phase: startPhase, message: `Loaded ${analyses!.length} cached analyses` });
    }

    // Phase 4: Writing
    if (startPhase <= 4 && endPhase >= 4) {
        if (isCancelled()) { sendSSE(res, { type: 'done', success: false, error: 'Cancelled' }); return; }
        if (!analyses) {
            sendSSE(res, { type: 'error', message: 'No analyses available for writing phase' });
            sendSSE(res, { type: 'done', success: false, error: 'Missing analyses' }); return;
        }
        state.currentPhase = 4;
        sendSSE(res, { type: 'status', phase: 4, state: 'running', message: 'Starting article writing...' });
        const phaseStart = Date.now();
        try {
            const result = await runPhase4Writing(repoPath, graph, analyses!, options, isCancelled, usageTracker, reanalyzedComponentIds);
            if (result.exitCode !== undefined) {
                sendSSE(res, { type: 'error', phase: 4, message: `Writing failed (exit code ${result.exitCode})` });
                sendSSE(res, { type: 'done', success: false, error: 'Phase 4 failed' }); return;
            }
            sendSSE(res, { type: 'phase-complete', phase: 4, success: true, duration: Date.now() - phaseStart, message: `Wrote ${result.articlesWritten} articles` });
        } catch (error) {
            sendSSE(res, { type: 'error', phase: 4, message: error instanceof Error ? error.message : String(error) });
            sendSSE(res, { type: 'done', success: false, error: 'Phase 4 failed' }); return;
        }
    }

    // Phase 5: Website
    if (startPhase <= 5 && endPhase >= 5) {
        if (isCancelled()) { sendSSE(res, { type: 'done', success: false, error: 'Cancelled' }); return; }
        state.currentPhase = 5;
        sendSSE(res, { type: 'status', phase: 5, state: 'running', message: 'Building website...' });

        if (graph) {
            const graphOutputFile = path.join(path.resolve(outputDir), 'component-graph.json');
            try {
                fs.mkdirSync(path.resolve(outputDir), { recursive: true });
                fs.writeFileSync(graphOutputFile, JSON.stringify(graph, null, 2), 'utf-8');
            } catch { /* non-fatal */ }
        }

        const phaseStart = Date.now();
        try {
            const result = runPhase5Website(options);
            if (result.success) {
                sendSSE(res, { type: 'phase-complete', phase: 5, success: true, duration: Date.now() - phaseStart, message: 'Website generated' });
            } else {
                sendSSE(res, { type: 'error', phase: 5, message: 'Website generation failed' });
            }
        } catch (error) {
            sendSSE(res, { type: 'error', phase: 5, message: error instanceof Error ? error.message : String(error) });
        }
    }

    // Post-generation: Reload wiki data
    if (endPhase >= 4) {
        try {
            wiki.wikiData.reload();
            sendSSE(res, { type: 'log', message: 'Wiki data reloaded' });
        } catch (error) {
            sendSSE(res, { type: 'log', message: `Warning: Failed to reload wiki data: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    sendSSE(res, { type: 'done', success: true, duration: Date.now() - totalStartTime });
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
): void {
    const state = generationStates.get(wikiId);
    if (!state?.running) {
        sendJson(res, { success: false, error: 'No generation in progress for this wiki' });
        return;
    }

    state.cancelled = true;
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
    wikiManager: WikiManager,
): void {
    const wiki = wikiManager.get(wikiId);
    if (!wiki) {
        sendJson(res, { error: `Wiki not found: ${wikiId}` }, 404);
        return;
    }

    try {
        const outputDir = wiki.registration.wikiDir;
        const available = !!wiki.registration.repoPath;
        const phases: Record<string, { cached: boolean; timestamp?: string; components?: Record<string, { cached: boolean; timestamp?: string }> }> = {};

        if (available) {
            phases['1'] = checkCacheFileStatus(path.join(path.resolve(outputDir), '.wiki-cache', 'component-graph.json'));
            phases['2'] = checkCacheFileStatus(path.join(path.resolve(outputDir), '.wiki-cache', 'consolidated-graph.json'));
            phases['3'] = checkCacheFileStatus(path.join(path.resolve(outputDir), '.wiki-cache', 'analyses', '_metadata.json'));
            phases['4'] = checkCacheFileStatus(path.join(path.resolve(outputDir), '.wiki-cache', 'articles', '_metadata.json'));

            // Per-component article status
            try {
                const components: Record<string, { cached: boolean; timestamp?: string }> = {};
                const graph = wiki.wikiData.graph;
                const articlesDir = path.join(path.resolve(outputDir), '.wiki-cache', 'articles');
                for (const mod of graph.components) {
                    components[mod.id] = getComponentArticleCacheStatus(articlesDir, mod.id, mod.domain);
                }
                phases['4'].components = components;
            } catch { /* ignore */ }

            phases['5'] = checkWebsiteCacheStatus(outputDir);
        }

        const metadata = collectCacheMetadata(wiki, path.resolve(outputDir));

        const state = generationStates.get(wikiId);
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
    wikiManager: WikiManager,
): Promise<void> {
    const wiki = wikiManager.get(wikiId);
    if (!wiki) {
        sendJson(res, { error: `Wiki not found: ${wikiId}` }, 404);
        return;
    }

    if (!wiki.registration.repoPath) {
        sendJson(res, { error: 'No repository path configured.' }, 503);
        return;
    }

    const existingState = generationStates.get(wikiId);
    if (existingState?.running) {
        sendJson(res, { error: 'A generation is already in progress for this wiki' }, 409);
        return;
    }

    const graph = wiki.wikiData.graph;
    const componentInfo = graph.components.find((m: any) => m.id === componentId);
    if (!componentInfo) {
        send404(res, `Component not found: ${componentId}`);
        return;
    }

    // Parse optional body
    const body = await readBody(req);
    let force = false;
    try {
        if (body.trim()) {
            const parsed = JSON.parse(body);
            force = !!parsed.force;
        }
    } catch { /* use defaults */ }

    // Load analysis
    const cacheModule = await importDeepWiki('cache');
    const analysis = cacheModule.getCachedAnalysis(componentId, wiki.registration.wikiDir);
    const detail = wiki.wikiData.getComponentDetail(componentId);
    const componentAnalysis = analysis || detail?.analysis;

    if (!componentAnalysis) {
        sendJson(res, { error: `No analysis cached for component "${componentId}". Run Phase 3 (Analysis) first.` }, 412);
        return;
    }

    // SSE setup
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    const state: GenerationState = { running: true, currentPhase: 4, cancelled: false, startTime: Date.now() };
    generationStates.set(wikiId, state);

    try {
        await runComponentRegeneration(res, wiki, componentId, componentInfo, componentAnalysis, graph, force);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendSSE(res, { type: 'error', message });
        sendSSE(res, { type: 'done', success: false, componentId, error: message });
    } finally {
        generationStates.delete(wikiId);
        res.end();
    }
}

async function runComponentRegeneration(
    res: http.ServerResponse,
    wiki: { registration: { repoPath?: string; wikiDir: string }; wikiData: { graph: any; reload: () => void; getComponentDetail: (id: string) => any } },
    componentId: string,
    componentInfo: any,
    analysis: any,
    graph: any,
    _force: boolean,
): Promise<void> {
    const repoPath = path.resolve(wiki.registration.repoPath!);
    const outputDir = wiki.registration.wikiDir;
    const startTime = Date.now();
    const componentName = componentInfo.name || componentId;

    sendSSE(res, { type: 'status', state: 'running', componentId, message: `Generating article for ${componentName}...` });

    const { checkAIAvailability } = await importDeepWiki('ai-invoker');
    const availability = await checkAIAvailability();
    if (!availability.available) {
        sendSSE(res, { type: 'error', message: `Copilot SDK not available: ${availability.reason || 'Unknown'}` });
        sendSSE(res, { type: 'done', success: false, componentId, error: 'AI service unavailable' });
        return;
    }

    const { buildComponentArticlePrompt } = await importDeepWiki('writing/prompts');
    const prompt = buildComponentArticlePrompt(analysis, graph, 'normal');

    sendSSE(res, { type: 'log', message: 'Sending to AI model...' });

    const { createWritingInvoker } = await importDeepWiki('ai-invoker');
    const invoker = createWritingInvoker({ repoPath });
    const aiResult = await invoker(prompt);

    if (!aiResult.success || !aiResult.response) {
        const errMsg = aiResult.error || 'AI returned empty response';
        sendSSE(res, { type: 'error', message: errMsg });
        sendSSE(res, { type: 'done', success: false, componentId, error: errMsg });
        return;
    }

    sendSSE(res, { type: 'log', message: 'Article generated, saving...' });

    const { normalizeComponentId } = await importDeepWiki('schemas');
    const { saveArticle } = await importDeepWiki('cache/article-cache');
    const { getFolderHeadHash } = await importDeepWiki('cache/git-utils');
    const { getArticleFilePath, normalizeLineEndings } = await importDeepWiki('writing/file-writer');

    const domainId = componentInfo.domain;
    const article = {
        type: 'component' as const,
        slug: normalizeComponentId(componentId),
        title: componentName,
        content: aiResult.response,
        componentId,
        domainId,
    };

    const gitHash = await getFolderHeadHash(repoPath) || 'unknown';
    saveArticle(componentId, article, outputDir, gitHash);

    const resolvedDir = path.resolve(outputDir);
    const filePath = getArticleFilePath(article, resolvedDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, normalizeLineEndings(article.content), 'utf-8');

    // Reload wiki data
    try {
        wiki.wikiData.reload();
        sendSSE(res, { type: 'log', message: 'Wiki data reloaded' });
    } catch (error) {
        sendSSE(res, { type: 'log', message: `Warning: Failed to reload wiki data: ${error instanceof Error ? error.message : String(error)}` });
    }

    sendSSE(res, { type: 'done', success: true, componentId, duration: Date.now() - startTime, message: 'Article regenerated' });
}

// ============================================================================
// Cache Metadata Collection
// ============================================================================

export interface CacheMetadataStats {
    components: number;
    categories: number;
    themes: number;
    domains: number;
    analyses: number;
    articles: number;
    projectName?: string;
    projectLanguage?: string;
}

export function collectCacheMetadata(
    wiki: { wikiData: { graph: any } },
    outputDir: string,
): CacheMetadataStats {
    const stats: CacheMetadataStats = {
        components: 0,
        categories: 0,
        themes: 0,
        domains: 0,
        analyses: 0,
        articles: 0,
    };

    try {
        const graph = wiki.wikiData.graph;
        if (graph) {
            stats.components = Array.isArray(graph.components) ? graph.components.length : 0;
            stats.categories = Array.isArray(graph.categories) ? graph.categories.length : 0;
            stats.themes = Array.isArray(graph.themes) ? graph.themes.length : 0;
            stats.domains = Array.isArray(graph.domains) ? graph.domains.length : 0;
            if (graph.project) {
                if (graph.project.name) stats.projectName = graph.project.name;
                if (graph.project.language) stats.projectLanguage = graph.project.language;
            }
        }
    } catch { /* graph may not be loaded */ }

    try {
        const analysesDir = path.join(outputDir, '.wiki-cache', 'analyses');
        if (fs.existsSync(analysesDir) && fs.statSync(analysesDir).isDirectory()) {
            const graphComponentIds = new Set(
                Array.isArray(wiki.wikiData?.graph?.components)
                    ? wiki.wikiData.graph.components.map((m: any) => m.id as string)
                    : []
            );
            const analysisFiles = fs.readdirSync(analysesDir)
                .filter(f => f.endsWith('.json') && f !== '_metadata.json');

            if (graphComponentIds.size > 0) {
                stats.analyses = analysisFiles
                    .filter(f => graphComponentIds.has(f.slice(0, -5))).length;
            } else {
                stats.analyses = analysisFiles.length;
            }
        }
    } catch { /* ignore */ }

    try {
        const articlesDir = path.join(outputDir, '.wiki-cache', 'articles');
        if (fs.existsSync(articlesDir) && fs.statSync(articlesDir).isDirectory()) {
            stats.articles = countArticleFiles(articlesDir);
        }
    } catch { /* ignore */ }

    return stats;
}

function countArticleFiles(dir: string): number {
    let count = 0;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.startsWith('_')) {
                count++;
            } else if (entry.isDirectory()) {
                count += countArticleFiles(path.join(dir, entry.name));
            }
        }
    } catch { /* ignore */ }
    return count;
}

// ============================================================================
// Cache Status Helpers
// ============================================================================

function checkCacheFileStatus(filePath: string): { cached: boolean; timestamp?: string } {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            const timestamp = parsed?.metadata?.timestamp || parsed?.timestamp;
            if (timestamp) {
                return { cached: true, timestamp: new Date(timestamp).toISOString() };
            }
            return { cached: true };
        }
        return { cached: false };
    } catch {
        return { cached: false };
    }
}

function checkWebsiteCacheStatus(outputDir: string): { cached: boolean; timestamp?: string } {
    try {
        const indexPath = path.join(path.resolve(outputDir), 'index.html');
        if (fs.existsSync(indexPath)) {
            const stat = fs.statSync(indexPath);
            return { cached: true, timestamp: stat.mtime.toISOString() };
        }
        return { cached: false };
    } catch {
        return { cached: false };
    }
}

function getComponentArticleCacheStatus(
    articlesDir: string,
    componentId: string,
    domainId?: string,
): { cached: boolean; timestamp?: string } {
    const pathsToTry = domainId
        ? [path.join(articlesDir, domainId, `${componentId}.json`), path.join(articlesDir, `${componentId}.json`)]
        : [path.join(articlesDir, `${componentId}.json`)];

    for (const cachePath of pathsToTry) {
        try {
            if (fs.existsSync(cachePath)) {
                const content = fs.readFileSync(cachePath, 'utf-8');
                const parsed = JSON.parse(content);
                if (parsed.article && parsed.article.slug) {
                    const timestamp = parsed.timestamp ? new Date(parsed.timestamp).toISOString() : undefined;
                    return { cached: true, timestamp };
                }
            }
        } catch { /* skip */ }
    }

    return { cached: false };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/** Get per-wiki generation state (for testing). */
export function getGenerationState(wikiId: string): GenerationState | null {
    return generationStates.get(wikiId) ?? null;
}

/** Reset per-wiki generation state (for testing). */
export function resetGenerationState(wikiId: string): void {
    generationStates.delete(wikiId);
}

/** Reset all generation states (for testing). */
export function resetAllGenerationStates(): void {
    generationStates.clear();
}
