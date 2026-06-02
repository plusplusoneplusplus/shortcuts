import { describe, expect, it } from 'vitest';
import * as workflowPackage from '@plusplusoneplusplus/coc-workflow/workflow';
import * as forgeRoot from '../../src';
import * as forgeWorkflow from '../../src/workflow';
import type {
    FlatWorkflowResult,
    NodeResult,
    PipelineConfig,
    WorkflowConfig,
    WorkflowResult,
} from '../../src';

describe('Forge workflow compatibility exports', () => {
    it('delegates root workflow functions to coc-workflow', () => {
        expect(forgeRoot.compileToWorkflow).toBe(workflowPackage.compileToWorkflow);
        expect(forgeRoot.executeWorkflow).toBe(workflowPackage.executeWorkflow);
        expect(forgeRoot.flattenWorkflowResult).toBe(workflowPackage.flattenWorkflowResult);
        expect(forgeRoot.validateWorkflow).toBe(workflowPackage.validate);
        expect(forgeRoot.scheduleWorkflow).toBe(workflowPackage.schedule);
    });

    it('delegates @forge/workflow functions and legacy pipeline guards to coc-workflow', () => {
        expect(forgeWorkflow.compileToWorkflow).toBe(workflowPackage.compileToWorkflow);
        expect(forgeWorkflow.executeWorkflow).toBe(workflowPackage.executeWorkflow);
        expect(forgeWorkflow.flattenWorkflowResult).toBe(workflowPackage.flattenWorkflowResult);
        expect(forgeWorkflow.isCSVSource).toBe(workflowPackage.isCSVSource);
        expect(forgeWorkflow.isGenerateConfig).toBe(workflowPackage.isGenerateConfig);
        expect(forgeWorkflow.executeMap).toBe(workflowPackage.executeMap);
        expect(forgeWorkflow.ConcurrencyLimiter).toBe(workflowPackage.ConcurrencyLimiter);
    });

    it('keeps workflow and legacy pipeline compatibility types available from Forge', () => {
        const pipeline: PipelineConfig = {
            name: 'compat-pipeline',
            input: { items: [{ name: 'one' }] },
            map: { prompt: 'Summarize {{name}}' },
            reduce: { type: 'list' },
        };
        const workflow: WorkflowConfig = forgeRoot.compileToWorkflow(`
name: compat-workflow
job:
  prompt: "Say hello"
`);
        const jobResult: NodeResult = {
            nodeId: 'job',
            success: true,
            items: [{ text: 'hello' }],
            stats: { durationMs: 0, inputCount: 1, outputCount: 1 },
        };
        const result: WorkflowResult = {
            success: true,
            results: new Map([['job', jobResult]]),
            leaves: new Map([['job', jobResult]]),
            tiers: [['job']],
            totalDurationMs: 0,
        };
        const flat: FlatWorkflowResult = forgeRoot.flattenWorkflowResult(result, workflow);

        expect(forgeRoot.isCSVSource(pipeline.input?.from)).toBe(false);
        expect(workflow.name).toBe('compat-workflow');
        expect(flat.stats.totalItems).toBe(1);
    });
});
