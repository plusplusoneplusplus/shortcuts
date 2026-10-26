/**
 * `run_tool_script` MCP access in a chat turn: the flag gate, server names in
 * the description, one shared client per turn, cleanup on dispose and abort,
 * the approval gate on `mcp_call`, and per-workspace server resolution.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Tool, ToolEvent } from '@plusplusoneplusplus/coc-agent-sdk';
import { buildChatTurnContext, type ChatTurnContext, type ChatTurnContextInput } from '../../../src/server/executors/chat-turn-context-builder';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import type { LlmToolApprovalRecord } from '../../../src/server/executors/llm-tool-approval-gate';
import { CONFIG_FILE_NAME } from '../../../src/config';

const FIXTURE = path.join(__dirname, '..', 'llm-tools', 'fixtures', 'fake-mcp-server.cjs');
const invocation = { sessionId: 's', toolCallId: 'script-call', toolName: 'run_tool_script', arguments: {} };

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitForExit(pid: number): Promise<void> {
    const deadline = Date.now() + 5000;
    while (isAlive(pid) && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    expect(isAlive(pid)).toBe(false);
}

const scriptTool = (tools: Tool<any>[]) => tools.find(t => t.name === 'run_tool_script')!;

async function runScript(tools: Tool<any>[], code: string): Promise<any> {
    const result = await scriptTool(tools).handler!({ code }, invocation);
    return JSON.parse(typeof result === 'string' ? result : (result as { textResultForLlm: string }).textResultForLlm);
}

describe('run_tool_script MCP access in a chat turn', () => {
    let tmpDir: string;
    let contexts: ChatTurnContext[];
    const workspaces: Array<{ id: string; name: string; rootPath: string; enabledMcpServers?: string[] }> = [];

    function addWorkspace(id: string, servers: string[], enabledMcpServers: string[] = servers) {
        const rootPath = path.join(tmpDir, id);
        fs.mkdirSync(path.join(rootPath, '.vscode'), { recursive: true });
        fs.writeFileSync(path.join(rootPath, '.vscode', 'mcp.json'), JSON.stringify({
            servers: Object.fromEntries(servers.map(name => [name, { command: process.execPath, args: [FIXTURE] }])),
        }));
        writeRepoPreferences(tmpDir, id, { disabledLlmTools: [] });
        workspaces.push({ id, name: id, rootPath, enabledMcpServers });
    }

    function setFeatures(features: Record<string, boolean>) {
        fs.writeFileSync(path.join(tmpDir, CONFIG_FILE_NAME),
            `features:\n${Object.entries(features).map(([k, v]) => `  ${k}: ${v}\n`).join('')}`);
    }

    async function turn(workspaceId: string, extra: Partial<ChatTurnContextInput> = {}) {
        const ctx = await buildChatTurnContext({
            dataDir: tmpDir,
            store: { getWorkspaces: vi.fn(async () => workspaces), searchConversations: vi.fn() } as any,
            workspaceId,
            processId: `proc-${workspaceId}`,
            includeMemoryV2: false,
            ...extra,
        });
        contexts.push(ctx);
        return ctx;
    }

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tool-script-mcp-'));
        contexts = [];
        workspaces.length = 0;
        setFeatures({ toolScripting: true, toolScriptingMcp: true });
    });

    afterEach(() => {
        for (const ctx of contexts) ctx.dispose();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('lists the workspace server names and calls them through the generic tools', async () => {
        addWorkspace('ws-a', ['alpha']);
        const events: ToolEvent[] = [];
        const ctx = await turn('ws-a', { onNestedToolEvent: e => events.push(e) });
        const description = scriptTool(ctx.tools).description!;
        expect(description).toContain('MCP servers: alpha;');
        expect(description).toContain('tools.mcp_list_tools');
        expect(description).toContain('tools.mcp_call');
        // The pair is script-only: the model never sees it directly.
        expect(ctx.tools.map(t => t.name)).not.toContain('mcp_call');

        const run = await runScript(ctx.tools, `
            const listed = await tools.mcp_list_tools({ server: 'alpha' });
            let failed;
            try { await tools.mcp_call({ server: 'alpha', tool: 'fail', args: {} }); }
            catch (err) { failed = err.name + ':' + err.message; }
            const echoed = await tools.mcp_call({ server: 'alpha', tool: 'echo', args: { text: 'hi' } });
            return { names: listed.tools.map(t => t.name), failed, echoed };`);
        expect(run.result.names).toEqual(['echo', 'pid', 'fail', 'secret']);
        expect(run.result.failed).toMatch(/^ToolCallError:.*boom from fail/);
        expect(run.result.echoed).toBe('echo:hi');
        expect(events.filter(e => e.type === 'tool-start').map(e => `${e.toolName}:${e.parentToolCallId}`)).toEqual([
            'mcp_list_tools:script-call', 'mcp_call:script-call', 'mcp_call:script-call',
        ]);
    });

    it('shares one client across scripts of a turn and kills it on dispose', async () => {
        addWorkspace('ws-a', ['alpha']);
        const ctx = await turn('ws-a');
        const code = `return Number(await tools.mcp_call({ server: 'alpha', tool: 'pid' }));`;
        const first = (await runScript(ctx.tools, code)).result;
        const second = (await runScript(ctx.tools, code)).result;
        expect(first).toBe(second);
        expect(isAlive(first)).toBe(true);
        ctx.dispose();
        await waitForExit(first);
        expect((await runScript(ctx.tools, code)).error.message).toContain('MCP scope is closed');
    });

    it('closes the clients when the turn is aborted', async () => {
        addWorkspace('ws-a', ['alpha']);
        const abort = new AbortController();
        const ctx = await turn('ws-a', { browserSignal: abort.signal });
        const pid = (await runScript(ctx.tools, `return Number(await tools.mcp_call({ server: 'alpha', tool: 'pid' }));`)).result;
        abort.abort();
        await waitForExit(pid);
    });

    it('resolves servers per workspace', async () => {
        addWorkspace('ws-a', ['alpha']);
        addWorkspace('ws-b', ['beta']);
        const [a, b] = [await turn('ws-a'), await turn('ws-b')];
        expect(scriptTool(a.tools).description).toContain('MCP servers: alpha;');
        expect(scriptTool(b.tools).description).toContain('MCP servers: beta;');
        expect((await runScript(a.tools, `return await tools.mcp_call({ server: 'beta', tool: 'echo' });`)).error.message)
            .toContain('unknown-server: beta');
        expect((await runScript(b.tools, `return await tools.mcp_list_tools({ server: 'alpha' });`)).error.message)
            .toContain('unknown-server: alpha');
    });

    describe('approval gate', () => {
        function interactiveTurn(decisions: string[], records: LlmToolApprovalRecord[], asked: string[]) {
            return turn('ws-a', {
                onLlmToolApprovalDecision: r => records.push(r),
                askUser: {
                    enabled: true,
                    deps: {
                        computeTurnIndex: () => 1,
                        isInteractive: () => true,
                        emitQuestions: vi.fn(async (payloads: any[], control: any) => {
                            asked.push(payloads[0].question);
                            control.answer(payloads[0].questionId, decisions.shift());
                        }),
                    },
                },
            });
        }

        it('asks before mcp_call by default and never before mcp_list_tools', async () => {
            addWorkspace('ws-a', ['alpha']);
            const records: LlmToolApprovalRecord[] = [];
            const asked: string[] = [];
            const ctx = await interactiveTurn(['deny', 'approve-once'], records, asked);
            const run = await runScript(ctx.tools, `
                await tools.mcp_list_tools({ server: 'alpha' });
                let denied;
                try { await tools.mcp_call({ server: 'alpha', tool: 'echo', args: { text: 'no' } }); }
                catch (err) { denied = err.message; }
                const echoed = await tools.mcp_call({ server: 'alpha', tool: 'echo', args: { text: 'yes' } });
                return { denied, echoed };`);
            expect(run.result.denied).toContain('User denied this tool call.');
            expect(run.result.echoed).toBe('echo:yes');
            expect(asked).toHaveLength(2);
            expect(asked[0]).toContain('"server": "alpha"');
            expect(asked[0]).toContain('"tool": "echo"');
            expect(records.map(r => `${r.toolName}:${r.outcome}`)).toEqual(['mcp_call:deny', 'mcp_call:approve-once']);
        });

        it('denies mcp_call on unattended runs while listing still works', async () => {
            addWorkspace('ws-a', ['alpha']);
            const ctx = await turn('ws-a', { unattendedScript: true });
            const run = await runScript(ctx.tools, `
                const listed = await tools.mcp_list_tools({ server: 'alpha' });
                let denied;
                try { await tools.mcp_call({ server: 'alpha', tool: 'echo' }); }
                catch (err) { denied = err.message; }
                return { count: listed.tools.length, denied };`);
            expect(run.result.count).toBe(4);
            expect(run.result.denied).toContain('cannot run in a background script');
        });

        it('lets mcp_call through when the repo turns its approval off', async () => {
            addWorkspace('ws-a', ['alpha']);
            writeRepoPreferences(tmpDir, 'ws-a', { disabledLlmTools: [], approvalOptOutLlmTools: ['mcp_call'] });
            const records: LlmToolApprovalRecord[] = [];
            const asked: string[] = [];
            const interactive = await interactiveTurn([], records, asked);
            expect((await runScript(interactive.tools, `return await tools.mcp_call({ server: 'alpha', tool: 'echo', args: { text: 'a' } });`)).result)
                .toBe('echo:a');
            const unattended = await turn('ws-a', { unattendedScript: true });
            expect((await runScript(unattended.tools, `return await tools.mcp_call({ server: 'alpha', tool: 'echo', args: { text: 'b' } });`)).result)
                .toBe('echo:b');
            expect(asked).toEqual([]);
            expect(records).toEqual([]);
        });
    });

    it.each([
        ['toolScriptingMcp is off', { toolScripting: true, toolScriptingMcp: false }],
        ['toolScripting is off', { toolScripting: false, toolScriptingMcp: true }],
    ])('offers nothing MCP-related when %s', async (_label, features) => {
        addWorkspace('ws-a', ['alpha']);
        setFeatures(features);
        const ctx = await turn('ws-a');
        const description = scriptTool(ctx.tools)?.description ?? '';
        expect(description).not.toContain('MCP servers');
        expect(description).not.toContain('mcp_call');
    });

    it('offers nothing MCP-related when every server is disabled (mcpServers {})', async () => {
        addWorkspace('ws-a', ['alpha'], []);
        const ctx = await turn('ws-a');
        const description = scriptTool(ctx.tools).description!;
        expect(description).not.toContain('MCP servers');
        expect(description).not.toContain('mcp_call');
    });

    it('leaves MCP out of browser-only and Codex code-mode bundles', async () => {
        addWorkspace('ws-a', ['alpha']);
        expect((await turn('ws-a', { includeToolScripting: false })).tools.map(t => t.name)).not.toContain('run_tool_script');
        const bundle = buildChatToolBundle({
            dataDir: tmpDir, store: { searchConversations: vi.fn() } as any, workspaceId: 'ws-a',
            mcpServers: { alpha: { command: process.execPath, args: [FIXTURE] } as never },
            includeToolScripting: false,
        });
        expect(bundle.mcpScope).toBeUndefined();
    });
});
