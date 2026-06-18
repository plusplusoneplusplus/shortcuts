/**
 * Global system prompt — multi-repo invariants (AC-06)
 *
 * Two invariants make the admin-configured global system prompt *operator-wide*
 * rather than per-repo:
 *
 *  1. Router propagation — `MultiRepoQueueRouter` carries the live
 *     `getGlobalSystemPrompt` callback in its `defaultOptions` and spreads it
 *     into EVERY per-repo `QueueExecutorBridge`. So all repos read the same
 *     callback, resolve to the same value, and pick up live admin edits without
 *     recreating any bridge.
 *
 *  2. Composition with per-repo instructions — the global block is appended via
 *     `appendGlobalSystemPrompt()` BEFORE `withRepoInstructions()` loads the
 *     per-repo `.github/coc` guidance (the chain order shared by every
 *     interactive builder). The per-repo `.github/coc` content differs across
 *     repos, but the global block is byte-identical everywhere.
 *
 * These guard the contract that the global prompt is the SAME for every
 * workspace while `.github/coc` instructions stay repo-scoped.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { RepoQueueRegistry } from '@plusplusoneplusplus/forge';

import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { createMockProcessStore } from '../../helpers/mock-process-store';

const sdkMocks = createMockSDKService();
const mockLoadInstructions = vi.fn();

// One module mock serves both layers: `sdkServiceRegistry` for the real
// `createQueueExecutorBridge` path (router layer) and `loadInstructions` for
// the per-repo `.github/coc` composition (builder layer).
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
        loadInstructions: (...args: any[]) => mockLoadInstructions(...args),
    };
});

import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import * as queueExecutorBridgeMod from '../../../src/server/queue/queue-executor-bridge';
import {
    systemMessageBuilder,
    buildGlobalSystemPromptBlock,
    GLOBAL_SYSTEM_PROMPT_TAG,
} from '../../../src/server/executors/system-message-builder';

type CapturedOptions = { getGlobalSystemPrompt?: () => string | undefined };

function captureBridgeOptions(callIndex: number, spy: ReturnType<typeof vi.spyOn>): CapturedOptions {
    return spy.mock.calls[callIndex][2] as CapturedOptions;
}

describe('Global system prompt — multi-repo invariants (AC-06)', () => {
    beforeEach(() => {
        sdkMocks.resetAll();
        mockLoadInstructions.mockReset();
    });

    // ------------------------------------------------------------------
    // Router propagation — same operator-wide callback for every repo
    // ------------------------------------------------------------------

    describe('router propagates the operator-wide prompt to every per-repo bridge', () => {
        it('passes the SAME getGlobalSystemPrompt callback to every per-repo bridge', () => {
            const getGlobalSystemPrompt = () => 'Cite all sources.';
            const router = new MultiRepoQueueRouter(
                new RepoQueueRegistry(),
                createMockProcessStore(),
                { autoStart: false, getGlobalSystemPrompt },
            );
            const spy = vi.spyOn(queueExecutorBridgeMod, 'createQueueExecutorBridge');

            router.getOrCreateBridge('/repo/a');
            router.getOrCreateBridge('/repo/b');

            expect(spy).toHaveBeenCalledTimes(2);
            const optsA = captureBridgeOptions(0, spy);
            const optsB = captureBridgeOptions(1, spy);

            // Identical callback reference reaches every repo's bridge.
            expect(optsA.getGlobalSystemPrompt).toBe(getGlobalSystemPrompt);
            expect(optsB.getGlobalSystemPrompt).toBe(getGlobalSystemPrompt);
            // ...and resolves to the same operator-wide value, not a per-repo one.
            expect(optsA.getGlobalSystemPrompt!()).toBe('Cite all sources.');
            expect(optsB.getGlobalSystemPrompt!()).toBe('Cite all sources.');

            spy.mockRestore();
            router.dispose();
        });

        it('reflects a live admin edit identically across repos without recreating bridges', () => {
            let liveValue: string | undefined = 'Be concise.';
            const router = new MultiRepoQueueRouter(
                new RepoQueueRegistry(),
                createMockProcessStore(),
                { autoStart: false, getGlobalSystemPrompt: () => liveValue },
            );
            const spy = vi.spyOn(queueExecutorBridgeMod, 'createQueueExecutorBridge');

            router.getOrCreateBridge('/repo/a');
            router.getOrCreateBridge('/repo/b');
            const optsA = captureBridgeOptions(0, spy);
            const optsB = captureBridgeOptions(1, spy);

            expect(optsA.getGlobalSystemPrompt!()).toBe('Be concise.');
            expect(optsB.getGlobalSystemPrompt!()).toBe('Be concise.');

            // Admin edits the prompt live (RuntimeConfigService updates in place).
            liveValue = 'Always cite sources.';
            expect(optsA.getGlobalSystemPrompt!()).toBe('Always cite sources.');
            expect(optsB.getGlobalSystemPrompt!()).toBe('Always cite sources.');

            // Admin clears it → both repos go inert together.
            liveValue = undefined;
            expect(optsA.getGlobalSystemPrompt!()).toBeUndefined();
            expect(optsB.getGlobalSystemPrompt!()).toBeUndefined();

            spy.mockRestore();
            router.dispose();
        });

        it('passes undefined to every bridge when no global prompt is configured (inert default)', () => {
            const router = new MultiRepoQueueRouter(
                new RepoQueueRegistry(),
                createMockProcessStore(),
                { autoStart: false },
            );
            const spy = vi.spyOn(queueExecutorBridgeMod, 'createQueueExecutorBridge');

            router.getOrCreateBridge('/repo/a');
            router.getOrCreateBridge('/repo/b');

            expect(captureBridgeOptions(0, spy).getGlobalSystemPrompt).toBeUndefined();
            expect(captureBridgeOptions(1, spy).getGlobalSystemPrompt).toBeUndefined();

            spy.mockRestore();
            router.dispose();
        });

        it('keeps getGlobalSystemPrompt on bridges created after clearInitialDelay / setResolveDefaultProvider', () => {
            const getGlobalSystemPrompt = () => 'Operator rule.';
            const router = new MultiRepoQueueRouter(
                new RepoQueueRegistry(),
                createMockProcessStore(),
                { autoStart: false, initialDelayMs: 30000, getGlobalSystemPrompt },
            );
            const spy = vi.spyOn(queueExecutorBridgeMod, 'createQueueExecutorBridge');

            // These methods rebuild defaultOptions via spread; the global prompt
            // must survive so later repos still receive it.
            router.clearInitialDelay();
            router.setResolveDefaultProvider((() => undefined) as any);

            router.getOrCreateBridge('/repo/late');

            const opts = captureBridgeOptions(0, spy);
            expect(opts.getGlobalSystemPrompt).toBe(getGlobalSystemPrompt);
            expect(opts.getGlobalSystemPrompt!()).toBe('Operator rule.');

            spy.mockRestore();
            router.dispose();
        });
    });

    // ------------------------------------------------------------------
    // Composition with per-repo .github/coc instructions
    // ------------------------------------------------------------------

    describe('global block composes with per-repo .github/coc instructions', () => {
        it('includes both the global block and per-repo instructions, global block first', async () => {
            mockLoadInstructions.mockResolvedValue('REPO-A .github/coc instructions');

            const result = await systemMessageBuilder()
                .append('Mode block.')
                .appendGlobalSystemPrompt('Always cite sources.')
                .withRepoInstructions('/repo/a', 'ask')
                .build();

            expect(result?.content).toContain(`<${GLOBAL_SYSTEM_PROMPT_TAG}>`);
            expect(result?.content).toContain('Always cite sources.');
            expect(result?.content).toContain('REPO-A .github/coc instructions');

            // Chain order: the global block is appended before repo instructions.
            const globalIdx = result!.content.indexOf(`<${GLOBAL_SYSTEM_PROMPT_TAG}>`);
            const repoIdx = result!.content.indexOf('REPO-A .github/coc instructions');
            expect(globalIdx).toBeGreaterThanOrEqual(0);
            expect(globalIdx).toBeLessThan(repoIdx);

            expect(mockLoadInstructions).toHaveBeenCalledWith('/repo/a', expect.anything());
        });

        it('emits a byte-identical global block across repos with different .github/coc instructions', async () => {
            const globalPrompt = 'Operator-wide rule for every workspace.';
            const expectedBlock = buildGlobalSystemPromptBlock(globalPrompt)!;

            mockLoadInstructions.mockResolvedValue('REPO-A instructions');
            const a = await systemMessageBuilder()
                .appendGlobalSystemPrompt(globalPrompt)
                .withRepoInstructions('/repo/a', 'ask')
                .build();

            mockLoadInstructions.mockResolvedValue('REPO-B instructions');
            const b = await systemMessageBuilder()
                .appendGlobalSystemPrompt(globalPrompt)
                .withRepoInstructions('/repo/b', 'ralph')
                .build();

            // Per-repo `.github/coc` content is repo-scoped and therefore differs.
            expect(a?.content).toContain('REPO-A instructions');
            expect(a?.content).not.toContain('REPO-B instructions');
            expect(b?.content).toContain('REPO-B instructions');
            expect(b?.content).not.toContain('REPO-A instructions');

            // ...but the global block is operator-wide: byte-identical everywhere.
            expect(a?.content).toContain(expectedBlock);
            expect(b?.content).toContain(expectedBlock);
        });

        it('leaves only per-repo instructions when the global prompt is unset (inert default)', async () => {
            mockLoadInstructions.mockResolvedValue('REPO-A instructions');

            const result = await systemMessageBuilder()
                .appendGlobalSystemPrompt(undefined)
                .withRepoInstructions('/repo/a', 'ask')
                .build();

            expect(result?.content).toBe('REPO-A instructions');
            expect(result?.content).not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
        });
    });
});
