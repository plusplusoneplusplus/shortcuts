/**
 * Unit tests for work-item-ai-generator
 *
 * Tests cover:
 *  - parseAiDraftResponse: happy path, edge cases, error cases
 *  - buildNewItemPrompt: key content assertions
 *  - buildImproveItemPrompt: key content assertions
 *  - createWorkItemAiGenerators: integration with a mock AI service
 */

import { describe, it, expect } from 'vitest';
import {
    parseAiDraftResponse,
    buildNewItemPrompt,
    buildImproveItemPrompt,
    createWorkItemAiGenerators,
} from '../../../src/server/work-items/work-item-ai-generator';
import type { NewItemDraftContext, ImproveItemDraftContext } from '../../../src/server/routes/work-item-ai-routes';
import { MAX_CLARIFICATION_ROUNDS } from '../../../src/server/routes/work-item-ai-routes';
import { createMockSDKService, createFailingMock } from '../../helpers/mock-sdk-service';

// ============================================================================
// parseAiDraftResponse
// ============================================================================

describe('parseAiDraftResponse', () => {
    // -----------------------------------------------------------------------
    // Draft responses
    // -----------------------------------------------------------------------

    it('parses a minimal draft response', () => {
        const raw = JSON.stringify({
            kind: 'draft',
            workItem: { title: 'Login page', priority: 'high' },
        });
        const result = parseAiDraftResponse(raw);
        expect(result.kind).toBe('draft');
        if (result.kind === 'draft') {
            expect(result.workItem.title).toBe('Login page');
            expect(result.workItem.priority).toBe('high');
        }
    });

    it('parses a full draft response with goal and childTasks', () => {
        const raw = JSON.stringify({
            kind: 'draft',
            workItem: {
                title: 'Auth Feature',
                description: 'Build auth',
                priority: 'normal',
                tags: ['auth', 'security'],
                type: 'pbi',
                plan: '## Objective\nBuild it.',
            },
            goal: '## Objective\nBuild auth.\n\n## Steps\n- [ ] Implement JWT',
            childTasks: [
                { title: 'Login endpoint', type: 'work-item' },
                { title: 'Auth bug fix', description: 'Fix redirect loop', type: 'bug' },
            ],
        });
        const result = parseAiDraftResponse(raw);
        expect(result.kind).toBe('draft');
        if (result.kind === 'draft') {
            expect(result.workItem.title).toBe('Auth Feature');
            expect(result.workItem.tags).toEqual(['auth', 'security']);
            expect(result.goal).toContain('Implement JWT');
            expect(result.childTasks).toHaveLength(2);
            expect(result.childTasks![0].title).toBe('Login endpoint');
            expect(result.childTasks![0].type).toBe('work-item');
            expect(result.childTasks![1].type).toBe('bug');
        }
    });

    it('strips markdown code fences (```json ... ```)', () => {
        const inner = JSON.stringify({ kind: 'draft', workItem: { title: 'X' } });
        const raw = '```json\n' + inner + '\n```';
        const result = parseAiDraftResponse(raw);
        expect(result.kind).toBe('draft');
    });

    it('strips plain code fences (``` ... ```)', () => {
        const inner = JSON.stringify({ kind: 'draft', workItem: { title: 'Y' } });
        const raw = '```\n' + inner + '\n```';
        const result = parseAiDraftResponse(raw);
        expect(result.kind).toBe('draft');
    });

    it('skips invalid tags (non-strings) in workItem.tags', () => {
        const raw = JSON.stringify({
            kind: 'draft',
            workItem: { title: 'T', tags: ['valid', 42, null, 'also-valid'] },
        });
        const result = parseAiDraftResponse(raw);
        if (result.kind === 'draft') {
            expect(result.workItem.tags).toEqual(['valid', 'also-valid']);
        }
    });

    it('skips invalid priority values and omits the field', () => {
        const raw = JSON.stringify({
            kind: 'draft',
            workItem: { title: 'T', priority: 'urgent' },
        });
        const result = parseAiDraftResponse(raw);
        if (result.kind === 'draft') {
            expect(result.workItem.priority).toBeUndefined();
        }
    });

    it('skips childTask entries without a title', () => {
        const raw = JSON.stringify({
            kind: 'draft',
            workItem: { title: 'T' },
            childTasks: [
                { title: 'Good task' },
                { description: 'No title' },
                {},
            ],
        });
        const result = parseAiDraftResponse(raw);
        if (result.kind === 'draft') {
            expect(result.childTasks).toHaveLength(1);
            expect(result.childTasks![0].title).toBe('Good task');
        }
    });

    it('defaults childTask type to "work-item" when unknown', () => {
        const raw = JSON.stringify({
            kind: 'draft',
            workItem: { title: 'T' },
            childTasks: [{ title: 'Task', type: 'goal' }],
        });
        const result = parseAiDraftResponse(raw);
        if (result.kind === 'draft') {
            expect(result.childTasks![0].type).toBe('work-item');
        }
    });

    // -----------------------------------------------------------------------
    // Clarification responses
    // -----------------------------------------------------------------------

    it('parses a clarification response', () => {
        const raw = JSON.stringify({
            kind: 'clarification',
            questions: ['Who are the target users?', 'What is the timeline?'],
            clarificationCount: 0,
        });
        const result = parseAiDraftResponse(raw);
        expect(result.kind).toBe('clarification');
        if (result.kind === 'clarification') {
            expect(result.questions).toHaveLength(2);
            expect(result.clarificationCount).toBe(0);
        }
    });

    it('filters non-string values out of clarification questions', () => {
        const raw = JSON.stringify({
            kind: 'clarification',
            questions: ['Real question', 42, null],
            clarificationCount: 1,
        });
        const result = parseAiDraftResponse(raw);
        if (result.kind === 'clarification') {
            expect(result.questions).toEqual(['Real question']);
        }
    });

    it('defaults clarificationCount to 0 when missing', () => {
        const raw = JSON.stringify({
            kind: 'clarification',
            questions: ['Question?'],
        });
        const result = parseAiDraftResponse(raw);
        if (result.kind === 'clarification') {
            expect(result.clarificationCount).toBe(0);
        }
    });

    // -----------------------------------------------------------------------
    // Error cases
    // -----------------------------------------------------------------------

    it('throws when response is not JSON', () => {
        expect(() => parseAiDraftResponse('I am a helpful assistant!')).toThrow(/non-JSON/i);
    });

    it('throws when clarification has no questions', () => {
        const raw = JSON.stringify({ kind: 'clarification', questions: [] });
        expect(() => parseAiDraftResponse(raw)).toThrow(/no questions/i);
    });

    it('throws for unknown kind', () => {
        const raw = JSON.stringify({ kind: 'unknown-kind' });
        expect(() => parseAiDraftResponse(raw)).toThrow(/unexpected kind/i);
    });

    it('throws when response is a JSON array', () => {
        expect(() => parseAiDraftResponse('[]')).toThrow();
    });
});

