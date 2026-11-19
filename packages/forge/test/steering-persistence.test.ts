import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileProcessStore } from '../src/file-process-store';
import { SqliteProcessStore } from '../src/sqlite-process-store';
import type { TimelineItem } from '../src/ai/process-interfaces';
import { deserializeProcess, serializeProcess } from '../src/ai/process-serialization';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

describe.each(['file', 'sqlite'] as const)('durable steering metadata (%s)', backend => {
    it('preserves correlation, streaming boundaries and finalized history after reopening', async () => {
        const directory = path.resolve('.test-artifacts', `steering-${randomUUID()}`);
        directories.push(directory);
        await fs.mkdir(directory, { recursive: true });
        const open = () => backend === 'file'
            ? new FileProcessStore({ dataDir: directory })
            : new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        let store = open();
        const timestamp = new Date('2026-01-01T00:00:00.000Z');
        const marker: TimelineItem = { type: 'steering', steeringId: 'steer-id', contentOffset: 6, timelineIndex: 2, eventOffset: 1, timestamp };
        const timeline: TimelineItem[] = [
            { type: 'content', content: 'before', timestamp },
            { type: 'tool-start', timestamp, toolCall: { id: 'tool-id', name: 'view', status: 'running', startTime: timestamp, args: {} } },
            marker,
            { type: 'content', content: 'after', timestamp },
        ];
        try {
            await store.addProcess({ id: 'steering', type: 'chat', status: 'running',
                startTime: timestamp, promptPreview: '', metadata: { workspaceId: 'owner' } });
            await store.appendConversationTurn('steering', turnIndex => ({
                role: 'user', content: 'change', timestamp, turnIndex, timeline: [marker],
                optimisticId: 'steer-id', steered: true,
            }));
            await store.upsertStreamingTurn('steering', 'beforeafter', true, timeline);
            const streaming = (await store.getProcess('steering'))!.conversationTurns!;
            expect(streaming[0]).toMatchObject({ optimisticId: 'steer-id', steered: true });
            expect(streaming[1].timeline).toEqual(timeline);
            await store.appendConversationTurn('steering', turnIndex => ({
                role: 'assistant', content: 'beforeafter', timestamp, turnIndex, timeline,
                provider: 'copilot', segmentId: 'segment',
            }), { filterStreaming: true });
            if (store instanceof SqliteProcessStore) store.close();
            store = open();
            const process = (await store.getProcess('steering'))!;
            expect(process.conversationTurns).toHaveLength(2);
            expect(process.conversationTurns![0]).toMatchObject({ optimisticId: 'steer-id', steered: true });
            expect(process.conversationTurns![1]).toMatchObject({ timeline, provider: 'copilot', segmentId: 'segment' });
            const history = await store.getProcessHistory('steering', 'owner', { limit: 30 });
            expect(history!.page.turns[1].timeline).toEqual(timeline);
            if (store instanceof SqliteProcessStore) {
                const turns = await store.getConversationTurns('steering');
                expect(turns![0]).toMatchObject({ optimisticId: 'steer-id', steered: true });
                expect(turns![1].timeline).toEqual(timeline);
            }
            const roundTrip = deserializeProcess(JSON.parse(JSON.stringify(serializeProcess(process))));
            expect(roundTrip.conversationTurns![0]).toMatchObject({ optimisticId: 'steer-id', steered: true });
            expect(roundTrip.conversationTurns![1].timeline).toEqual(timeline);
        } finally {
            if (store instanceof SqliteProcessStore) store.close();
        }
    });
});
