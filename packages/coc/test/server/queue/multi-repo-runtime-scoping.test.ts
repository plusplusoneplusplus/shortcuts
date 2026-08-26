/**
 * Multi-repo scoping of the shared executor runtime
 *
 * Late-bound capabilities are operator-wide: one object is assembled in the
 * composition layer and shared by identity with every per-repo bridge. Repo
 * identity is NOT part of that object — the working directory and the
 * workspace-id lookup must stay explicit per bridge, or a task queued against
 * one clone would execute against another.
 *
 * These tests run two workspace IDs over two roots at once and assert both
 * halves of that contract: the capabilities are shared, the repo scoping is not.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RepoQueueRegistry } from '@plusplusoneplusplus/forge';

import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { createMockProcessStore } from '../../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import * as bridgeMod from '../../../src/server/queue/queue-executor-bridge';
import type { ExecutorRuntimeCapabilities } from '../../../src/server/executors/executor-runtime-contracts';

// ============================================================================
// Fixtures — two workspaces, two roots
// ============================================================================

const ROOT_A = path.resolve(path.sep, 'repos', 'alpha');
const ROOT_B = path.resolve(path.sep, 'repos', 'beta');
const WS_A = 'ws-alpha';
const WS_B = 'ws-beta';

function makeRuntime(): ExecutorRuntimeCapabilities {
    return {
        getWsServer: vi.fn(() => undefined),
        getCronInfra: vi.fn(() => undefined),
        getGlobalSystemPrompt: vi.fn(() => 'Operator rule.'),
        getEnqueueChat: vi.fn(() => undefined),
    };
}

function makeStore() {
    const store = createMockProcessStore();
    // Two clones registered at once: workspace-id resolution has to pick the
    // right one for each bridge's own root.
    (store as any).getWorkspaces = vi.fn().mockResolvedValue([
        { id: WS_A, rootPath: ROOT_A, name: 'alpha' },
        { id: WS_B, rootPath: ROOT_B, name: 'beta' },
    ]);
    return store;
}

function makeRouter(store: ReturnType<typeof makeStore>, runtime: ExecutorRuntimeCapabilities) {
    const router = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, {
        autoStart: false,
        aiService: sdkMocks.service as any,
        runtime,
    });
    router.registerRepoId(WS_A, ROOT_A);
    router.registerRepoId(WS_B, ROOT_B);
    return router;
}

// ============================================================================
// Tests
// ============================================================================

describe('Multi-repo executor runtime scoping', () => {
    beforeEach(() => {
        sdkMocks.resetAll();
    });

    // ------------------------------------------------------------------
    // Shared capabilities
    // ------------------------------------------------------------------

    it('shares one capability object with both repos, by identity', () => {
        const runtime = makeRuntime();
        const router = makeRouter(makeStore(), runtime);
        const spy = vi.spyOn(bridgeMod, 'createQueueExecutorBridge');

        router.getOrCreateBridge(ROOT_A);
        router.getOrCreateBridge(ROOT_B);

        const optsA = spy.mock.calls[0][2] as { runtime?: ExecutorRuntimeCapabilities };
        const optsB = spy.mock.calls[1][2] as { runtime?: ExecutorRuntimeCapabilities };
        expect(optsA.runtime).toBe(runtime);
        expect(optsB.runtime).toBe(runtime);

        spy.mockRestore();
        router.dispose();
    });

    // ------------------------------------------------------------------
    // Repo scoping stays explicit
    // ------------------------------------------------------------------

    it('gives each repo its own working directory rather than a shared one', () => {
        const router = makeRouter(makeStore(), makeRuntime());
        const spy = vi.spyOn(bridgeMod, 'createQueueExecutorBridge');

        router.getOrCreateBridge(ROOT_A);
        router.getOrCreateBridge(ROOT_B);

        const optsA = spy.mock.calls[0][2] as { workingDirectory?: string };
        const optsB = spy.mock.calls[1][2] as { workingDirectory?: string };
        expect(optsA.workingDirectory).toBe(ROOT_A);
        expect(optsB.workingDirectory).toBe(ROOT_B);
        expect(optsA.workingDirectory).not.toBe(optsB.workingDirectory);

        spy.mockRestore();
        router.dispose();
    });

    it('keeps a distinct bridge per root and resolves each repoId back correctly', () => {
        const router = makeRouter(makeStore(), makeRuntime());

        const bridgeA = router.getOrCreateBridge(ROOT_A);
        const bridgeB = router.getOrCreateBridge(ROOT_B);

        expect(bridgeA).not.toBe(bridgeB);
        expect(router.getOrCreateBridge(ROOT_A)).toBe(bridgeA);
        expect(router.getBridgeByRepoId(WS_A)).toBe(bridgeA);
        expect(router.getBridgeByRepoId(WS_B)).toBe(bridgeB);

        router.dispose();
    });

    it('routes a path to the workspace that owns it, including subdirectories', () => {
        const router = makeRouter(makeStore(), makeRuntime());

        expect(router.getRepoIdForPath(ROOT_A)).toBe(WS_A);
        expect(router.getRepoIdForPath(ROOT_B)).toBe(WS_B);
        expect(router.getRepoIdForPath(path.join(ROOT_A, 'src', 'server'))).toBe(WS_A);
        expect(router.getRepoIdForPath(path.join(ROOT_B, 'packages'))).toBe(WS_B);

        router.dispose();
    });

    // ------------------------------------------------------------------
    // Workspace-id resolution reaches the chat executors per repo
    // ------------------------------------------------------------------

    it('resolves each executor graph to its own workspace id', async () => {
        const router = makeRouter(makeStore(), makeRuntime());
        const spy = vi.spyOn(bridgeMod, 'createQueueExecutorBridge');

        router.getOrCreateBridge(ROOT_A);
        router.getOrCreateBridge(ROOT_B);

        // The resolver each bridge threads into its executors is the bridge's
        // own; it maps a clone root to that clone's workspace id.
        const resolverA = (spy.mock.results[0].value.bridge as any).executors.chatExecutor.resolveWorkspaceIdForPathFn;
        const resolverB = (spy.mock.results[1].value.bridge as any).executors.chatExecutor.resolveWorkspaceIdForPathFn;

        expect(resolverA).not.toBe(resolverB);
        await expect(resolverA(ROOT_A)).resolves.toBe(WS_A);
        await expect(resolverB(ROOT_B)).resolves.toBe(WS_B);
        // Cross-repo lookups are not silently coerced to the local workspace.
        await expect(resolverA(ROOT_B)).resolves.toBe(WS_B);

        spy.mockRestore();
        router.dispose();
    });

    it('shares the capability object while keeping each executor graph clone-scoped', () => {
        const runtime = makeRuntime();
        const router = makeRouter(makeStore(), runtime);
        const spy = vi.spyOn(bridgeMod, 'createQueueExecutorBridge');

        router.getOrCreateBridge(ROOT_A);
        router.getOrCreateBridge(ROOT_B);

        const graphA = (spy.mock.results[0].value.bridge as any).executors.chatExecutor;
        const graphB = (spy.mock.results[1].value.bridge as any).executors.chatExecutor;

        // Same capabilities…
        expect(graphA.runtime.getCronInfra).toBe(runtime.getCronInfra);
        expect(graphB.runtime.getCronInfra).toBe(runtime.getCronInfra);
        expect(graphA.runtime.getGlobalSystemPrompt).toBe(runtime.getGlobalSystemPrompt);
        expect(graphB.runtime.getGlobalSystemPrompt).toBe(runtime.getGlobalSystemPrompt);
        // …different clones.
        expect(graphA.defaultWorkingDirectory).toBe(ROOT_A);
        expect(graphB.defaultWorkingDirectory).toBe(ROOT_B);
        // The abort registry is bridge-owned, so a cancel in one repo cannot
        // reach a turn running in the other.
        expect(graphA.runtime.processAbortControllers)
            .not.toBe(graphB.runtime.processAbortControllers);

        spy.mockRestore();
        router.dispose();
    });
});
