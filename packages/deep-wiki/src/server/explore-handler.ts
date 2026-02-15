/**
 * Explore Handler
 *
 * POST /api/explore/:componentId — On-demand deep-dive into a component.
 * Creates a focused AI session that analyzes the component in depth,
 * optionally answering a specific user question.
 *
 * Streams the result as SSE events:
 *   data: {"type":"status","message":"Analyzing component..."}
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

/** Request body for POST /api/explore/:componentId. */
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
 * Handle POST /api/explore/:componentId — streamed as SSE.
 */
export async function handleExploreRequest(
    req: IncomingMessage,
    res: ServerResponse,
    componentId: string,
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

    // Validate component exists
    const graph = options.wikiData.graph;
    const mod = graph.components.find(m => m.id === componentId);
    if (!mod) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Component not found: ${componentId}` }));
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
        sendSSE(res, { type: 'status', message: `Analyzing ${mod.name} component...` });

        // 2. Load existing analysis
        const detail = options.wikiData.getComponentDetail(componentId);
        const existingMarkdown = detail?.markdown || '';

        // 3. Build explore prompt
        const prompt = buildExplorePrompt(mod, existingMarkdown, graph, exploreReq);

        // 4. Call AI with native streaming — chunks are sent as SSE events in real-time
        const fullResponse = await options.sendMessage(prompt, {
            model: options.model,
            workingDirectory: options.workingDirectory,
            onStreamingChunk: (chunk) => {
                sendSSE(res, { type: 'chunk', text: chunk });
            },
        });

        // 5. Done
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
    graph: { project: { name: string; description: string; language: string }; components: Array<{ id: string; name: string; purpose: string; dependencies: string[] }> },
    request: ExploreRequest,
): string {
    const parts: string[] = [];

    const depth = request.depth || 'normal';
    const isDeep = depth === 'deep';

    parts.push(`You are conducting a ${isDeep ? 'deep' : 'focused'} analysis of the "${mod.name}" component.`);
    parts.push('Provide detailed technical insights with code-level specifics.');
    parts.push('Use markdown formatting with headers, code blocks, and lists.');
    parts.push('');

    // Component context
    parts.push('## Component Information');
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
    for (const m of graph.components) {
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
        parts.push('5. Integration points with other components');
        parts.push('6. Potential improvements and technical debt');
    } else {
        parts.push('## Analysis Task');
        parts.push('');
        parts.push('Provide a focused analysis covering the most important aspects of this component,');
        parts.push('including architecture, key patterns, and how it integrates with the rest of the system.');

    }

    return parts.join('\n');
}

// ============================================================================
// Utilities
// ============================================================================

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}
