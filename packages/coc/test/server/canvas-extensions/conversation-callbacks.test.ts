import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { SqliteProcessStore, denyAllPermissions, type CreateTaskInput, type ISDKService } from '@plusplusoneplusplus/forge';
import { createCanvasExtensionCallbacks } from '../../../src/server/canvas-extensions/conversation-callbacks';
import { CanvasExtensionHostRegistry } from '../../../src/server/canvas-extensions/host-registry';
import { CANVAS_COMPLETE_TIMEOUT_MS, MAX_CANVAS_COMPLETE_PROMPT_CHARS } from '../../../src/server/canvas/canvas-capability-completion';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import type { QueueExecutorBridge } from '../../../src/server/core/api-handler';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

const owner = { workspaceId: 'group-1', processId: 'conversation-1' };
const extensionKey = 'member-1:counter';

describe('canvas extension conversation callbacks', () => {
    let root: string, store: SqliteProcessStore, enabled: boolean;
    let callbacks: ReturnType<typeof createCanvasExtensionCallbacks>;
    let hosts: CanvasExtensionHostRegistry | undefined;
    let bridge: QueueExecutorBridge;
    let service: ReturnType<typeof createMockSDKService>['service'];
    let sendMessage: MockInstance<ISDKService['sendMessage']>;
    let resolveAiService: ReturnType<typeof vi.fn>;
    let log: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'canvas-callbacks-'));
        store = new SqliteProcessStore({ dbPath: join(root, 'processes.db') });
        for (const [id, workspaceId] of [[owner.processId, owner.workspaceId], ['sibling', 'other-workspace']]) {
            await store.addProcess({ id, type: 'chat', status: 'completed', promptPreview: 'Canvas',
                fullPrompt: 'Canvas', startTime: new Date(), workingDirectory: root,
                metadata: { type: 'chat', workspaceId, provider: 'copilot', mode: 'autopilot', model: 'gpt-6.1-sol' } });
        }
        enabled = true;
        service = createMockSDKService().service;
        sendMessage = vi.spyOn(service, 'sendMessage').mockResolvedValue({ success: true, response: 'One-shot answer' });
        resolveAiService = vi.fn(() => service);
        log = vi.fn();
        const enqueue = vi.fn(async (input: CreateTaskInput) => input.id ?? 'queued-task');
        bridge = { enqueue, enqueueAdmitted: enqueue, getTask: vi.fn(),
            executeFollowUp: vi.fn(), isSessionAlive: vi.fn(async () => false), steerProcess: vi.fn() };
        callbacks = createCanvasExtensionCallbacks({
            config: () => ({ canvasExtensions: { enabled } }), store, bridge, dataDir: root, resolveAiService, log,
        });
    });

    afterEach(async () => {
        await hosts?.dispose();
        hosts = undefined;
        store.close();
        vi.restoreAllMocks();
        await rm(root, { recursive: true, force: true });
    });

    it('queues an attributed follow-up with a durable message ID into only the owning conversation', async () => {
        const result = await callbacks.send(owner, extensionKey, 'hi');
        expect(bridge.enqueueAdmitted).toHaveBeenCalledOnce();
        const input = vi.mocked(bridge.enqueueAdmitted!).mock.calls[0][0];
        expect(input).toMatchObject({ id: result.messageId, processId: owner.processId, payload: {
            workspaceId: owner.workspaceId, processId: owner.processId, mode: 'autopilot',
            deliveryMode: 'enqueue', prompt: `[Canvas extension ${extensionKey}]\n\nhi`,
        } });
        const process = await store.getProcess(owner.processId, owner.workspaceId);
        expect(process?.conversationTurns).toHaveLength(1);
        expect(process?.conversationTurns?.[0]).toMatchObject({
            role: 'user', content: input.payload.prompt, relayRequestId: result.messageId,
        });
        expect((await store.getProcess('sibling'))?.conversationTurns ?? []).toEqual([]);
        expect(bridge.steerProcess).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(expect.stringContaining(`message=${result.messageId}`));
    });

    it('buffers busy-conversation sends at the next turn boundary rather than steering or adding a turn', async () => {
        await store.updateProcess(owner.processId, { status: 'running' });
        const { messageId } = await callbacks.send(owner, extensionKey, 'hi');
        const process = await store.getProcess(owner.processId);
        expect(process?.pendingMessages).toEqual([expect.objectContaining({
            id: messageId, relayRequestId: messageId, mode: 'autopilot', content: `[Canvas extension ${extensionKey}]\n\nhi`,
        })]);
        expect(process?.conversationTurns ?? []).toEqual([]);
        expect(bridge.enqueue).not.toHaveBeenCalled();
        expect(bridge.steerProcess).not.toHaveBeenCalled();
    });

    it.each([
        ['copilot', 'gpt-6.1-sol'], ['codex', 'gpt-6.1-sol'], ['claude', 'sonnet'], ['opencode', 'provider/model'],
    ] as const)('uses the active %s conversation provider and model with no tools, ambient MCP or conversation turn', async (provider, model) => {
        await store.updateProcess(owner.processId, {
            metadata: { type: 'chat', workspaceId: owner.workspaceId, provider: 'copilot', model },
            activeProviderSession: { provider, segmentId: 'current', firstTurnIndex: 0 },
        });
        expect(await callbacks.ephemeralQuery(owner, extensionKey, 'How many?')).toEqual({ answer: 'One-shot answer' });
        expect(resolveAiService).toHaveBeenCalledExactlyOnceWith(provider);
        expect(sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            prompt: 'How many?', model, workingDirectory: root, timeoutMs: CANVAS_COMPLETE_TIMEOUT_MS,
            loadDefaultMcpConfig: false, tools: undefined, onPermissionRequest: expect.any(Function),
        }));
        const options = sendMessage.mock.calls[0][0];
        expect(options.onPermissionRequest).toBe(denyAllPermissions);
        expect(options.sessionId).toBeUndefined();
        expect((await store.getProcess(owner.processId))?.conversationTurns ?? []).toEqual([]);
        expect(bridge.enqueue).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(expect.stringContaining(`canvas=${extensionKey}`));
    });

    it('uses the follow-up model policy, not the canvas quick-ask default, when the conversation has no model', async () => {
        await store.updateProcess(owner.processId, { metadata: { type: 'chat', workspaceId: owner.workspaceId } });
        writeRepoPreferences(root, owner.workspaceId, { defaultModels: { followUp: 'gpt-6.1-sol', quickAsk: 'gpt-6-astra' } });
        await callbacks.ephemeralQuery(owner, extensionKey, 'Question');
        expect(sendMessage.mock.calls[0][0].model).toBe('gpt-6.1-sol');
        writeRepoPreferences(root, owner.workspaceId, { defaultModels: { quickAsk: 'gpt-6-astra' } });
        await callbacks.ephemeralQuery(owner, extensionKey, 'Question');
        expect(sendMessage.mock.calls[1][0].model).toBeUndefined();
    });

    it.each(['disabled', 'archived', 'deleted', 'wrong-workspace'])('rejects callbacks for a %s owner', async state => {
        if (state === 'disabled') enabled = false;
        if (state === 'archived') store.archiveProcess(owner.processId);
        if (state === 'deleted') await store.removeProcess(owner.processId);
        const target = state === 'wrong-workspace' ? { ...owner, workspaceId: 'other-workspace' } : owner;
        await expect(callbacks.send(target, extensionKey, 'hi')).rejects.toThrow();
        await expect(callbacks.ephemeralQuery(target, extensionKey, 'Question')).rejects.toThrow();
        expect(bridge.enqueue).not.toHaveBeenCalled();
        expect(sendMessage).not.toHaveBeenCalled();
    });

    it('rejects empty sends and empty or oversized queries without contacting a model or queue', async () => {
        await expect(callbacks.send(owner, extensionKey, ' ')).rejects.toThrow('non-empty');
        await expect(callbacks.ephemeralQuery(owner, extensionKey, ' ')).rejects.toThrow('non-empty');
        await expect(callbacks.ephemeralQuery(owner, extensionKey, 'x'.repeat(MAX_CANVAS_COMPLETE_PROMPT_CHARS + 1)))
            .rejects.toThrow('over the');
        expect(sendMessage).not.toHaveBeenCalled();
        expect(bridge.enqueue).not.toHaveBeenCalled();
    });

    it('surfaces provider and delivery failures without a success-shaped response', async () => {
        sendMessage.mockResolvedValueOnce({ success: false, error: 'Completion failed' });
        await expect(callbacks.ephemeralQuery(owner, extensionKey, 'Question')).rejects.toThrow('Completion failed');
        resolveAiService.mockImplementationOnce(() => { throw new Error('Provider disabled'); });
        await expect(callbacks.ephemeralQuery(owner, extensionKey, 'Question')).rejects.toThrow('Provider disabled');
        vi.mocked(bridge.enqueueAdmitted!).mockRejectedValueOnce(new Error('Queue unavailable'));
        await expect(callbacks.send(owner, extensionKey, 'hi')).rejects.toMatchObject({
            message: 'Failed to enqueue follow-up', originalError: expect.objectContaining({ message: 'Queue unavailable' }),
        });
        expect((await store.getProcess(owner.processId))?.conversationTurns ?? []).toEqual([]);
    });

    it('rechecks the live gate during queue routing and before publishing a delayed completion', async () => {
        vi.mocked(bridge.enqueueAdmitted!).mockImplementationOnce(async (_input, validate) => {
            enabled = false;
            validate?.(await store.getProcess(owner.processId));
            throw new Error('Admission should reject');
        });
        await expect(callbacks.send(owner, extensionKey, 'hi')).rejects.toMatchObject({
            originalError: expect.objectContaining({ message: 'Canvas extensions are disabled' }),
        });
        expect((await store.getProcess(owner.processId))?.conversationTurns ?? []).toEqual([]);
        enabled = true;
        sendMessage.mockImplementationOnce(async () => {
            enabled = false;
            return { success: true, response: 'Late answer' };
        });
        await expect(callbacks.ephemeralQuery(owner, extensionKey, 'Question')).rejects.toThrow('disabled');
    });

    it('serves real SDK fixture callbacks through the conversation-bound registry', async () => {
        const extensionPath = join(root, 'extension.mjs');
        await copyFile(resolve('test/fixtures/canvas-extensions/minimal/extension.mjs'), extensionPath);
        hosts = new CanvasExtensionHostRegistry({
            config: () => ({ canvasExtensions: { enabled } }), store, dataDir: root, log, ...callbacks,
        });
        const extension = { extensionKey, name: 'counter', ownerWorkspaceId: 'member-1',
            extensionPath, cwd: root, contentHash: 'fixture' };
        await hosts.open(owner, extension, { canvasId: 'counter', instanceId: 'counter-1' });
        const result = await hosts.invoke(owner, extension, { instanceId: 'counter-1', actionName: 'callbacks' });
        expect(result).toEqual({ messageId: expect.any(String), answer: 'One-shot answer', eventId: expect.any(String) });
        expect(bridge.enqueueAdmitted).toHaveBeenCalledOnce();
        expect((await store.getProcess(owner.processId))?.conversationTurns).toHaveLength(1);
        expect((await store.getProcess('sibling'))?.conversationTurns ?? []).toEqual([]);
        expect(sendMessage).toHaveBeenCalledOnce();
    });
});
