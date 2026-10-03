import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SqliteProcessStore, type AIProcess } from '@plusplusoneplusplus/forge';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { admitBotControlledFollowUp } from '../../../src/server/messaging/bot-control-admission';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';

function fixture(botControl?: NonNullable<AIProcess['metadata']>['botControl']) {
    return createMockProcessStore({ initialProcesses: [{
        id: 'topic', type: 'chat', status: 'completed', startTime: new Date(),
        promptPreview: 'Ordinary conversation',
        metadata: { type: 'chat', workspaceId: 'ws-a', provider: 'claude', botControl },
    }] });
}

describe('trusted existing-conversation bot admission', () => {
    it.each(['teams', 'whatsapp'] as const)('persists %s control before admitting without changing provider', async source => {
        const store = fixture();
        const result = await admitBotControlledFollowUp(store, 'ws-a', 'topic', source, async () => {
            expect((await store.getProcess('topic'))?.metadata).toMatchObject({
                botControl: createBotControlMetadata(source), provider: 'claude', workspaceId: 'ws-a',
            });
            return 'admitted';
        });
        expect(result).toBe('admitted');
    });

    it('keeps an existing same-controller claim and saved link unchanged on failed admission', async () => {
        const control = { ...createBotControlMetadata('whatsapp'), externalThreadUrl: 'https://web.whatsapp.com/thread' };
        const store = fixture(control);
        await expect(admitBotControlledFollowUp(store, 'ws-a', 'topic', 'whatsapp', async () => {
            throw new Error('queue full');
        })).rejects.toThrow('queue full');
        expect(store.updateProcess).not.toHaveBeenCalled();
        expect((await store.getProcess('topic'))?.metadata?.botControl).toEqual(control);
    });

    it('rejects a competing integration without admitting or overwriting ownership', async () => {
        const store = fixture(createBotControlMetadata('teams'));
        const admit = vi.fn();
        await expect(admitBotControlledFollowUp(store, 'ws-a', 'topic', 'whatsapp', admit))
            .rejects.toThrow('already controlled');
        expect(admit).not.toHaveBeenCalled();
        expect(store.updateProcess).not.toHaveBeenCalled();
    });

    it('rejects malformed ownership rather than overwriting it', async () => {
        const store = fixture({ ...createBotControlMetadata('teams'), controllerLabel: 'Unknown controller' });
        const admit = vi.fn();
        await expect(admitBotControlledFollowUp(store, 'ws-a', 'topic', 'teams', admit))
            .rejects.toThrow('Invalid bot control');
        expect(admit).not.toHaveBeenCalled();
    });

    it.each(['ws-b', 'missing'])('rejects unavailable or wrong-workspace targets (%s)', async workspaceId => {
        const store = fixture();
        const admit = vi.fn();
        await expect(admitBotControlledFollowUp(store, workspaceId, workspaceId === 'missing' ? 'missing' : 'topic', 'teams', admit))
            .rejects.toThrow('unavailable');
        expect(admit).not.toHaveBeenCalled();
        expect(store.updateProcess).not.toHaveBeenCalled();
    });

    it('propagates failed claim persistence without running admission', async () => {
        const store = fixture();
        vi.mocked(store.updateProcess).mockRejectedValueOnce(new Error('disk unavailable'));
        const admit = vi.fn();
        await expect(admitBotControlledFollowUp(store, 'ws-a', 'topic', 'teams', admit))
            .rejects.toThrow('disk unavailable');
        expect(admit).not.toHaveBeenCalled();
        expect((await store.getProcess('topic'))?.metadata?.botControl).toBeUndefined();
        expect(store.updateProcess).toHaveBeenCalledOnce();
    });

    it.each(['teams', 'whatsapp'] as const)('compensates a committed %s readmission claim when its observer rejects before enqueue', async source => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-readmission-'));
        const store = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        try {
            await store.addProcess({
                id: 'topic', type: 'chat', status: 'completed', startTime: new Date(),
                promptPreview: 'Released conversation',
                metadata: { type: 'chat', workspaceId: 'ws-a', provider: 'claude' },
            });
            store.onProcessChange = event => {
                if (event.process?.metadata?.botControl === undefined) return;
                store.getDatabase().prepare("UPDATE processes SET metadata = json_set(metadata, '$.model', ?) WHERE id = ?")
                    .run('latest-model', 'topic');
                throw new Error('claim observer rejected');
            };
            const admit = vi.fn(async () => 'accepted');
            await expect(admitBotControlledFollowUp(store, 'ws-a', 'topic', source, admit))
                .rejects.toThrow('claim observer rejected');
            expect(admit).not.toHaveBeenCalled();
            expect((await store.getProcess('topic'))?.metadata).toMatchObject({
                workspaceId: 'ws-a', provider: 'claude', model: 'latest-model',
            });
            expect((await store.getProcess('topic'))?.metadata).not.toHaveProperty('botControl');
            const reloaded = new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
            try {
                expect((await reloaded.getProcess('topic'))?.metadata).not.toHaveProperty('botControl');
                expect(await admitBotControlledFollowUp(reloaded, 'ws-a', 'topic', source, admit)).toBe('accepted');
                expect((await reloaded.getProcess('topic'))?.metadata?.botControl).toEqual(createBotControlMetadata(source));
            } finally {
                reloaded.close();
            }
        } finally {
            store.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('does not compensate changed same-integration authority after a claim observer failure', async () => {
        const store = fixture();
        const replacement = { ...createBotControlMetadata('teams'), externalThreadUrl: 'https://teams.microsoft.com/thread' };
        vi.mocked(store.updateProcess).mockImplementationOnce(async (id, updates) => {
            const current = store.processes.get(id)!;
            store.processes.set(id, { ...current, ...updates, metadata: { ...updates.metadata, botControl: replacement } });
            throw new Error('claim observer rejected');
        });
        const admit = vi.fn();
        await expect(admitBotControlledFollowUp(store, 'ws-a', 'topic', 'teams', admit)).rejects.toMatchObject({
            message: 'Bot control admission failed and could not be rolled back',
            errors: [
                expect.objectContaining({ message: 'claim observer rejected' }),
                expect.objectContaining({ message: 'Bot control admission rollback target changed' }),
            ],
        });
        expect(admit).not.toHaveBeenCalled();
        expect(store.updateProcess).toHaveBeenCalledOnce();
        expect((await store.getProcess('topic'))?.metadata?.botControl).toEqual(replacement);
    });

    it('rolls back failed admission while preserving unrelated concurrent metadata', async () => {
        const store = fixture();
        await expect(admitBotControlledFollowUp(store, 'ws-a', 'topic', 'teams', async () => {
            const current = (await store.getProcess('topic'))!;
            await store.updateProcess('topic', { metadata: { ...current.metadata, model: 'test-model' } });
            throw new Error('queue full');
        })).rejects.toThrow('queue full');
        expect((await store.getProcess('topic'))?.metadata).toMatchObject({
            model: 'test-model', provider: 'claude', workspaceId: 'ws-a',
        });
        expect((await store.getProcess('topic'))?.metadata?.botControl).toBeUndefined();
    });

    it('surfaces both admission and rollback failures without reporting success', async () => {
        const store = fixture();
        vi.mocked(store.updateProcess).mockImplementationOnce(async (id, updates) => {
            const current = store.processes.get(id)!;
            store.processes.set(id, { ...current, ...updates });
        }).mockRejectedValueOnce(new Error('rollback write failed'));
        const result = admitBotControlledFollowUp(store, 'ws-a', 'topic', 'teams', async () => {
            throw new Error('enqueue failed');
        });
        await expect(result).rejects.toMatchObject({
            message: 'Bot control admission failed and could not be rolled back',
            errors: [expect.objectContaining({ message: 'enqueue failed' }), expect.objectContaining({ message: 'rollback write failed' })],
        });
    });

    it('serializes competing claims and lets a second integration retry after rollback', async () => {
        const store = fixture();
        let entered!: () => void;
        const started = new Promise<void>(resolve => { entered = resolve; });
        let reject!: (error: Error) => void;
        const first = admitBotControlledFollowUp(store, 'ws-a', 'topic', 'teams', () => {
            entered();
            return new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; });
        });
        const failed = expect(first).rejects.toThrow('first admission failed');
        await started;
        const secondAdmit = vi.fn(async () => 'second');
        const second = admitBotControlledFollowUp(store, 'ws-a', 'topic', 'whatsapp', secondAdmit);
        expect(secondAdmit).not.toHaveBeenCalled();
        reject(new Error('first admission failed'));
        await failed;
        expect(await second).toBe('second');
        expect((await store.getProcess('topic'))?.metadata?.botControl).toEqual(createBotControlMetadata('whatsapp'));
    });
});
