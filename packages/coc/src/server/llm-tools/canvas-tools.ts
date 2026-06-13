/**
 * Canvas LLM Tools
 *
 * Per-invocation tool factories for the chat canvas — a markdown artifact the
 * AI maintains in a side panel next to the conversation (in the genre of
 * ChatGPT Canvas / Claude Artifacts / GitHub Copilot app canvases).
 *
 * Tools:
 *   - `create_canvas` — creates a markdown/code canvas linked to the current process
 *   - `update_canvas` — applies revision-checked targeted edits or a full rewrite
 *   - `read_canvas`   — reads the current content (required after user edits)
 *   - `create_or_update_extension_canvas` — authors a custom interactive canvas
 *     (manifest + sandboxed iframe UI + vm-run capability script over JSON state)
 *   - `invoke_canvas_capability` — runs a declared pure state transform
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
import { CanvasStore, MAX_EXTENSION_UI_BYTES, MAX_EXTENSION_CAPABILITIES_BYTES } from '../canvas/canvas-store';
import type { CanvasEdit, CanvasType, CanvasCapabilityMeta, CanvasExtensionManifest } from '../canvas/canvas-store';
import { runCanvasCapability, isValidCapabilityName } from '../canvas/canvas-capability-runner';
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

export interface CreateOrUpdateExtensionCanvasArgs {
    canvasId?: string;
    title?: string;
    description: string;
    capabilities: CanvasCapabilityMeta[];
    capabilitiesJs: string;
    uiHtml: string;
    initialState?: Record<string, unknown>;
}

export interface InvokeCanvasCapabilityArgs {
    canvasId: string;
    capability: string;
    params?: Record<string, unknown>;
}

/** Cap on the state JSON echoed back to the model after a capability call. */
const MAX_RETURNED_STATE_CHARS = 20000;

function truncateState(state: string): { state: string; stateTruncated?: boolean } {
    if (state.length <= MAX_RETURNED_STATE_CHARS) return { state };
    return { state: state.slice(0, MAX_RETURNED_STATE_CHARS), stateTruncated: true };
}

function validateExtensionInput(args: CreateOrUpdateExtensionCanvasArgs): string | null {
    if (typeof args.description !== 'string' || !args.description.trim()) {
        return 'description is required';
    }
    if (!Array.isArray(args.capabilities) || args.capabilities.length === 0) {
        return 'capabilities must be a non-empty array of { name, description }';
    }
    for (const capability of args.capabilities) {
        if (!capability || !isValidCapabilityName(capability.name)) {
            return `Invalid capability name: ${String(capability?.name)} (lowercase letters, digits, underscores; starts with a letter)`;
        }
        if (typeof capability.description !== 'string' || !capability.description.trim()) {
            return `Capability "${capability.name}" needs a description`;
        }
    }
    if (typeof args.capabilitiesJs !== 'string' || !args.capabilitiesJs.trim()) {
        return 'capabilitiesJs is required';
    }
    if (Buffer.byteLength(args.capabilitiesJs, 'utf-8') > MAX_EXTENSION_CAPABILITIES_BYTES) {
        return 'capabilitiesJs exceeds the 256 KB limit';
    }
    if (typeof args.uiHtml !== 'string' || !args.uiHtml.trim()) {
        return 'uiHtml is required';
    }
    if (Buffer.byteLength(args.uiHtml, 'utf-8') > MAX_EXTENSION_UI_BYTES) {
        return 'uiHtml exceeds the 512 KB limit';
    }
    return null;
}

// ============================================================================
// Tool Factories
// ============================================================================

