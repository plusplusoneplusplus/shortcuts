/**
 * Tests for pipeline phase module decomposition.
 *
 * Ensures the phase modules are properly exported and the decomposition
 * maintains all public APIs from the pipeline/executor module.
 */

import { describe, it, expect } from 'vitest';
import * as Phases from '../../src/pipeline/phases';
import * as Executor from '../../src/pipeline/executor';

describe('Pipeline Phase Modules', () => {
    describe('shared exports', () => {
        it('exports PipelineExecutionError', () => {
            expect(Phases.PipelineExecutionError).toBeDefined();
            const err = new Phases.PipelineExecutionError('test', 'input');
            expect(err.phase).toBe('input');
            expect(err.name).toBe('PipelineExecutionError');
        });

        it('exports emitPhase', () => {
            expect(typeof Phases.emitPhase).toBe('function');
        });

        it('exports createPhaseTrackingProgress', () => {
            expect(typeof Phases.createPhaseTrackingProgress).toBe('function');
        });

        it('exports convertParametersToObject', () => {
            const result = Phases.convertParametersToObject([
                { name: 'key1', value: 'val1' },
                { name: 'key2', value: 'val2' },
            ]);
            expect(result).toEqual({ key1: 'val1', key2: 'val2' });
        });
    });

    describe('validation exports', () => {
        it('exports validatePipelineConfig', () => {
            expect(typeof Phases.validatePipelineConfig).toBe('function');
        });

        it('exports validatePipelineConfigForExecution', () => {
            expect(typeof Phases.validatePipelineConfigForExecution).toBe('function');
        });

        it('exports validateMapConfig', () => {
            expect(typeof Phases.validateMapConfig).toBe('function');
        });

        it('exports validateReduceConfig', () => {
            expect(typeof Phases.validateReduceConfig).toBe('function');
        });

        it('exports validateInputConfig', () => {
            expect(typeof Phases.validateInputConfig).toBe('function');
        });

        it('exports validateJobConfig', () => {
            expect(typeof Phases.validateJobConfig).toBe('function');
        });
    });

    describe('input-loader exports', () => {
        it('exports loadInputItems', () => {
            expect(typeof Phases.loadInputItems).toBe('function');
        });

        it('exports prepareItems', () => {
            expect(typeof Phases.prepareItems).toBe('function');
        });
    });

    describe('prompt-resolution exports', () => {
        it('exports resolvePrompts', () => {
            expect(typeof Phases.resolvePrompts).toBe('function');
        });

        it('exports buildPromptWithSkill', () => {
            expect(typeof Phases.buildPromptWithSkill).toBe('function');
        });

        it('exports deriveWorkspaceRoot', () => {
            expect(typeof Phases.deriveWorkspaceRoot).toBe('function');
        });

        it('deriveWorkspaceRoot returns provided root when given', () => {
            expect(Phases.deriveWorkspaceRoot('/some/dir', '/workspace')).toBe('/workspace');
        });

        it('buildPromptWithSkill returns main prompt when no skill', () => {
            expect(Phases.buildPromptWithSkill('hello')).toBe('hello');
        });

        it('buildPromptWithSkill prepends skill guidance', () => {
            const result = Phases.buildPromptWithSkill('main prompt', 'skill content', 'myskill');
            expect(result).toContain('[Skill Guidance: myskill]');
            expect(result).toContain('[Task]');
            expect(result).toContain('main prompt');
        });
    });

    describe('job-dispatcher exports', () => {
        it('exports executeSingleJob', () => {
            expect(typeof Phases.executeSingleJob).toBe('function');
        });
    });

    describe('batch-runner exports', () => {
        it('exports executeBatchMode', () => {
            expect(typeof Phases.executeBatchMode).toBe('function');
        });

        it('exports splitIntoBatches', () => {
            const batches = Phases.splitIntoBatches(
                [{ a: '1' }, { a: '2' }, { a: '3' }],
                2
            );
            expect(batches).toHaveLength(2);
            expect(batches[0]).toHaveLength(2);
            expect(batches[1]).toHaveLength(1);
        });

        it('exports substituteModelTemplate', () => {
            expect(Phases.substituteModelTemplate('gpt-4', {})).toBe('gpt-4');
            expect(Phases.substituteModelTemplate(undefined, {})).toBeUndefined();
        });

        it('exports buildBatchPrompt', () => {
            const prompt = Phases.buildBatchPrompt(
                'Process {{ITEMS}}',
                [{ name: 'test' }],
                ['result']
            );
            expect(prompt).toContain('"name": "test"');
            expect(prompt).toContain('Return a JSON array');
        });

        it('exports createEmptyOutput', () => {
            const output = Phases.createEmptyOutput(['a', 'b']);
            expect(output).toEqual({ a: null, b: null });
        });

        it('exports parseBatchResponse', () => {
            expect(typeof Phases.parseBatchResponse).toBe('function');
        });
    });

    describe('output-collector exports', () => {
        it('exports executeReducePhase', () => {
            expect(typeof Phases.executeReducePhase).toBe('function');
        });

        it('exports formatResults', () => {
            expect(typeof Phases.formatResults).toBe('function');
        });

        it('exports formatValue', () => {
            expect(Phases.formatValue(null)).toBe('null');
            expect(Phases.formatValue(42)).toBe('42');
            expect(Phases.formatValue(true)).toBe('true');
        });

        it('exports truncate', () => {
            expect(Phases.truncate('short')).toBe('short');
            expect(Phases.truncate('a very long string that exceeds limit', 10)).toBe('a very ...');
        });

        it('exports escapeCSV', () => {
            expect(Phases.escapeCSV('simple')).toBe('simple');
            expect(Phases.escapeCSV('has,comma')).toBe('"has,comma"');
        });
    });
});

describe('Pipeline Executor backward compatibility', () => {
    it('exports executePipeline', () => {
        expect(typeof Executor.executePipeline).toBe('function');
    });

    it('exports executePipelineWithItems', () => {
        expect(typeof Executor.executePipelineWithItems).toBe('function');
    });

    it('exports parsePipelineYAML', () => {
        expect(typeof Executor.parsePipelineYAML).toBe('function');
    });

    it('exports parsePipelineYAMLSync', () => {
        expect(typeof Executor.parsePipelineYAMLSync).toBe('function');
    });

    it('exports PipelineExecutionError', () => {
        expect(Executor.PipelineExecutionError).toBeDefined();
    });

    it('exports DEFAULT_PARALLEL_LIMIT', () => {
        expect(typeof Executor.DEFAULT_PARALLEL_LIMIT).toBe('number');
    });
});