// ============================================================================
// buildNewItemPrompt
// ============================================================================

describe('buildNewItemPrompt', () => {
    const baseCtx: NewItemDraftContext = {
        workspaceId: 'ws-abc',
        prompt: 'Build a login page',
        type: 'work-item',
        clarificationCount: 0,
        hierarchyEnabled: false,
    };

    it('includes the user prompt', () => {
        const result = buildNewItemPrompt(baseCtx);
        expect(result).toContain('Build a login page');
    });

    it('includes the requested type', () => {
        const result = buildNewItemPrompt({ ...baseCtx, type: 'bug' });
        expect(result).toContain('bug');
    });

    it('includes parentId when provided', () => {
        const result = buildNewItemPrompt({ ...baseCtx, parentId: 'parent-123' });
        expect(result).toContain('parent-123');
    });

    it('includes clarification answers when provided', () => {
        const result = buildNewItemPrompt({
            ...baseCtx,
            clarificationAnswers: ['Internal users', 'Q4 deadline'],
            clarificationCount: 1,
        });
        expect(result).toContain('Internal users');
        expect(result).toContain('Q4 deadline');
    });

    it('mentions hierarchy-disabled guidance when hierarchyEnabled is false', () => {
        const result = buildNewItemPrompt({ ...baseCtx, hierarchyEnabled: false });
        expect(result).toMatch(/hierarchy.*disabled|disabled.*hierarchy/i);
        expect(result).toContain('checklist');
    });

    it('mentions hierarchy-enabled guidance when hierarchyEnabled is true', () => {
        const result = buildNewItemPrompt({ ...baseCtx, hierarchyEnabled: true });
        expect(result).toMatch(/hierarchy.*enabled|enabled.*hierarchy/i);
    });

    it('forces draft when clarificationCount reaches MAX_CLARIFICATION_ROUNDS', () => {
        const result = buildNewItemPrompt({ ...baseCtx, clarificationCount: MAX_CLARIFICATION_ROUNDS });
        expect(result).toMatch(/MUST respond with a draft/i);
    });

    it('shows remaining rounds info when below the limit', () => {
        const result = buildNewItemPrompt({ ...baseCtx, clarificationCount: 1 });
        expect(result).toContain('1 of');
    });
});

