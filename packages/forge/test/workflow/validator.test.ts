/**
 * Workflow Validator — Unit Tests
 *
 * Tests for validate() and WorkflowValidationError.
 */

import { describe, it, expect, vi } from 'vitest';
import { validate, WorkflowValidationError } from '../../src/workflow/validator';
import { WorkflowErrorCode } from '../../src/errors/error-codes';
import { isPipelineCoreError } from '../../src/errors/pipeline-core-error';
import type { WorkflowConfig, NodeConfig } from '../../src/workflow/types';

// =============================================================================
// Helpers
// =============================================================================

function catchError(fn: () => void): WorkflowValidationError {
    try {
        fn();
    } catch (e) {
        return e as WorkflowValidationError;
    }
    throw new Error('Expected function to throw');
}

/** Minimal valid load node. */
function loadNode(): NodeConfig {
    return { type: 'load', source: { type: 'inline', items: [] } };
}

// =============================================================================
// WorkflowValidationError class
// =============================================================================

describe('WorkflowValidationError', () => {
    it('is an instance of PipelineCoreError', () => {
        const err = new WorkflowValidationError('test', WorkflowErrorCode.WORKFLOW_EMPTY);
        expect(isPipelineCoreError(err)).toBe(true);
    });

    it('has the correct name and code', () => {
        const err = new WorkflowValidationError('msg', WorkflowErrorCode.CYCLE_DETECTED, { foo: 1 });
        expect(err.name).toBe('WorkflowValidationError');
        expect(err.code).toBe(WorkflowErrorCode.CYCLE_DETECTED);
        expect(err.meta).toEqual({ foo: 1 });
    });

    it('is instanceof WorkflowValidationError', () => {
        const err = new WorkflowValidationError('msg', WorkflowErrorCode.WORKFLOW_EMPTY);
        expect(err).toBeInstanceOf(WorkflowValidationError);
        expect(err).toBeInstanceOf(Error);
    });
});

// =============================================================================
// validate() — Rule 1: Non-empty nodes
// =============================================================================

describe('validate — Rule 1: non-empty nodes', () => {
    it('throws WORKFLOW_EMPTY for empty nodes', () => {
        const config: WorkflowConfig = { name: 'test', nodes: {} };
        const err = catchError(() => validate(config));
        expect(err).toBeInstanceOf(WorkflowValidationError);
        expect(err.code).toBe(WorkflowErrorCode.WORKFLOW_EMPTY);
    });
});

// =============================================================================
// validate() — Rule 2: Unknown from references
// =============================================================================

describe('validate — Rule 2: unknown from references', () => {
    it('throws UNKNOWN_NODE_REF for dangling reference', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                B: { type: 'map', from: ['DOES_NOT_EXIST'], prompt: 'p' } as NodeConfig,
            },
        };
        const err = catchError(() => validate(config));
        expect(err).toBeInstanceOf(WorkflowValidationError);
        expect(err.code).toBe(WorkflowErrorCode.UNKNOWN_NODE_REF);
        expect(err.message).toContain('DOES_NOT_EXIST');
        expect(err.message).toContain('"B"');
    });
});

// =============================================================================
// validate() — Rule 3: No cycles
// =============================================================================

describe('validate — Rule 3: no cycles', () => {
    it('throws CYCLE_DETECTED with path in message', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: { type: 'map', from: ['C'], prompt: 'p' } as NodeConfig,
                B: { type: 'map', from: ['A'], prompt: 'p' } as NodeConfig,
                C: { type: 'map', from: ['B'], prompt: 'p' } as NodeConfig,
            },
        };
        const err = catchError(() => validate(config));
        expect(err).toBeInstanceOf(WorkflowValidationError);
        expect(err.code).toBe(WorkflowErrorCode.CYCLE_DETECTED);
        // Message must contain the cycle path
        expect(err.message).toMatch(/A.*B.*C|B.*C.*A|C.*A.*B/);
    });
});

// =============================================================================
// validate() — Rule 4: Load nodes with parents (warning)
// =============================================================================

describe('validate — Rule 4: load nodes with parents', () => {
    it('warns but does not throw when a load node has from entries', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                B: { type: 'load', source: { type: 'inline', items: [] }, from: ['A'] } as NodeConfig,
            },
        };
        // Should not throw
        expect(() => validate(config)).not.toThrow();
    });
});

// =============================================================================
// validate() — Rule 5: Merge nodes need 2+ parents
// =============================================================================

describe('validate — Rule 5: merge nodes need 2+ parents', () => {
    it('throws MERGE_NEEDS_MULTIPLE_PARENTS for merge with 1 parent', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                M: { type: 'merge', from: ['A'] } as NodeConfig,
            },
        };
        const err = catchError(() => validate(config));
        expect(err.code).toBe(WorkflowErrorCode.MERGE_NEEDS_MULTIPLE_PARENTS);
        expect(err.message).toContain('"M"');
        expect(err.message).toContain('1');
    });

    it('throws MERGE_NEEDS_MULTIPLE_PARENTS for merge with 0 parents', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                M: { type: 'merge' } as NodeConfig,
            },
        };
        const err = catchError(() => validate(config));
        expect(err.code).toBe(WorkflowErrorCode.MERGE_NEEDS_MULTIPLE_PARENTS);
        expect(err.message).toContain('0');
    });

    it('does not throw for merge with 2 parents', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                B: loadNode(),
                M: { type: 'merge', from: ['A', 'B'] } as NodeConfig,
            },
        };
        expect(() => validate(config)).not.toThrow();
    });
});

