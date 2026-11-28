/** Per-invocation tools for durable documents and owner-safe canvas metadata. */
import { defineTool, type Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { CanvasStore, type CanvasRecord, type CanvasEdit, type CanvasType } from '../canvas/canvas-store';
import { normaliseExcalidrawScene } from '../canvas/excalidraw-scene';
import { emitCanvasUpdated } from '../streaming/sse-handler';
import { listGeneratedPackages } from '../canvas-extensions/generated-packages';
import { readCanvasExtensionInstance } from '../canvas-extensions/instance-records';

export interface CanvasToolsDeps {
    dataDir: string;
    workspaceId: string;
    processId?: string;
    processStore?: ProcessStore;
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
    purpose?: string;
    expectedRevision?: number;
}

export interface ReadCanvasArgs {
    canvasId: string;
}

export function createCanvasTools(deps: CanvasToolsDeps): {
    write: Tool<unknown>;
    read: Tool<unknown>;
} {
    const store = deps.canvasStore ?? new CanvasStore(deps.dataDir);

    const emitUpdate = (canvas: CanvasRecord): void => {
        if (deps.processStore && deps.processId) {
            emitCanvasUpdated(deps.processStore, deps.processId, { canvasId: canvas.id, title: canvas.title, revision: canvas.revision, editor: 'ai', canvasType: canvas.type });
        }
    };

    // ------------------------------------------------------------------
    // write_canvas — create or update a markdown/code canvas
    // ------------------------------------------------------------------
    const write = defineTool<WriteCanvasArgs>('write_canvas', {
        description:
            'Create or update a canvas — a live document beside the chat the user iterates on. '
            + 'Markdown renders Mermaid blocks as diagrams and ```svg fenced blocks as inline visual images. '
            + 'Omit canvasId to create (needs title + content; set type "code" + language for code). '
            + 'Use type "code" + language "svg" to create a dedicated SVG canvas that renders as a visual '
            + 'image with Source/Rendered toggle, zoom, pan, and export. '
            + 'For an Excalidraw diagram, set type "excalidraw" and pass '
            + 'the scene JSON ({ elements, appState }) as content — the result carries an `embed` reference '
            + '(canvas://<id>); put that marker in your chat reply to render the diagram inline (it also shows in '
            + 'the panel). Updates must pass the full scene as content (edits are rejected for excalidraw). To update, pass '
            + 'canvasId + expectedRevision and either edits (exact-match, one per match) or content (full rewrite). '
            + 'On a revision conflict the user edited it — read_canvas and retry. Keep chat replies short; '
            + 'reference the canvas, don\'t repeat it.',
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
                type: { type: 'string', enum: ['markdown', 'code', 'excalidraw'], description: 'Create only. Default "markdown". Use "excalidraw" for a diagram whose content is the scene JSON.' },
                language: { type: 'string', description: 'Create only, for type "code" (e.g. "typescript"). Use "svg" to create an SVG canvas that renders as a visual image with zoom/pan/export chrome.' },
                purpose: {
                    type: 'string',
                    description: 'Optional semantic role for this canvas, e.g. "plan", "goal", "notes". Helps the system understand the intended use of the canvas.',
                },
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

                // Excalidraw canvases store a JSON scene — text edits are not
                // meaningful, so reject them and normalize full-content rewrites.
                let content = a.content;
                const existing = store.getCanvas(deps.workspaceId, a.canvasId);
                if (!existing) {
                    return { success: false, error: `Canvas not found: ${a.canvasId}` };
                }
                if (existing.type === 'copilot-extension') return { success: false, error: 'Use extension_canvas or manage_canvas for runtime records' };
                if (existing.type === 'excalidraw') {
                    if (a.edits && a.edits.length > 0) {
                        return {
                            success: false,
                            error: 'Excalidraw canvases do not support targeted edits — pass the full scene JSON as content (a full rewrite).',
                        };
                    }
                    if (a.content !== undefined) {
                        const normalised = normaliseExcalidrawScene(a.content);
                        if (!normalised.ok) {
                            return { success: false, error: normalised.error };
                        }
                        content = normalised.content;
                    }
                }

                try {
                    const result = store.updateCanvas(deps.workspaceId, a.canvasId, {
                        edits: a.edits,
                        content,
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
                    emitUpdate(result.canvas);
                    return {
                        success: true,
                        canvasId: result.canvas.id,
                        revision: result.canvas.revision,
                        ...(result.canvas.type === 'excalidraw' ? { embed: `canvas://${result.canvas.id}` } : {}),
                    };
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
            if (a.type !== undefined && a.type !== 'markdown' && a.type !== 'code' && a.type !== 'excalidraw') {
                return { success: false, error: 'type must be "markdown", "code", or "excalidraw"' };
            }

            // Excalidraw canvases persist a validated, normalized scene JSON.
            let createContent = a.content;
            if (a.type === 'excalidraw') {
                const normalised = normaliseExcalidrawScene(a.content);
                if (!normalised.ok) {
                    return { success: false, error: normalised.error };
                }
                createContent = normalised.content;
            }

            try {
                const canvas = store.createCanvas({
                    workspaceId: deps.workspaceId,
                    title: a.title.trim(),
                    content: createContent,
                    type: a.type,
                    language: a.language,
                    purpose: a.purpose,
                    processId: deps.processId,
                    editor: 'ai',
                });
                emitUpdate(canvas);
                return { success: true, canvasId: canvas.id, title: canvas.title, type: canvas.type, ...(canvas.language ? { language: canvas.language } : {}), ...(canvas.type === 'excalidraw' ? { embed: `canvas://${canvas.id}` } : {}), revision: canvas.revision, created: true };
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
    });

    // ------------------------------------------------------------------
    // read_canvas — read document content or generated publication metadata
    // ------------------------------------------------------------------
    const read = defineTool<ReadCanvasArgs>('read_canvas', {
        description:
            'Read canvas content/revision or owner-scoped generated source and asset paths. Use before '
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
            if (canvas.type === 'copilot-extension') {
                if (!deps.processId || canvas.processId !== deps.processId) return { success: false, error: 'Canvas owner unavailable' };
                const instance = readCanvasExtensionInstance(canvas);
                const item = listGeneratedPackages(deps.dataDir, { workspaceId: deps.workspaceId, processId: deps.processId })
                    .find(item => item.extension.extensionKey === instance.extensionKey);
                return { success: true, canvasId: canvas.id, revision: canvas.revision, type: canvas.type,
                    instanceId: instance.instanceId, extensionKey: instance.extensionKey, declaredCanvasId: instance.canvasId,
                    ...(item ? { sourcePath: item.sourcePath, assets: item.assetPaths, publicationStatus: item.status } : {}) };
            }
            return {
                success: true,
                canvasId: canvas.id,
                title: canvas.title,
                type: canvas.type,
                ...(canvas.language ? { language: canvas.language } : {}),
                revision: canvas.revision,
                content: canvas.content,
                ...(canvas.type === 'excalidraw' ? {
                    note: 'Excalidraw canvas: content is the scene JSON ({ elements, appState }). To change it, write_canvas with the full scene as content — targeted edits are not supported.',
                } : {}),
            };
        },
    });

    return { write: write as Tool<unknown>, read: read as Tool<unknown> };
}
