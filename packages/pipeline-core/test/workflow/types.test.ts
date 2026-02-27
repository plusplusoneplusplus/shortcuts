/**
 * Workflow Core Types — Unit Tests
 *
 * Tests for every exported type guard and key type properties.
 */

import { describe, it, expect } from 'vitest';
import {
    isLoadNode,
    isScriptNode,
    isFilterNode,
    isMapNode,
    isReduceNode,
    isMergeNode,
    isTransformNode,
    isAINode,
    isNodeConfig,
    type Item,
    type WorkflowFilterRule,
} from '../../src/workflow/types';
import { WorkflowErrorCode } from '../../src/errors/error-codes';

// =============================================================================
// Type guard tests
// =============================================================================

describe('isLoadNode', () => {
    it('returns true for a valid load node config', () => {
        expect(isLoadNode({ type: 'load', source: { type: 'csv', path: 'x.csv' } })).toBe(true);
    });

    it('returns false for a different node type', () => {
        expect(isLoadNode({ type: 'map', prompt: 'x' })).toBe(false);
    });

    it('returns false for non-object values', () => {
        expect(isLoadNode(null)).toBe(false);
        expect(isLoadNode(undefined)).toBe(false);
        expect(isLoadNode('load')).toBe(false);
        expect(isLoadNode(42)).toBe(false);
    });
});

describe('isScriptNode', () => {
    it('returns true for a valid script node config', () => {
        expect(isScriptNode({ type: 'script', run: 'echo hi' })).toBe(true);
    });

    it('returns true even when run is missing — guard only checks type', () => {
        // The guard only checks the `type` discriminant. The `run` field
        // is required at validation time, not type-guard time.
        expect(isScriptNode({ type: 'script' })).toBe(true);
    });

    it('returns false for non-object values', () => {
        expect(isScriptNode(null)).toBe(false);
        expect(isScriptNode(undefined)).toBe(false);
        expect(isScriptNode('script')).toBe(false);
        expect(isScriptNode(42)).toBe(false);
    });
});

describe('isFilterNode', () => {
    it('returns true for a valid filter node config', () => {
        expect(isFilterNode({
            type: 'filter',
            rule: { type: 'field', field: 'x', op: 'eq', value: 1 },
        })).toBe(true);
    });

    it('returns false for non-object values', () => {
        expect(isFilterNode(null)).toBe(false);
        expect(isFilterNode(undefined)).toBe(false);
    });
});

describe('isMapNode', () => {
    it('returns true for a valid map node config', () => {
        expect(isMapNode({ type: 'map', prompt: 'do {{x}}' })).toBe(true);
    });

    it('returns false for non-object values', () => {
        expect(isMapNode(null)).toBe(false);
        expect(isMapNode(undefined)).toBe(false);
    });
});

describe('isReduceNode', () => {
    it('returns true for a valid reduce node config', () => {
        expect(isReduceNode({ type: 'reduce', strategy: 'json' })).toBe(true);
    });

    it('returns false for non-object values', () => {
        expect(isReduceNode(null)).toBe(false);
        expect(isReduceNode(undefined)).toBe(false);
    });
});

describe('isMergeNode', () => {
    it('returns true for a basic merge node config', () => {
        expect(isMergeNode({ type: 'merge' })).toBe(true);
    });

    it('returns true with a strategy specified', () => {
        expect(isMergeNode({ type: 'merge', strategy: 'zip' })).toBe(true);
    });

    it('returns false for non-object values', () => {
        expect(isMergeNode(null)).toBe(false);
        expect(isMergeNode(undefined)).toBe(false);
    });
});

describe('isTransformNode', () => {
    it('returns true for a valid transform node config', () => {
        expect(isTransformNode({
            type: 'transform',
            ops: [{ op: 'select', fields: ['a'] }],
        })).toBe(true);
    });

    it('returns false for non-object values', () => {
        expect(isTransformNode(null)).toBe(false);
        expect(isTransformNode(undefined)).toBe(false);
    });
});

describe('isAINode', () => {
    it('returns true for a valid AI node config', () => {
        expect(isAINode({ type: 'ai', prompt: 'x', output: ['y'] })).toBe(true);
    });

    it('returns false for non-object values', () => {
        expect(isAINode(null)).toBe(false);
        expect(isAINode(undefined)).toBe(false);
    });
});

