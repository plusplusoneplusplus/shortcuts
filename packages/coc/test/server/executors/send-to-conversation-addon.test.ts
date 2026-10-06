import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import { buildSendToConversationAddon } from '../../../src/server/executors/prompt-builder';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';

const WS_ID = 'ws-send-to-conversation';
const PARENT_ID = 'queue_parent';

function makeStore() {
    return {
        searchConversations: vi.fn(),
        getWorkspaces: vi.fn().mockResolvedValue([{ id: WS_ID }]),
        // A parent process so create mode can inherit a provider.
        getProcess: vi.fn(async (id: string) =>
            id === PARENT_ID ? ({ id: PARENT_ID, metadata: { provider: 'copilot' } } as never) : (undefined as never),
        ),
    } as any;
}

describe('buildSendToConversationAddon', () => {
    it('no-ops (returns no tool) when the enqueue capability is absent', () => {
        const addon = buildSendToConversationAddon(makeStore(), WS_ID, undefined);
        expect(addon.tools).toEqual([]);
        expect(addon.suffix).toBe('');
    });

    it('no-ops when the store is absent', () => {
        const addon = buildSendToConversationAddon(undefined, WS_ID, vi.fn());
        expect(addon.tools).toEqual([]);
    });

    it('builds send_to_conversation and list_workspaces when store + enqueue capability are present', () => {
        const addon = buildSendToConversationAddon(makeStore(), WS_ID, vi.fn());
        expect(addon.tools.map(t => t.name)).toEqual(['send_to_conversation', 'list_workspaces']);
    });

    it('forwards cancellation through the existing runtime without changing registration gates', async () => {
        const cancelConversation = vi.fn().mockResolvedValue({ processId: 'target', cancelled: true, status: 'cancelled' });
        const addon = buildSendToConversationAddon(makeStore(), WS_ID, vi.fn(), undefined, undefined, { cancelConversation });
        const tool = addon.tools.find(t => t.name === 'send_to_conversation')!;
        expect(await tool.handler({ action: 'cancel', processId: 'target' }, {} as never)).toMatchObject({ cancelled: true });
        expect(cancelConversation).toHaveBeenCalledWith('target', undefined);
        expect(buildSendToConversationAddon(makeStore(), WS_ID, undefined, undefined, undefined, { cancelConversation }).tools).toEqual([]);
    });

    it('backs list_workspaces with the runtime workspace directory', async () => {
        const directory = {
            list: vi.fn().mockResolvedValue({
                entries: [{ id: 'remote:s1:w1', name: 'api', type: 'repo', server: 'vm', serverKind: 'url', online: true }],
                servers: [],
            }),
            startRemoteChat: vi.fn(),
        };
        const addon = buildSendToConversationAddon(makeStore(), WS_ID, vi.fn(), undefined, undefined, { workspaceDirectory: directory });
        const listTool = addon.tools.find(t => t.name === 'list_workspaces')!;
        const result = await listTool.handler({}, {} as any) as any;
        expect(result.workspaces.map((w: any) => w.id)).toEqual(['remote:s1:w1']);
    });
});

describe('buildChatToolBundle send_to_conversation wiring', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-to-conversation-bundle-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('includes send_to_conversation when the capability is provided AND the tool is enabled', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(),
            workspaceId: WS_ID,
            enqueueChat: vi.fn(),
        });

        expect(result.tools.map(t => t.name)).toContain('send_to_conversation');
    });

    it('excludes send_to_conversation when the enqueue capability is absent (addon no-ops)', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(),
            workspaceId: WS_ID,
            // no enqueueChat
        });

        expect(result.tools.map(t => t.name)).not.toContain('send_to_conversation');
    });

    it('includes send_to_conversation by default when the capability is present', () => {
        // No repo preferences written → enabled-by-default tool is offered.
        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(),
            workspaceId: WS_ID,
            enqueueChat: vi.fn(),
        });

        expect(result.tools.map(t => t.name)).toContain('send_to_conversation');
    });

    it('excludes send_to_conversation when explicitly disabled by repo preferences', () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: ['send_to_conversation'] });

        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(),
            workspaceId: WS_ID,
            enqueueChat: vi.fn(),
        });

        expect(result.tools.map(t => t.name)).not.toContain('send_to_conversation');
    });

    it('defaults the create-mode target workspace to options.workspaceId', async () => {
        writeRepoPreferences(tmpDir, WS_ID, { disabledLlmTools: [] });

        const enqueueChat = vi.fn().mockResolvedValue('task-123');
        const result = buildChatToolBundle({
            dataDir: tmpDir,
            store: makeStore(),
            workspaceId: WS_ID,
            // The parent process supplies the inherited provider.
            processId: PARENT_ID,
            enqueueChat,
        });

        const tool = result.tools.find(t => t.name === 'send_to_conversation');
        expect(tool).toBeDefined();

        // Invoking with no workspaceId should fall back to options.workspaceId and
        // enqueue a chat task scoped to that workspace. The provider is inherited
        // from the parent process the bundle was built for.
        await (tool as any).handler({ content: 'hello' });
        expect(enqueueChat).toHaveBeenCalledTimes(1);
        const input = enqueueChat.mock.calls[0][0];
        expect(input.type).toBe('chat');
        expect((input.payload as any).workspaceId).toBe(WS_ID);
    });
});
