import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { TeamsChannelBindings } from '../../../src/server/messaging/teams-channel-binding';
import { createMockProcessStore } from '../helpers/mock-process-store';

describe('TeamsChannelBindings', () => {
    let dataDir: string;
    let store: ReturnType<typeof createMockProcessStore>;
    let bindings: TeamsChannelBindings;
    const identity = { accountKey: 'account-a', teamId: 'team-a', channelId: 'channel-a' };
    const sentinel: AIProcess = {
        id: 'sentinel-a', type: 'chat', status: 'completed', promptPreview: '', fullPrompt: '',
        startTime: new Date(), metadata: { workspaceId: 'workspace-a', mode: 'sentinel' },
    };

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-channel-binding-'));
        fs.mkdirSync(path.join(dataDir, 'a'));
        fs.mkdirSync(path.join(dataDir, 'b'));
        store = createMockProcessStore({
            initialWorkspaces: [
                { id: 'workspace-a', name: 'A', rootPath: path.join(dataDir, 'a') },
                { id: 'workspace-b', name: 'B', rootPath: path.join(dataDir, 'b') },
            ],
            initialProcesses: [sentinel],
        });
        bindings = new TeamsChannelBindings(dataDir, store);
    });
    afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

    it('persists exact account and channel ownership across restart', async () => {
        await bindings.bind(identity, 'workspace-a', 'sentinel-a');
        const restored = new TeamsChannelBindings(dataDir, store);
        expect((await restored.resolve(identity))?.process.id).toBe('sentinel-a');
        expect(await restored.resolve({ ...identity, accountKey: 'account-b' })).toBeNull();
        expect(await restored.resolve({ ...identity, channelId: 'channel-b' })).toBeNull();
        expect(await restored.resolve({ ...identity, teamId: 'team-b' })).toBeNull();
    });

    it('rejects wrong owners, non-Sentinels, missing chats and deleted workspaces', async () => {
        await expect(bindings.bind(identity, 'workspace-b', 'sentinel-a')).rejects.toThrow('Sentinel');
        store.processes.set('ordinary', { ...sentinel, id: 'ordinary', metadata: { workspaceId: 'workspace-a', mode: 'ask' } });
        await expect(bindings.bind(identity, 'workspace-a', 'ordinary')).rejects.toThrow('Sentinel');
        await expect(bindings.bind(identity, 'workspace-a', 'missing')).rejects.toThrow('Sentinel');
        await bindings.bind(identity, 'workspace-a', 'sentinel-a');
        await store.removeWorkspace('workspace-a');
        await expect(bindings.resolve(identity)).rejects.toThrow('workspace');
    });

    it('serializes admission and rebind without redirecting the admitted operation', async () => {
        const second: AIProcess = { ...sentinel, id: 'sentinel-b', metadata: { workspaceId: 'workspace-b', mode: 'sentinel' } };
        store.processes.set(second.id, second);
        await bindings.bind(identity, 'workspace-a', sentinel.id);
        let release!: () => void;
        const held = new Promise<void>(resolve => { release = resolve; });
        const observed: string[] = [];
        const first = bindings.exclusive(async () => {
            observed.push((await bindings.resolve(identity))!.process.id);
            await held;
            observed.push((await bindings.resolve(identity))!.process.id);
        });
        const secondOperation = bindings.exclusive(() => bindings.bind(identity, 'workspace-b', second.id));
        release();
        await Promise.all([first, secondOperation]);
        expect(observed).toEqual(['sentinel-a', 'sentinel-a']);
        expect((await bindings.resolve(identity))?.process.id).toBe('sentinel-b');
    });

    it('does not save a binding after its connection changes during validation', async () => {
        await expect(bindings.bind(identity, 'workspace-a', sentinel.id, () => false)).rejects.toThrow('unavailable');
        expect(await bindings.resolve(identity)).toBeNull();
    });

    it('fails closed on malformed persisted state', async () => {
        fs.writeFileSync(path.join(dataDir, 'teams-channel-bindings.json'), '{"invalid":true}');
        await expect(bindings.resolve(identity)).rejects.toThrow('unavailable');
        await expect(bindings.bind(identity, 'workspace-a', sentinel.id)).rejects.toThrow('unavailable');
    });
});
