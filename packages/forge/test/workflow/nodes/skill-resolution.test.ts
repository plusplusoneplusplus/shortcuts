import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeMap } from '../../../src/workflow/nodes/map';
import { executeAI } from '../../../src/workflow/nodes/ai';
import { executeReduce } from '../../../src/workflow/nodes/reduce';
import { setLogger, nullLogger, resetLogger } from '../../../src/logger';
import type { MapNodeConfig, AINodeConfig, ReduceNodeConfig, WorkflowExecutionOptions } from '../../../src/workflow/types';
import type { AIInvokerResult, AIInvokerOptions } from '../../../src/ai/types';

// Mock the skill resolver
vi.mock('../../../src/pipeline/skill-resolver', () => ({
    resolveSkill: vi.fn(async (name: string) => `[Skill: ${name}] You are an expert.`),
}));

import { resolveSkill } from '../../../src/pipeline/skill-resolver';
const mockedResolveSkill = vi.mocked(resolveSkill);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureInvoker() {
    const calls: Array<{ prompt: string; opts?: AIInvokerOptions }> = [];
    const fn = vi.fn(async (prompt: string, opts?: AIInvokerOptions): Promise<AIInvokerResult> => {
        calls.push({ prompt, opts });
        return { success: true, response: '{"result":"ok"}' };
    });
    return { fn, calls };
}

