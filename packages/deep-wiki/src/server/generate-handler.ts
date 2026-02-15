/**
 * Generate Handler
 *
 * Server-side handler for phase regeneration from the admin page.
 * Provides SSE streaming for real-time progress, cancellation support,
 * and cache status checking.
 *
 * Routes:
 *   POST /api/admin/generate        — Start generation (SSE stream)
 *   POST /api/admin/generate/cancel — Cancel running generation
 *   GET  /api/admin/generate/status — Get phase cache status
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { sendSSE } from './ask-handler';
import { sendJson, send400, send404, send500, readBody } from './router';
import { getErrorMessage } from '../utils/error-utils';
import type { GenerateCommandOptions, ComponentGraph, ComponentAnalysis, GeneratedArticle } from '../types';
import type { WikiData } from './wiki-data';
import type { WebSocketServer } from './websocket';

// ============================================================================
// Types
// ============================================================================

export interface GenerateHandlerContext {
    /** Wiki output directory */
    wikiDir: string;
    /** Repository root path (required for generation) */
    repoPath?: string;
    /** Wiki data layer (for reload after generation) */
    wikiData?: WikiData;
    /** WebSocket server (for broadcasting reload events) */
    wsServer?: WebSocketServer;
}

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

// ============================================================================
// Component-Level State
// ============================================================================

let generationState: GenerationState | null = null;

// ============================================================================
// Main Router
// ============================================================================

/**
 * Route a generate API request to the appropriate handler.
 * Returns true if the request was handled, false otherwise.
 */
export function handleGenerateRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    method: string,
    context: GenerateHandlerContext
): boolean {
    // POST /api/admin/generate — Start generation (SSE stream)
    if (method === 'POST' && pathname === '/api/admin/generate') {
        handleStartGenerate(req, res, context).catch(() => {
            if (!res.headersSent) {
                send500(res, 'Failed to start generation');
            }
        });
        return true;
    }

    // POST /api/admin/generate/cancel — Cancel running generation
    if (method === 'POST' && pathname === '/api/admin/generate/cancel') {
        handleCancelGenerate(res);
        return true;
    }

    // GET /api/admin/generate/status — Get phase cache status
    if (method === 'GET' && pathname === '/api/admin/generate/status') {
        handleGetGenerateStatus(res, context);
        return true;
    }

    // POST /api/admin/generate/component/:componentId — Regenerate single component article
    const componentMatch = pathname.match(/^\/api\/admin\/generate\/component\/(.+)$/);
    if (method === 'POST' && componentMatch) {
        const componentId = decodeURIComponent(componentMatch[1]);
        handleComponentRegenerate(req, res, componentId, context).catch(() => {
            if (!res.headersSent) {
                send500(res, 'Failed to regenerate component article');
            }
        });
        return true;
    }

    return false;
}

// ============================================================================
// Start Generation (SSE Stream)
// ============================================================================

/**
 * POST /api/admin/generate — Start phase generation with SSE streaming.
 */
