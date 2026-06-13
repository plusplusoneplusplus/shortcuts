/**
 * Canvas LLM Tools
 *
 * Per-invocation tool factories for the chat canvas — a live artifact the AI
 * maintains in a side panel next to the conversation (ChatGPT Canvas / Claude
 * Artifacts / GitHub Copilot app canvases genre).
 *
 * Three tools (kept deliberately few to limit tool-schema context cost):
 *   - `write_canvas`     — create or update a markdown/code canvas
 *   - `read_canvas`      — read content/revision (+ manifest for extensions)
 *   - `extension_canvas` — build or run a custom interactive (extension) canvas
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

/** Create (omit canvasId) or update (with canvasId) a markdown/code canvas. */
export interface WriteCanvasArgs {
    canvasId?: string;
    title?: string;
    content?: string;
    edits?: CanvasEdit[];
    type?: CanvasType;
    language?: string;
    expectedRevision?: number;
}

export interface ReadCanvasArgs {
    canvasId: string;
}

/** Author (manifest/ui/capabilities) or run (capability + params) an extension canvas. */
export interface ExtensionCanvasArgs {
    canvasId?: string;
    title?: string;
    description?: string;
    capabilities?: CanvasCapabilityMeta[];
    capabilitiesJs?: string;
    uiHtml?: string;
    initialState?: Record<string, unknown>;
    capability?: string;
    params?: Record<string, unknown>;
}

/** Cap on the state JSON echoed back to the model after a capability call. */
const MAX_RETURNED_STATE_CHARS = 20000;

function truncateState(state: string): { state: string; stateTruncated?: boolean } {
    if (state.length <= MAX_RETURNED_STATE_CHARS) return { state };
    return { state: state.slice(0, MAX_RETURNED_STATE_CHARS), stateTruncated: true };
}

