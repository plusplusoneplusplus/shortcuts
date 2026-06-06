import { describe, expect, it } from 'vitest';
import {
    buildMapReducePlanPrompt,
    createMapReducePlanGenerator,
    parseMapReducePlanResponse,
} from '../../src/server/map-reduce/map-reduce-plan-generator';
import { DEFAULT_MAP_REDUCE_MAX_PARALLEL } from '../../src/server/map-reduce/types';
import { createMockSDKService, createFailingMock } from '../helpers/mock-sdk-service';

const VALID_PLAN = {
    maxParallel: 4,
    reduceInstructions: 'Combine every map item output into a concise implementation summary with risks.',
    items: [
        {
            id: 'item-1',
            title: 'Audit server',
            prompt: 'Inspect the server implementation and report required changes.',
            status: 'pending',
            metadata: { area: 'server' },
        },
        {
            id: 'item-2',
            title: 'Audit client',
            prompt: 'Inspect the client implementation and report required changes.',
            dependsOn: ['item-1'],
            status: 'pending',
        },
    ],
};

describe('parseMapReducePlanResponse', () => {
    it('parses a valid Map Reduce plan including reduce instructions', () => {
        const plan = parseMapReducePlanResponse(JSON.stringify(VALID_PLAN));
        expect(plan.items).toHaveLength(2);
        expect(plan.items[0]).toMatchObject({
            id: 'item-1',
            title: 'Audit server',
            status: 'pending',
        });
        expect(plan.items[1].dependsOn).toEqual(['item-1']);
        expect(plan.reduceInstructions).toContain('implementation summary');
        expect(plan.maxParallel).toBe(4);
    });

    it('strips JSON code fences', () => {
        const plan = parseMapReducePlanResponse(`\`\`\`json\n${JSON.stringify(VALID_PLAN)}\n\`\`\``);
        expect(plan.items).toHaveLength(2);
        expect(plan.reduceInstructions).toContain('implementation summary');
    });

    it('uses the default maxParallel when the AI omits it', () => {
        const { maxParallel: _maxParallel, ...planWithoutMaxParallel } = VALID_PLAN;
        const plan = parseMapReducePlanResponse(JSON.stringify(planWithoutMaxParallel));
        expect(plan.maxParallel).toBe(DEFAULT_MAP_REDUCE_MAX_PARALLEL);
    });

    it('rejects non-JSON output with an actionable error', () => {
        expect(() => parseMapReducePlanResponse('Here are some tasks.')).toThrow(/non-JSON Map Reduce plan/i);
    });

    it('rejects missing reduce instructions', () => {
        expect(() => parseMapReducePlanResponse(JSON.stringify({
            items: VALID_PLAN.items,
        }))).toThrow(/reduceInstructions is required/i);
    });

    it('rejects missing required item fields', () => {
        expect(() => parseMapReducePlanResponse(JSON.stringify({
            reduceInstructions: 'Aggregate outputs.',
            items: [{ id: 'item-1', title: 'Missing prompt', status: 'pending' }],
        }))).toThrow(/prompt is required/i);
    });

    it('rejects non-pending initial statuses', () => {
        expect(() => parseMapReducePlanResponse(JSON.stringify({
            reduceInstructions: 'Aggregate outputs.',
            items: [{ id: 'item-1', title: 'Task', prompt: 'Do it', status: 'running' }],
        }))).toThrow(/initial status 'pending'/i);
    });

    it('rejects unknown dependencies', () => {
        expect(() => parseMapReducePlanResponse(JSON.stringify({
            reduceInstructions: 'Aggregate outputs.',
            items: [{ id: 'item-1', title: 'Task', prompt: 'Do it', status: 'pending', dependsOn: ['missing'] }],
        }))).toThrow(/unknown item/i);
    });
});

describe('buildMapReducePlanPrompt', () => {
    it('includes original request, child mode, default parallelism, and shared instructions', () => {
        const prompt = buildMapReducePlanPrompt({
            workspaceId: 'ws-test',
            prompt: 'Split and summarize this research',
            childMode: 'autopilot',
            sharedInstructions: 'Keep outputs source-linked.',
        });
        expect(prompt).toContain('Split and summarize this research');
        expect(prompt).toContain('autopilot');
        expect(prompt).toContain(`Default max parallel map items: ${DEFAULT_MAP_REDUCE_MAX_PARALLEL}`);
        expect(prompt).toContain('Keep outputs source-linked');
    });
});

describe('createMapReducePlanGenerator', () => {
    it('calls the selected AI service with model, reasoning effort, and the Map Reduce system prompt', async () => {
        const defaultService = createMockSDKService({
            sendMessageResponse: { success: true, response: JSON.stringify(VALID_PLAN) },
        }).service;
        const selectedService = createMockSDKService({
            sendMessageResponse: { success: true, response: JSON.stringify(VALID_PLAN) },
        }).service;
        const { generatePlan } = createMapReducePlanGenerator({
            aiService: defaultService,
            resolveAiServiceForProvider: () => selectedService,
        });

        const plan = await generatePlan({
            workspaceId: 'ws-test',
            prompt: 'Split this feature',
            childMode: 'ask',
            provider: 'claude',
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
        });

        expect(plan.items).toHaveLength(2);
        expect(plan.reduceInstructions).toContain('implementation summary');
        expect((selectedService.sendMessage as any).mock.calls[0][0]).toMatchObject({
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            systemMessage: {
                mode: 'replace',
            },
        });
        expect((selectedService.sendMessage as any).mock.calls[0][0].systemMessage.content).toContain('reduceInstructions');
        expect((selectedService.sendMessage as any).mock.calls[0][0].systemMessage.content).toContain('maxParallel');
        expect((defaultService.sendMessage as any).mock.calls).toHaveLength(0);
    });

    it('surfaces AI service failures', async () => {
        const service = createFailingMock('LLM unavailable').service;
        const { generatePlan } = createMapReducePlanGenerator({ aiService: service });

        await expect(generatePlan({
            workspaceId: 'ws-test',
            prompt: 'Split this feature',
            childMode: 'ask',
        })).rejects.toThrow(/LLM unavailable/i);
    });
});