export function createCanvasTools(deps: CanvasToolsDeps): {
    create: Tool<unknown>;
    update: Tool<unknown>;
    read: Tool<unknown>;
    createOrUpdateExtension: Tool<unknown>;
    invokeCapability: Tool<unknown>;
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
            const extension = canvas.type === 'extension'
                ? store.getExtension(deps.workspaceId, canvas.id)
                : null;
            return {
                success: true,
                canvasId: canvas.id,
                title: canvas.title,
                type: canvas.type,
                ...(canvas.language ? { language: canvas.language } : {}),
                revision: canvas.revision,
                content: canvas.content,
                ...(extension ? {
                    extensionManifest: extension.manifest,
                    note: 'This is an extension canvas: content is its JSON shared state. Prefer invoke_canvas_capability over raw state edits.',
                } : {}),
            };
        },
    });

    const createOrUpdateExtension = defineTool<CreateOrUpdateExtensionCanvasArgs>('create_or_update_extension_canvas', {
        description:
            'Create or update a custom extension canvas — an interactive panel (kanban board, checklist, ' +
            'dashboard, …) backed by JSON shared state that both you and the user mutate through declared ' +
            'capabilities. Provide: a manifest (description + capabilities list), `capabilitiesJs` (a script ' +
            'that assigns a top-level `capabilities` object of synchronous (state, params) => nextState ' +
            'functions — pure transforms, no imports, no network, 1s budget), and `uiHtml` (a self-contained ' +
            'HTML+JS document rendered in a sandboxed iframe; use the injected `window.CanvasHost` API: ' +
            'CanvasHost.onState(cb) for re-renders, CanvasHost.invoke(name, params) for actions, ' +
            'CanvasHost.setState(state) as an escape hatch). Omit canvasId to create (with title + ' +
            'initialState); pass canvasId to replace the extension documents of an existing extension canvas ' +
            'without touching its state.',
        parameters: {
            type: 'object',
            properties: {
                canvasId: {
                    type: 'string',
                    description: 'Existing extension canvas to update. Omit to create a new one.',
                },
                title: {
                    type: 'string',
                    description: 'Canvas title (required when creating).',
                },
                description: {
                    type: 'string',
                    description: 'What this extension canvas does.',
                },
                capabilities: {
                    type: 'array',
                    description: 'Declared capabilities. Each must exist as a function in capabilitiesJs.',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'Capability name (lowercase_snake_case).' },
                            description: { type: 'string', description: 'What the capability does.' },
                            paramsDescription: { type: 'string', description: 'Expected params object, in plain words.' },
                        },
                        required: ['name', 'description'],
                    },
                },
                capabilitiesJs: {
                    type: 'string',
                    description: 'Script assigning `capabilities = { name(state, params) { ... return nextState; } }`.',
                },
                uiHtml: {
                    type: 'string',
                    description: 'Self-contained HTML+JS for the sandboxed iframe, using window.CanvasHost.',
                },
                initialState: {
                    type: 'object',
                    description: 'Initial JSON shared state (creation only). Defaults to {}.',
                },
            },
            required: ['description', 'capabilities', 'capabilitiesJs', 'uiHtml'],
        },
        handler: async (args) => {
            const validationError = validateExtensionInput(args ?? ({} as CreateOrUpdateExtensionCanvasArgs));
            if (validationError) {
                return { success: false, error: validationError };
            }
            const manifest: CanvasExtensionManifest = {
                description: args.description.trim(),
                capabilities: args.capabilities.map(c => ({
                    name: c.name,
                    description: c.description,
                    ...(c.paramsDescription ? { paramsDescription: c.paramsDescription } : {}),
                })),
            };
            try {
                if (args.canvasId) {
                    const updated = store.saveExtension(deps.workspaceId, args.canvasId, {
                        manifest,
                        uiHtml: args.uiHtml,
                        capabilitiesJs: args.capabilitiesJs,
                    }, 'ai');
                    if (!updated) {
                        return { success: false, error: `Extension canvas not found: ${args.canvasId}` };
                    }
                    emitUpdate(updated.id, updated.title, updated.revision);
                    return { success: true, canvasId: updated.id, revision: updated.revision, updated: true };
                }

                if (!args.title || !args.title.trim()) {
                    return { success: false, error: 'title is required when creating an extension canvas' };
                }
                const canvas = store.createCanvas({
                    workspaceId: deps.workspaceId,
                    title: args.title.trim(),
                    content: JSON.stringify(args.initialState ?? {}, null, 2),
                    type: 'extension',
                    processId: deps.processId,
                    editor: 'ai',
                });
                const withExtension = store.saveExtension(deps.workspaceId, canvas.id, {
                    manifest,
                    uiHtml: args.uiHtml,
                    capabilitiesJs: args.capabilitiesJs,
                }, 'ai');
                const record = withExtension ?? canvas;
                emitUpdate(record.id, record.title, record.revision);
                return { success: true, canvasId: record.id, title: record.title, revision: record.revision, created: true };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    });

    const invokeCapability = defineTool<InvokeCanvasCapabilityArgs>('invoke_canvas_capability', {
        description:
            'Invoke a declared capability on an extension canvas. The capability runs as a pure transform ' +
            'over the canvas JSON shared state and the panel re-renders live. Use read_canvas to see the ' +
            'manifest and current state first. Returns the new revision and resulting state.',
        parameters: {
            type: 'object',
            properties: {
                canvasId: {
                    type: 'string',
                    description: 'Extension canvas ID.',
                },
                capability: {
                    type: 'string',
                    description: 'Declared capability name from the canvas manifest.',
                },
                params: {
                    type: 'object',
                    description: 'Parameters for the capability (see the manifest paramsDescription).',
                },
            },
            required: ['canvasId', 'capability'],
        },
        handler: async (args) => {
            if (!args?.canvasId || !args?.capability) {
                return { success: false, error: 'canvasId and capability are required' };
            }
            const canvas = store.getCanvas(deps.workspaceId, args.canvasId);
            if (!canvas || canvas.type !== 'extension') {
                return { success: false, error: `Extension canvas not found: ${args.canvasId}` };
            }
            const extension = store.getExtension(deps.workspaceId, args.canvasId);
            if (!extension) {
                return { success: false, error: `Extension documents missing for canvas: ${args.canvasId}` };
            }

            const run = runCanvasCapability(extension.capabilitiesJs, args.capability, canvas.content, args.params);
            if (!run.ok) {
                return { success: false, error: run.error };
            }

            const result = store.updateCanvas(deps.workspaceId, args.canvasId, {
                content: run.state,
                expectedRevision: canvas.revision,
                editor: 'ai',
            });
            if (!result.ok) {
                return {
                    success: false,
                    error: 'The canvas state changed while the capability ran — call read_canvas and retry.',
                };
            }
            emitUpdate(result.canvas.id, result.canvas.title, result.canvas.revision);
            return { success: true, canvasId: result.canvas.id, revision: result.canvas.revision, ...truncateState(result.canvas.content) };
        },
    });

    return {
        create: create as Tool<unknown>,
        update: update as Tool<unknown>,
        read: read as Tool<unknown>,
        createOrUpdateExtension: createOrUpdateExtension as Tool<unknown>,
        invokeCapability: invokeCapability as Tool<unknown>,
    };
}
