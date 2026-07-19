import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';

const WS_ID = 'ws-tools';

function makeStore(searchEnabled = true) {
    return {
        ...(searchEnabled ? { searchConversations: vi.fn() } : {}),
    } as any;
}

describe('buildChatToolBundle', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-tool-builder-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('assembles the common chat tools and suffixes when enabled', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(),
            workspaceId: WS_ID,
            processId: 'proc-1',
            followUpSuggestions: { enabled: true, count: 3 },
            askUser: {
                enabled: true,
                deps: {
                    emitQuestions: vi.fn(),
                    computeTurnIndex: () => 1,
                },
            },
        });

        expect(result.tools.map(t => t.name).sort()).toEqual([
            'ask_user',
            'create_update_work_item',
            'get_conversation',
            'get_work_item',
            'search_conversations',
            'suggest_follow_ups',
            'tavily_web_search',
        ]);
        expect(result.tools.map(t => t.name)).not.toContain('update_work_item');
        expect(result.tools.map(t => t.name)).not.toContain('create_bug');
        expect(result.toolGuidance).toContain('tavily_web_search');
        // search_conversations / get_conversation tools are still wired (asserted
        // above); their prompt suffix was intentionally trimmed, so no guidance text.
        expect(result.askUser).toBeDefined();
        // Only web-search injects a prose suffix; follow-up / ask_user / work-item
        // / canvas guidance lives in each tool's description, not toolGuidance.
        expect(result.toolGuidance).not.toContain('<follow_up_suggestions>');
        expect(result.toolGuidance).not.toContain('</follow_up_suggestions>');
        expect(result.toolGuidance).not.toContain('<ask_user_tool>');
        expect(result.toolGuidance).not.toContain('<work_item_tools>');
        expect(result.toolGuidance).toContain('<web_search_tool>');
    });

    it('filters tavily_web_search and its suffix when disabled by repo preferences', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: ['tavily_web_search'] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(false),
            workspaceId: WS_ID,
            processId: 'proc-1',
            followUpSuggestions: { enabled: false, count: 3 },
        });

        expect(result.tools.map(t => t.name)).not.toContain('tavily_web_search');
        expect(result.toolGuidance).not.toContain('tavily_web_search');
        // Disabling the tool drops its whole tagged guidance block.
        expect(result.toolGuidance).not.toContain('<web_search_tool>');
    });

    it('honors context-specific exclusions in addition to preferences', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(false),
            workspaceId: WS_ID,
            followUpSuggestions: { enabled: true, count: 2 },
            excludeTools: ['suggest_follow_ups'],
        });

        expect(result.tools.map(t => t.name)).not.toContain('suggest_follow_ups');
        expect(result.tools.map(t => t.name)).toContain('tavily_web_search');
        expect(result.toolGuidance).not.toContain('2 suggestions');
    });

    it('includes kusto_query when kustoToolsEnabled is true', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(false),
            workspaceId: WS_ID,
            processId: 'proc-1',
            followUpSuggestions: { enabled: false, count: 0 },
            kustoToolsEnabled: true,
        });

        expect(result.tools.map(t => t.name)).toContain('kusto_query');
    });

    it('suppresses kusto_query when kustoToolsEnabled is false', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(false),
            workspaceId: WS_ID,
            processId: 'proc-1',
            followUpSuggestions: { enabled: false, count: 0 },
            kustoToolsEnabled: false,
        });

        expect(result.tools.map(t => t.name)).not.toContain('kusto_query');
    });

    it('suppresses kusto_query when includeKustoTools is false even if enabled', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(false),
            workspaceId: WS_ID,
            processId: 'proc-1',
            followUpSuggestions: { enabled: false, count: 0 },
            includeKustoTools: false,
            kustoToolsEnabled: true,
        });

        expect(result.tools.map(t => t.name)).not.toContain('kusto_query');
    });

    it('drops kusto_query when disabled by repo preferences even if enabled', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: ['kusto_query'] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(false),
            workspaceId: WS_ID,
            processId: 'proc-1',
            followUpSuggestions: { enabled: false, count: 0 },
            kustoToolsEnabled: true,
        });

        expect(result.tools.map(t => t.name)).not.toContain('kusto_query');
    });

    it('includes loop tools when loopTools deps are provided', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const mockLoopStore = {
            insert: vi.fn(),
            getById: vi.fn(),
            getByProcess: vi.fn().mockReturnValue([]),
            update: vi.fn(),
            getActive: vi.fn().mockReturnValue([]),
        } as any;

        const mockLoopExecutor = {
            armTimer: vi.fn(),
            disarmTimer: vi.fn(),
        } as any;

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(false),
            workspaceId: WS_ID,
            followUpSuggestions: { enabled: false, count: 0 },
            loopTools: {
                store: mockLoopStore,
                executor: mockLoopExecutor,
                processId: 'proc-1',
            },
        });

        const toolNames = result.tools.map(t => t.name);
        expect(toolNames).toContain('createLoop');
        expect(toolNames).toContain('cancelLoop');
        expect(toolNames).toContain('listLoops');
        // Loop tools are wired; their descriptive suffix was intentionally removed.
    });

    it('does not include loop tools when loopTools deps are not provided', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(false),
            workspaceId: WS_ID,
            followUpSuggestions: { enabled: false, count: 0 },
        });

        const toolNames = result.tools.map(t => t.name);
        expect(toolNames).not.toContain('createLoop');
        expect(toolNames).not.toContain('cancelLoop');
        expect(toolNames).not.toContain('listLoops');
    });
});
