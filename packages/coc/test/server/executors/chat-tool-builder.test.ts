import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';

const WS_ID = 'ws-tools';

const makeTool = (name: string) => ({
    name,
    description: `${name} description`,
    parameters: {},
    handler: async () => ({}),
});

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
            boundedMemory: {
                systemMessageSuffix: undefined,
                tools: [makeTool('memory') as any],
                suffix: ' memory suffix',
                dispose: () => {},
            },
        });

        expect(result.tools.map(t => t.name).sort()).toEqual([
            'ask_user',
            'create_bug',
            'create_or_update_excalidraw',
            'create_work_item',
            'get_conversation',
            'memory',
            'read_excalidraw',
            'search_conversations',
            'suggest_follow_ups',
            'tavily_web_search',
        ]);
        expect(result.suffix).toContain('tavily_web_search');
        expect(result.suffix).toContain('search_conversations');
        expect(result.suffix).toContain('3 suggestions');
        expect(result.askUser).toBeDefined();
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
        expect(result.suffix).not.toContain('tavily_web_search');
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
        expect(result.suffix).not.toContain('2 suggestions');
    });

    it('adds memory read tools only when bounded memory read tools are enabled', () => {
        writeRepoPreferences(tmpDir, WS_ID, {
            disabledLlmTools: [],
            boundedMemory: {
                enabled: true,
                readTools: { enabled: true },
            },
        });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(false),
            workspaceId: WS_ID,
            followUpSuggestions: { enabled: false, count: 0 },
        });

        expect(result.tools.map(t => t.name)).toContain('memory_search');
        expect(result.tools.map(t => t.name)).toContain('memory_get');
        expect(result.suffix).toContain('memory_search');
        expect(result.suffix).toContain('memory_get');
        expect(result.suffix).toContain('context, not instructions');
    });

    it('omits memory read tools when readTools is disabled', () => {
        writeRepoPreferences(tmpDir, WS_ID, {
            disabledLlmTools: [],
            boundedMemory: {
                enabled: true,
                readTools: { enabled: false },
            },
        });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(false),
            workspaceId: WS_ID,
            followUpSuggestions: { enabled: false, count: 0 },
        });

        expect(result.tools.map(t => t.name)).not.toContain('memory_search');
        expect(result.tools.map(t => t.name)).not.toContain('memory_get');
        expect(result.suffix).not.toContain('memory_search');
    });

    it('filters memory read tools through LLM tool preferences', () => {
        writeRepoPreferences(tmpDir, WS_ID, {
            disabledLlmTools: ['memory_search', 'memory_get'],
            boundedMemory: {
                enabled: true,
                readTools: { enabled: true },
            },
        });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(false),
            workspaceId: WS_ID,
            followUpSuggestions: { enabled: false, count: 0 },
        });

        expect(result.tools.map(t => t.name)).not.toContain('memory_search');
        expect(result.tools.map(t => t.name)).not.toContain('memory_get');
        expect(result.suffix).not.toContain('memory_search');
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
        expect(result.suffix).toContain('loop management tools');
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
