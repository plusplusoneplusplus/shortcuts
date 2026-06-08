import { describe, expect, it } from 'vitest';
import {
    buildForEachPlanPrompt,
    createForEachPlanGenerator,
    parseForEachItemPlanResponse,
} from '../../src/server/for-each/for-each-plan-generator';
import { createMockSDKService, createFailingMock } from '../helpers/mock-sdk-service';

const VALID_PLAN = {
    items: [
        {
            id: 'item-1',
            title: 'Update parser',
            prompt: 'Update only the parser logic and add parser tests.',
            status: 'pending',
            metadata: { area: 'parser' },
        },
        {
            id: 'item-2',
            title: 'Update UI',
            prompt: 'Update only the UI to consume the parser result.',
            dependsOn: ['item-1'],
            status: 'pending',
        },
    ],
};

describe('parseForEachItemPlanResponse', () => {
    it('parses a valid For Each item plan', () => {
        const items = parseForEachItemPlanResponse(JSON.stringify(VALID_PLAN));
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({
            id: 'item-1',
            title: 'Update parser',
            status: 'pending',
        });
        expect(items[1].dependsOn).toEqual(['item-1']);
    });

    it('strips JSON code fences', () => {
        const items = parseForEachItemPlanResponse(`\`\`\`json\n${JSON.stringify(VALID_PLAN)}\n\`\`\``);
        expect(items).toHaveLength(2);
    });

    it('rejects non-JSON output with an actionable error', () => {
        expect(() => parseForEachItemPlanResponse('Here are some tasks.')).toThrow(/non-JSON For Each item plan/i);
    });

    it('rejects missing required item fields', () => {
        expect(() => parseForEachItemPlanResponse(JSON.stringify({
            items: [{ id: 'item-1', title: 'Missing prompt', status: 'pending' }],
        }))).toThrow(/prompt is required/i);
    });

    it('rejects non-pending initial statuses', () => {
        expect(() => parseForEachItemPlanResponse(JSON.stringify({
            items: [{ id: 'item-1', title: 'Task', prompt: 'Do it', status: 'running' }],
        }))).toThrow(/initial status 'pending'/i);
    });

    it('rejects unknown dependencies', () => {
        expect(() => parseForEachItemPlanResponse(JSON.stringify({
            items: [{ id: 'item-1', title: 'Task', prompt: 'Do it', status: 'pending', dependsOn: ['missing'] }],
        }))).toThrow(/unknown item/i);
    });
});

describe('buildForEachPlanPrompt', () => {
    it('includes original request, child mode, and shared instructions', () => {
        const prompt = buildForEachPlanPrompt({
            workspaceId: 'ws-test',
            prompt: 'Split this feature',
            childMode: 'autopilot',
            sharedInstructions: 'Keep commits small.',
        });
        expect(prompt).toContain('Split this feature');
        expect(prompt).toContain('autopilot');
        expect(prompt).toContain('Keep commits small');
    });
});

describe('createForEachPlanGenerator', () => {
    it('calls the selected AI service with model and reasoning effort', async () => {
        const defaultService = createMockSDKService({
            sendMessageResponse: { success: true, response: JSON.stringify({ items: [] }) },
        }).service;
        const selectedService = createMockSDKService({
            sendMessageResponse: { success: true, response: JSON.stringify(VALID_PLAN) },
        }).service;
        const { generateItemPlan } = createForEachPlanGenerator({
            aiService: defaultService,
            resolveAiServiceForProvider: () => selectedService,
        });

        const items = await generateItemPlan({
            workspaceId: 'ws-test',
            prompt: 'Split this feature',
            childMode: 'ask',
            provider: 'claude',
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
        });

        expect(items).toHaveLength(2);
        expect((selectedService.sendMessage as any).mock.calls[0][0]).toMatchObject({
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            systemMessage: {
                mode: 'replace',
            },
        });
        expect((selectedService.sendMessage as any).mock.calls[0][0].systemMessage.content).toContain('STRICT OUTPUT CONTRACT');
        expect((selectedService.sendMessage as any).mock.calls[0][0].systemMessage.content).toContain('"items"');
        expect((defaultService.sendMessage as any).mock.calls).toHaveLength(0);
    });

    it('surfaces AI service failures', async () => {
        const service = createFailingMock('LLM unavailable').service;
        const { generateItemPlan } = createForEachPlanGenerator({ aiService: service });

        await expect(generateItemPlan({
            workspaceId: 'ws-test',
            prompt: 'Split this feature',
            childMode: 'ask',
        })).rejects.toThrow(/LLM unavailable/i);
    });
});
