/**
 * Global Admin System Prompt — Background Structured-Job Exclusions (AC-05)
 *
 * AC-05 is the complement of AC-03: the admin-configured global system prompt
 * must reach *user-facing* agent sessions, but it must NEVER leak into the
 * strict, background, structured jobs that own their entire system message via
 * `mode: 'replace'` (or run through the isolated `transform` boundary). Those
 * jobs ship a precise output contract to the model; an operator-wide free-text
 * instruction would corrupt the JSON/contract they depend on.
 *
 * The four background paths the journal enumerates:
 *   1. For Each plan generation      — sendMessage, mode: 'replace'
 *   2. Map Reduce plan generation    — sendMessage, mode: 'replace'
 *   3. Dream internal analyzer/critic — sendMessage, mode: 'replace'
 *   4. AI title generation           — transform (no systemMessage at all)
 *
 * Two layers of guard:
 *   - Behavioural: drive each path with a spy SDK service and assert the
 *     `systemMessage` is `mode: 'replace'` and its content carries NONE of the
 *     labeled global block (`<admin-global-system-prompt>`).
 *   - Structural regression: assert the source of all four paths never wires in
 *     the global-prompt seam (`appendGlobalSystemPrompt` /
 *     `resolveGlobalSystemPrompt` / `getGlobalSystemPrompt` / the block tag), so
 *     a future change cannot quietly opt them in.
 *
 * The positive AC-03 coverage lives in `global-prompt-structured-paths.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createForEachPlanGenerator } from '../../../src/server/for-each/for-each-plan-generator';
import { createMapReducePlanGenerator } from '../../../src/server/map-reduce/map-reduce-plan-generator';
import { DreamInternalProcessExecutor } from '../../../src/server/executors/dream-internal-process-executor';
import { GLOBAL_SYSTEM_PROMPT_TAG } from '../../../src/server/executors/system-message-builder';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

/** The labeled wrapper any global-prompt injection would introduce. */
const GLOBAL_BLOCK_MARKER = `<${GLOBAL_SYSTEM_PROMPT_TAG}>`;

const FOR_EACH_PLAN = {
    items: [
        { id: 'item-1', title: 'Audit', prompt: 'Inspect the implementation.', status: 'pending' },
    ],
};
const MAP_REDUCE_PLAN = {
    maxParallel: 4,
    reduceInstructions: 'Combine outputs into a concise summary.',
    items: [
        { id: 'item-1', title: 'Audit', prompt: 'Inspect the implementation.', status: 'pending' },
    ],
};

/** Read the first `sendMessage` call's options off a spy SDK service. */
function firstSendMessage(service: { sendMessage: unknown }): { systemMessage?: { mode: string; content: string } } {
    return (service.sendMessage as { mock: { calls: unknown[][] } }).mock.calls[0][0] as {
        systemMessage?: { mode: string; content: string };
    };
}

