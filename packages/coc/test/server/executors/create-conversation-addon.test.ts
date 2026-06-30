import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import { buildCreateConversationAddon } from '../../../src/server/executors/prompt-builder';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';

const WS_ID = 'ws-create-conversation';

function makeStore() {
    return {
        searchConversations: vi.fn(),
        getWorkspaces: vi.fn().mockResolvedValue([{ id: WS_ID }]),
    } as any;
}

describe('buildCreateConversationAddon', () => {
    it('no-ops (returns no tool) when the enqueue capability is absent', () => {
        const addon = buildCreateConversationAddon(makeStore(), WS_ID, undefined);
        expect(addon.tools).toEqual([]);
        expect(addon.suffix).toBe('');
    });

    it('no-ops when the store is absent', () => {
        const addon = buildCreateConversationAddon(undefined, WS_ID, vi.fn());
        expect(addon.tools).toEqual([]);
    });

    it('builds the create_conversation tool when store + enqueue capability are present', () => {
        const addon = buildCreateConversationAddon(makeStore(), WS_ID, vi.fn());
        expect(addon.tools.map(t => t.name)).toEqual(['create_conversation']);
    });
});

describe('buildChatToolBundle create_conversation wiring', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-conversation-bundle-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('includes create_conversation when the capability is provided AND the tool is enabled', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(),
            workspaceId: WS_ID,
            enqueueChat: vi.fn(),
        });

        expect(result.tools.map(t => t.name)).toContain('create_conversation');
    });

    it('excludes create_conversation when the enqueue capability is absent (addon no-ops)', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(),
            workspaceId: WS_ID,
            // no enqueueChat
        });

        expect(result.tools.map(t => t.name)).not.toContain('create_conversation');
    });

    it('includes create_conversation by default when the capability is present', () => {
        // No repo preferences written → enabled-by-default tool is offered.
        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(),
            workspaceId: WS_ID,
            enqueueChat: vi.fn(),
        });

        expect(result.tools.map(t => t.name)).toContain('create_conversation');
    });

    it('excludes create_conversation when explicitly disabled by repo preferences', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: ['create_conversation'] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(),
            workspaceId: WS_ID,
            enqueueChat: vi.fn(),
        });

        expect(result.tools.map(t => t.name)).not.toContain('create_conversation');
    });

    it('defaults the create_conversation target workspace to options.workspaceId', async () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const enqueueChat = vi.fn().mockResolvedValue('task-123');
        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(),
            workspaceId: WS_ID,
            enqueueChat,
        });

        const tool = result.tools.find(t => t.name === 'create_conversation');
        expect(tool).toBeDefined();

        // Invoking with no workspaceId should fall back to options.workspaceId and
        // enqueue a chat task scoped to that workspace. An explicit provider is
        // supplied because this bundle has no parent process to inherit one from.
        await (tool as any).handler({ prompt: 'hello', provider: 'copilot' });
        expect(enqueueChat).toHaveBeenCalledTimes(1);
        const input = enqueueChat.mock.calls[0][0];
        expect(input.type).toBe('chat');
        expect((input.payload as any).workspaceId).toBe(WS_ID);
    });
});
