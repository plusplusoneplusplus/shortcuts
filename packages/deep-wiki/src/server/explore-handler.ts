/**
 * Explore Handler
 *
 * POST /api/explore/:moduleId — On-demand deep-dive into a module.
 * Creates a focused AI session that analyzes the module in depth,
 * optionally answering a specific user question.
 *
 * Streams the result as SSE events:
 *   data: {"type":"status","message":"Analyzing module..."}
 *   data: {"type":"chunk","text":"## Deep Analysis\n\n..."}
 *   data: {"type":"done","fullResponse":"..."}
 *   data: {"type":"error","message":"Something went wrong"}
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { WikiData } from './wiki-data';
import { sendSSE } from './ask-handler';
import type { AskAIFunction } from './ask-handler';

// ============================================================================
// Types
// ============================================================================

/** Request body for POST /api/explore/:moduleId. */
export interface ExploreRequest {
    question?: string;
    depth?: 'normal' | 'deep';
}

/** Options for the explore handler. */
export interface ExploreHandlerOptions {
    wikiData: WikiData;
    sendMessage: AskAIFunction;
    model?: string;
    workingDirectory?: string;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Handle POST /api/explore/:moduleId — streamed as SSE.
 */
export async function handleExploreRequest(
    req: IncomingMessage,
    res: ServerResponse,
    moduleId: string,
    options: ExploreHandlerOptions,
): Promise<void> {
    // Parse body
    const body = await readBody(req);
    let exploreReq: ExploreRequest = {};
    if (body.trim()) {
        try {
            exploreReq = JSON.parse(body);
        } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            return;
        }
    }

    // Validate module exists
    const graph = options.wikiData.graph;
    const mod = graph.modules.find(m => m.id === moduleId);
    if (!mod) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Module not found: ${moduleId}` }));
        return;
    }

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });

    try {
        // 1. Send status
        sendSSE(res, { type: 'status', message: `Analyzing ${mod.name} module...` });

        // 2. Load existing analysis
        const detail = options.wikiData.getModuleDetail(moduleId);
        const existingMarkdown = detail?.markdown || '';

        // 3. Build explore prompt
        const prompt = buildExplorePrompt(mod, existingMarkdown, graph, exploreReq);

        // 4. Call AI
        const fullResponse = await options.sendMessage(prompt, {
            model: options.model,
            workingDirectory: options.workingDirectory,
        });

        // 5. Stream chunks
        const chunks = chunkText(fullResponse, 150);
        for (const chunk of chunks) {
            sendSSE(res, { type: 'chunk', text: chunk });
        }

        // 6. Done
        sendSSE(res, { type: 'done', fullResponse });

    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        sendSSE(res, { type: 'error', message });
    }

    res.end();
}

// ============================================================================
// Prompt Building
// ============================================================================

/**
 * Build the AI prompt for deep-dive exploration.
 */
export function buildExplorePrompt(
    mod: { id: string; name: string; category: string; path: string; purpose: string; keyFiles: string[]; dependencies: string[]; dependents: string[] },
    existingMarkdown: string,
    graph: { project: { name: string; description: string; language: string }; modules: Array<{ id: string; name: string; purpose: string; dependencies: string[] }> },
    request: ExploreRequest,
): string {
    const parts: string[] = [];

    const depth = request.depth || 'normal';
    const isDeep = depth === 'deep';

    parts.push(`You are conducting a ${isDeep ? 'deep' : 'focused'} analysis of the "${mod.name}" module.`);
    parts.push('Provide detailed technical insights with code-level specifics.');
    parts.push('Use markdown formatting with headers, code blocks, and lists.');
    parts.push('');

    // Module context
    parts.push('## Module Information');
    parts.push('');
    parts.push(`- **Name:** ${mod.name}`);
    parts.push(`- **ID:** ${mod.id}`);
    parts.push(`- **Category:** ${mod.category}`);
    parts.push(`- **Path:** ${mod.path}`);
    parts.push(`- **Purpose:** ${mod.purpose}`);
    parts.push(`- **Key Files:** ${mod.keyFiles.join(', ')}`);
    parts.push(`- **Dependencies:** ${mod.dependencies.length > 0 ? mod.dependencies.join(', ') : 'none'}`);
    parts.push(`- **Dependents:** ${mod.dependents.length > 0 ? mod.dependents.join(', ') : 'none'}`);
    parts.push('');

    // Existing analysis
    if (existingMarkdown) {
        parts.push('## Existing Analysis');
        parts.push('');
        parts.push(existingMarkdown);
        parts.push('');
    }

    // Architecture context
    parts.push('## Project Architecture');
    parts.push('');
    parts.push(`Project: ${graph.project.name} (${graph.project.language})`);
    for (const m of graph.modules) {
        const deps = m.dependencies.length > 0 ? ` → ${m.dependencies.join(', ')}` : '';
        parts.push(`  - ${m.name}: ${m.purpose}${deps}`);
    }
    parts.push('');

    // User question or default exploration
    if (request.question) {
        parts.push('## User Question');
        parts.push('');
        parts.push(request.question);
    } else if (isDeep) {
        parts.push('## Deep Analysis Task');
        parts.push('');
        parts.push('Provide a comprehensive deep-dive analysis covering:');
        parts.push('1. Internal architecture and design patterns');
        parts.push('2. Key algorithms and data structures');
        parts.push('3. Error handling strategies');
        parts.push('4. Performance characteristics and potential bottlenecks');
        parts.push('5. Integration points with other modules');
        parts.push('6. Potential improvements and technical debt');
    } else {
        parts.push('## Analysis Task');
        parts.push('');
        parts.push('Provide a focused analysis covering the most important aspects of this module,');
        parts.push('including architecture, key patterns, and how it integrates with the rest of the system.');
    }

    return parts.join('\n');
}

// ============================================================================
// Utilities
// ============================================================================

function chunkText(text: string, chunkSize: number): string[] {
    if (!text) return [];
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