// ============================================================================
// buildImproveItemPrompt
// ============================================================================

describe('buildImproveItemPrompt', () => {
    const baseCtx: ImproveItemDraftContext = {
        workspaceId: 'ws-abc',
        workItemId: 'item-001',
        title: 'Add user authentication',
        description: 'Need OAuth2 support',
        type: 'work-item',
        prompt: 'Improve the plan and add acceptance criteria',
        targets: ['fields', 'goal'],
        clarificationCount: 0,
        hierarchyEnabled: false,
    };

    it('includes the work item title', () => {
        expect(buildImproveItemPrompt(baseCtx)).toContain('Add user authentication');
    });

    it('includes the improvement request', () => {
        expect(buildImproveItemPrompt(baseCtx)).toContain('Improve the plan and add acceptance criteria');
    });

    it('includes targets in the prompt', () => {
        const result = buildImproveItemPrompt(baseCtx);
        expect(result).toContain('fields');
        expect(result).toContain('goal');
    });

    it('includes current plan when provided', () => {
        const result = buildImproveItemPrompt({
            ...baseCtx,
            currentPlan: '## Objective\nBuild auth.',
        });
        expect(result).toContain('## Objective');
    });

    it('includes clarification answers when provided', () => {
        const result = buildImproveItemPrompt({
            ...baseCtx,
            clarificationAnswers: ['Use Passport.js'],
            clarificationCount: 1,
        });
        expect(result).toContain('Passport.js');
    });

    it('forces draft when clarificationCount reaches MAX_CLARIFICATION_ROUNDS', () => {
        const result = buildImproveItemPrompt({
            ...baseCtx,
            clarificationCount: MAX_CLARIFICATION_ROUNDS,
        });
        expect(result).toMatch(/MUST respond with a draft/i);
    });

    it('mentions hierarchy childTasks guidance when childTasks is in targets', () => {
        const result = buildImproveItemPrompt({
            ...baseCtx,
            targets: ['fields', 'goal', 'childTasks'],
            hierarchyEnabled: false,
        });
        expect(result).toContain('checklist');
    });
});

// ============================================================================
// createWorkItemAiGenerators (integration with mock AI service)
// ============================================================================

