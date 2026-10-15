import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createExecutionServer } from '../../../src/server/index';
import { createQueueInfrastructure } from '../../../src/server/infrastructure/queue-infrastructure';
import { buildMcpOAuthHandler } from '../../../src/server/executors/chat-turn-runner';
import type { ExecutorRuntimeCapabilities } from '../../../src/server/executors/executor-runtime-contracts';
import { createMockProcessStore } from '../../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

vi.mock('../../../src/server/infrastructure/queue-infrastructure', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../src/server/infrastructure/queue-infrastructure')>();
    return { ...actual, createQueueInfrastructure: vi.fn(actual.createQueueInfrastructure) };
});

describe('generic MCP OAuth at server startup', () => {
    it.each([
        { label: 'explicitly disabled', fileConfig: { mcpOauth: { enabled: false } }, callbackEnabled: false },
        { label: 'omitted (default disabled)', fileConfig: {}, callbackEnabled: false },
        { label: 'explicitly enabled', fileConfig: { mcpOauth: { enabled: true } }, callbackEnabled: true },
    ])('keeps the shared lifecycle but gates the chat callback when $label', async ({ fileConfig, callbackEnabled }) => {
        const dataDir = await mkdtemp(join(tmpdir(), 'mcp-oauth-gate-'));
        const sdk = createMockSDKService();
        let server: Awaited<ReturnType<typeof createExecutionServer>> | undefined;
        vi.mocked(createQueueInfrastructure).mockClear();
        try {
            server = await createExecutionServer({
                host: '127.0.0.1', port: 0, dataDir, fileConfig,
                aiService: sdk.service, queue: { autoStart: false },
            });
            const queueInfra = vi.mocked(createQueueInfrastructure).mock.results[0]?.value;
            expect(queueInfra).toBeDefined();
            const runtime = (queueInfra?.bridge as unknown as {
                defaultOptions: { runtime: ExecutorRuntimeCapabilities };
            }).defaultOptions.runtime;
            const getManager = runtime.getMcpOauthManager;
            expect(getManager).toBeTypeOf('function');
            const handler = buildMcpOAuthHandler({
                store: createMockProcessStore(), processId: 'probe',
                originalMessage: 'connect', manager: getManager?.(), logLabel: 'probe',
            });
            expect(typeof handler === 'function').toBe(callbackEnabled);

            const pending = await fetch(`${server.url}/api/mcp-oauth/pending`);
            expect(pending.status).toBe(200);
            expect(await pending.json()).toEqual({ items: [] });
        } finally {
            await server?.close();
            await rm(dataDir, { recursive: true, force: true });
        }
    });
});
