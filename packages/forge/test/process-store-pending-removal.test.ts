import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileProcessStore } from '../src/file-process-store';
import { SqliteProcessStore } from '../src/sqlite-process-store';
import type { ProcessStore } from '../src/process-store';

describe.each(['file', 'sqlite'] as const)('%s pending-message removal', backend => {
    it('removes one message atomically with concurrent appends and isolates conversations', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pending-removal-'));
        const store: ProcessStore = backend === 'file' ? new FileProcessStore({ dataDir: dir })
            : new SqliteProcessStore({ dbPath: path.join(dir, 'processes.db') });
        const message = (id: string) => ({ id, content: id, createdAt: new Date().toISOString() });
        try {
            for (const id of ['a', 'b']) await store.addProcess({ id, type: 'chat', status: 'running', startTime: new Date(),
                promptPreview: '', metadata: { type: 'chat', workspaceId: `ws-${id}` }, pendingMessages: [message('remove')] });
            await Promise.all([
                store.appendPendingMessage('a', message('keep-one')),
                store.removePendingMessage('a', 'remove'),
                store.appendPendingMessage('a', message('keep-two')),
            ]);
            expect((await store.getProcess('a'))?.pendingMessages?.map(message => message.id)).toEqual(['keep-one', 'keep-two']);
            expect((await store.getProcess('b'))?.pendingMessages?.map(message => message.id)).toEqual(['remove']);
            await store.removePendingMessage('a', 'missing');
            expect((await store.getProcess('a'))?.pendingMessages).toHaveLength(2);
        } finally {
            if (store instanceof SqliteProcessStore) store.close();
            await fs.rm(dir, { recursive: true, force: true });
        }
    });
});