async function handleStartGenerate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    context: GenerateHandlerContext
): Promise<void> {
    // Check if generation is already running
    if (generationState?.running) {
        sendJson(res, { error: 'Generation already in progress' }, 409);
        return;
    }

    // Check if repo path is available
    if (!context.repoPath) {
        send400(res, 'No repository path configured. Start server with --generate <repo-path>.');
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

    // Validate phases
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

    // Set up SSE response
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    // Initialize generation state
    generationState = {
        running: true,
        currentPhase: startPhase,
        cancelled: false,
        startTime: Date.now(),
    };

    const isCancelled = () => generationState?.cancelled ?? true;

    try {
        await runGeneration(res, context, startPhase, endPhase, !!request.force, isCancelled);
    } catch (error) {
        const message = getErrorMessage(error);
        sendSSE(res, { type: 'error', message });
        sendSSE(res, { type: 'done', success: false, error: message });
    } finally {
        generationState = null;
        res.end();
    }
}

// ============================================================================
// Generation Execution
// ============================================================================

/**
 * Run the generation pipeline for the specified phase range.
 */
async function runGeneration(
    res: http.ServerResponse,
    context: GenerateHandlerContext,
    startPhase: number,
    endPhase: number,
    force: boolean,
    isCancelled: () => boolean
): Promise<void> {
    const repoPath = path.resolve(context.repoPath!);
    const outputDir = context.wikiDir;
    const totalStartTime = Date.now();

    // Build options for the generate pipeline
    const options: GenerateCommandOptions = {
        output: outputDir,
        depth: 'normal',
        force,
        useCache: !force,
        verbose: false,
        phase: startPhase,
        endPhase,
    };

    // Dynamically import phase runners and cache functions
    const {
        runPhase1,
        runPhase2Consolidation,
        runPhase3Analysis,
        runPhase4Writing,
        runPhase5Website,
    } = await import('../commands/phases');

    const {
        getCachedGraphAny,
        getCachedGraph,
        getCachedAnalyses,
    } = await import('../cache');

    const { UsageTracker } = await import('../usage-tracker');
    const { checkAIAvailability } = await import('../ai-invoker');

    // Check AI availability (needed for phases 1-4)
    if (endPhase <= 4 || startPhase <= 4) {
        const availability = await checkAIAvailability();
        if (!availability.available) {
            sendSSE(res, { type: 'error', message: `Copilot SDK not available: ${availability.reason || 'Unknown'}` });
            sendSSE(res, { type: 'done', success: false, error: 'AI service unavailable' });
            return;
        }
    }

    const usageTracker = new UsageTracker();
    let graph: ComponentGraph | undefined;
    let analyses: ComponentAnalysis[] | undefined;
    let reanalyzedComponentIds: string[] | undefined;

    // ================================================================
    // Phase 1: Discovery
    // ================================================================
    if (startPhase <= 1 && endPhase >= 1) {
        if (isCancelled()) {
            sendSSE(res, { type: 'done', success: false, error: 'Cancelled' });
            return;
        }

        generationState!.currentPhase = 1;
        sendSSE(res, { type: 'status', phase: 1, state: 'running', message: 'Starting discovery...' });

        const phaseStart = Date.now();
        try {
            const phase1Result = await runPhase1(repoPath, options, isCancelled);
            if (phase1Result.exitCode !== undefined) {
                sendSSE(res, { type: 'error', phase: 1, message: `Discovery failed (exit code ${phase1Result.exitCode})` });
                sendSSE(res, { type: 'done', success: false, error: 'Phase 1 failed' });
                return;
            }
            graph = phase1Result.graph!;
            const duration = Date.now() - phaseStart;
            if (phase1Result.tokenUsage) {
                usageTracker.addUsage('discovery', phase1Result.tokenUsage);
            }
            sendSSE(res, {
                type: 'phase-complete', phase: 1, success: true, duration,
                message: `Discovered ${graph.components.length} components`,
            });
        } catch (error) {
            sendSSE(res, { type: 'error', phase: 1, message: getErrorMessage(error) });
            sendSSE(res, { type: 'done', success: false, error: 'Phase 1 failed' });
            return;
        }
    } else if (startPhase > 1) {
        // Load graph from cache
        const cached = options.useCache
            ? getCachedGraphAny(outputDir)
            : await getCachedGraph(repoPath, outputDir);
        if (!cached) {
            sendSSE(res, { type: 'error', message: 'No cached component graph found. Run Discovery first.' });
            sendSSE(res, { type: 'done', success: false, error: 'Missing prerequisite: Discovery' });
            return;
        }
        graph = cached.graph;
        sendSSE(res, { type: 'log', phase: startPhase, message: `Loaded cached component graph (${graph.components.length} components)` });
    }

    if (!graph) {
        sendSSE(res, { type: 'error', message: 'No component graph available' });
        sendSSE(res, { type: 'done', success: false, error: 'No component graph' });
        return;
    }

    // ================================================================
    // Phase 2: Consolidation
    // ================================================================
    if (startPhase <= 2 && endPhase >= 2) {
        if (isCancelled()) {
            sendSSE(res, { type: 'done', success: false, error: 'Cancelled' });
            return;
        }

        generationState!.currentPhase = 2;
        sendSSE(res, { type: 'status', phase: 2, state: 'running', message: 'Starting consolidation...' });

        const phaseStart = Date.now();
        try {
            const phase2Result = await runPhase2Consolidation(repoPath, graph, options, usageTracker);
            graph = phase2Result.graph;
            const duration = Date.now() - phaseStart;
            sendSSE(res, {
                type: 'phase-complete', phase: 2, success: true, duration,
                message: `Consolidated to ${graph.components.length} components`,
            });
        } catch (error) {
            sendSSE(res, { type: 'error', phase: 2, message: getErrorMessage(error) });
            sendSSE(res, { type: 'done', success: false, error: 'Phase 2 failed' });
            return;
        }
    }

    // ================================================================
    // Phase 3: Analysis
    // ================================================================
    if (startPhase <= 3 && endPhase >= 3) {
        if (isCancelled()) {
            sendSSE(res, { type: 'done', success: false, error: 'Cancelled' });
            return;
        }

        generationState!.currentPhase = 3;
        sendSSE(res, { type: 'status', phase: 3, state: 'running', message: 'Starting analysis...' });

        const phaseStart = Date.now();
        try {
            const phase3Result = await runPhase3Analysis(
                repoPath, graph, options, isCancelled, usageTracker
            );
            if (phase3Result.exitCode !== undefined) {
                sendSSE(res, { type: 'error', phase: 3, message: `Analysis failed (exit code ${phase3Result.exitCode})` });
                sendSSE(res, { type: 'done', success: false, error: 'Phase 3 failed' });
                return;
            }
            analyses = phase3Result.analyses!;
            reanalyzedComponentIds = phase3Result.reanalyzedComponentIds;
            const duration = Date.now() - phaseStart;
            sendSSE(res, {
                type: 'phase-complete', phase: 3, success: true, duration,
                message: `Analyzed ${analyses.length} components`,
            });
        } catch (error) {
            sendSSE(res, { type: 'error', phase: 3, message: getErrorMessage(error) });
            sendSSE(res, { type: 'done', success: false, error: 'Phase 3 failed' });
            return;
        }
    } else if (startPhase > 3 && endPhase >= 4) {
        // Load analyses from cache
        const cached = getCachedAnalyses(outputDir);
        if (!cached || cached.length === 0) {
            sendSSE(res, { type: 'error', message: 'No cached analyses found. Run Analysis first.' });
            sendSSE(res, { type: 'done', success: false, error: 'Missing prerequisite: Analysis' });
            return;
        }
        analyses = cached;
        sendSSE(res, { type: 'log', phase: startPhase, message: `Loaded ${analyses.length} cached analyses` });
    }

    // ================================================================
    // Phase 4: Writing
    // ================================================================
    if (startPhase <= 4 && endPhase >= 4) {
        if (isCancelled()) {
            sendSSE(res, { type: 'done', success: false, error: 'Cancelled' });
            return;
        }

        if (!analyses) {
            sendSSE(res, { type: 'error', message: 'No analyses available for writing phase' });
            sendSSE(res, { type: 'done', success: false, error: 'Missing analyses' });
            return;
        }

        generationState!.currentPhase = 4;
        sendSSE(res, { type: 'status', phase: 4, state: 'running', message: 'Starting article writing...' });

        const phaseStart = Date.now();
        try {
            const phase4Result = await runPhase4Writing(
                repoPath, graph, analyses, options, isCancelled, usageTracker, reanalyzedComponentIds
            );
            if (phase4Result.exitCode !== undefined) {
                sendSSE(res, { type: 'error', phase: 4, message: `Writing failed (exit code ${phase4Result.exitCode})` });
                sendSSE(res, { type: 'done', success: false, error: 'Phase 4 failed' });
                return;
            }
            const duration = Date.now() - phaseStart;
            sendSSE(res, {
                type: 'phase-complete', phase: 4, success: true, duration,
                message: `Wrote ${phase4Result.articlesWritten} articles`,
            });
        } catch (error) {
            sendSSE(res, { type: 'error', phase: 4, message: getErrorMessage(error) });
            sendSSE(res, { type: 'done', success: false, error: 'Phase 4 failed' });
            return;
        }
    }

    // ================================================================
    // Phase 5: Website
    // ================================================================
    if (startPhase <= 5 && endPhase >= 5) {
        if (isCancelled()) {
            sendSSE(res, { type: 'done', success: false, error: 'Cancelled' });
            return;
        }

        generationState!.currentPhase = 5;
        sendSSE(res, { type: 'status', phase: 5, state: 'running', message: 'Building website...' });

        // Ensure component-graph.json reflects the current in-memory graph before Phase 5
        if (graph) {
            const graphOutputFile = path.join(path.resolve(outputDir), 'component-graph.json');
            try {
                fs.mkdirSync(path.resolve(outputDir), { recursive: true });
                fs.writeFileSync(graphOutputFile, JSON.stringify(graph, null, 2), 'utf-8');
            } catch {
                // Non-fatal
            }
        }

        const phaseStart = Date.now();
        try {
            const phase5Result = runPhase5Website(options);
            const duration = Date.now() - phaseStart;
            if (phase5Result.success) {
                sendSSE(res, {
                    type: 'phase-complete', phase: 5, success: true, duration,
                    message: 'Website generated',
                });
            } else {
                sendSSE(res, { type: 'error', phase: 5, message: 'Website generation failed' });
            }
        } catch (error) {
            sendSSE(res, { type: 'error', phase: 5, message: getErrorMessage(error) });
        }
    }

    // ================================================================
    // Post-generation: Reload wiki data and broadcast refresh
    // ================================================================
    if (endPhase >= 4 && context.wikiData) {
        try {
            context.wikiData.reload();
            sendSSE(res, { type: 'log', message: 'Wiki data reloaded' });
        } catch (error) {
            sendSSE(res, { type: 'log', message: `Warning: Failed to reload wiki data: ${getErrorMessage(error)}` });
        }

        // Broadcast WebSocket refresh event
        if (context.wsServer) {
            context.wsServer.broadcast({ type: 'reload', components: [] });
        }
    }

    const totalDuration = Date.now() - totalStartTime;
    sendSSE(res, { type: 'done', success: true, duration: totalDuration });
}

// ============================================================================
// Single-Component Article Regeneration
// ============================================================================

/**
 * POST /api/admin/generate/component/:componentId — Regenerate article for a single component.
 * Streams progress via SSE. Uses cached analysis + component graph.
 */
async function handleComponentRegenerate(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    componentId: string,
    context: GenerateHandlerContext
): Promise<void> {
    // 503: No repo path configured
    if (!context.repoPath) {
        sendJson(res, { error: 'No repository path configured. Start server with --generate <repo-path>.' }, 503);
        return;
    }

    // 409: Another generation is already running
    if (generationState?.running) {
        sendJson(res, { error: 'A generation is already in progress' }, 409);
        return;
    }

    // Validate component exists in graph
    if (!context.wikiData) {
        send500(res, 'Wiki data not loaded');
        return;
    }

    const graph = context.wikiData.graph;
    const componentInfo = graph.components.find(m => m.id === componentId);
    if (!componentInfo) {
        send404(res, `Component not found: ${componentId}`);
        return;
    }

    // Parse optional request body
    const body = await readBody(req);
    let force = false;
    try {
        if (body.trim()) {
            const parsed = JSON.parse(body);
            force = !!parsed.force;
        }
    } catch {
        // Ignore parse errors — use defaults
    }

    // Load analysis for this component
    const { getCachedAnalysis } = await import('../cache');
    const outputDir = context.wikiDir;
    const analysis = getCachedAnalysis(componentId, outputDir);

    // Also check in-memory analyses from wikiData
    const detail = context.wikiData.getComponentDetail(componentId);
    const componentAnalysis = analysis || detail?.analysis;

    if (!componentAnalysis) {
        sendJson(res, { error: `No analysis cached for component "${componentId}". Run Phase 3 (Analysis) first.` }, 412);
        return;
    }

    // Set up SSE response
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    // Set generation state to block concurrent runs
    generationState = {
        running: true,
        currentPhase: 4,
        cancelled: false,
        startTime: Date.now(),
    };

    try {
        await runComponentRegeneration(res, context, componentId, componentAnalysis, graph, force);
    } catch (error) {
        const message = getErrorMessage(error);
        sendSSE(res, { type: 'error', message });
        sendSSE(res, { type: 'done', success: false, componentId, error: message });
    } finally {
        generationState = null;
        res.end();
    }
}

/**
 * Execute single-component article regeneration.
 */
async function runComponentRegeneration(
    res: http.ServerResponse,
    context: GenerateHandlerContext,
    componentId: string,
    analysis: ComponentAnalysis,
    graph: ComponentGraph,
    _force: boolean
): Promise<void> {
    const outputDir = context.wikiDir;
    const repoPath = path.resolve(context.repoPath!);
    const startTime = Date.now();

    const componentInfo = graph.components.find(m => m.id === componentId)!;
    const componentName = componentInfo.name || componentId;

    sendSSE(res, { type: 'status', state: 'running', componentId, message: `Generating article for ${componentName}...` });

    // Check AI availability
    const { checkAIAvailability } = await import('../ai-invoker');
    const availability = await checkAIAvailability();
    if (!availability.available) {
        sendSSE(res, { type: 'error', message: `Copilot SDK not available: ${availability.reason || 'Unknown'}` });
        sendSSE(res, { type: 'done', success: false, componentId, error: 'AI service unavailable' });
        return;
    }

    // Build prompt using existing utilities
    const { buildComponentArticlePrompt } = await import('../writing/prompts');
    const prompt = buildComponentArticlePrompt(analysis, graph, 'normal');

    sendSSE(res, { type: 'log', message: 'Sending to AI model...' });

    // Create a writing invoker and invoke AI
    const { createWritingInvoker } = await import('../ai-invoker');
    const invoker = createWritingInvoker({ repoPath });
    const aiResult = await invoker(prompt);

    if (!aiResult.success || !aiResult.response) {
        const errMsg = aiResult.error || 'AI returned empty response';
        sendSSE(res, { type: 'error', message: errMsg });
        sendSSE(res, { type: 'done', success: false, componentId, error: errMsg });
        return;
    }

    sendSSE(res, { type: 'log', message: 'Article generated, saving...' });

    // Build the GeneratedArticle
    const { normalizeComponentId } = await import('../schemas');
    const domainId = componentInfo.domain;
    const article: GeneratedArticle = {
        type: 'component',
        slug: normalizeComponentId(componentId),
        title: componentName,
        content: aiResult.response,
        componentId,
        domainId,
    };

    // Save to cache
    const { saveArticle } = await import('../cache/article-cache');
    const { getFolderHeadHash } = await import('../cache/git-utils');
    const gitHash = await getFolderHeadHash(repoPath) || 'unknown';
    saveArticle(componentId, article, outputDir, gitHash);

    // Write markdown file to disk
    const { getArticleFilePath, normalizeLineEndings } = await import('../writing/file-writer');
    const resolvedDir = path.resolve(outputDir);
    const filePath = getArticleFilePath(article, resolvedDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, normalizeLineEndings(article.content), 'utf-8');

    // Reload wiki data
    if (context.wikiData) {
        try {
            context.wikiData.reload();
            sendSSE(res, { type: 'log', message: 'Wiki data reloaded' });
        } catch (error) {
            sendSSE(res, { type: 'log', message: `Warning: Failed to reload wiki data: ${getErrorMessage(error)}` });
        }
    }

    // Broadcast WebSocket refresh
    if (context.wsServer) {
        context.wsServer.broadcast({ type: 'reload', components: [componentId] });
    }

    const duration = Date.now() - startTime;
    sendSSE(res, { type: 'done', success: true, componentId, duration, message: 'Article regenerated' });
}

// ============================================================================
// Cancel Generation
// ============================================================================

/**
 * POST /api/admin/generate/cancel — Cancel running generation.
 */
function handleCancelGenerate(res: http.ServerResponse): void {
    if (!generationState?.running) {
        sendJson(res, { success: false, error: 'No generation in progress' });
        return;
    }

    generationState.cancelled = true;
    sendJson(res, { success: true });
}

// ============================================================================
// Generation Status
// ============================================================================

/**
 * GET /api/admin/generate/status — Get phase cache status and generation state.
 */
function handleGetGenerateStatus(
    res: http.ServerResponse,
    context: GenerateHandlerContext
): void {
    try {
        const outputDir = context.wikiDir;
        const available = !!context.repoPath;

        const phases: Record<string, { cached: boolean; timestamp?: string; components?: Record<string, { cached: boolean; timestamp?: string }> }> = {};

        if (available) {
            // Phase 1: Check graph cache
            phases['1'] = checkGraphCacheStatus(outputDir);

            // Phase 2: Check consolidation cache
            phases['2'] = checkConsolidationCacheStatus(outputDir);

            // Phase 3: Check analysis cache
            phases['3'] = checkAnalysisCacheStatus(outputDir);

            // Phase 4: Check article cache + per-component article status
            phases['4'] = checkArticleCacheStatus(outputDir);

            // Add per-component article cache status to Phase 4
            if (context.wikiData) {
                try {
                    const components: Record<string, { cached: boolean; timestamp?: string }> = {};
                    const graph = context.wikiData.graph;
                    const articlesDir = path.join(path.resolve(outputDir), '.wiki-cache', 'articles');

                    for (const mod of graph.components) {
                        components[mod.id] = getComponentArticleCacheStatus(articlesDir, mod.id, mod.domain);
                    }
                    phases['4'].components = components;
                } catch {
                    // Ignore errors reading per-component status
                }
            }

            // Phase 5: Check website existence
            phases['5'] = checkWebsiteCacheStatus(outputDir);
        }

        sendJson(res, {
            running: generationState?.running ?? false,
            currentPhase: generationState?.currentPhase,
            phases,
            repoPath: context.repoPath,
            available,
        });
    } catch (error) {
        send500(res, `Failed to get generation status: ${getErrorMessage(error)}`);
    }
}

// ============================================================================
// Cache Status Helpers
// ============================================================================

function checkCacheFileStatus(filePath: string): { cached: boolean; timestamp?: string } {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            // Try to extract timestamp from common cache formats
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

function checkGraphCacheStatus(outputDir: string): { cached: boolean; timestamp?: string } {
    return checkCacheFileStatus(path.join(path.resolve(outputDir), '.wiki-cache', 'component-graph.json'));
}

function checkConsolidationCacheStatus(outputDir: string): { cached: boolean; timestamp?: string } {
    return checkCacheFileStatus(path.join(path.resolve(outputDir), '.wiki-cache', 'consolidated-graph.json'));
}

function checkAnalysisCacheStatus(outputDir: string): { cached: boolean; timestamp?: string } {
    return checkCacheFileStatus(path.join(path.resolve(outputDir), '.wiki-cache', 'analyses', '_metadata.json'));
}

function checkArticleCacheStatus(outputDir: string): { cached: boolean; timestamp?: string } {
    return checkCacheFileStatus(path.join(path.resolve(outputDir), '.wiki-cache', 'articles', '_metadata.json'));
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

/**
 * Check per-component article cache status.
 * Looks in both flat and domain-scoped cache directories.
 */
function getComponentArticleCacheStatus(
    articlesDir: string,
    componentId: string,
    domainId?: string
): { cached: boolean; timestamp?: string } {
    // Check domain-scoped path first, then flat path
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
        } catch {
            // Skip invalid cache files
        }
    }

    return { cached: false };
}

// ============================================================================
// Testing Utilities
// ============================================================================

/**
 * Get the current generation state (for testing).
 */
export function getGenerationState(): GenerationState | null {
    return generationState;
}

/**
 * Reset the generation state (for testing).
 */
export function resetGenerationState(): void {
    generationState = null;
}