// =============================================================================
// validate() — Rule 6: Map nodes need prompt
// =============================================================================

describe('validate — Rule 6: map nodes need prompt', () => {
    it('throws MISSING_PROMPT for map without prompt or promptFile', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                B: { type: 'map', from: ['A'] } as NodeConfig,
            },
        };
        const err = catchError(() => validate(config));
        expect(err.code).toBe(WorkflowErrorCode.MISSING_PROMPT);
        expect(err.message).toContain('"B"');
    });

    it('does not throw when map has prompt', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                B: { type: 'map', from: ['A'], prompt: 'do something' } as NodeConfig,
            },
        };
        expect(() => validate(config)).not.toThrow();
    });

    it('does not throw when map has promptFile', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                B: { type: 'map', from: ['A'], promptFile: 'prompt.md' } as NodeConfig,
            },
        };
        expect(() => validate(config)).not.toThrow();
    });
});

// =============================================================================
// validate() — Rule 7: Filter nodes need rule
// =============================================================================

describe('validate — Rule 7: filter nodes need rule', () => {
    it('throws MISSING_RULE for filter without rule', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                F: { type: 'filter', from: ['A'] } as NodeConfig,
            },
        };
        const err = catchError(() => validate(config));
        expect(err.code).toBe(WorkflowErrorCode.MISSING_RULE);
        expect(err.message).toContain('"F"');
    });

    it('does not throw when filter has rule', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                F: {
                    type: 'filter',
                    from: ['A'],
                    rule: { type: 'field', field: 'x', op: 'eq', value: 1 },
                } as NodeConfig,
            },
        };
        expect(() => validate(config)).not.toThrow();
    });
});

// =============================================================================
// validate() — Rule 8: Reduce nodes need strategy
// =============================================================================

describe('validate — Rule 8: reduce nodes need strategy', () => {
    it('throws MISSING_STRATEGY for reduce without strategy', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                R: { type: 'reduce', from: ['A'] } as NodeConfig,
            },
        };
        const err = catchError(() => validate(config));
        expect(err.code).toBe(WorkflowErrorCode.MISSING_STRATEGY);
        expect(err.message).toContain('"R"');
    });

    it('does not throw when reduce has strategy', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                R: { type: 'reduce', from: ['A'], strategy: 'json' } as NodeConfig,
            },
        };
        expect(() => validate(config)).not.toThrow();
    });
});

// =============================================================================
// validate() — Rule 9: Script nodes need run
// =============================================================================

describe('validate — Rule 9: script nodes need run', () => {
    it('throws MISSING_COMMAND for script without run', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                S: { type: 'script', from: ['A'] } as NodeConfig,
            },
        };
        const err = catchError(() => validate(config));
        expect(err.code).toBe(WorkflowErrorCode.MISSING_COMMAND);
        expect(err.message).toContain('"S"');
    });

    it('does not throw when script has run', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                S: { type: 'script', from: ['A'], run: 'echo hi' } as NodeConfig,
            },
        };
        expect(() => validate(config)).not.toThrow();
    });
});

// =============================================================================
// validate() — Rule 10: AI nodes need prompt
// =============================================================================

describe('validate — Rule 10: AI nodes need prompt', () => {
    it('throws MISSING_PROMPT for ai without prompt', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                AI: { type: 'ai', from: ['A'] } as NodeConfig,
            },
        };
        const err = catchError(() => validate(config));
        expect(err.code).toBe(WorkflowErrorCode.MISSING_PROMPT);
        expect(err.message).toContain('"AI"');
    });

    it('does not throw when ai has prompt', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                A: loadNode(),
                AI: { type: 'ai', from: ['A'], prompt: 'summarize' } as NodeConfig,
            },
        };
        expect(() => validate(config)).not.toThrow();
    });
});

// =============================================================================
// validate() — Valid configs
// =============================================================================

describe('validate — valid configs', () => {
    it('does not throw for a valid single-node load config', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: { load1: loadNode() },
        };
        expect(() => validate(config)).not.toThrow();
    });

    it('does not throw for a complex valid DAG', () => {
        const config: WorkflowConfig = {
            name: 'test',
            nodes: {
                load1: loadNode(),
                load2: loadNode(),
                M: { type: 'merge', from: ['load1', 'load2'] } as NodeConfig,
                F: { type: 'filter', from: ['M'], rule: { type: 'field', field: 'x', op: 'eq', value: 1 } } as NodeConfig,
                map1: { type: 'map', from: ['F'], prompt: 'do {{x}}' } as NodeConfig,
                R: { type: 'reduce', from: ['map1'], strategy: 'json' } as NodeConfig,
            },
        };
        expect(() => validate(config)).not.toThrow();
    });
});
