/**
 * Wiki Explore Handler
 *
 * POST /api/wikis/:wikiId/explore/:componentId — On-demand deep-dive.
 * Adapted from deep-wiki's explore-handler for multi-wiki CoC server.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { WikiManager } from './wiki-manager';
import type { AskAIFunction } from './types';
import { sendSSE, readBody } from './ask-handler';
import { send400, send404 } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Types
// ============================================================================

/** Request body for POST /api/wikis/:wikiId/explore/:componentId. */
export interface ExploreRequest {
    question?: string;
    depth?: 'normal' | 'deep';
}

/** Options for the explore handler. */
export interface WikiExploreHandlerOptions {
    wikiManager: WikiManager;
    aiSendMessage?: AskAIFunction;
    aiModel?: string;
    aiWorkingDirectory?: string;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Handle POST /api/wikis/:wikiId/explore/:componentId — streamed as SSE.
 */
export async function handleWikiExploreRequest(
    req: IncomingMessage,
    res: ServerResponse,
    wikiId: string,
    componentId: string,
    options: WikiExploreHandlerOptions,
): Promise<void> {
    const wiki = options.wikiManager.get(wikiId);
    if (!wiki) {
        send404(res, `Wiki not found: ${wikiId}`);
        return;
    }

    if (!wiki.registration.aiEnabled) {
        send400(res, 'AI features are not enabled for this wiki.');
        return;
    }

    const sendMessage = options.aiSendMessage;
    if (!sendMessage) {
        send400(res, 'AI service is not configured.');
        return;
    }

    // Validate component exists
    const graph = wiki.wikiData.graph;
    const mod = graph.components.find(m => m.id === componentId);
    if (!mod) {
        send404(res, `Component not found: ${componentId}`);
        return;
    }

    // Parse body
    const body = await readBody(req);
    let exploreReq: ExploreRequest = {};
    if (body.trim()) {
        try {
            exploreReq = JSON.parse(body);
        } catch {
            send400(res, 'Invalid JSON body');
            return;
        }
    }

    // Set SSE headers (no redundant CORS — router handles it)
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });

    const model = options.aiModel ?? wiki.registration.aiModel;
    const workingDirectory = options.aiWorkingDirectory ?? wiki.registration.repoPath;

    try {
        sendSSE(res, { type: 'status', message: `Analyzing ${mod.name} component...` });

        const detail = wiki.wikiData.getComponentDetail(componentId);
        const existingMarkdown = detail?.markdown || '';
        const prompt = buildExplorePrompt(mod, existingMarkdown, graph, exploreReq);

        const fullResponse = await sendMessage(prompt, {
            model,
            workingDirectory,
            onStreamingChunk: (chunk: string) => {
                sendSSE(res, { type: 'chunk', text: chunk });
            },
        });

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

    if (existingMarkdown) {
        parts.push('## Existing Analysis');
        parts.push('');
        parts.push(existingMarkdown);
        parts.push('');
    }

    parts.push('## Project Architecture');
    parts.push('');
    parts.push(`Project: ${graph.project.name} (${graph.project.language})`);
    for (const m of graph.components) {
        const deps = m.dependencies.length > 0 ? ` → ${m.dependencies.join(', ')}` : '';
        parts.push(`  - ${m.name}: ${m.purpose}${deps}`);
    }
    parts.push('');

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
