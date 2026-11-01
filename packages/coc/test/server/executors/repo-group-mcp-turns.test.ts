/**
 * Repo-group chats send the aggregated member MCP servers on the first turn
 * and on every follow-up — the same resolution Settings → MCP shows — with
 * member stdio servers anchored to their member root.
 *
 * Synthetic config files only; the SDK is mocked, so no MCP server starts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { setHomeDirectoryOverride } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { FollowUpExecutor } from '../../../src/server/executors/follow-up-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { nestRuntime } from './runtime-options-helper';

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../src/server/streaming/sse-handler', () => ({
    emitMessageSteering: vi.fn(),
}));

const GROUP_ID = 'group-demo';
const sdkMocks = createMockSDKService();

let base: string;
let dataDir: string;
let groupRoot: string;
let repoA: string;
let repoB: string;

function writeJson(file: string, data: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
}

function makeStore() {
    const workspaces = [
        { id: GROUP_ID, name: 'Demo', rootPath: groupRoot, virtual: true, enabledMcpServers: null },
        { id: 'ws-a', name: 'repo-a', rootPath: repoA, enabledMcpServers: ['shared', 'local'] },
        { id: 'ws-b', name: 'repo-b', rootPath: repoB },
    ];
    const store = createMockProcessStore({ initialWorkspaces: workspaces as any });
    (store.getWorkspaces as any).mockResolvedValue(workspaces);
    return store;
}

function makeOptions() {
    return nestRuntime({
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        askUser: { enabled: false },
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue(GROUP_ID),
        resolveAiServiceForProvider: () => sdkMocks.service as any,
    }) as any;
}

function expectAggregatedServers(options: any): void {
    expect(options.loadDefaultMcpConfig).toBe(false);
    const servers = options.mcpServers;
    expect(Object.keys(servers).sort()).toEqual(['global', 'local', 'onlyB', 'shared']);
    // `hidden` is disabled in repo-a's own settings, so the group never inherits it.
    expect(servers.hidden).toBeUndefined();
    expect(servers.local).toMatchObject({ command: path.join(repoA, 'bin', 'mcp'), cwd: repoA });
    expect(servers.onlyB).toMatchObject({ command: 'b-bin', cwd: repoB });
    expect(servers.shared).toMatchObject({ type: 'http', url: 'https://shared.example/mcp' });
}

beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-group-mcp-turns-'));
    const home = path.join(base, 'home');
    dataDir = path.join(base, 'data');
    groupRoot = path.join(dataDir, 'repos', GROUP_ID);
    repoA = path.join(base, 'repo-a');
    repoB = path.join(base, 'repo-b');
    for (const dir of [home, groupRoot, repoA, repoB]) fs.mkdirSync(dir, { recursive: true });
    setHomeDirectoryOverride(home);
    writeJson(path.join(home, '.copilot', 'mcp-config.json'), { mcpServers: { global: { command: 'global-bin' } } });
    writeJson(path.join(groupRoot, 'group.json'), { name: 'Demo', members: ['ws-a', 'ws-b'] });
    const shared = { type: 'http', url: 'https://shared.example/mcp' };
    writeJson(path.join(repoA, '.vscode', 'mcp.json'), {
        servers: { shared, local: { command: './bin/mcp' }, hidden: { command: 'hidden-bin' } },
    });
    writeJson(path.join(repoB, '.vscode', 'mcp.json'), { servers: { shared, onlyB: { command: 'b-bin' } } });

    sdkMocks.resetAll();
    sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
    sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 'sess-1' });
});

afterEach(() => {
    setHomeDirectoryOverride(null);
    fs.rmSync(base, { recursive: true, force: true });
});

describe('repo-group chat turns', () => {
    it('sends the aggregated member servers on the first turn', async () => {
        const task = {
            id: 'task-group',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat', mode: 'ask', prompt: 'hi', workspaceId: GROUP_ID, workingDirectory: groupRoot },
            config: {},
            displayName: 'hi',
        } as unknown as QueuedTask;
        await new ChatExecutor(makeStore(), makeOptions(), dataDir).execute(task, 'hi');
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        expectAggregatedServers(sdkMocks.mockSendMessage.mock.calls[0][0]);
    });

    it('sends the same aggregated servers on a follow-up turn', async () => {
        const store = makeStore();
        await store.addProcess({
            id: 'proc-group',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            promptPreview: 'hi',
            sdkSessionId: 'sess-1',
            workingDirectory: groupRoot,
            metadata: { type: 'chat', workspaceId: GROUP_ID, mode: 'ask' },
            conversationTurns: [
                { role: 'user', content: 'hi', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'ok', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        } as unknown as AIProcess);
        await new FollowUpExecutor(store, makeOptions(), dataDir).executeFollowUp('proc-group', 'next', undefined, 'ask');
        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(1);
        expectAggregatedServers(sdkMocks.mockSendMessage.mock.calls[0][0]);
    });
});