function opts(overrides: Partial<WorkflowExecutionOptions> = {}): WorkflowExecutionOptions {
    return {
        aiInvoker: vi.fn(async (): Promise<AIInvokerResult> => ({
            success: true, response: '{"result":"ok"}',
        })),
        workspaceRoot: '/workspace',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Skill resolution in workflow nodes', () => {
    beforeEach(() => {
        setLogger(nullLogger);
        mockedResolveSkill.mockClear();
    });
    afterEach(() => resetLogger());

    it('map node with skill prepends skill content to prompt', async () => {
        const { fn, calls } = captureInvoker();
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Classify: {{title}}',
            skill: 'classifier',
            output: ['result'],
        };
        await executeMap(config, [{ title: 'Bug report' }], opts({ aiInvoker: fn }));

        expect(mockedResolveSkill).toHaveBeenCalledWith('classifier', '/workspace');
        expect(calls[0].prompt).toContain('[Skill: classifier] You are an expert.');
        expect(calls[0].prompt).toContain('Classify: Bug report');
        // Skill content should come before the prompt
        const skillIdx = calls[0].prompt.indexOf('[Skill: classifier]');
        const promptIdx = calls[0].prompt.indexOf('Classify:');
        expect(skillIdx).toBeLessThan(promptIdx);
    });

    it('ai node with skill prepends skill content to prompt', async () => {
        const { fn, calls } = captureInvoker();
        const config: AINodeConfig = {
            type: 'ai',
            prompt: 'Summarize: {{ITEMS}}',
            skill: 'summarizer',
            output: ['result'],
        };
        await executeAI(config, [{ text: 'hello' }], opts({ aiInvoker: fn }));

        expect(mockedResolveSkill).toHaveBeenCalledWith('summarizer', '/workspace');
        expect(calls[0].prompt).toContain('[Skill: summarizer] You are an expert.');
        expect(calls[0].prompt).toContain('Summarize:');
    });

    it('reduce node (ai strategy) with skill prepends skill content to prompt', async () => {
        const { fn, calls } = captureInvoker();
        const config: ReduceNodeConfig = {
            type: 'reduce',
            strategy: 'ai',
            prompt: 'Aggregate: {{RESULTS}}',
            skill: 'aggregator',
            output: ['result'],
        };
        await executeReduce(config, [{ text: 'item1' }], opts({ aiInvoker: fn }));

        expect(mockedResolveSkill).toHaveBeenCalledWith('aggregator', '/workspace');
        expect(calls[0].prompt).toContain('[Skill: aggregator] You are an expert.');
    });

    it('nodes without skill field work unchanged', async () => {
        const { fn, calls } = captureInvoker();
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Process: {{id}}',
            output: ['result'],
        };
        await executeMap(config, [{ id: '1' }], opts({ aiInvoker: fn }));

        expect(mockedResolveSkill).not.toHaveBeenCalled();
        expect(calls[0].prompt).toBe('Process: 1');
    });

    it('missing workspaceRoot silently skips skill resolution', async () => {
        const { fn, calls } = captureInvoker();
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Process: {{id}}',
            skill: 'my-skill',
            output: ['result'],
        };
        // No workspaceRoot
        await executeMap(config, [{ id: '1' }], { aiInvoker: fn });

        expect(mockedResolveSkill).not.toHaveBeenCalled();
        expect(calls[0].prompt).toBe('Process: 1');
    });

    it('skill resolution failure logs warning and continues with original prompt', async () => {
        mockedResolveSkill.mockRejectedValueOnce(new Error('Skill not found'));

        const { fn, calls } = captureInvoker();
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Process: {{id}}',
            skill: 'nonexistent',
            output: ['result'],
        };
        await executeMap(config, [{ id: '1' }], opts({ aiInvoker: fn }));

        expect(calls[0].prompt).toBe('Process: 1');
    });

    it('skill content appears before parameter substitution', async () => {
        const { fn, calls } = captureInvoker();
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Analyze {{id}} in {{language}}',
            skill: 'expert',
            output: ['result'],
        };
        await executeMap(config, [{ id: '1' }], opts({
            aiInvoker: fn,
            parameters: { language: 'TypeScript' },
        }));

        // Skill prepended, params substituted, item fields substituted
        expect(calls[0].prompt).toContain('[Skill: expert]');
        expect(calls[0].prompt).toContain('Analyze 1 in TypeScript');
    });

    // ---- Multi-skill tests ----

    it('map node with skills[] prepends multiple skill contents in order', async () => {
        const { fn, calls } = captureInvoker();
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Classify: {{title}}',
            skills: ['classifier', 'reviewer'],
            output: ['result'],
        };
        await executeMap(config, [{ title: 'Bug report' }], opts({ aiInvoker: fn }));

        expect(mockedResolveSkill).toHaveBeenCalledTimes(2);
        expect(mockedResolveSkill).toHaveBeenCalledWith('classifier', '/workspace');
        expect(mockedResolveSkill).toHaveBeenCalledWith('reviewer', '/workspace');
        expect(calls[0].prompt).toContain('[Skill: classifier] You are an expert.');
        expect(calls[0].prompt).toContain('[Skill: reviewer] You are an expert.');
        // Both skills before the prompt
        const classifierIdx = calls[0].prompt.indexOf('[Skill: classifier]');
        const reviewerIdx = calls[0].prompt.indexOf('[Skill: reviewer]');
        const promptIdx = calls[0].prompt.indexOf('Classify:');
        expect(classifierIdx).toBeLessThan(promptIdx);
        expect(reviewerIdx).toBeLessThan(promptIdx);
        // Order preserved
        expect(classifierIdx).toBeLessThan(reviewerIdx);
    });

    it('ai node with skills[] prepends multiple skill contents', async () => {
        const { fn, calls } = captureInvoker();
        const config: AINodeConfig = {
            type: 'ai',
            prompt: 'Summarize: {{ITEMS}}',
            skills: ['summarizer', 'formatter'],
            output: ['result'],
        };
        await executeAI(config, [{ text: 'hello' }], opts({ aiInvoker: fn }));

        expect(mockedResolveSkill).toHaveBeenCalledTimes(2);
        expect(calls[0].prompt).toContain('[Skill: summarizer]');
        expect(calls[0].prompt).toContain('[Skill: formatter]');
    });

    it('reduce node (ai strategy) with skills[] prepends multiple skill contents', async () => {
        const { fn, calls } = captureInvoker();
        const config: ReduceNodeConfig = {
            type: 'reduce',
            strategy: 'ai',
            prompt: 'Aggregate: {{RESULTS}}',
            skills: ['aggregator', 'validator'],
            output: ['result'],
        };
        await executeReduce(config, [{ text: 'item1' }], opts({ aiInvoker: fn }));

        expect(mockedResolveSkill).toHaveBeenCalledTimes(2);
        expect(calls[0].prompt).toContain('[Skill: aggregator]');
        expect(calls[0].prompt).toContain('[Skill: validator]');
    });

    it('skills[] takes precedence over singular skill', async () => {
        const { fn, calls } = captureInvoker();
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Process: {{id}}',
            skill: 'ignored-skill',
            skills: ['alpha', 'beta'],
            output: ['result'],
        };
        await executeMap(config, [{ id: '1' }], opts({ aiInvoker: fn }));

        expect(mockedResolveSkill).toHaveBeenCalledTimes(2);
        expect(mockedResolveSkill).toHaveBeenCalledWith('alpha', '/workspace');
        expect(mockedResolveSkill).toHaveBeenCalledWith('beta', '/workspace');
        // singular skill is NOT resolved
        expect(mockedResolveSkill).not.toHaveBeenCalledWith('ignored-skill', '/workspace');
    });

    it('backward compat: singular skill still works when skills[] absent', async () => {
        const { fn, calls } = captureInvoker();
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Process: {{id}}',
            skill: 'my-skill',
            output: ['result'],
        };
        await executeMap(config, [{ id: '1' }], opts({ aiInvoker: fn }));

        expect(mockedResolveSkill).toHaveBeenCalledTimes(1);
        expect(mockedResolveSkill).toHaveBeenCalledWith('my-skill', '/workspace');
        expect(calls[0].prompt).toContain('[Skill: my-skill]');
    });

    it('partial skill resolution failure still includes successful skills', async () => {
        mockedResolveSkill
            .mockResolvedValueOnce('[Skill: good] Content')
            .mockRejectedValueOnce(new Error('Not found'));

        const { fn, calls } = captureInvoker();
        const config: MapNodeConfig = {
            type: 'map',
            prompt: 'Process: {{id}}',
            skills: ['good', 'bad'],
            output: ['result'],
        };
        await executeMap(config, [{ id: '1' }], opts({ aiInvoker: fn }));

        expect(calls[0].prompt).toContain('[Skill: good] Content');
        expect(calls[0].prompt).toContain('Process: 1');
    });
});
