import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsCommandRouter, type TeamsCommandRouterDeps } from '../../../src/server/messaging/teams-command-router';
import { createMockProcessStore } from '../helpers/mock-process-store';

describe('fixed Teams channel routing', () => {
    let dataDir: string;
    let deps: TeamsCommandRouterDeps;
    let router: TeamsCommandRouter;
    const sentinel: AIProcess = {
        id: 'sentinel-a', type: 'chat', status: 'completed', promptPreview: '', fullPrompt: '',
        startTime: new Date(), metadata: { workspaceId: 'workspace-a', mode: 'sentinel' },
    };
    const message = (id: string, text: string, replyToMessageId?: string): InboundTeamsMessage => ({
        channelId: 'channel-a', messageId: id, text, senderAadId: 'user-a', ...(replyToMessageId ? { replyToMessageId } : {}),
    });

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-fixed-router-'));
        const store = createMockProcessStore({
            initialWorkspaces: [{ id: 'workspace-a', name: 'A', rootPath: dataDir },
                { id: 'workspace-b', name: 'B', rootPath: dataDir }],
            initialProcesses: [sentinel],
        });
        deps = {
            dataDir, store, enqueueChat: vi.fn(), executeFollowUp: vi.fn(),
            sendReply: vi.fn().mockResolvedValue(undefined),
            isAnswerRelayEnabled: () => true,
            admitFollowUp: vi.fn().mockResolvedValue({ duplicate: false }),
            acknowledgeFollowUp: vi.fn().mockResolvedValue(undefined),
            validateImageTarget: vi.fn().mockResolvedValue(undefined),
            fixedChannel: {
                enabled: () => true,
                resolve: vi.fn().mockResolvedValue({ workspaceId: 'workspace-a', process: sentinel }),
                bind: vi.fn().mockResolvedValue(undefined),
            },
        };
        router = new TeamsCommandRouter(deps);
    });
    afterEach(() => {
        router.stop();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('sends roots and replies from different users to the same Sentinel', async () => {
        await router.handle(message('root', 'first'));
        await router.handle({ ...message('reply', 'second', 'another-root'), senderAadId: 'user-b' });
        expect(deps.admitFollowUp).toHaveBeenNthCalledWith(1, expect.objectContaining({ messageId: 'root' }), sentinel, 'first', undefined);
        expect(deps.admitFollowUp).toHaveBeenNthCalledWith(2, expect.objectContaining({ messageId: 'reply' }), sentinel, 'second', undefined);
        expect(deps.enqueueChat).not.toHaveBeenCalled();
    });

    it('rejects removed commands and explicit targets without admitting work', async () => {
        for (const text of ['list repos', 'list topics', 'select repo x', 'create topic', '[foreign] send']) {
            await router.handle(message(text, text));
        }
        expect(deps.admitFollowUp).not.toHaveBeenCalled();
        expect(deps.sendReply).toHaveBeenCalledTimes(5);
        expect(vi.mocked(deps.sendReply).mock.calls[0][0]).not.toContain('list repos');
    });

    it('fails closed when no binding or relay exists', async () => {
        vi.mocked(deps.fixedChannel!.resolve).mockResolvedValueOnce(null);
        await router.handle(message('missing', 'hello'));
        expect(deps.sendReply).toHaveBeenCalledWith(expect.stringContaining('not configured'), 'missing');
        deps.isAnswerRelayEnabled = () => false;
        await router.handle(message('disabled', 'hello'));
        expect(deps.sendReply).toHaveBeenCalledWith(expect.stringContaining('answer relay'), 'disabled');
        expect(deps.admitFollowUp).not.toHaveBeenCalled();
    });

    it('supports channel binding commands and fixed-channel help', async () => {
        await router.handle(message('bind', '/binding set workspace-a sentinel-a'));
        expect(deps.fixedChannel!.bind).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'bind' }), 'workspace-a', 'sentinel-a');
        await router.handle(message('help', '/help'));
        expect(deps.sendReply).toHaveBeenCalledWith(expect.stringContaining('Sentinel bound to this Teams channel'), 'help');
    });

    it('keeps duplicates from being acknowledged a second time', async () => {
        vi.mocked(deps.admitFollowUp!).mockResolvedValueOnce({ duplicate: true });
        await router.handle(message('repeat', 'hello'));
        expect(deps.acknowledgeFollowUp).not.toHaveBeenCalled();
    });

    it('deduplicates compaction commands for both channel roots and replies', async () => {
        const seen = new Set<string>();
        deps.hasThreadCommand = msg => seen.has(msg.messageId);
        deps.recordThreadCommand = msg => { seen.add(msg.messageId); };
        deps.compact = vi.fn().mockResolvedValue({});
        const root = message('compact-root', '/compact');
        const reply = message('compact-reply', '/compact', 'thread-root');
        await router.handle(root);
        await router.handle(root);
        await router.handle(reply);
        await router.handle(reply);
        expect(deps.compact).toHaveBeenCalledTimes(2);
    });

    it('does not send pending images or their instructions after a channel rebind', async () => {
        const image = { mimeType: 'image/png', download: vi.fn(async () => Buffer.from('image')) };
        await router.handle({ ...message('image-root', ''), images: [image] });
        const next: AIProcess = { ...sentinel, id: 'sentinel-b', metadata: { workspaceId: 'workspace-b', mode: 'sentinel' } };
        vi.mocked(deps.fixedChannel!.resolve).mockResolvedValue({ workspaceId: 'workspace-b', process: next });
        const instruction = message('instruction', 'describe this', 'image-root');
        await router.handle(instruction);
        await router.handle(instruction);
        expect(deps.admitFollowUp).not.toHaveBeenCalled();
        expect(image.download).not.toHaveBeenCalled();
        expect(deps.sendReply).toHaveBeenCalledWith(expect.stringContaining('changed'), 'image-root');
    });
});
