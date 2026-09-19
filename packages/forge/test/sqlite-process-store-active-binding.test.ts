/**
 * Round-trip tests for `activeProviderSession` — the authoritative binding
 * between a conversation and the provider-native session that continues it.
 *
 * The point of storing provider + session id + segment as one value is that
 * they can only ever be written together: no store path may leave a provider
 * paired with a different provider's session id.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
    SqliteProcessStore,
    AIProcess,
    AIProcessStatus,
    ActiveProviderSession,
    serializeProcess,
    deserializeProcess,
} from '../src/index';

let tmpDir: string;
let store: SqliteProcessStore;

function makeProcess(id: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        status: 'running' as AIProcessStatus,
        startTime: new Date(),
        metadata: { type: 'ai', workspaceId: 'ws-test', provider: 'copilot' },
        ...overrides,
    };
}

const binding: ActiveProviderSession = {
    provider: 'codex',
    sessionId: 'codex-session-1',
    segmentId: 'seg-2',
    firstTurnIndex: 4,
    boundAt: '2026-09-19T00:00:00.000Z',
};

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-store-active-binding-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('activeProviderSession persistence', () => {
    it('round-trips a binding written at insert time', async () => {
        await store.addProcess(makeProcess('p1', { activeProviderSession: binding }));

        const loaded = await store.getProcess('p1');
        expect(loaded?.activeProviderSession).toEqual(binding);
    });

    it('round-trips a binding written by updateProcess', async () => {
        await store.addProcess(makeProcess('p2'));
        await store.updateProcess('p2', {
            activeProviderSession: binding,
            sdkSessionId: binding.sessionId,
        });

        const loaded = await store.getProcess('p2');
        expect(loaded?.activeProviderSession).toEqual(binding);
        expect(loaded?.sdkSessionId).toBe('codex-session-1');
    });

    it('leaves pre-binding processes unbound rather than guessing', async () => {
        await store.addProcess(makeProcess('p3', { sdkSessionId: 'legacy-session' }));

        const loaded = await store.getProcess('p3');
        expect(loaded?.activeProviderSession).toBeUndefined();
        expect(loaded?.sdkSessionId).toBe('legacy-session');
    });

    it('keeps the binding readable in list views that skip heavy columns', async () => {
        await store.addProcess(makeProcess('p4', { activeProviderSession: binding }));

        const listed = await store.getAllProcesses({ workspaceId: 'ws-test', exclude: ['conversation'] });
        expect(listed.find(p => p.id === 'p4')?.activeProviderSession).toEqual(binding);
    });

    it('moves the binding session id when only the compatibility projection is written', async () => {
        await store.addProcess(makeProcess('p5', {
            activeProviderSession: binding,
            sdkSessionId: binding.sessionId,
        }));

        // A settle path that still writes `sdkSessionId` alone must not leave
        // the binding naming Codex with the previous Codex session.
        await store.updateProcess('p5', { sdkSessionId: 'codex-session-2' });

        const loaded = await store.getProcess('p5');
        expect(loaded?.sdkSessionId).toBe('codex-session-2');
        expect(loaded?.activeProviderSession).toEqual({
            ...binding,
            sessionId: 'codex-session-2',
        });
    });

    it('does not invent a binding when a projection-only write hits an unbound process', async () => {
        await store.addProcess(makeProcess('p6'));
        await store.updateProcess('p6', { sdkSessionId: 'copilot-1' });

        const loaded = await store.getProcess('p6');
        expect(loaded?.activeProviderSession).toBeUndefined();
        expect(loaded?.sdkSessionId).toBe('copilot-1');
    });

    it('does not copy the source binding into a fork', async () => {
        await store.addProcess(makeProcess('p7', {
            activeProviderSession: binding,
            sdkSessionId: binding.sessionId,
        }));

        const forked = await store.forkProcess('p7', 'p7-fork', 'fork-session-1');

        expect(forked.activeProviderSession).toBeUndefined();
        const reloaded = await store.getProcess('p7-fork');
        expect(reloaded?.activeProviderSession).toBeUndefined();
        // The source keeps its own binding.
        expect((await store.getProcess('p7'))?.activeProviderSession).toEqual(binding);
    });

    it('survives serialize/deserialize for the file store', () => {
        const process = makeProcess('p8', { activeProviderSession: binding });
        const restored = deserializeProcess(serializeProcess(process));
        expect(restored.activeProviderSession).toEqual(binding);
    });

    it('serializes an unbound process without inventing a binding', () => {
        const restored = deserializeProcess(serializeProcess(makeProcess('p9')));
        expect(restored.activeProviderSession).toBeUndefined();
    });
});
