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
import { sendJson, send400, send500, readBody } from './router';
import { getErrorMessage } from '../utils/error-utils';
import type { GenerateCommandOptions, ModuleGraph, ModuleAnalysis } from '../types';
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
// Module-Level State
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
    let graph: ModuleGraph | undefined;
    let analyses: ModuleAnalysis[] | undefined;
    let reanalyzedModuleIds: string[] | undefined;

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
                message: `Discovered ${graph.modules.length} modules`,
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
            sendSSE(res, { type: 'error', message: 'No cached module graph found. Run Discovery first.' });
            sendSSE(res, { type: 'done', success: false, error: 'Missing prerequisite: Discovery' });
            return;
        }
        graph = cached.graph;
        sendSSE(res, { type: 'log', phase: startPhase, message: `Loaded cached module graph (${graph.modules.length} modules)` });
    }

    if (!graph) {
        sendSSE(res, { type: 'error', message: 'No module graph available' });
        sendSSE(res, { type: 'done', success: false, error: 'No module graph' });
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
                message: `Consolidated to ${graph.modules.length} modules`,
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
            reanalyzedModuleIds = phase3Result.reanalyzedModuleIds;
            const duration = Date.now() - phaseStart;
            sendSSE(res, {
                type: 'phase-complete', phase: 3, success: true, duration,
                message: `Analyzed ${analyses.length} modules`,
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
                repoPath, graph, analyses, options, isCancelled, usageTracker, reanalyzedModuleIds
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

        // Ensure module-graph.json reflects the current in-memory graph before Phase 5
        if (graph) {
            const graphOutputFile = path.join(path.resolve(outputDir), 'module-graph.json');
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
            context.wsServer.broadcast({ type: 'reload', modules: [] });
        }
    }

    const totalDuration = Date.now() - totalStartTime;
    sendSSE(res, { type: 'done', success: true, duration: totalDuration });
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

        const phases: Record<string, { cached: boolean; timestamp?: string }> = {};

        if (available) {
            // Phase 1: Check graph cache
            phases['1'] = checkGraphCacheStatus(outputDir);

            // Phase 2: Check consolidation cache
            phases['2'] = checkConsolidationCacheStatus(outputDir);

            // Phase 3: Check analysis cache
            phases['3'] = checkAnalysisCacheStatus(outputDir);

            // Phase 4: Check article cache
            phases['4'] = checkArticleCacheStatus(outputDir);

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
    return checkCacheFileStatus(path.join(path.resolve(outputDir), '.wiki-cache', 'module-graph.json'));
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
