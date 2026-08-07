import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { createCanvasTools } from '../../../src/server/llm-tools/canvas-tools';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { CANVAS_LIBRARY_IDS } from '../../../src/server/canvas/canvas-libraries';

const WS = 'tool-workspace';
const PROCESS_ID = 'proc-42';

describe('canvas LLM tools', () => {
    let dataDir: string;
    let store: CanvasStore;
    let emitProcessEvent: ReturnType<typeof vi.fn>;
    let processStore: ProcessStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-canvas-tools-'));
        store = new CanvasStore(dataDir);
        emitProcessEvent = vi.fn();
        processStore = { emitProcessEvent } as unknown as ProcessStore;
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function buildTools() {
        return createCanvasTools({
            dataDir,
            workspaceId: WS,
            processId: PROCESS_ID,
            processStore,
            canvasStore: store,
        });
    }

    it('registers three consolidated canvas tool names', () => {
        const { write, read, extension } = buildTools();
        expect(write.name).toBe('write_canvas');
        expect(read.name).toBe('read_canvas');
        expect(extension.name).toBe('extension_canvas');
    });

    describe('write_canvas — create', () => {
        it('creates a canvas linked to the process and emits an SSE event', async () => {
            const { write } = buildTools();
            const result = await write.handler({ title: 'Spec', content: '# Spec' }) as any;

            expect(result.success).toBe(true);
            expect(result.created).toBe(true);
            expect(result.revision).toBe(1);

            const persisted = store.getCanvas(WS, result.canvasId);
            expect(persisted?.content).toBe('# Spec');
            expect(persisted?.processId).toBe(PROCESS_ID);

            expect(emitProcessEvent).toHaveBeenCalledWith(PROCESS_ID, expect.objectContaining({
                type: 'canvas-updated',
                canvasUpdate: expect.objectContaining({ canvasId: result.canvasId, revision: 1, editor: 'ai' }),
            }));
        });

        it('rejects create without title or content', async () => {
            const { write } = buildTools();
            expect(((await write.handler({ content: 'x' } as any)) as any).success).toBe(false);
            expect(((await write.handler({ title: 't' } as any)) as any).success).toBe(false);
        });

        it('creates a code canvas with a language', async () => {
            const { write } = buildTools();
            const result = await write.handler({
                title: 'Parser',
                content: 'def parse(): pass',
                type: 'code',
                language: 'python',
            }) as any;

            expect(result.success).toBe(true);
            expect(result.type).toBe('code');
            expect(result.language).toBe('python');
            expect(store.getCanvas(WS, result.canvasId)?.language).toBe('python');
        });

        it('creates an SVG code canvas and persists it with language "svg" (AC-05)', async () => {
            const { write } = buildTools();
            const svgContent = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="green"/></svg>';
            const result = await write.handler({
                title: 'Circle',
                content: svgContent,
                type: 'code',
                language: 'svg',
            }) as any;

            expect(result.success).toBe(true);
            expect(result.type).toBe('code');
            expect(result.language).toBe('svg');

            const persisted = store.getCanvas(WS, result.canvasId);
            expect(persisted?.type).toBe('code');
            expect(persisted?.language).toBe('svg');
            expect(persisted?.content).toBe(svgContent);
        });

        it('rejects an unknown canvas type', async () => {
            const { write } = buildTools();
            const result = await write.handler({ title: 'X', content: 'x', type: 'webview' } as any) as any;
            expect(result.success).toBe(false);
            expect(result.error).toContain('type');
        });

        it('persists a declared purpose on the canvas descriptor', async () => {
            const { write } = buildTools();
            const result = await write.handler({ title: 'Plan', content: '# Plan', purpose: 'plan' }) as any;

            expect(result.success).toBe(true);
            expect(store.getCanvas(WS, result.canvasId)?.purpose).toBe('plan');
        });
    });

    describe('write_canvas — update', () => {
        it('applies targeted edits with the expected revision and emits an SSE event', async () => {
            const { write } = buildTools();
            const created = await write.handler({ title: 'Doc', content: 'alpha beta' }) as any;
            emitProcessEvent.mockClear();

            const result = await write.handler({
                canvasId: created.canvasId,
                edits: [{ oldText: 'beta', newText: 'gamma' }],
                expectedRevision: 1,
            }) as any;

            expect(result.success).toBe(true);
            expect(result.revision).toBe(2);
            expect(store.getCanvas(WS, created.canvasId)?.content).toBe('alpha gamma');
            expect(emitProcessEvent).toHaveBeenCalledTimes(1);
        });

        it('reports a revision conflict and tells the model to re-read', async () => {
            const { write } = buildTools();
            const created = await write.handler({ title: 'Doc', content: 'v1' }) as any;
            // Simulate a user edit bumping the revision
            store.updateCanvas(WS, created.canvasId, { content: 'v2 (user)', editor: 'user' });
            emitProcessEvent.mockClear();

            const result = await write.handler({
                canvasId: created.canvasId,
                content: 'v2 (ai)',
                expectedRevision: 1,
            }) as any;

            expect(result.success).toBe(false);
            expect(result.currentRevision).toBe(2);
            expect(result.error).toContain('read_canvas');
            expect(store.getCanvas(WS, created.canvasId)?.content).toBe('v2 (user)');
            expect(emitProcessEvent).not.toHaveBeenCalled();
        });

        it('returns an error updating an unknown canvas', async () => {
            const { write } = buildTools();
            const result = await write.handler({ canvasId: 'missing-000000', content: 'x' }) as any;
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });

        it('rejects an update with no edits, content, or title', async () => {
            const { write } = buildTools();
            const created = await write.handler({ title: 'Doc', content: 'v1' }) as any;
            const result = await write.handler({ canvasId: created.canvasId } as any) as any;
            expect(result.success).toBe(false);
        });
    });

    describe('write_canvas — excalidraw', () => {
        const SKELETON_SCENE = JSON.stringify({
            type: 'excalidraw',
            elements: [{ id: 'box1', type: 'rectangle', x: 0, y: 0, width: 120, height: 60 }],
            appState: { viewBackgroundColor: '#ffffff' },
        });

        it('creates an excalidraw canvas and persists a normalized complete scene', async () => {
            const { write, read } = buildTools();
            const created = await write.handler({ title: 'Arch', content: SKELETON_SCENE, type: 'excalidraw' }) as any;

            expect(created.success).toBe(true);
            expect(created.type).toBe('excalidraw');
            expect(store.getCanvas(WS, created.canvasId)?.type).toBe('excalidraw');

            const result = await read.handler({ canvasId: created.canvasId }) as any;
            expect(result.success).toBe(true);
            const scene = JSON.parse(result.content);
            expect(Array.isArray(scene.elements)).toBe(true);
            expect(typeof scene.appState).toBe('object');
            // Skeleton element completed with Excalidraw bookkeeping fields.
            const el = scene.elements[0];
            expect(el.id).toBe('box1');
            expect(el.isDeleted).toBe(false);
            expect(el.groupIds).toEqual([]);
            expect(typeof el.versionNonce).toBe('number');
            expect(typeof el.seed).toBe('number');
            // read_canvas flags excalidraw canvases so the model uses full rewrites.
            expect(result.note).toMatch(/scene JSON/i);
        });

        it('rejects targeted edits on an excalidraw canvas with a clear error', async () => {
            const { write } = buildTools();
            const created = await write.handler({ title: 'Arch', content: SKELETON_SCENE, type: 'excalidraw' }) as any;

            const result = await write.handler({
                canvasId: created.canvasId,
                edits: [{ oldText: 'rectangle', newText: 'ellipse' }],
                expectedRevision: 1,
            }) as any;

            expect(result.success).toBe(false);
            expect(result.error).toMatch(/excalidraw/i);
            expect(result.error).toMatch(/full scene|content|rewrite/i);
            // Unchanged on disk.
            expect(store.getCanvas(WS, created.canvasId)?.revision).toBe(1);
        });

        it('normalizes a full-scene content rewrite on update', async () => {
            const { write, read } = buildTools();
            const created = await write.handler({ title: 'Arch', content: SKELETON_SCENE, type: 'excalidraw' }) as any;

            const next = JSON.stringify({
                elements: [{ id: 'circle1', type: 'ellipse', x: 10, y: 10, width: 40, height: 40 }],
                appState: {},
            });
            const updated = await write.handler({
                canvasId: created.canvasId,
                content: next,
                expectedRevision: 1,
            }) as any;

            expect(updated.success).toBe(true);
            expect(updated.revision).toBe(2);
            const scene = JSON.parse(store.getCanvas(WS, created.canvasId)!.content);
            expect(scene.elements[0].id).toBe('circle1');
            expect(scene.elements[0].isDeleted).toBe(false);
        });

        it('returns a canvas:// embed marker on create and update', async () => {
            const { write } = buildTools();
            const created = await write.handler({ title: 'Arch', content: SKELETON_SCENE, type: 'excalidraw' }) as any;
            expect(created.embed).toBe(`canvas://${created.canvasId}`);

            const updated = await write.handler({
                canvasId: created.canvasId,
                content: JSON.stringify({ elements: [], appState: {} }),
                expectedRevision: 1,
            }) as any;
            expect(updated.success).toBe(true);
            expect(updated.embed).toBe(`canvas://${created.canvasId}`);
        });

        it('does not return an embed marker for non-excalidraw canvases', async () => {
            const { write } = buildTools();
            const md = await write.handler({ title: 'Doc', content: '# hi' }) as any;
            expect(md.embed).toBeUndefined();
        });

        it('rejects an invalid scene on create', async () => {
            const { write } = buildTools();
            const badJson = await write.handler({ title: 'Bad', content: '{ not json', type: 'excalidraw' }) as any;
            expect(badJson.success).toBe(false);

            const notArray = await write.handler({
                title: 'Bad2',
                content: JSON.stringify({ elements: 'nope', appState: {} }),
                type: 'excalidraw',
            }) as any;
            expect(notArray.success).toBe(false);
            expect(notArray.error).toMatch(/elements/i);
        });
    });

    describe('read_canvas', () => {
        it('returns content and revision', async () => {
            const { write, read } = buildTools();
            const created = await write.handler({ title: 'Doc', content: 'hello' }) as any;

            const result = await read.handler({ canvasId: created.canvasId }) as any;
            expect(result).toMatchObject({
                success: true,
                canvasId: created.canvasId,
                title: 'Doc',
                revision: 1,
                content: 'hello',
            });
        });

        it('returns an error for an unknown canvas', async () => {
            const { read } = buildTools();
            const result = await read.handler({ canvasId: 'missing-000000' }) as any;
            expect(result.success).toBe(false);
        });
    });

    describe('extension_canvas', () => {
        const BUILD_ARGS = {
            title: 'Kanban',
            description: 'A simple board',
            capabilities: [{ name: 'add_card', description: 'Add a card' }],
            capabilitiesJs: 'capabilities = { add_card: function (s, p) { var c = (s.cards||[]).slice(); c.push({ id: p.id, title: p.title }); return { cards: c }; } };',
            uiHtml: '<div id="board"></div>',
            initialState: { cards: [] },
        };

        it('builds an extension canvas with documents and links it to the process', async () => {
            const { extension } = buildTools();
            const result = await extension.handler(BUILD_ARGS as any) as any;

            expect(result.success).toBe(true);
            expect(result.created).toBe(true);

            const canvas = store.getCanvas(WS, result.canvasId);
            expect(canvas?.type).toBe('extension');
            expect(canvas?.processId).toBe(PROCESS_ID);
            const ext = store.getExtension(WS, result.canvasId);
            expect(ext?.manifest.capabilities[0].name).toBe('add_card');
            expect(emitProcessEvent).toHaveBeenCalled();
        });

        it('updates extension documents without resetting state', async () => {
            const { extension } = buildTools();
            const created = await extension.handler(BUILD_ARGS as any) as any;
            await extension.handler({ canvasId: created.canvasId, capability: 'add_card', params: { id: 'c1', title: 'A' } } as any);

            const updated = await extension.handler({
                canvasId: created.canvasId,
                description: 'Updated board',
                capabilities: [{ name: 'add_card', description: 'Add a card' }, { name: 'clear', description: 'Clear' }],
                capabilitiesJs: 'capabilities = { add_card: function (s) { return s; }, clear: function () { return { cards: [] }; } };',
                uiHtml: '<div id="board2"></div>',
            } as any) as any;

            expect(updated.success).toBe(true);
            expect(updated.updated).toBe(true);
            // State preserved across the extension-document update
            expect(JSON.parse(store.getCanvas(WS, created.canvasId)!.content).cards).toHaveLength(1);
            expect(store.getExtension(WS, created.canvasId)?.uiHtml).toBe('<div id="board2"></div>');
        });

        // --- async capability declaration ----------------------------------

        it('persists an async: true declaration into the manifest', async () => {
            const { extension } = buildTools();
            const result = await extension.handler({
                ...BUILD_ARGS,
                capabilities: [
                    { name: 'add_card', description: 'Add a card' },
                    { name: 'summarize', description: 'Ask the model', async: true },
                ],
                capabilitiesJs: 'capabilities = { add_card: function (s) { return s; }, summarize: async function (s) { return s; } };',
            } as any) as any;

            expect(result.success).toBe(true);
            const capabilities = store.getExtension(WS, result.canvasId)!.manifest.capabilities;
            expect(capabilities.find(c => c.name === 'add_card')?.async).toBeUndefined();
            expect(capabilities.find(c => c.name === 'summarize')?.async).toBe(true);
        });

        it('omits async from the manifest when declared false', async () => {
            const { extension } = buildTools();
            const result = await extension.handler({
                ...BUILD_ARGS,
                capabilities: [{ name: 'add_card', description: 'Add a card', async: false }],
            } as any) as any;
            expect(result.success).toBe(true);
            expect(store.getExtension(WS, result.canvasId)!.manifest.capabilities[0].async).toBeUndefined();
        });

        it('rejects a non-boolean async declaration', async () => {
            const { extension } = buildTools();
            const result = await extension.handler({
                ...BUILD_ARGS,
                capabilities: [{ name: 'add_card', description: 'Add a card', async: 'yes' }],
            } as any) as any;
            expect(result.success).toBe(false);
            expect(result.error).toContain('async must be true or false');
        });

        it('declares async in the tool schema so the model can set it', () => {
            const { extension } = buildTools();
            const items = (extension.parameters as any).properties.capabilities.items;
            expect(items.properties.async.type).toBe('boolean');
            expect(items.required).not.toContain('async');
        });

        it('refuses to RUN an async capability when the host APIs flag is off', async () => {
            const { extension } = createCanvasTools({
                dataDir,
                workspaceId: WS,
                processId: PROCESS_ID,
                processStore,
                canvasStore: store,
                getCanvasHostApisEnabled: () => false,
            });
            const created = await extension.handler({
                ...BUILD_ARGS,
                capabilities: [{ name: 'slow', description: 'slow', async: true }],
                capabilitiesJs: 'capabilities = { slow: async function (s) { return { ran: true }; } };',
            } as any) as any;

            const run = await extension.handler({ canvasId: created.canvasId, capability: 'slow' } as any) as any;
            expect(run.success).toBe(false);
            expect(run.error).toContain('async capabilities are disabled');
            // Nothing ran, so the state is untouched.
            expect(JSON.parse(store.getCanvas(WS, created.canvasId)!.content).ran).toBeUndefined();
        });

        it('runs an async capability, with host.complete, when the flag is on', async () => {
            const complete = vi.fn(async () => ({ ok: true as const, text: 'a summary' }));
            const completeFactory = vi.fn(() => complete);
            const { extension } = createCanvasTools({
                dataDir,
                workspaceId: WS,
                processId: PROCESS_ID,
                processStore,
                canvasStore: store,
                getCanvasHostApisEnabled: () => true,
                completeFactory,
            });
            const created = await extension.handler({
                ...BUILD_ARGS,
                capabilities: [{ name: 'summarize', description: 'summarize', async: true }],
                capabilitiesJs: `capabilities = { summarize: async function (s, p, host) { return { summary: await host.complete('sum it up') }; } };`,
            } as any) as any;

            const run = await extension.handler({ canvasId: created.canvasId, capability: 'summarize' } as any) as any;
            expect(run.success).toBe(true);
            expect(JSON.parse(store.getCanvas(WS, created.canvasId)!.content).summary).toBe('a summary');
            expect(completeFactory).toHaveBeenCalledWith({
                workspaceId: WS,
                canvasId: created.canvasId,
                capability: 'summarize',
                processId: PROCESS_ID,
            });
        });

        it('rejects malformed build input', async () => {
            const { extension } = buildTools();
            const noCapName = await extension.handler({ ...BUILD_ARGS, capabilities: [{ name: 'Bad Name', description: 'x' }] } as any) as any;
            expect(noCapName.success).toBe(false);

            const noUi = await extension.handler({ ...BUILD_ARGS, uiHtml: '' } as any) as any;
            expect(noUi.success).toBe(false);
        });

        // --- JSX authoring -------------------------------------------------

        it('tells the model that JSX authoring exists, with the real library list', () => {
            const { extension } = buildTools();
            const description = extension.description ?? '';

            expect(description).toContain('uiJsx');
            expect(description).toContain('window.CanvasExtension');
            expect(description).toContain('mount(rootEl, host)');
            // The list is generated from the registry, so it cannot drift from
            // what the bootstrap will actually load.
            for (const id of CANVAS_LIBRARY_IDS) {
                expect(description).toContain(id);
            }
            expect(description).toContain('window.Recharts');
            // The two footguns worth spending description budget on.
            expect(description).toContain('never write an import');
            expect(description).toContain('FIXED prebuilt subset');

            const schema = extension.parameters as { properties: Record<string, { items?: { enum?: string[] } }> };
            expect(schema.properties.libraries.items?.enum).toEqual([...CANVAS_LIBRARY_IDS]);
        });

        const JSX_BUILD_ARGS = {
            title: 'Sales',
            description: 'A sales chart',
            capabilities: [{ name: 'refresh', description: 'Refresh the data' }],
            capabilitiesJs: 'capabilities = { refresh: function (s) { return s; } };',
            uiJsx: [
                'function App({ state }) {',
                '  return <div className="p-4"><h1>{state.title}</h1></div>;',
                '}',
                'window.CanvasExtension = {',
                '  mount(rootEl, host) {',
                '    const root = ReactDOM.createRoot(rootEl);',
                '    host.onState(state => root.render(<App state={state} />));',
                '  },',
                '};',
            ].join('\n'),
            libraries: ['recharts', 'tailwind'],
            initialState: { title: 'Q3' },
        };

        it('compiles uiJsx to ui.js, keeps the source, and records the resolved libraries', async () => {
            const { extension } = buildTools();
            const result = await extension.handler(JSX_BUILD_ARGS as any) as any;
            expect(result.success).toBe(true);

            const ext = store.getExtension(WS, result.canvasId)!;
            // Transformed with the CLASSIC runtime: no module import survives,
            // because the iframe resolves nothing — React is a global there.
            expect(ext.uiJs).toContain('React.createElement');
            expect(ext.uiJs).not.toContain('<div');
            expect(ext.uiJs).not.toContain('jsx-runtime');
            // The JSX source is kept verbatim so version history shows what the
            // AI actually wrote.
            expect(ext.uiJsx).toBe(JSX_BUILD_ARGS.uiJsx);
            // No ui.html for a JSX extension.
            expect(ext.uiHtml).toBe('');
            // `react` is implied and ordered ahead of recharts; the stylesheet
            // comes first so nothing paints unstyled.
            expect(ext.manifest.libraries).toEqual(['tailwind', 'react', 'recharts']);
        });

        it('returns a tool error with a line number for a JSX syntax error and saves nothing', async () => {
            const { extension } = buildTools();
            const result = await extension.handler({
                ...JSX_BUILD_ARGS,
                uiJsx: 'window.CanvasExtension = { mount() { return <div>unclosed; } };',
            } as any) as any;

            expect(result.success).toBe(false);
            expect(result.error).toContain('uiJsx failed to compile');
            expect(result.error).toMatch(/line \d+/);
            // Nothing was created — a blank saved canvas is exactly the failure
            // mode this guards.
            expect(store.listCanvases(WS)).toHaveLength(0);
        });

        it('does not overwrite an existing canvas when the JSX fails to compile', async () => {
            const { extension } = buildTools();
            const created = await extension.handler(JSX_BUILD_ARGS as any) as any;
            const before = store.getExtension(WS, created.canvasId)!;

            const failed = await extension.handler({
                ...JSX_BUILD_ARGS,
                canvasId: created.canvasId,
                uiJsx: 'window.CanvasExtension = { mount() { return <div>; } };',
            } as any) as any;

            expect(failed.success).toBe(false);
            expect(store.getExtension(WS, created.canvasId)).toEqual(before);
            // Revision untouched: create (1) + saveExtension (2), no third bump.
            expect(store.getCanvas(WS, created.canvasId)!.revision).toBe(2);
        });

        it('rejects a library outside the allowlist', async () => {
            const { extension } = buildTools();
            const result = await extension.handler({ ...JSX_BUILD_ARGS, libraries: ['d3'] } as any) as any;

            expect(result.success).toBe(false);
            expect(result.error).toContain('Unknown canvas library "d3"');
            expect(result.error).toContain('recharts');
            expect(store.listCanvases(WS)).toHaveLength(0);
        });

        it('rejects uiHtml and uiJsx together, and libraries on a uiHtml build', async () => {
            const { extension } = buildTools();
            const both = await extension.handler({ ...JSX_BUILD_ARGS, uiHtml: '<div></div>' } as any) as any;
            expect(both.success).toBe(false);
            expect(both.error).toContain('not both');

            const htmlWithLibs = await extension.handler({ ...BUILD_ARGS, libraries: ['recharts'] } as any) as any;
            expect(htmlWithLibs.success).toBe(false);
            expect(htmlWithLibs.error).toContain('libraries only applies to uiJsx');
        });

        it('enforces the 512 KB cap on uiJsx', async () => {
            const { extension } = buildTools();
            const huge = `// ${'x'.repeat(520 * 1024)}\nwindow.CanvasExtension = { mount() {} };`;
            const result = await extension.handler({ ...JSX_BUILD_ARGS, uiJsx: huge } as any) as any;

            expect(result.success).toBe(false);
            expect(result.error).toContain('512 KB');
            expect(store.listCanvases(WS)).toHaveLength(0);
        });

        it('switching an existing canvas from uiHtml to uiJsx keeps its state', async () => {
            const { extension } = buildTools();
            const created = await extension.handler(BUILD_ARGS as any) as any;
            await extension.handler({ canvasId: created.canvasId, capability: 'add_card', params: { id: 'c1', title: 'A' } } as any);

            const updated = await extension.handler({
                ...JSX_BUILD_ARGS,
                canvasId: created.canvasId,
                title: undefined,
            } as any) as any;

            expect(updated.success).toBe(true);
            expect(JSON.parse(store.getCanvas(WS, created.canvasId)!.content).cards).toHaveLength(1);
            const ext = store.getExtension(WS, created.canvasId)!;
            expect(ext.uiJs).toContain('React.createElement');
            expect(ext.uiHtml).toBe('');
        });

        it('runs a capability and returns the new state', async () => {
            const { extension } = buildTools();
            const created = await extension.handler(BUILD_ARGS as any) as any;
            emitProcessEvent.mockClear();

            const result = await extension.handler({
                canvasId: created.canvasId,
                capability: 'add_card',
                params: { id: 'c1', title: 'First' },
            } as any) as any;

            expect(result.success).toBe(true);
            expect(JSON.parse(result.state).cards).toEqual([{ id: 'c1', title: 'First' }]);
            expect(emitProcessEvent).toHaveBeenCalledTimes(1);
        });

        it('requires a canvasId to run a capability', async () => {
            const { extension } = buildTools();
            const result = await extension.handler({ capability: 'add_card' } as any) as any;
            expect(result.success).toBe(false);
            expect(result.error).toContain('canvasId');
        });

        it('surfaces capability errors and an unknown extension canvas', async () => {
            const { extension } = buildTools();
            const created = await extension.handler(BUILD_ARGS as any) as any;

            const badCap = await extension.handler({ canvasId: created.canvasId, capability: 'nope' } as any) as any;
            expect(badCap.success).toBe(false);

            const missing = await extension.handler({ canvasId: 'missing-000000', capability: 'add_card' } as any) as any;
            expect(missing.success).toBe(false);
        });

        it('read_canvas returns the manifest for extension canvases', async () => {
            const { extension, read } = buildTools();
            const created = await extension.handler(BUILD_ARGS as any) as any;

            const result = await read.handler({ canvasId: created.canvasId } as any) as any;
            expect(result.success).toBe(true);
            expect(result.type).toBe('extension');
            expect(result.extensionManifest.capabilities[0].name).toBe('add_card');
        });
    });

    /**
     * How data gets INTO `canvases/<id>/files/` in v1: the AI attaches it, and
     * the artifact reads it back with `CanvasHost.readFile`. There is no user
     * upload route and no write path from the iframe.
     */
    describe('extension_canvas — attached files', () => {
        const AUTHOR = {
            title: 'Sales',
            description: 'Revenue chart',
            capabilities: [{ name: 'refresh', description: 'Refresh' }],
            capabilitiesJs: 'capabilities = { refresh: function (s) { return s; } };',
            uiHtml: '<div></div>',
        };

        it('writes files at BUILD time and reads them back through the store', async () => {
            const { extension } = buildTools();
            const result = await extension.handler({
                ...AUTHOR,
                files: [
                    { path: 'data.csv', content: 'month,revenue\njan,10\n' },
                    { path: 'raw/jan.json', content: '{"n":1}' },
                ],
            }) as any;

            expect(result.success).toBe(true);
            expect(result.files).toEqual([
                { path: 'data.csv', size: 21, encoding: 'utf-8' },
                { path: 'raw/jan.json', size: 7, encoding: 'utf-8' },
            ]);
            const read = store.readCanvasFile(WS, result.canvasId, 'data.csv');
            expect(read.ok).toBe(true);
            if (read.ok) expect(read.file.content).toBe('month,revenue\njan,10\n');
        });

        it('attaches files to an existing canvas without re-authoring the UI', async () => {
            const { extension } = buildTools();
            const created = await extension.handler(AUTHOR) as any;

            const attached = await extension.handler({
                canvasId: created.canvasId,
                files: [{ path: 'data.csv', content: 'a,b\n' }],
            }) as any;

            expect(attached.success).toBe(true);
            expect(attached.files).toEqual([{ path: 'data.csv', size: 4, encoding: 'utf-8' }]);
            // The extension documents are untouched — this is not a rebuild.
            expect(store.getExtension(WS, created.canvasId)?.uiHtml).toBe('<div></div>');
        });

        it('decodes base64 file content', async () => {
            const { extension } = buildTools();
            const bytes = Buffer.from([0x00, 0xff, 0x10]);
            const result = await extension.handler({
                ...AUTHOR,
                files: [{ path: 'logo.png', content: bytes.toString('base64'), encoding: 'base64' }],
            }) as any;

            expect(result.success).toBe(true);
            const read = store.readCanvasFile(WS, result.canvasId, 'logo.png');
            expect(read.ok).toBe(true);
            if (read.ok) expect(Buffer.from(read.file.content, 'base64')).toEqual(bytes);
        });

        it('refuses a traversing path and writes nothing', async () => {
            const { extension } = buildTools();
            const created = await extension.handler(AUTHOR) as any;

            const result = await extension.handler({
                canvasId: created.canvasId,
                files: [{ path: '../canvas.json', content: 'pwned' }],
            }) as any;

            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid file path');
            // The descriptor one directory up is intact.
            expect(store.getCanvas(WS, created.canvasId)?.type).toBe('extension');
        });

        it('rejects a malformed files array before writing any of it', async () => {
            const { extension } = buildTools();
            const created = await extension.handler(AUTHOR) as any;

            const result = await extension.handler({
                canvasId: created.canvasId,
                files: [{ path: 'ok.csv', content: 'a\n' }, { path: 'bad.csv' }],
            }) as any;

            expect(result.success).toBe(false);
            expect(result.error).toContain('content string');
            expect(store.listCanvasFiles(WS, created.canvasId)).toEqual([]);
        });

        it('rejects an unknown canvas and an invalid encoding', async () => {
            const { extension } = buildTools();

            const missing = await extension.handler({
                canvasId: 'no-such-canvas',
                files: [{ path: 'a.csv', content: 'x' }],
            }) as any;
            expect(missing.success).toBe(false);
            expect(missing.error).toContain('Canvas not found');

            const created = await extension.handler(AUTHOR) as any;
            const bad = await extension.handler({
                canvasId: created.canvasId,
                files: [{ path: 'a.csv', content: 'x', encoding: 'hex' }],
            }) as any;
            expect(bad.success).toBe(false);
            expect(bad.error).toContain('encoding');
        });
    });

    it('does not emit SSE events when process context is missing', async () => {
        const { write } = createCanvasTools({ dataDir, workspaceId: WS, canvasStore: store });
        const result = await write.handler({ title: 'Doc', content: 'x' }) as any;
        expect(result.success).toBe(true);
        expect(emitProcessEvent).not.toHaveBeenCalled();
    });
});
