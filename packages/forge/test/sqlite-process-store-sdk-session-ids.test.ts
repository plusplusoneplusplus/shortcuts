/**
 * SqliteProcessStore.getSdkSessionIds Tests
 *
 * Validates the workspace-scoped distinct native SDK session id accessor used
 * to deduplicate the read-only native Copilot CLI session view against
 * sessions already tracked as CoC processes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
    SqliteProcessStore,
    AIProcess,
    AIProcessStatus,
} from '../src/index';

let tmpDir: string;
let store: SqliteProcessStore;

function makeProcess(id: string, workspaceId: string, sdkSessionId?: string): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        status: 'completed' as AIProcessStatus,
        startTime: new Date(),
        metadata: { type: 'ai', workspaceId },
        sdkSessionId,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-sdk-ids-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SqliteProcessStore.getSdkSessionIds', () => {
    it('returns an empty set for a workspace with no processes', () => {
        expect(store.getSdkSessionIds('ws-empty')).toEqual(new Set());
    });

    it('returns distinct sdk session ids scoped to the workspace', async () => {
        await store.addProcess(makeProcess('p1', 'ws-a', 'sess-1'));
        await store.addProcess(makeProcess('p2', 'ws-a', 'sess-2'));
        await store.addProcess(makeProcess('p3', 'ws-b', 'sess-3'));

        expect(store.getSdkSessionIds('ws-a')).toEqual(new Set(['sess-1', 'sess-2']));
        expect(store.getSdkSessionIds('ws-b')).toEqual(new Set(['sess-3']));
    });

    it('deduplicates repeated sdk session ids (e.g. resumed conversations)', async () => {
        await store.addProcess(makeProcess('p1', 'ws-a', 'sess-shared'));
        await store.addProcess(makeProcess('p2', 'ws-a', 'sess-shared'));

        expect(store.getSdkSessionIds('ws-a')).toEqual(new Set(['sess-shared']));
    });

    it('ignores processes with null or empty sdk session ids', async () => {
        await store.addProcess(makeProcess('p1', 'ws-a', undefined));
        await store.addProcess(makeProcess('p2', 'ws-a', ''));
        await store.addProcess(makeProcess('p3', 'ws-a', 'sess-real'));

        expect(store.getSdkSessionIds('ws-a')).toEqual(new Set(['sess-real']));
    });
});
