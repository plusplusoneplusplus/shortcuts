import { describe, it, expect } from 'vitest';
import {
    // Type guards
    isLoadNode,
    isScriptNode,
    isFilterNode,
    isMapNode,
    isReduceNode,
    isMergeNode,
    isTransformNode,
    isAINode,
    isNodeConfig,

    // Graph utilities
    buildGraph,
    detectCycle,

    // Validator
    validateWorkflow,
    WorkflowValidationError,

    // Scheduler
    scheduleWorkflow,
    getExecutionOrder,

    // Executor
    executeWorkflow,
} from '../../src/index';

describe('Workflow barrel exports from pipeline-core', () => {
    it('executeWorkflow is a function', () => {
        expect(typeof executeWorkflow).toBe('function');
    });

    it('type guards are functions', () => {
        expect(typeof isLoadNode).toBe('function');
        expect(typeof isScriptNode).toBe('function');
        expect(typeof isFilterNode).toBe('function');
        expect(typeof isMapNode).toBe('function');
        expect(typeof isReduceNode).toBe('function');
        expect(typeof isMergeNode).toBe('function');
        expect(typeof isTransformNode).toBe('function');
        expect(typeof isAINode).toBe('function');
        expect(typeof isNodeConfig).toBe('function');
    });

    it('graph utilities are functions', () => {
        expect(typeof buildGraph).toBe('function');
        expect(typeof detectCycle).toBe('function');
    });

    it('validator exports are defined', () => {
        expect(typeof validateWorkflow).toBe('function');
        expect(WorkflowValidationError).toBeDefined();
        expect(typeof WorkflowValidationError).toBe('function');
    });

    it('scheduler utilities are functions', () => {
        expect(typeof scheduleWorkflow).toBe('function');
        expect(typeof getExecutionOrder).toBe('function');
    });

    it('WorkflowValidationError is a constructor', () => {
        const err = new WorkflowValidationError([]);
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(WorkflowValidationError);
    });
});