function validateExtensionAuthorInput(args: ExtensionCanvasArgs): string | null {
    if (typeof args.description !== 'string' || !args.description.trim()) {
        return 'description is required to build an extension canvas';
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
    write: Tool<unknown>;
    read: Tool<unknown>;
    extension: Tool<unknown>;
} {
    const store = deps.canvasStore ?? new CanvasStore(deps.dataDir);

    const emitUpdate = (canvasId: string, title: string, revision: number): void => {
        if (deps.processStore && deps.processId) {
            emitCanvasUpdated(deps.processStore, deps.processId, { canvasId, title, revision, editor: 'ai' });
        }
    };

    // ------------------------------------------------------------------
    // write_canvas — create or update a markdown/code canvas
    // ------------------------------------------------------------------
    const write = defineTool<WriteCanvasArgs>('write_canvas', {
        description:
            'Create or update a markdown/code canvas — a live document shown beside the chat for content '
            + 'the user will iterate on (plans, specs, docs, a code file). Markdown renders Mermaid blocks as '
            + 'diagrams. Omit canvasId to create (needs title + content; set type "code" + language for code). '
            + 'To update, pass canvasId + expectedRevision (from your last result) and either edits '
            + '(exact-match, one-per-match, preferred) or content (full rewrite). On a revision conflict the '
            + 'user edited it — read_canvas and retry. Keep chat replies short; reference the canvas, don\'t repeat it.',
        parameters: {
            type: 'object',
            properties: {
                canvasId: { type: 'string', description: 'Existing canvas to update. Omit to create.' },
                title: { type: 'string', description: 'Title (required on create; optional rename on update).' },
                content: { type: 'string', description: 'Full body. Required on create; on update use for a full rewrite.' },
                edits: {
                    type: 'array',
                    description: 'Targeted update: ordered exact-match replacements. Each oldText must occur once.',
                    items: {
                        type: 'object',
                        properties: {
                            oldText: { type: 'string' },
                            newText: { type: 'string' },
                        },
                        required: ['oldText', 'newText'],
                    },
                },
                type: { type: 'string', enum: ['markdown', 'code'], description: 'Create only. Default "markdown".' },
                language: { type: 'string', description: 'Create only, for type "code" (e.g. "typescript").' },
                expectedRevision: { type: 'number', description: 'Update only: the revision you last saw.' },
            },
            required: [],
        },
        handler: async (args) => {
            const a = args ?? ({} as WriteCanvasArgs);

            // Update path
            if (a.canvasId) {
                if (a.content === undefined && (!a.edits || a.edits.length === 0) && a.title === undefined) {
                    return { success: false, error: 'To update, provide edits, content, or title' };
                }
                try {
                    const result = store.updateCanvas(deps.workspaceId, a.canvasId, {
                        edits: a.edits,
                        content: a.content,
                        expectedRevision: a.expectedRevision,
                        title: a.title,
                        editor: 'ai',
                    });
                    if (!result.ok) {
                        if (result.reason === 'not-found') {
                            return { success: false, error: `Canvas not found: ${a.canvasId}` };
                        }
                        if (result.reason === 'revision-conflict') {
                            return {
                                success: false,
                                error: `Revision conflict — the canvas is now at revision ${result.currentRevision} `
                                    + '(the user likely edited it). Call read_canvas and re-apply your change.',
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
            }

            // Create path
            if (!a.title || typeof a.title !== 'string') {
                return { success: false, error: 'title is required to create a canvas' };
            }
            if (typeof a.content !== 'string') {
                return { success: false, error: 'content is required to create a canvas' };
            }
            if (a.type !== undefined && a.type !== 'markdown' && a.type !== 'code') {
                return { success: false, error: 'type must be "markdown" or "code"' };
            }
            try {
                const canvas = store.createCanvas({
                    workspaceId: deps.workspaceId,
                    title: a.title.trim(),
                    content: a.content,
                    type: a.type,
                    language: a.language,
                    processId: deps.processId,
                    editor: 'ai',
                });
                emitUpdate(canvas.id, canvas.title, canvas.revision);
                return { success: true, canvasId: canvas.id, title: canvas.title, type: canvas.type, ...(canvas.language ? { language: canvas.language } : {}), revision: canvas.revision, created: true };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    });

    // ------------------------------------------------------------------
    // read_canvas — read content + revision (+ manifest for extensions)
    // ------------------------------------------------------------------
    const read = defineTool<ReadCanvasArgs>('read_canvas', {
        description:
            'Read a canvas\'s content and revision (plus the manifest for extension canvases). Use before '
            + 'editing a canvas you did not just write, and after any revision conflict.',
        parameters: {
            type: 'object',
            properties: {
                canvasId: { type: 'string', description: 'Canvas ID.' },
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
                    note: 'Extension canvas: content is its JSON shared state. Prefer extension_canvas with a capability over raw edits.',
                } : {}),
            };
        },
    });

    // ------------------------------------------------------------------
    // extension_canvas — author OR run a custom interactive canvas
    // ------------------------------------------------------------------
    const extension = defineTool<ExtensionCanvasArgs>('extension_canvas', {
        description:
            'Build or run a custom interactive "extension" canvas (kanban, checklist, dashboard) backed by '
            + 'JSON shared state. BUILD: omit canvasId to create (give title) or pass canvasId to update; '
            + 'provide description, capabilities[] (declared actions), capabilitiesJs (assigns '
            + '`capabilities = { name(state, params) { return nextState } }` — pure, no imports/network, 1s budget), '
            + 'and uiHtml (self-contained HTML+JS in a sandboxed iframe using window.CanvasHost.onState/invoke/setState). '
            + 'RUN: pass canvasId + capability (+ params) to apply one action to the state; the panel re-renders live.',
        parameters: {
            type: 'object',
            properties: {
                canvasId: { type: 'string', description: 'Target canvas (required to update or run; omit to create).' },
                capability: { type: 'string', description: 'RUN mode: declared capability name to invoke.' },
                params: { type: 'object', description: 'RUN mode: parameters for the capability.' },
                title: { type: 'string', description: 'BUILD: title (required when creating).' },
                description: { type: 'string', description: 'BUILD: what this canvas does.' },
                capabilities: {
                    type: 'array',
                    description: 'BUILD: declared capabilities; each must exist in capabilitiesJs.',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: 'lowercase_snake_case' },
                            description: { type: 'string' },
                            paramsDescription: { type: 'string' },
                        },
                        required: ['name', 'description'],
                    },
                },
                capabilitiesJs: { type: 'string', description: 'BUILD: the capabilities script.' },
                uiHtml: { type: 'string', description: 'BUILD: sandboxed-iframe HTML+JS using window.CanvasHost.' },
                initialState: { type: 'object', description: 'BUILD (create only): initial JSON state. Default {}.' },
            },
            required: [],
        },
        handler: async (args) => {
            const a = args ?? ({} as ExtensionCanvasArgs);

            // RUN mode — invoke a capability
            if (a.capability) {
                if (!a.canvasId) {
                    return { success: false, error: 'canvasId is required to run a capability' };
                }
                const canvas = store.getCanvas(deps.workspaceId, a.canvasId);
                if (!canvas || canvas.type !== 'extension') {
                    return { success: false, error: `Extension canvas not found: ${a.canvasId}` };
                }
                const ext = store.getExtension(deps.workspaceId, a.canvasId);
                if (!ext) {
                    return { success: false, error: `Extension documents missing for canvas: ${a.canvasId}` };
                }
                const run = runCanvasCapability(ext.capabilitiesJs, a.capability, canvas.content, a.params);
                if (!run.ok) {
                    return { success: false, error: run.error };
                }
                const result = store.updateCanvas(deps.workspaceId, a.canvasId, {
                    content: run.state,
                    expectedRevision: canvas.revision,
                    editor: 'ai',
                });
                if (!result.ok) {
                    return { success: false, error: 'The canvas state changed while the capability ran — call read_canvas and retry.' };
                }
                emitUpdate(result.canvas.id, result.canvas.title, result.canvas.revision);
                return { success: true, canvasId: result.canvas.id, revision: result.canvas.revision, ...truncateState(result.canvas.content) };
            }

            // BUILD mode — author the extension documents
            const validationError = validateExtensionAuthorInput(a);
            if (validationError) {
                return { success: false, error: validationError };
            }
            const manifest: CanvasExtensionManifest = {
                description: a.description!.trim(),
                capabilities: a.capabilities!.map(c => ({
                    name: c.name,
                    description: c.description,
                    ...(c.paramsDescription ? { paramsDescription: c.paramsDescription } : {}),
                })),
            };
            try {
                if (a.canvasId) {
                    const updated = store.saveExtension(deps.workspaceId, a.canvasId, {
                        manifest,
                        uiHtml: a.uiHtml!,
                        capabilitiesJs: a.capabilitiesJs!,
                    }, 'ai');
                    if (!updated) {
                        return { success: false, error: `Extension canvas not found: ${a.canvasId}` };
                    }
                    emitUpdate(updated.id, updated.title, updated.revision);
                    return { success: true, canvasId: updated.id, revision: updated.revision, updated: true };
                }

                if (!a.title || !a.title.trim()) {
                    return { success: false, error: 'title is required when creating an extension canvas' };
                }
                const canvas = store.createCanvas({
                    workspaceId: deps.workspaceId,
                    title: a.title.trim(),
                    content: JSON.stringify(a.initialState ?? {}, null, 2),
                    type: 'extension',
                    processId: deps.processId,
                    editor: 'ai',
                });
                const withExtension = store.saveExtension(deps.workspaceId, canvas.id, {
                    manifest,
                    uiHtml: a.uiHtml!,
                    capabilitiesJs: a.capabilitiesJs!,
                }, 'ai');
                const record = withExtension ?? canvas;
                emitUpdate(record.id, record.title, record.revision);
                return { success: true, canvasId: record.id, title: record.title, revision: record.revision, created: true };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    });

    return {
        write: write as Tool<unknown>,
        read: read as Tool<unknown>,
        extension: extension as Tool<unknown>,
    };
}
