import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    FileProcessStore,
    SqliteProcessStore,
    deserializeProcess,
    serializeProcess,
    type AIProcess,
    type BotControlMetadata,
    type BotControlSource,
} from '../src/index';

function control(source: BotControlSource): BotControlMetadata {
    return {
        state: 'active',
        source,
        controllerKey: `${source}-bridge`,
        controllerLabel: source === 'teams' ? 'Teams bridge' : 'WhatsApp bridge',
    };
}

function process(id: string, workspaceId: string, botControl?: BotControlMetadata): AIProcess {
    return {
        id,
        type: 'chat',
        promptPreview: 'hello',
        fullPrompt: 'hello',
        status: 'queued',
        startTime: new Date('2026-01-01T00:00:00.000Z'),
        metadata: { type: 'chat', workspaceId, provider: 'copilot', botControl },
    };
}

describe('bot control serialization', () => {
    it.each(['teams', 'whatsapp'] as const)('round-trips %s control through persisted JSON', source => {
        const botControl = {
            ...control(source),
            externalThreadUrl: 'https://example.com/thread',
        };
        const serialized = JSON.parse(JSON.stringify(serializeProcess(process('chat', 'ws-a', botControl))));
        const restored = deserializeProcess(serialized);
        expect(restored.metadata?.botControl).toEqual(botControl);
        expect(restored.metadata?.provider).toBe('copilot');
        expect(restored.metadata?.workspaceId).toBe('ws-a');
    });

    it('does not infer control from prompts, provider, or automation metadata', () => {
        const ordinary = process('automated-chat', 'ws-a');
        ordinary.fullPrompt = 'Managed by a Teams bot';
        ordinary.metadata = { ...ordinary.metadata!, cronId: 'cron-test', wakeupId: 'wakeup-test' };
        const restored = deserializeProcess(JSON.parse(JSON.stringify(serializeProcess(ordinary))));
        expect(restored.metadata?.botControl).toBeUndefined();
    });
});

describe.each(['sqlite', 'file'] as const)('%s bot control persistence', backend => {
    let tmpDir: string;
    let store: SqliteProcessStore | FileProcessStore;

    function openStore() {
        return backend === 'sqlite'
            ? new SqliteProcessStore({ dbPath: path.join(tmpDir, 'processes.db') })
            : new FileProcessStore({ dataDir: tmpDir });
    }

    function closeStore() {
        if (store instanceof SqliteProcessStore) {
            store.close();
        }
    }

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-control-store-'));
        store = openStore();
    });

    afterEach(async () => {
        closeStore();
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it.each(['teams', 'whatsapp'] as const)('retains %s control after reopening the store', async source => {
        const botControl = control(source);
        await store.addProcess(process('chat', 'ws-a', botControl));
        closeStore();
        store = openStore();

        const loaded = await store.getProcess('chat', 'ws-a');
        expect(loaded?.metadata?.botControl).toEqual(botControl);
        expect(loaded?.metadata?.workspaceId).toBe('ws-a');
        const listed = await store.getAllProcesses({ workspaceId: 'ws-a', exclude: ['conversation'] });
        expect(listed[0].metadata?.botControl).toEqual(botControl);
    });

    it('persists an explicit claim on an existing conversation and repeated writes', async () => {
        const original = process('chat', 'ws-a');
        await store.addProcess(original);
        const metadata = { ...original.metadata!, botControl: control('teams') };
        await store.updateProcess('chat', { metadata });
        await store.updateProcess('chat', { metadata });

        expect((await store.getProcess('chat'))?.metadata).toEqual(metadata);
        expect(await store.getAllProcesses({ workspaceId: 'ws-a' })).toHaveLength(1);
    });

    it('persists removal without losing unrelated metadata', async () => {
        const original = process('chat', 'ws-a', control('whatsapp'));
        await store.addProcess(original);
        await store.updateProcess('chat', {
            metadata: { ...original.metadata!, botControl: undefined },
        });
        closeStore();
        store = openStore();

        const loaded = await store.getProcess('chat', 'ws-a');
        expect(loaded?.metadata?.botControl).toBeUndefined();
        expect(loaded?.metadata?.provider).toBe('copilot');
        expect(loaded?.metadata?.workspaceId).toBe('ws-a');
    });

    it('keeps workspace reads separate and ordinary conversations unattributed', async () => {
        await store.addProcess(process('teams-chat', 'ws-a', control('teams')));
        await store.addProcess(process('whatsapp-chat', 'ws-b', control('whatsapp')));
        await store.addProcess(process('ordinary-chat', 'ws-b'));

        const first = await store.getAllProcesses({ workspaceId: 'ws-a' });
        expect(first.map(item => item.id)).toEqual(['teams-chat']);
        expect(first[0].metadata?.botControl?.source).toBe('teams');
        const second = await store.getAllProcesses({ workspaceId: 'ws-b' });
        expect(second).toHaveLength(2);
        expect(second.find(item => item.id === 'whatsapp-chat')?.metadata?.botControl?.source).toBe('whatsapp');
        expect(second.find(item => item.id === 'ordinary-chat')?.metadata?.botControl).toBeUndefined();
    });

    it.each(['teams', 'whatsapp'] as const)('reads %s control from summaries without hydrating processes', async source => {
        const botControl = { ...control(source), externalThreadUrl: 'https://example.com/private-thread' };
        await store.addProcess(process('managed', 'ws-a', botControl));
        await store.addProcess(process('ordinary', 'ws-a'));
        await store.addProcess(process('other', 'ws-b', control('teams')));
        closeStore();
        store = openStore();
        const fullRead = vi.spyOn(store, 'getProcess');
        const allRead = vi.spyOn(store, 'getAllProcesses');
        const summaries = await store.getProcessSummaries({ workspaceId: 'ws-a' });
        expect(summaries.total).toBe(2);
        expect(summaries.entries.find(entry => entry.id === 'managed')?.botControl).toEqual(botControl);
        expect(summaries.entries.find(entry => entry.id === 'ordinary')?.botControl).toBeUndefined();
        expect(summaries.entries.map(entry => entry.workspaceId)).toEqual(['ws-a', 'ws-a']);
        expect(fullRead).not.toHaveBeenCalled();
        expect(allRead).not.toHaveBeenCalled();
        if (store instanceof SqliteProcessStore) {
            store.pinProcess('managed', '2026-02-01T00:00:00Z');
            expect(store.getPinnedProcesses('ws-a')[0].botControl).toEqual(botControl);
            expect(store.getPinnedProcesses('ws-b')).toEqual([]);
        }
    });

    it('keeps summary claims and releases current through repeated updates and reload', async () => {
        const original = process('managed', 'ws-a');
        await store.addProcess(original);
        for (const botControl of [control('teams'), control('teams'), undefined]) {
            await store.updateProcess('managed', { metadata: { ...original.metadata!, botControl } });
            expect((await store.getProcessSummaries()).entries[0].botControl).toEqual(botControl);
            if (store instanceof SqliteProcessStore) {
                store.pinProcess('managed', '2026-02-01T00:00:00Z');
                expect(store.getPinnedProcesses('ws-a')[0].botControl).toEqual(botControl);
            }
        }
        closeStore();
        store = openStore();
        expect((await store.getProcessSummaries()).entries[0].botControl).toBeUndefined();
    });
});
