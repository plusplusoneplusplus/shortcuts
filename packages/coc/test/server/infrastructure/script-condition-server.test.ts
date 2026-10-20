import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../../src/server/index';
import type { ExecutionServer } from '../../../src/server/types';
import type { Trigger } from '../../../src/server/triggers/trigger-types';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

describe('script-condition server composition', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let store: SqliteProcessStore;

    afterEach(async () => {
        await server?.close();
        store?.close();
        if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    });

    it('enables owner REST authoring after startup and runs the actual owner tool without a provider turn', async () => {
        dataDir = mkdtempSync(join(tmpdir(), 'script-server-'));
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        const sdk = createMockSDKService();
        server = await createExecutionServer({
            dataDir, store, port: 0, host: '127.0.0.1', configPath: join(dataDir, 'config.yaml'),
            fileConfig: { sentinel: { enabled: true }, features: { sentinelTodoScriptTriggers: true, toolScripting: true } },
            aiService: sdk.service, queue: { autoStart: false },
            nativeCopilotSessionDbPath: join(dataDir, 'native-sessions.db'),
            nativeCopilotSessionStateDir: join(dataDir, 'native-state'),
        });
        vi.mocked(sdk.service.sendMessage).mockClear();
        const owner = { workspaceId: 'workspace-script', processId: 'sentinel-script' };
        await store.registerWorkspace({ id: owner.workspaceId, name: 'Script fixture', rootPath: dataDir });
        await store.addProcess({
            id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: '', metadata: { workspaceId: owner.workspaceId, mode: 'sentinel' },
        });
        const root = `/api/workspaces/${owner.workspaceId}/sentinel-todos/${owner.processId}`;
        const request = async (path: string, body?: unknown) => {
            const response = await fetch(`${server!.url}${path}`, {
                method: body === undefined ? 'GET' : 'POST',
                headers: { 'content-type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            });
            const result = await response.json();
            expect(response.ok, JSON.stringify(result)).toBe(true);
            return result;
        };
        expect(await request(`${root}/triggers/capabilities`)).toMatchObject({ scriptCondition: true });
        const first = await request(`${root}/items`, { title: 'Watch readiness', completionCondition: 'Ready' });
        const { trigger: initial } = await request(`${root}/triggers`, {
            itemId: first.item.id,
            event: {
                type: 'script-condition', intervalMs: 300_000,
                script: 'const ledger = await tools.sentinel_todos({ action: "list" }); return { count: ledger.items.length };',
            },
        });
        const run = async (rule: Trigger): Promise<Trigger> => (await request(`${root}/triggers/${rule.id}/run-now`, {
            expectedRevision: rule.revision, confirmed: true,
        })).trigger;
        const baseline = await run(initial);
        expect(baseline.event).toMatchObject({ lastResult: '{"count":1}', consecutiveFailures: 0 });
        expect(baseline.delivery).toBeUndefined();
        await request(`${root}/items`, { title: 'Another item', completionCondition: 'Ready' });
        const changed = await run(baseline);
        expect(changed).toMatchObject({
            status: 'active', event: { lastResult: '{"count":2}', consecutiveFailures: 0 },
            delivery: { state: 'delivered', reason: 'script-changed' },
        });
        const unchanged = await run(changed);
        expect(unchanged.delivery).toEqual(changed.delivery);
        expect(sdk.service.sendMessage).not.toHaveBeenCalled();
    });
});
