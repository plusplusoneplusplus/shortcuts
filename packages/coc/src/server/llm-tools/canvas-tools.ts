/**
 * Per-invocation tool factories for the chat canvas — a live artifact the AI
 * maintains in a side panel next to the conversation (ChatGPT Canvas / Claude
 * Artifacts / GitHub Copilot app canvases genre).
 *
 * Three tools (kept deliberately few to limit tool-schema context cost):
 *   - `write_canvas`     — create or update a markdown/code canvas
 *   - `read_canvas`      — read content/revision (+ manifest for extensions)
 *   - `extension_canvas` — build or run a custom interactive (extension) canvas
 *
 * An extension canvas is authored one of two ways. `uiJsx` is a React component
 * compiled server-side by esbuild into a stored `ui.js`, rendered against
 * vendored library globals (React, Recharts, PapaParse, a prebuilt Tailwind
 * sheet) that the panel loads as classic scripts. `uiHtml` is the original
 * hand-written HTML+JS path and is unchanged.
 *
 * Canvases persist via `CanvasStore` under `~/.coc/repos/<workspaceId>/canvases/`.
 * Every successful create/update emits a `canvas-updated` SSE event on the
 * process channel so the dashboard panel re-renders live.
 */

import { defineTool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import {
    CanvasStore,
    MAX_EXTENSION_UI_BYTES,
    MAX_EXTENSION_UI_JS_BYTES,
    MAX_EXTENSION_CAPABILITIES_BYTES,
} from '../canvas/canvas-store';
import type {
    CanvasEdit,
    CanvasType,
    CanvasCapabilityMeta,
    CanvasExtensionManifest,
    CanvasFileEncoding,
    CanvasFileEntry,
} from '../canvas/canvas-store';
import { CANVAS_LIBRARIES, CANVAS_LIBRARY_IDS, resolveCanvasLibraries } from '../canvas/canvas-libraries';
import type { CanvasLibraryId } from '../canvas/canvas-libraries';
import { transformCanvasJsx } from '../canvas/canvas-jsx';
import { runCanvasCapability, isValidCapabilityName } from '../canvas/canvas-capability-runner';
import type { CapabilityCompleteFn } from '../canvas/canvas-capability-runner';
import { queueCanvasCapabilityRun } from '../canvas/canvas-capability-queue';
import { createCanvasCompleteFn } from '../canvas/canvas-capability-completion';
import { normaliseExcalidrawScene } from '../canvas/excalidraw-scene';
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
    /**
     * Live gate for the canvas host APIs — async capabilities and the
     * `host.complete` they get. Absent or false means a capability declared
     * `async: true` cannot be RUN; authoring one is still allowed, so a manifest
     * survives the flag being toggled off and back on.
     */
    getCanvasHostApisEnabled?: () => boolean;
    /** Injectable `host.complete` implementation. Overridden in tests. */
    completeFactory?: (attribution: { workspaceId: string; canvasId: string; capability: string; processId?: string }) => CapabilityCompleteFn;
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

/** Author (manifest/ui/capabilities) or run (capability + params) an extension canvas. */
export interface ExtensionCanvasArgs {
    canvasId?: string;
    title?: string;
    description?: string;
    capabilities?: CanvasCapabilityMeta[];
    capabilitiesJs?: string;
    uiHtml?: string;
    /** JSX source, transformed to `ui.js` at BUILD time. Alternative to `uiHtml`. */
    uiJsx?: string;
    /** Vendored libraries `uiJsx` needs, from the fixed allowlist. */
    libraries?: string[];
    initialState?: Record<string, unknown>;
    capability?: string;
    params?: Record<string, unknown>;
    /** Data files to place in the canvas's read-only `files/` directory. */
    files?: CanvasFileInput[];
}

/** One file the AI attaches to a canvas for its UI to read back. */
export interface CanvasFileInput {
    /** Canvas-relative path, e.g. `data.csv` or `raw/jan.json`. */
    path: string;
    content: string;
    /** `base64` when `content` carries bytes; defaults to `utf-8`. */
    encoding?: CanvasFileEncoding;
}

/**
 * The library allowlist rendered for the tool description — `id (global)` for
 * each. Generated from the registry so the description cannot drift out of step
 * with what the bootstrap will actually load.
 */
const LIBRARY_HELP = CANVAS_LIBRARY_IDS
    .map(id => {
        const lib = CANVAS_LIBRARIES[id];
        return lib.global ? `${id} (window.${lib.global})` : `${id} (CSS)`;
    })
    .join(', ');

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
        if (capability.async !== undefined && typeof capability.async !== 'boolean') {
            return `Capability "${capability.name}": async must be true or false`;
        }
    }
    if (typeof args.capabilitiesJs !== 'string' || !args.capabilitiesJs.trim()) {
        return 'capabilitiesJs is required';
    }
    if (Buffer.byteLength(args.capabilitiesJs, 'utf-8') > MAX_EXTENSION_CAPABILITIES_BYTES) {
        return 'capabilitiesJs exceeds the 256 KB limit';
    }
    const hasUiHtml = typeof args.uiHtml === 'string' && args.uiHtml.trim().length > 0;
    const hasUiJsx = typeof args.uiJsx === 'string' && args.uiJsx.trim().length > 0;
    if (!hasUiHtml && !hasUiJsx) {
        return 'Provide uiHtml (vanilla HTML+JS) or uiJsx (a React component) — one is required';
    }
    if (hasUiHtml && hasUiJsx) {
        return 'Provide uiHtml or uiJsx, not both — they are two authoring paths for the same UI';
    }
    if (hasUiHtml && Buffer.byteLength(args.uiHtml!, 'utf-8') > MAX_EXTENSION_UI_BYTES) {
        return 'uiHtml exceeds the 512 KB limit';
    }
    if (hasUiJsx && Buffer.byteLength(args.uiJsx!, 'utf-8') > MAX_EXTENSION_UI_JS_BYTES) {
        return 'uiJsx exceeds the 512 KB limit';
    }
    if (!hasUiJsx && args.libraries !== undefined && (!Array.isArray(args.libraries) || args.libraries.length > 0)) {
        return 'libraries only applies to uiJsx — a uiHtml extension loads no vendored libraries';
    }
    return null;
}

