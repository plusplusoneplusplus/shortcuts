/**
 * Canvas LLM Tools
 *
 * Per-invocation tool factories for the chat canvas — a markdown artifact the
 * AI maintains in a side panel next to the conversation (in the genre of
 * ChatGPT Canvas / Claude Artifacts / GitHub Copilot app canvases).
 *
 * Three tools:
 *   - `create_canvas` — creates a markdown canvas linked to the current process
 *   - `update_canvas` — applies revision-checked targeted edits or a full rewrite
 *   - `read_canvas`   — reads the current content (required after user edits)
 *
 * Canvases persist via `CanvasStore` under `~/.coc/repos/<workspaceId>/canvases/`.
 * Every successful create/update emits a `canvas-updated` SSE event on the
 * process channel so the dashboard panel re-renders live.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { CanvasStore } from '../canvas/canvas-store';
import type { CanvasEdit, CanvasType } from '../canvas/canvas-store';
import { emitCanvasUpdated } from '../streaming/sse-handler';

// ============================================================================
// Types
// ============================================================================

export interface CanvasToolsDeps {
    dataDir: string;
    workspaceId: string;
    /** Process the canvas is linked to; enables SSE events and panel discovery. */
    processId?: string;
    /** Process store used to emit `canvas-updated` SSE events. */
    processStore?: ProcessStore;
    /** Injectable store for tests. Defaults to a dataDir-backed `CanvasStore`. */
    canvasStore?: CanvasStore;
}

export interface CreateCanvasArgs {
    title: string;
    content: string;
    type?: CanvasType;
    language?: string;
}

export interface UpdateCanvasArgs {
    canvasId: string;
    edits?: CanvasEdit[];
    content?: string;
    expectedRevision?: number;
    title?: string;
}

export interface ReadCanvasArgs {
    canvasId: string;
}

// ============================================================================
// Tool Factories
// ============================================================================