describe('global admin system prompt — background structured-job exclusions (AC-05)', () => {
    // ------------------------------------------------------------------
    // For Each plan generation
    // ------------------------------------------------------------------
    describe('For Each plan generator', () => {
        it('uses mode: replace and never carries the global block', async () => {
            const { service } = createMockSDKService({
                sendMessageResponse: { success: true, response: JSON.stringify(FOR_EACH_PLAN) },
            });
            const { generateItemPlan } = createForEachPlanGenerator({ aiService: service });

            await generateItemPlan({
                workspaceId: 'ws-test',
                prompt: 'Split this feature',
                childMode: 'ask',
            });

            const call = firstSendMessage(service);
            expect(call.systemMessage?.mode).toBe('replace');
            // Owns its full contract; no supplementary operator block.
            expect(call.systemMessage?.content).toContain('STRICT OUTPUT CONTRACT');
            expect(call.systemMessage?.content ?? '').not.toContain(GLOBAL_BLOCK_MARKER);
            expect(call.systemMessage?.content ?? '').not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
        });
    });

    // ------------------------------------------------------------------
    // Map Reduce plan generation
    // ------------------------------------------------------------------
    describe('Map Reduce plan generator', () => {
        it('uses mode: replace and never carries the global block', async () => {
            const { service } = createMockSDKService({
                sendMessageResponse: { success: true, response: JSON.stringify(MAP_REDUCE_PLAN) },
            });
            const { generatePlan } = createMapReducePlanGenerator({ aiService: service });

            await generatePlan({
                workspaceId: 'ws-test',
                prompt: 'Split this feature',
                childMode: 'ask',
            });

            const call = firstSendMessage(service);
            expect(call.systemMessage?.mode).toBe('replace');
            expect(call.systemMessage?.content).toContain('reduceInstructions');
            expect(call.systemMessage?.content ?? '').not.toContain(GLOBAL_BLOCK_MARKER);
            expect(call.systemMessage?.content ?? '').not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
        });
    });

    // ------------------------------------------------------------------
    // Dream internal analyzer/critic
    // ------------------------------------------------------------------
    describe('Dream internal process executor', () => {
        it('replaces the system message with only the dream prompt — no global block', async () => {
            const store = createMockProcessStore();
            const { service } = createMockSDKService({
                sendMessageResponse: {
                    success: true,
                    response: JSON.stringify({ candidates: [] }),
                    effectiveModel: 'claude-sonnet-4.6',
                },
            });
            const executor = new DreamInternalProcessExecutor({ store, aiService: service, provider: 'claude' });

            const dreamSystemPrompt = 'You are the CoC Dream analyzer.';
            await executor.runStep({
                purpose: 'analyzer',
                workspaceId: 'ws-dream-process',
                runId: 'dream-run-1',
                prompt: 'Analyze these conversations.',
                systemPrompt: dreamSystemPrompt,
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                timeoutMs: 45_000,
            });

            const call = firstSendMessage(service);
            expect(call.systemMessage?.mode).toBe('replace');
            // The dream prompt is the WHOLE system message — nothing appended.
            expect(call.systemMessage?.content).toBe(dreamSystemPrompt);
            expect(call.systemMessage?.content ?? '').not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
        });
    });

    // ------------------------------------------------------------------
    // AI title generation (transform boundary — no systemMessage at all)
    // ------------------------------------------------------------------
    describe('title generator', () => {
        it('routes through the isolated transform boundary, never sendMessage', () => {
            const source = fs.readFileSync(
                path.join(__dirname, '..', '..', '..', 'src', 'server', 'executors', 'title-generator.ts'),
                'utf-8',
            );
            expect(source).toContain('this.options.aiService.transform(');
            // No system-message channel exists here, so the global block cannot reach it.
            expect(source).not.toContain('.sendMessage(');
        });
    });

    // ------------------------------------------------------------------
    // Structural regression guard — none of the background paths may wire in
    // the global-prompt seam in the future without tripping this test.
    // ------------------------------------------------------------------
    describe('source regression guard', () => {
        const SRC = path.join(__dirname, '..', '..', '..', 'src', 'server');
        const FORBIDDEN = [
            'appendGlobalSystemPrompt',
            'resolveGlobalSystemPrompt',
            'getGlobalSystemPrompt',
            'GLOBAL_SYSTEM_PROMPT_TAG',
            'admin-global-system-prompt',
        ];
        const BACKGROUND_PATHS: Array<[string, string]> = [
            ['For Each plan generator', path.join(SRC, 'for-each', 'for-each-plan-generator.ts')],
            ['Map Reduce plan generator', path.join(SRC, 'map-reduce', 'map-reduce-plan-generator.ts')],
            ['Dream internal process executor', path.join(SRC, 'executors', 'dream-internal-process-executor.ts')],
            ['Title generator', path.join(SRC, 'executors', 'title-generator.ts')],
        ];

        it.each(BACKGROUND_PATHS)('%s never references the global system prompt seam', (_name, file) => {
            const source = fs.readFileSync(file, 'utf-8');
            for (const token of FORBIDDEN) {
                expect(source).not.toContain(token);
            }
        });
    });
});
