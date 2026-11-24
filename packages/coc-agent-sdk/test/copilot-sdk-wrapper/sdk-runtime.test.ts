import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createSdkClient, findCopilotSdkRuntimePath } from '../../src/sdk-client-factory';
import { defineTool, type ToolResultObject } from '../../src/types';

vi.mock('../../src/trusted-folder', () => ({ ensureFolderTrusted: vi.fn() }));
vi.mock('../../src/sdk-esm-loader', async () => {
    const sdk = await import('@github/copilot-sdk');
    return { getCachedCopilotSdk: () => sdk };
});

it('executes tools and resumes sessions with the pinned out-of-process SDK runtime', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'coc-sdk-runtime-'));
    const clients: ReturnType<typeof createSdkClient>[] = [];
    try {
        const runtime = findCopilotSdkRuntimePath();
        expect(runtime).toBeDefined();
        const result: ToolResultObject = {
            textResultForLlm: 'fixture-success',
            resultType: 'success',
            toolTelemetry: { fixture: { count: 1, nested: { enabled: true }, values: [null, 'ok'] } },
        };
        const config = {
            model: 'fixture-model',
            provider: { type: 'openai' as const, baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture' },
            onPermissionRequest: () => ({ kind: 'approved' as const }),
            availableTools: ['fixture_tool'],
            tools: [defineTool('fixture_tool', { handler: () => result })],
            mcpServers: {},
        };
        let sessionId: string | undefined;
        for (const resume of [false, true]) {
            const client = createSdkClient({
                mode: 'empty',
                useLoggedInUser: false,
                workingDirectory: root,
                baseDirectory: path.join(root, 'sessions'),
                env: { COPILOT_HOME: path.join(root, 'home') },
            });
            clients.push(client);
            expect(client).not.toBe(clients.at(-2));
            await client.start();
            expect(await client.ping('fixture')).toMatchObject({ message: 'pong: fixture' });
            const session = resume
                ? await client.resumeSession(sessionId!, config)
                : await client.createSession(config);
            if (resume) expect(session.sessionId).toBe(sessionId);
            sessionId = session.sessionId;
            await session.rpc.tools.initializeAndValidate();
            expect((await session.rpc.tools.getCurrentMetadata()).tools.map(tool => tool.name))
                .toEqual(['fixture_tool']);
            expect(await session.rpc.tools.execute({ name: 'fixture_tool', arguments: {} }))
                .toMatchObject({ textResultForLlm: 'fixture-success', resultType: 'success' });
            await session.disconnect();
            expect(await client.stop()).toEqual([]);
        }
    } finally {
        await Promise.all(clients.map(client => client.stop()));
        await rm(root, { recursive: true, force: true });
    }
}, 30000);