export function createCanvasTools(deps: CanvasToolsDeps): {
    create: Tool<unknown>;
    update: Tool<unknown>;
    read: Tool<unknown>;
} {
    const store = deps.canvasStore ?? new CanvasStore(deps.dataDir);

    const emitUpdate = (canvasId: string, title: string, revision: number): void => {
        if (deps.processStore && deps.processId) {
            emitCanvasUpdated(deps.processStore, deps.processId, {
                canvasId,
                title,
                revision,
                editor: 'ai',
            });
        }
    };

    const create = defineTool<CreateCanvasArgs>('create_canvas', {
        description:
            'Create a canvas — a live artifact shown in a side panel next to this chat that you and ' +
            'the user co-edit. Use type "markdown" (default) for documents, plans, and specs — Mermaid ' +
            'code blocks render as diagrams/charts there. Use type "code" with a language for a single ' +
            'code file the user will iterate on. Returns the canvasId and revision needed for updates. ' +
            'After creating, keep chat replies short and reference the canvas instead of repeating its content.',
        parameters: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Short human-readable canvas title (e.g. "Auth migration plan").',
                },
                content: {
                    type: 'string',
                    description: 'Initial content of the canvas (markdown, or raw code for type "code").',
                },
                type: {
                    type: 'string',
                    enum: ['markdown', 'code'],
                    description: 'Canvas type. Defaults to "markdown".',
                },
                language: {
                    type: 'string',
                    description: 'Language for type "code" (e.g. "typescript", "python"). Ignored for markdown.',
                },
            },
            required: ['title', 'content'],
        },
        handler: async (args) => {
            if (!args?.title || typeof args.title !== 'string') {
                return { success: false, error: 'title is required' };
            }
            if (typeof args?.content !== 'string') {
                return { success: false, error: 'content is required' };
            }
            if (args.type !== undefined && args.type !== 'markdown' && args.type !== 'code') {
                return { success: false, error: 'type must be "markdown" or "code"' };
            }
            try {
                const canvas = store.createCanvas({
                    workspaceId: deps.workspaceId,
                    title: args.title.trim(),
                    content: args.content,
                    type: args.type,
                    language: args.language,
                    processId: deps.processId,
                    editor: 'ai',
                });
                emitUpdate(canvas.id, canvas.title, canvas.revision);
                return { success: true, canvasId: canvas.id, title: canvas.title, type: canvas.type, ...(canvas.language ? { language: canvas.language } : {}), revision: canvas.revision };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    });

    const update = defineTool<UpdateCanvasArgs>('update_canvas', {
        description:
            'Update an existing canvas. Prefer targeted `edits` (each oldText must match exactly once); ' +
            'pass `content` only for a full rewrite. Always pass `expectedRevision` from your latest ' +
            'create_canvas/read_canvas/update_canvas result — a revision conflict means the user edited ' +
            'the canvas, so call read_canvas and re-apply your change on the current content.',
        parameters: {
            type: 'object',
            properties: {
                canvasId: {
                    type: 'string',
                    description: 'Canvas ID returned by create_canvas.',
                },
                edits: {
                    type: 'array',
                    description: 'Targeted replacements applied in order. Each oldText must appear exactly once.',
                    items: {
                        type: 'object',
                        properties: {
                            oldText: { type: 'string', description: 'Exact existing text to replace.' },
                            newText: { type: 'string', description: 'Replacement text.' },
                        },
                        required: ['oldText', 'newText'],
                    },
                },
                content: {
                    type: 'string',
                    description: 'Full replacement markdown content. Use only when edits are impractical.',
                },
                expectedRevision: {
                    type: 'number',
                    description: 'The revision you last saw. The update fails if the canvas has changed since.',
                },
                title: {
                    type: 'string',
                    description: 'Optional new canvas title.',
                },
            },
            required: ['canvasId'],
        },
        handler: async (args) => {
            if (!args?.canvasId) {
                return { success: false, error: 'canvasId is required' };
            }
            try {
                const result = store.updateCanvas(deps.workspaceId, args.canvasId, {
                    edits: args.edits,
                    content: args.content,
                    expectedRevision: args.expectedRevision,
                    title: args.title,
                    editor: 'ai',
                });
                if (!result.ok) {
                    if (result.reason === 'not-found') {
                        return { success: false, error: `Canvas not found: ${args.canvasId}` };
                    }
                    if (result.reason === 'revision-conflict') {
                        return {
                            success: false,
                            error: `Revision conflict — the canvas is now at revision ${result.currentRevision} ` +
                                '(the user likely edited it). Call read_canvas and re-apply your change.',
                            currentRevision: result.currentRevision,
                        };
                    }
                    return { success: false, error: result.error };
                }
                emitUpdate(result.canvas.id, result.canvas.title, result.canvas.revision);
                return { success: true, canvasId: result.canvas.id, revision: result.canvas.revision };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    });

    const read = defineTool<ReadCanvasArgs>('read_canvas', {
        description:
            'Read the current content and revision of a canvas. Use before editing a canvas you did not ' +
            'just write, and after any update_canvas revision conflict.',
        parameters: {
            type: 'object',
            properties: {
                canvasId: {
                    type: 'string',
                    description: 'Canvas ID returned by create_canvas.',
                },
            },
            required: ['canvasId'],
        },
        handler: async (args) => {
            if (!args?.canvasId) {
                return { success: false, error: 'canvasId is required' };
            }
            const canvas = store.getCanvas(deps.workspaceId, args.canvasId);
            if (!canvas) {
                return { success: false, error: `Canvas not found: ${args.canvasId}` };
            }
            return {
                success: true,
                canvasId: canvas.id,
                title: canvas.title,
                revision: canvas.revision,
                content: canvas.content,
            };
        },
    });

    return {
        create: create as Tool<unknown>,
        update: update as Tool<unknown>,
        read: read as Tool<unknown>,
    };
}
