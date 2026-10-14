import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Tool, ToolEvent } from '@plusplusoneplusplus/coc-agent-sdk';
import { buildChatToolBundle, type ChatToolBundleOptions } from '../../../src/server/executors/chat-tool-builder';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { CONFIG_FILE_NAME } from '../../../src/config';
import type { LlmToolApprovalRecord } from '../../../src/server/executors/llm-tool-approval-gate';

const WS = 'ws-script';

describe('run_tool_script in buildChatToolBundle', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tool-script-bundle-'));
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: [] });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function build(overrides: Partial<ChatToolBundleOptions> = {}) {
        return buildChatToolBundle({
            dataDir: tmpDir,
            store: { searchConversations: vi.fn(async () => ({ results: [{ processId: 'p1' }], total: 1 })) } as any,
            workspaceId: WS,
            processId: 'proc-1',
            followUpSuggestions: { enabled: true, count: 3 },
            askUser: { enabled: true, deps: { emitQuestions: vi.fn(async () => {}), computeTurnIndex: () => 1, isInteractive: () => false } },
            toolScriptingEnabled: true,
            canvasToolsEnabled: false,
            kustoToolsEnabled: false,
            systemOneToolEnabled: false,
            ...overrides,
        });
    }

    const memoryV2 = () => ({
        tools: [{ name: 'recall_memory', description: 'recall', handler: vi.fn(async () => ({ facts: ['a'] })) }] as never,
        suffix: '', excludedBuiltinTools: [], dispose: vi.fn(),
    });
    const names = (bundle: { tools: Tool<any>[] }) => bundle.tools.map(t => t.name);
    const scriptTool = (bundle: { tools: Tool<any>[] }) => bundle.tools.find(t => t.name === 'run_tool_script');
    const invocation = { sessionId: 's', toolCallId: 'script-call', toolName: 'run_tool_script', arguments: {} };

    it('is offered only when the admin flag is on', () => {
        expect(names(build())).toContain('run_tool_script');
        expect(names(build({ toolScriptingEnabled: false }))).not.toContain('run_tool_script');
    });

    it('reads the admin flag from config on every build', () => {
        const configPath = path.join(tmpDir, CONFIG_FILE_NAME);
        expect(names(build({ toolScriptingEnabled: undefined }))).not.toContain('run_tool_script');
        fs.writeFileSync(configPath, 'features:\n  toolScripting: true\n');
        expect(names(build({ toolScriptingEnabled: undefined }))).toContain('run_tool_script');
        fs.writeFileSync(configPath, 'features:\n  toolScripting: false\n');
        expect(names(build({ toolScriptingEnabled: undefined }))).not.toContain('run_tool_script');
    });

    it('is hidden when disabled per repo or excluded by context', () => {
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: ['run_tool_script'] });
        expect(names(build())).not.toContain('run_tool_script');
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: [] });
        expect(names(build({ excludeTools: ['run_tool_script'] }))).not.toContain('run_tool_script');
    });

    it.each([
        ['includeToolScripting false (Codex code mode, browser-only)', { includeToolScripting: false }],
        ['PR outcome review turns', { sentinelPrOutcomeReview: true }],
        ['scrubber turns', { scrubFindings: { name: 'submit_scrub_findings', handler: vi.fn() } as never }],
    ])('is left out for %s', (_label, overrides) => {
        expect(names(build(overrides))).not.toContain('run_tool_script');
    });

    it('lists only enabled, scriptable tools as callable', () => {
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: ['tavily_web_search', 'get_conversation'] });
        const description = scriptTool(build({ enqueueChat: vi.fn() }))!.description!;
        const callable = description.split('Callable: ')[1].split(' Limits:')[0];
        expect(callable).toContain('tools.search_conversations');
        expect(callable).toContain('tools.run_tool_script');
        for (const hidden of ['ask_user', 'suggest_follow_ups', 'send_to_conversation', 'tavily_web_search', 'get_conversation']) {
            expect(callable).not.toContain(`tools.${hidden}`);
        }
    });

    it('keeps the same tool block whether or not the turn can open PRs', () => {
        const ask = scriptTool(build())!;
        const autopilot = scriptTool(build({ createPullRequest: { workspaceId: WS } as never }))!;
        expect(autopilot.description).toBe(ask.description);
        expect(autopilot.parameters).toEqual(ask.parameters);
    });

    it('runs scriptable tools and reports nested events under the script call', async () => {
        const events: ToolEvent[] = [];
        const tool = scriptTool(build({ memoryV2: memoryV2(), onNestedToolEvent: e => events.push(e) }))!;
        const result = await tool.handler!({
            code: `const r = await tools.recall_memory({ query: 'x' }); return r.facts;`,
        }, invocation);
        expect(JSON.parse(result as string)).toEqual({
            result: ['a'], logs: [], calls: [{ name: 'recall_memory', ok: true }], callCount: 1,
        });
        expect(events.map(e => `${e.type}:${e.toolName}:${e.parentToolCallId}`)).toEqual([
            'tool-start:recall_memory:script-call',
            'tool-complete:recall_memory:script-call',
        ]);
    });

    it('returns a failure result when the script throws', async () => {
        const tool = scriptTool(build())!;
        const result = await tool.handler!({ code: `await tools.ask_user({});` }, invocation) as { textResultForLlm: string; resultType: string };
        expect(result.resultType).toBe('failure');
        expect(JSON.parse(result.textResultForLlm).error).toMatchObject({ code: 'UNKNOWN_TOOL' });
    });

    it('routes a script call to an approval-gated tool through the gate', async () => {
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: [], approvalRequiredLlmTools: ['recall_memory'] });
        const records: LlmToolApprovalRecord[] = [];
        const events: ToolEvent[] = [];
        const tool = scriptTool(build({
            memoryV2: memoryV2(), onLlmToolApprovalDecision: r => records.push(r), onNestedToolEvent: e => events.push(e),
        }))!;
        await tool.handler!({ code: `await tools.recall_memory({ query: 'x' });` }, invocation);
        expect(records).toEqual([{ toolName: 'recall_memory', toolCallId: events[0].toolCallId, outcome: 'auto-allowed' }]);
    });

    it('can itself be approval-gated', () => {
        writeRepoPreferences(tmpDir, WS, { disabledLlmTools: [], approvalRequiredLlmTools: ['run_tool_script'] });
        expect(scriptTool(build())!.handler!.name).toBe('gatedHandler');
    });
});
