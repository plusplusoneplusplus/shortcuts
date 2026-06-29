/**
 * Wiring coverage: the CodexSDKService must pass the resolved native-binary path
 * to the `Codex` constructor as `codexPathOverride`, so packaged desktop builds
 * spawn the unpacked binary instead of the unspawnable `app.asar` path.
 *
 * The resolver itself is covered by test/codex-exec-path.test.ts; here we mock it
 * to a fixed value and assert it flows into the constructor options alongside any
 * per-request `config`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const FAKE_OVERRIDE = '/Applications/CoC.app/Contents/Resources/app.asar.unpacked/codex';

vi.mock('../../src/codex-exec-path', () => ({
    resolveCodexExecutablePath: () => FAKE_OVERRIDE,
}));

import { CodexSDKService } from '../../src/codex-sdk-service';
import { cocToolBridgeServer } from '../../src/llm-tools/bridge-server';
import type { Tool } from '../../src/types';

function makeThread() {
    return {
        id: 'thread-1',
        runStreamed: vi.fn(async () => ({
            events: (async function* () {
                yield { type: 'thread.started' as const, thread_id: 'thread-1' };
                yield { type: 'item.completed' as const, item: { id: 'i1', type: 'agent_message', text: 'ok' } };
            })(),
        })),
    };
}

function makeCodexCtor() {
    const instances: Array<{ options: unknown }> = [];
    const ctor = vi.fn(function (this: unknown, options?: unknown) {
        instances.push({ options });
        return { startThread: vi.fn(() => makeThread()), resumeThread: vi.fn(() => makeThread()) };
    }) as unknown as new (options?: unknown) => unknown;
    return { ctor, instances };
}

function tool(name: string): Tool<any> {
    return {
        name,
        description: `desc ${name}`,
        parameters: { type: 'object', properties: {} },
        handler: vi.fn(async () => 'ok'),
    } as Tool<any>;
}

describe('CodexSDKService codexPathOverride wiring', () => {
    let svc: CodexSDKService | undefined;

    afterEach(() => {
        svc?.dispose();
        svc = undefined;
        cocToolBridgeServer.closeAll();
    });

    it('injects codexPathOverride into a per-request client and preserves config', async () => {
        svc = new CodexSDKService();
        const { ctor, instances } = makeCodexCtor();
        (svc as unknown as { sdk: unknown }).sdk = {
            startThread: vi.fn(() => makeThread()),
            resumeThread: vi.fn(),
        };
        (svc as unknown as { codexCtor: unknown }).codexCtor = ctor;
        (svc as unknown as { availabilityCache: unknown }).availabilityCache = { available: true };

        // Supplying tools forces a fresh per-request client carrying mcp_servers.
        const result = await svc.sendMessage({ prompt: 'hi', tools: [tool('ask_user')] });
        expect(result.success).toBe(true);

        expect(instances).toHaveLength(1);
        const built = instances[0].options as {
            codexPathOverride?: string;
            config?: { mcp_servers?: Record<string, unknown> };
        };
        expect(built.codexPathOverride).toBe(FAKE_OVERRIDE);
        expect(built.config?.mcp_servers).toBeDefined();
    });
});