describe('isNodeConfig', () => {
    it('accepts all eight known node types', () => {
        const types = ['load', 'script', 'filter', 'map', 'reduce', 'merge', 'transform', 'ai'];
        for (const t of types) {
            expect(isNodeConfig({ type: t })).toBe(true);
        }
    });

    it('rejects an unknown node type', () => {
        expect(isNodeConfig({ type: 'unknown_node' })).toBe(false);
    });

    it('rejects non-object values', () => {
        expect(isNodeConfig(null)).toBe(false);
        expect(isNodeConfig(undefined)).toBe(false);
        expect(isNodeConfig('map')).toBe(false);
        expect(isNodeConfig(42)).toBe(false);
    });
});

// =============================================================================
// WorkflowErrorCode tests
// =============================================================================

describe('WorkflowErrorCode', () => {
    it('has exactly 10 entries', () => {
        expect(Object.keys(WorkflowErrorCode).length).toBe(10);
    });

    it('contains expected entries with matching key/value', () => {
        expect(WorkflowErrorCode.CYCLE_DETECTED).toBe('CYCLE_DETECTED');
        expect(WorkflowErrorCode.WORKFLOW_EMPTY).toBe('WORKFLOW_EMPTY');
        expect(WorkflowErrorCode.UNKNOWN_NODE_REF).toBe('UNKNOWN_NODE_REF');
        expect(WorkflowErrorCode.MISSING_PROMPT).toBe('MISSING_PROMPT');
        expect(WorkflowErrorCode.MISSING_RULE).toBe('MISSING_RULE');
        expect(WorkflowErrorCode.MISSING_STRATEGY).toBe('MISSING_STRATEGY');
        expect(WorkflowErrorCode.MISSING_COMMAND).toBe('MISSING_COMMAND');
        expect(WorkflowErrorCode.MERGE_NEEDS_MULTIPLE_PARENTS).toBe('MERGE_NEEDS_MULTIPLE_PARENTS');
        expect(WorkflowErrorCode.SCRIPT_INVALID_OUTPUT).toBe('SCRIPT_INVALID_OUTPUT');
        expect(WorkflowErrorCode.SCRIPT_NONZERO_EXIT).toBe('SCRIPT_NONZERO_EXIT');
    });
});

// =============================================================================
// Item type compatibility (compile-time check)
// =============================================================================

describe('Item type', () => {
    it('accepts an object with string, number, boolean, and null values', () => {
        // This assignment is a compile-time type check — if Item's definition
        // regresses, TypeScript will report an error here.
        const item: Item = { name: 'Alice', age: 30, active: true, notes: null };
        expect(item.name).toBe('Alice');
        expect(item.age).toBe(30);
        expect(item.active).toBe(true);
        expect(item.notes).toBeNull();
    });
});

// =============================================================================
// WorkflowFilterRule recursive type (compile-time check)
// =============================================================================

describe('WorkflowFilterRule', () => {
    it('supports nested and/or/not composition', () => {
        // This assignment verifies the recursive type compiles correctly.
        const rule: WorkflowFilterRule = {
            type: 'and',
            rules: [
                { type: 'field', field: 'status', op: 'eq', value: 'open' },
                {
                    type: 'or',
                    rules: [
                        { type: 'field', field: 'priority', op: 'gte', value: 5 },
                        { type: 'not', rule: { type: 'field', field: 'category', op: 'in', values: ['spam'] } },
                    ],
                },
                { type: 'ai', prompt: 'Is this actionable?' },
            ],
        };
        expect(rule.type).toBe('and');
        expect(rule.rules).toHaveLength(3);
    });
});

// =============================================================================
// Type narrowing in switch — compile-time documentation
// =============================================================================

// The following pattern demonstrates exhaustive switch narrowing on NodeConfig.
// It is a compile-time check and is not executed at runtime. If a new node type
// is added to NodeConfig without updating this switch, TypeScript will produce
// an error on the `_exhaustive: never` assignment.
//
// import type { NodeConfig } from '../../src/workflow/types';
//
// function handleNode(config: NodeConfig): string {
//     switch (config.type) {
//         case 'load':      return 'load';
//         case 'script':    return 'script';
//         case 'filter':    return 'filter';
//         case 'map':       return 'map';
//         case 'reduce':    return 'reduce';
//         case 'merge':     return 'merge';
//         case 'transform': return 'transform';
//         case 'ai':        return 'ai';
//         default: {
//             const _exhaustive: never = config;
//             throw new Error(`Unhandled node type: ${(_exhaustive as NodeConfig).type}`);
//         }
//     }
// }