describe('createWorkItemAiGenerators', () => {
    const newCtx: NewItemDraftContext = {
        workspaceId: 'ws-test',
        prompt: 'Build a search feature',
        type: 'work-item',
        clarificationCount: 0,
        hierarchyEnabled: false,
    };

    const improveCtx: ImproveItemDraftContext = {
        workspaceId: 'ws-test',
        workItemId: 'item-002',
        title: 'Search feature',
        description: 'Full-text search',
        type: 'work-item',
        prompt: 'Add acceptance criteria',
        targets: ['fields', 'goal'],
        clarificationCount: 0,
        hierarchyEnabled: false,
    };

    it('generateNewItemDraft returns a draft from the AI service', async () => {
        const mockDraft = {
            kind: 'draft',
            workItem: { title: 'Search Feature', priority: 'normal' },
            goal: '## Objective\nBuild search.',
        };
        const service = createMockSDKService({
            sendMessageResponse: { success: true, response: JSON.stringify(mockDraft) },
        }).service;
        const { generateNewItemDraft } = createWorkItemAiGenerators({ aiService: service });

        const result = await generateNewItemDraft(newCtx);
        expect(result.kind).toBe('draft');
        if (result.kind === 'draft') {
            expect(result.workItem.title).toBe('Search Feature');
            expect(result.goal).toContain('Build search');
        }
    });

    it('generateNewItemDraft returns a clarification from the AI service', async () => {
        const mockClarification = {
            kind: 'clarification',
            questions: ['What types of content to search?'],
            clarificationCount: 0,
        };
        const service = createMockSDKService({
            sendMessageResponse: { success: true, response: JSON.stringify(mockClarification) },
        }).service;
        const { generateNewItemDraft } = createWorkItemAiGenerators({ aiService: service });

        const result = await generateNewItemDraft(newCtx);
        expect(result.kind).toBe('clarification');
        if (result.kind === 'clarification') {
            expect(result.questions[0]).toContain('search');
        }
    });

    it('generateImproveItemDraft returns a draft from the AI service', async () => {
        const mockDraft = {
            kind: 'draft',
            workItem: { title: 'Improved Search', description: 'Better description' },
        };
        const service = createMockSDKService({
            sendMessageResponse: { success: true, response: JSON.stringify(mockDraft) },
        }).service;
        const { generateImproveItemDraft } = createWorkItemAiGenerators({ aiService: service });

        const result = await generateImproveItemDraft(improveCtx);
        expect(result.kind).toBe('draft');
        if (result.kind === 'draft') {
            expect(result.workItem.title).toBe('Improved Search');
        }
    });

    it('generateNewItemDraft throws when AI service reports failure', async () => {
        const service = createFailingMock('LLM unavailable').service;
        const { generateNewItemDraft } = createWorkItemAiGenerators({ aiService: service });

        await expect(generateNewItemDraft(newCtx)).rejects.toThrow(/LLM unavailable/i);
    });

    it('generateImproveItemDraft throws when AI returns non-JSON', async () => {
        const service = createMockSDKService({
            sendMessageResponse: { success: true, response: 'Here is a nice plan for you!' },
        }).service;
        const { generateImproveItemDraft } = createWorkItemAiGenerators({ aiService: service });

        await expect(generateImproveItemDraft(improveCtx)).rejects.toThrow(/non-JSON/i);
    });

    it('generateNewItemDraft with childTasks when hierarchyEnabled', async () => {
        const mockDraft = {
            kind: 'draft',
            workItem: { title: 'Auth PBI', type: 'pbi' },
            childTasks: [
                { title: 'Login endpoint', type: 'work-item' },
                { title: 'Logout endpoint', type: 'work-item' },
            ],
        };
        const service = createMockSDKService({
            sendMessageResponse: { success: true, response: JSON.stringify(mockDraft) },
        }).service;
        const { generateNewItemDraft } = createWorkItemAiGenerators({ aiService: service });

        const result = await generateNewItemDraft({ ...newCtx, hierarchyEnabled: true });
        expect(result.kind).toBe('draft');
        if (result.kind === 'draft') {
            expect(result.childTasks).toHaveLength(2);
        }
    });
});