/** Cap on files attached in one tool call — a bound on a single AI mistake. */
const MAX_CANVAS_FILES_PER_CALL = 20;

/**
 * Write the attached data files into the canvas's read-only `files/` directory,
 * where `CanvasHost.readFile` can reach them. All-or-nothing on validation: a
 * bad entry aborts before anything is written, so the AI never has to reason
 * about a half-applied batch.
 */
function writeCanvasFiles(
    store: CanvasStore,
    workspaceId: string,
    canvasId: string,
    files: CanvasFileInput[],
): { ok: true; files: CanvasFileEntry[] } | { ok: false; error: string } {
    if (!Array.isArray(files)) {
        return { ok: false, error: 'files must be an array of { path, content }' };
    }
    if (files.length > MAX_CANVAS_FILES_PER_CALL) {
        return { ok: false, error: `At most ${MAX_CANVAS_FILES_PER_CALL} files can be attached in one call` };
    }
    for (const file of files) {
        if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
            return { ok: false, error: 'Each file needs a path and a content string' };
        }
        if (file.encoding !== undefined && file.encoding !== 'utf-8' && file.encoding !== 'base64') {
            return { ok: false, error: `Invalid encoding for "${file.path}" — use "utf-8" or "base64"` };
        }
    }

    const written: CanvasFileEntry[] = [];
    for (const file of files) {
        const result = store.writeCanvasFile(workspaceId, canvasId, file.path, file.content, file.encoding ?? 'utf-8');
        if (!result.ok) {
            if (result.reason === 'too-large') {
                return { ok: false, error: `"${file.path}" is ${result.size} bytes, over the ${result.limit} byte limit` };
            }
            if (result.reason === 'not-found') {
                return { ok: false, error: `Canvas not found: ${canvasId}` };
            }
            return { ok: false, error: `Invalid file path: ${file.path} (relative, no "..", no leading "/")` };
        }
        written.push(result.file);
    }
    return { ok: true, files: written };
}

/**
 * Resolve the libraries a JSX extension loads. `react` is implied — the
 * transform emits `React.createElement`, so the compiled UI cannot run without
 * it, and making the AI remember to declare it would only produce blank
 * artifacts.
 */
