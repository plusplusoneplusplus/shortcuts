import fs from 'node:fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { ClaudeSDKService, CodexSDKService, createBridgeHandlers, createHttpTransport } from '@plusplusoneplusplus/coc-agent-sdk';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { createCanvasUpdateNotifier } from '../../../src/server/canvas/canvas-update-notifier';
import { CanvasExtensionHost } from '../../../src/server/canvas-extensions/extension-host';
import { CanvasExtensionHostRegistry } from '../../../src/server/canvas-extensions/host-registry';
import { CANVAS_EXTENSION_LLM_TOOL_NAMES } from '../../../src/server/llm-tools/llm-tool-registry';
import { buildChatTurnContext, type ChatTurnContext } from '../../../src/server/executors/chat-turn-context-builder';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';

vi.mock('os', async importOriginal => {
    const actual = await importOriginal<typeof import('os')>();
    return { ...actual, homedir: vi.fn(actual.homedir) };
});
const owner = { workspaceId: 'workspace-1', processId: 'conversation-1' };
const names = [...CANVAS_EXTENSION_LLM_TOOL_NAMES];
describe('canvas extensions in executor turn contexts', () => {
    let root: string, enabled: boolean, store: ProcessStore, hosts: CanvasExtensionHostRegistry;
    let startHost: ReturnType<typeof vi.fn>, contexts: ChatTurnContext[];
    const config = () => ({ canvasExtensions: { enabled } });
    async function context(overrides = {}) {
        const result = await buildChatTurnContext({
            dataDir: root, store, ...owner, includeMemoryV2: false, includeToolScripting: false,
            canvasExtensionRuntime: { config, hosts, canvasStore: new CanvasStore(root),
                notifier: createCanvasUpdateNotifier({ processStore: store }) }, ...overrides,
        });
        contexts.push(result);
        return result;
    }
    const extensionNames = (ctx: ChatTurnContext) => ctx.tools.filter(tool => names.includes(tool.name)).map(tool => tool.name);
    beforeEach(() => {
        enabled = true; contexts = [];
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas executor '));
        const repo = path.join(root, 'repo');
        const folder = path.join(repo, '.github', 'extensions', 'counter');
        fs.mkdirSync(folder, { recursive: true });
        fs.copyFileSync(path.resolve('test/fixtures/canvas-extensions/minimal/extension.mjs'), path.join(folder, 'extension.mjs'));
        fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ description: 'A counter\nwith actions' }));
        fs.writeFileSync(path.join(root, 'config.yaml'), 'canvas:\n  enabled: false\n');
        vi.mocked(os.homedir).mockReturnValue(path.join(root, 'home'));
        store = {
            getWorkspaces: vi.fn(async () => [{ id: owner.workspaceId, rootPath: repo }]),
            getProcess: vi.fn(async (id, workspaceId) => ({ id, metadata: { workspaceId } })),
            emitProcessEvent: vi.fn(),
        } as unknown as ProcessStore;
        startHost = vi.fn(CanvasExtensionHost.start);
        hosts = new CanvasExtensionHostRegistry({ config, store, dataDir: root, startHost, log: vi.fn() });
    });
    afterEach(async () => {
        contexts.forEach(ctx => ctx.dispose());
        await hosts.dispose(); vi.restoreAllMocks();
        fs.rmSync(root, { recursive: true, force: true });
    });
    it('adds the fixed tools and discovery-only catalog independently of canvas.enabled', async () => {
        const ctx = await context();
        expect(extensionNames(ctx)).toEqual(names);
        expect(ctx.tools.some(tool => tool.name === 'write_canvas')).toBe(false);
        expect(ctx.toolGuidance).toContain('- workspace-1:counter: A counter with actions');
        expect(startHost).not.toHaveBeenCalled();
        expect(store.getWorkspaces).toHaveBeenCalledOnce();
    });
    it('omits tools and catalog with no discovery or spawn while disabled', async () => {
        enabled = false;
        const ctx = await context();
        expect(extensionNames(ctx)).toEqual([]);
        expect(ctx.toolGuidance).not.toContain('Installed canvas extensions');
        expect(store.getWorkspaces).not.toHaveBeenCalled();
        expect(startHost).not.toHaveBeenCalled();
    });
    it('has no extension tools or catalog without the server capability', async () => {
        const ctx = await context({ canvasExtensionRuntime: undefined });
        expect(extensionNames(ctx)).toEqual([]);
        expect(ctx.toolGuidance).not.toContain('Installed canvas extensions');
        expect(store.getWorkspaces).not.toHaveBeenCalled();
        expect(startHost).not.toHaveBeenCalled();
    });
    it('omits an empty catalog without starting any runtime', async () => {
        vi.mocked(store.getWorkspaces).mockResolvedValue([]);
        const ctx = await context();
        expect(extensionNames(ctx)).toEqual(names);
        expect(ctx.toolGuidance).not.toContain('Installed canvas extensions');
        expect(startHost).not.toHaveBeenCalled();
    });
    it('respects workspace preferences and live disabling of captured handlers', async () => {
        writeRepoPreferences(root, owner.workspaceId, { disabledLlmTools: names });
        const hidden = await context();
        expect(extensionNames(hidden)).toEqual([]);
        expect(hidden.toolGuidance).not.toContain('Installed canvas extensions');
        expect(store.getWorkspaces).not.toHaveBeenCalled();
        const sibling = await context({ workspaceId: 'workspace-2' });
        expect(extensionNames(sibling)).toEqual(names);
        enabled = false;
        const reads = vi.mocked(store.getWorkspaces).mock.calls.length;
        const denied = await sibling.tools.find(tool => tool.name === 'list_canvas_capabilities')!.handler({}) as any;
        expect(denied.resultType).toBe('failure');
        expect(JSON.parse(denied.textResultForLlm))
            .toMatchObject({ success: false, error: { message: 'Canvas extensions are disabled' } });
        expect(vi.mocked(store.getWorkspaces).mock.calls).toHaveLength(reads);
        expect(startHost).not.toHaveBeenCalled();
    });
    it.each([{ browserOnly: true }, { sentinelPrOutcomeReview: true }, { codaFindings: { name: 'submit_scrub_findings' } }])(
        'omits tools and catalog for restricted turns: %j', async restrictions => {
            const ctx = await context(restrictions);
            expect(extensionNames(ctx)).toEqual([]);
            expect(ctx.toolGuidance).not.toContain('Installed canvas extensions');
            expect(store.getWorkspaces).not.toHaveBeenCalled();
            expect(startHost).not.toHaveBeenCalled();
        },
    );
    it('exposes native tools and the actual Codex/Claude MCP lists, preserving CanvasError through the bridge', async () => {
        const ctx = await context();
        const tools = ctx.tools.filter(tool => names.includes(tool.name));
        // Copilot receives these native definitions directly; other providers adapt them.
        expect(tools.map(tool => tool.name)).toEqual(names);
        const claude = new ClaudeSDKService();
        const codex = new CodexSDKService();
        let claudeConfig: any, codexConfig: any;
        try {
            claudeConfig = await (claude as any).buildClaudeMcpServers({ tools });
            expect(claudeConfig.allowedTools).toEqual(names.map(name => `mcp__coc_llm_tools__${name}`));
            expect(claudeConfig.inventoryTools.map((tool: any) => tool.name)).toEqual(names);
            const constructor = vi.fn(function(this: any, options: any) { this.options = options; });
            (codex as any).codexCtor = constructor;
            codexConfig = await (codex as any).resolveRequestClient({ tools });
            expect(constructor.mock.calls[0][0].config.mcp_servers.coc_llm_tools.enabled_tools).toEqual(names);
            expect(startHost).not.toHaveBeenCalled();
            const env = claudeConfig.servers.coc_llm_tools.env;
            const bridge = createBridgeHandlers({ transport: createHttpTransport(env.COC_LLM_TOOLS_ENDPOINT, env.COC_LLM_TOOLS_TOKEN) });
            const response = await bridge.handleMessage({ id: 1, method: 'tools/list' });
            expect((response!.result as any).tools.map((tool: any) => tool.name)).toEqual(names);
            const opened = await tools.find(tool => tool.name === 'open_canvas')!.handler({ canvasId: 'workspace-1:counter/counter', instanceId: 'bridge-instance' }) as any;
            expect(opened.success).toBe(true);
            const error = await bridge.handleMessage({ id: 2, method: 'tools/call', params: {
                name: 'invoke_canvas_action', arguments: { instanceId: 'bridge-instance', actionName: 'error' },
            } });
            expect((error!.result as any).isError).toBe(true);
            expect(JSON.parse((error!.result as any).content[0].text)).toEqual({
                success: false, error: { code: 'counter_error', message: 'Counter failed' },
            });
        } finally {
            claudeConfig?.cleanup(); codexConfig?.cleanup(); claude.dispose(); codex.dispose();
        }
    });
});