function resolveJsxLibraries(declared: string[] | undefined): { ok: true; libraries: CanvasLibraryId[] } | { ok: false; error: string } {
    if (declared !== undefined && !Array.isArray(declared)) {
        return { ok: false, error: 'libraries must be an array of library names' };
    }
    return resolveCanvasLibraries(['react', ...(declared ?? [])]);
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

    /** Real `host.complete`: the one-shot AI invoker, bound to who asked for it. */
    const defaultCompleteFactory = (attribution: { workspaceId: string; canvasId: string; capability: string; processId?: string }): CapabilityCompleteFn =>
        createCanvasCompleteFn(deps.dataDir, attribution);

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
                    emitUpdate(result.canvas.id, result.canvas.title, result.canvas.revision);
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
                emitUpdate(canvas.id, canvas.title, canvas.revision);
                return { success: true, canvasId: canvas.id, title: canvas.title, type: canvas.type, ...(canvas.language ? { language: canvas.language } : {}), ...(canvas.type === 'excalidraw' ? { embed: `canvas://${canvas.id}` } : {}), revision: canvas.revision, created: true };
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
                ...(canvas.type === 'excalidraw' ? {
                    note: 'Excalidraw canvas: content is the scene JSON ({ elements, appState }). To change it, write_canvas with the full scene as content — targeted edits are not supported.',
                } : {}),
            };
        },
    });

    // ------------------------------------------------------------------
    // extension_canvas — author OR run a custom interactive canvas
    // ------------------------------------------------------------------
    const extension = defineTool<ExtensionCanvasArgs>('extension_canvas', {
        description:
            'Build or run a custom interactive "extension" canvas backed by '
            + 'JSON shared state. BUILD: omit canvasId to create (give title) or pass canvasId to update; '
            + 'provide description, capabilities[] (declared actions), capabilitiesJs (assigns '
            + '`capabilities = { name(state, params) { return nextState } }` — pure, no imports/network, 1s budget), '
            + 'and ONE of uiJsx or uiHtml.\n\n'
            + 'ASYNC capabilities: mark a capability `async: true` to run it with a 30s budget and a third argument, '
            + '`host`, whose only method is `await host.complete(prompt, { model? })` — a one-shot model call, max 3 per '
            + 'run. Write it as `async name(state, params, host) { … return nextState }`. There is no network access of '
            + 'any kind beyond that. Leave async off unless the capability genuinely awaits something.\n\n'
            + 'uiJsx (PREFERRED for anything with charts, tables or real interaction) — write a React component in JSX; '
            + 'the server compiles it. Declare what you need in `libraries`; they arrive as GLOBALS, so never write an '
            + 'import or a CDN <script> (module scripts and fetch are blocked in the sandboxed frame). '
            + `Available: ${LIBRARY_HELP}. react is added for you.\n`
            + 'Your code must end by assigning window.CanvasExtension = { mount(rootEl, host) { … } }. Example:\n'
            + '  const { LineChart, Line, XAxis, YAxis, Tooltip } = Recharts;\n'
            + '  function App({ state, host }) {\n'
            + '    return <div className="p-4">\n'
            + '      <h2 className="text-lg font-semibold mb-3">{state.title}</h2>\n'
            + '      <LineChart width={520} height={260} data={state.rows}>\n'
            + '        <XAxis dataKey="month" /><YAxis /><Tooltip />\n'
            + '        <Line dataKey="revenue" stroke="#3b82f6" />\n'
            + '      </LineChart>\n'
            + '      <button className="mt-3 px-3 py-1 rounded bg-blue-600 text-white"\n'
            + '        onClick={() => host.invoke(\'refresh\')}>Refresh</button>\n'
            + '    </div>;\n'
            + '  }\n'
            + '  window.CanvasExtension = {\n'
            + '    mount(rootEl, host) {\n'
            + '      const root = ReactDOM.createRoot(rootEl);\n'
            + '      host.onState(state => root.render(<App state={state} host={host} />));\n'
            + '    },\n'
            + '  };\n'
            + 'Tailwind ships a FIXED prebuilt subset (common spacing/flex/grid/text/border/shadow utilities, the standard '
            + 'palette at shades 50-900, plus hover:/focus:/md: on the common ones) — no arbitrary values like p-[13px], '
            + 'no dark: variants; use a style={{…}} prop for anything outside it.\n\n'
            + 'uiHtml — self-contained HTML+JS for simple widgets. No libraries, no JSX.\n\n'
            + 'Either way the UI talks to window.CanvasHost: onState(cb) to render, invoke(name, params) to run a '
            + 'capability, setState(state) to replace the state directly, listFiles() and readFile(path) to read the '
            + 'data files you attached. All of them return promises that reject with { code, message }, code being '
            + 'offline|timeout|revision-conflict|capability-error|file-error.\n\n'
            + 'FILES: pass `files: [{ path, content }]` to attach data the UI reads back with '
            + 'await host.readFile("data.csv") — which returns { path, size, encoding, content } (encoding is "utf-8" '
            + 'for text, "base64" otherwise). Use this instead of pasting a large dataset into initialState. Files are '
            + 'READ-ONLY to the artifact and live only in this canvas. To add data to an existing canvas, pass '
            + 'canvasId + files with no UI fields.\n\n'
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
                            async: {
                                type: 'boolean',
                                description:
                                    'Set true only if this capability needs to await something (e.g. host.complete). '
                                    + 'It then runs with a 30s budget and receives a `host` argument. Default false: '
                                    + 'a pure, synchronous 1s function with no host.',
                            },
                        },
                        required: ['name', 'description'],
                    },
                },
                capabilitiesJs: { type: 'string', description: 'BUILD: the capabilities script.' },
                uiHtml: { type: 'string', description: 'BUILD: sandboxed-iframe HTML+JS using window.CanvasHost. Mutually exclusive with uiJsx.' },
                uiJsx: {
                    type: 'string',
                    description:
                        'BUILD: JSX source, compiled server-side to ui.js. Must assign '
                        + 'window.CanvasExtension = { mount(rootEl, host) { … } }. Mutually exclusive with uiHtml.',
                },
                libraries: {
                    type: 'array',
                    items: { type: 'string', enum: [...CANVAS_LIBRARY_IDS] },
                    description:
                        'BUILD (uiJsx only): vendored libraries to load as globals. '
                        + `${CANVAS_LIBRARY_IDS.map(id => `"${id}"`).join(', ')}. react is added automatically.`,
                },
                initialState: { type: 'object', description: 'BUILD (create only): initial JSON state. Default {}.' },
                files: {
                    type: 'array',
                    description:
                        'Data files the UI reads back with CanvasHost.readFile(path). Attach them while building, '
                        + 'or pass canvasId + files alone to add data to an existing canvas. Read-only: nothing can write them back.',
                    items: {
                        type: 'object',
                        properties: {
                            path: { type: 'string', description: 'Canvas-relative path, e.g. "data.csv" or "raw/jan.json". No leading "/" and no "..".' },
                            content: { type: 'string' },
                            encoding: { type: 'string', enum: ['utf-8', 'base64'], description: 'Default "utf-8". Use "base64" for binary content.' },
                        },
                        required: ['path', 'content'],
                    },
                },
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

                // Same per-canvas queue the REST route uses. Without it an AI
                // run and a user's click on the same canvas read the same
                // revision and one of them loses the write.
                const canvasId = a.canvasId;
                const capabilityName = a.capability;
                const params = a.params;
                const outcome = await queueCanvasCapabilityRun(deps.workspaceId, canvasId, async () => {
                    const fresh = store.getCanvas(deps.workspaceId, canvasId);
                    const freshExt = store.getExtension(deps.workspaceId, canvasId);
                    if (!fresh || fresh.type !== 'extension' || !freshExt) {
                        return { kind: 'gone' } as const;
                    }
                    const isAsync = freshExt.manifest?.capabilities?.some(
                        meta => meta?.name === capabilityName && meta.async === true,
                    ) === true;
                    if (isAsync && !deps.getCanvasHostApisEnabled?.()) {
                        return { kind: 'disabled' } as const;
                    }

                    const run = await runCanvasCapability(
                        freshExt.capabilitiesJs,
                        capabilityName,
                        fresh.content,
                        params,
                        isAsync
                            ? {
                                async: true,
                                complete: (deps.completeFactory ?? defaultCompleteFactory)({
                                    workspaceId: deps.workspaceId,
                                    canvasId,
                                    capability: capabilityName,
                                    ...(fresh.processId ? { processId: fresh.processId } : {}),
                                }),
                            }
                            : undefined,
                    );
                    if (!run.ok) {
                        return { kind: 'run-error', error: run.error } as const;
                    }
                    const result = store.updateCanvas(deps.workspaceId, canvasId, {
                        content: run.state,
                        expectedRevision: fresh.revision,
                        editor: 'ai',
                    });
                    if (!result.ok) {
                        return { kind: 'conflict' } as const;
                    }
                    return { kind: 'ok', canvas: result.canvas } as const;
                });

                if (outcome.kind === 'gone') {
                    return { success: false, error: `Extension canvas not found: ${canvasId}` };
                }
                if (outcome.kind === 'disabled') {
                    return { success: false, error: `Capability "${capabilityName}" is declared async, and async capabilities are disabled on this server` };
                }
                if (outcome.kind === 'run-error') {
                    return { success: false, error: outcome.error };
                }
                if (outcome.kind === 'conflict') {
                    return { success: false, error: 'The canvas state changed while the capability ran — call read_canvas and retry.' };
                }
                emitUpdate(outcome.canvas.id, outcome.canvas.title, outcome.canvas.revision);
                return { success: true, canvasId: outcome.canvas.id, revision: outcome.canvas.revision, ...truncateState(outcome.canvas.content) };
            }

            // FILES mode — attach data to an existing canvas without re-authoring
            // it. Recognized by `files` on a canvasId with no UI/capabilities
            // input, so adding a dataset does not force the AI to resend the
            // whole extension.
            const hasFiles = Array.isArray(a.files) && a.files.length > 0;
            const authoringUi = typeof a.uiHtml === 'string' || typeof a.uiJsx === 'string' || a.capabilitiesJs !== undefined;
            if (hasFiles && a.canvasId && !authoringUi) {
                if (!store.getCanvas(deps.workspaceId, a.canvasId)) {
                    return { success: false, error: `Canvas not found: ${a.canvasId}` };
                }
                const written = writeCanvasFiles(store, deps.workspaceId, a.canvasId, a.files!);
                if (!written.ok) {
                    return { success: false, error: written.error };
                }
                return { success: true, canvasId: a.canvasId, files: written.files };
            }

            // BUILD mode — author the extension documents
            const validationError = validateExtensionAuthorInput(a);
            if (validationError) {
                return { success: false, error: validationError };
            }
            // JSX path: resolve the library set, then transform. Both run BEFORE
            // anything is written, so a bad library name or a syntax error comes
            // back as a tool error rather than a saved canvas that renders blank.
            const authoringJsx = typeof a.uiJsx === 'string' && a.uiJsx.trim().length > 0;
            let uiJs: string | undefined;
            let libraries: CanvasLibraryId[] | undefined;
            if (authoringJsx) {
                const resolved = resolveJsxLibraries(a.libraries);
                if (!resolved.ok) {
                    return { success: false, error: resolved.error };
                }
                libraries = resolved.libraries;

                const transformed = await transformCanvasJsx(a.uiJsx!);
                if (!transformed.ok) {
                    return { success: false, error: `uiJsx failed to compile:\n${transformed.error}` };
                }
                if (Buffer.byteLength(transformed.code, 'utf-8') > MAX_EXTENSION_UI_JS_BYTES) {
                    return { success: false, error: 'The compiled uiJsx exceeds the 512 KB limit' };
                }
                uiJs = transformed.code;
            }

            const manifest: CanvasExtensionManifest = {
                description: a.description!.trim(),
                capabilities: a.capabilities!.map(c => ({
                    name: c.name,
                    description: c.description,
                    ...(c.paramsDescription ? { paramsDescription: c.paramsDescription } : {}),
                    ...(c.async === true ? { async: true } : {}),
                })),
                ...(libraries ? { libraries } : {}),
            };
            const uiDocuments = authoringJsx
                ? { uiHtml: '', uiJs, uiJsx: a.uiJsx! }
                : { uiHtml: a.uiHtml! };
            try {
                if (a.canvasId) {
                    // Files first: a rejected path or an oversized file comes back
                    // as a tool error instead of landing an extension whose UI
                    // then reads data that was never written.
                    let updatedFiles: CanvasFileEntry[] | undefined;
                    if (hasFiles) {
                        const written = writeCanvasFiles(store, deps.workspaceId, a.canvasId, a.files!);
                        if (!written.ok) {
                            return { success: false, error: written.error };
                        }
                        updatedFiles = written.files;
                    }
                    const updated = store.saveExtension(deps.workspaceId, a.canvasId, {
                        manifest,
                        ...uiDocuments,
                        capabilitiesJs: a.capabilitiesJs!,
                    }, 'ai');
                    if (!updated) {
                        return { success: false, error: `Extension canvas not found: ${a.canvasId}` };
                    }
                    emitUpdate(updated.id, updated.title, updated.revision);
                    return {
                        success: true,
                        canvasId: updated.id,
                        revision: updated.revision,
                        updated: true,
                        ...(updatedFiles ? { files: updatedFiles } : {}),
                    };
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
                let createdFiles: CanvasFileEntry[] | undefined;
                if (hasFiles) {
                    const written = writeCanvasFiles(store, deps.workspaceId, canvas.id, a.files!);
                    if (!written.ok) {
                        return { success: false, error: written.error };
                    }
                    createdFiles = written.files;
                }
                const withExtension = store.saveExtension(deps.workspaceId, canvas.id, {
                    manifest,
                    ...uiDocuments,
                    capabilitiesJs: a.capabilitiesJs!,
                }, 'ai');
                const record = withExtension ?? canvas;
                emitUpdate(record.id, record.title, record.revision);
                return {
                    success: true,
                    canvasId: record.id,
                    title: record.title,
                    revision: record.revision,
                    created: true,
                    ...(createdFiles ? { files: createdFiles } : {}),
                };
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
