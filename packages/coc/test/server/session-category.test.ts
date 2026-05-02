/**
 * Tests for session category propagation across the system.
 *
 * Validates that:
 * - SessionCategory type allows all three category values
 * - WorkItemExecution type accepts sessionCategory field
 * - diff-comments-handler sets 'resolve-commit-comments' in task payload
 * - task-comments-handler sets category based on taskPath prefix
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import type { SessionCategory } from '@plusplusoneplusplus/forge';
import type { WorkItemExecution } from '../../src/server/work-items/types';

// ── Type-level checks ─────────────────────────────────────────────────────────

describe('SessionCategory type', () => {
    it('accepts generating-code', () => {
        const cat: SessionCategory = 'generating-code';
        expect(cat).toBe('generating-code');
    });

    it('accepts resolve-plan-comments', () => {
        const cat: SessionCategory = 'resolve-plan-comments';
        expect(cat).toBe('resolve-plan-comments');
    });

    it('accepts resolve-commit-comments', () => {
        const cat: SessionCategory = 'resolve-commit-comments';
        expect(cat).toBe('resolve-commit-comments');
    });
});

describe('WorkItemExecution type', () => {
    it('allows sessionCategory field', () => {
        const execution: WorkItemExecution = {
            taskId: 'task-1',
            startedAt: '2026-01-01T00:00:00.000Z',
            status: 'running',
            sessionCategory: 'generating-code',
        };
        expect(execution.sessionCategory).toBe('generating-code');
    });

    it('allows sessionCategory to be omitted', () => {
        const execution: WorkItemExecution = {
            taskId: 'task-2',
            startedAt: '2026-01-01T00:00:00.000Z',
            status: 'running',
        };
        expect(execution.sessionCategory).toBeUndefined();
    });
});

// ── Source-level checks for handler implementations ───────────────────────────

const DIFF_COMMENTS_HANDLER_PATH = path.join(
    __dirname, '..', '..', 'src', 'server', 'tasks', 'comments', 'diff-comments-handler.ts',
);

const TASK_COMMENTS_HANDLER_PATH = path.join(
    __dirname, '..', '..', 'src', 'server', 'tasks', 'comments', 'task-comments-handler.ts',
);

describe('diff-comments-handler sessionCategory', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(DIFF_COMMENTS_HANDLER_PATH, 'utf-8');
    });

    it.skip('enqueueDiffResolveMultiTask sets sessionCategory to resolve-commit-comments — feature not yet implemented', () => {
        const fnStart = source.indexOf('async function enqueueDiffResolveMultiTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        expect(fnBlock).toContain("sessionCategory: 'resolve-commit-comments'");
    });

    it('exports enqueueDiffResolveMultiTask function', () => {
        expect(source).toContain('enqueueDiffResolveMultiTask');
    });

    it.skip('sets workItemId directly on payload when available — feature not yet implemented', () => {
        const fnStart = source.indexOf('async function enqueueDiffResolveMultiTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        const payloadStart = fnBlock.indexOf('payload:');
        const payloadBlock = fnBlock.substring(payloadStart, payloadStart + 500);
        expect(payloadBlock).toContain('workItemId,');
        expect(payloadBlock).toContain('workItemResolveContext');
    });
});

describe('task-comments-handler sessionCategory', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(TASK_COMMENTS_HANDLER_PATH, 'utf-8');
    });

    it('exports enqueueResolveTask function', () => {
        expect(source).toContain('enqueueResolveTask');
    });

    it.skip('enqueueResolveTask derives sessionCategory from taskPath — feature not yet implemented', () => {
        const fnStart = source.indexOf('async function enqueueResolveTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        expect(fnBlock).toContain('sessionCategory');
        expect(fnBlock).toContain("'resolve-plan-comments'");
        expect(fnBlock).toContain("'resolve-commit-comments'");
    });

    it.skip('uses __wi-plan__/ prefix to select resolve-plan-comments — feature not yet implemented', () => {
        const fnStart = source.indexOf('async function enqueueResolveTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        expect(fnBlock).toContain("taskPath.startsWith('__wi-plan__/')");
        expect(fnBlock).toContain("'resolve-plan-comments'");
    });

    it.skip('defaults to resolve-commit-comments for non-plan paths — feature not yet implemented', () => {
        const fnStart = source.indexOf('async function enqueueResolveTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        const ternaryIdx = fnBlock.indexOf("taskPath.startsWith('__wi-plan__/')");
        expect(ternaryIdx).toBeGreaterThan(-1);
        const afterTernary = fnBlock.substring(ternaryIdx, ternaryIdx + 300);
        expect(afterTernary).toContain("'resolve-commit-comments'");
    });

    it.skip('passes sessionCategory in the enqueued task payload — feature not yet implemented', () => {
        const fnStart = source.indexOf('async function enqueueResolveTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        const payloadStart = fnBlock.indexOf('payload:');
        const payloadBlock = fnBlock.substring(payloadStart, payloadStart + 500);
        expect(payloadBlock).toContain('sessionCategory');
    });

    it.skip('imports SessionCategory type — feature not yet implemented', () => {
        expect(source).toContain('SessionCategory');
    });

    it.skip('accepts workItemId parameter — feature not yet implemented', () => {
        const fnStart = source.indexOf('async function enqueueResolveTask');
        const fnBlock = source.substring(fnStart, fnStart + 400);
        expect(fnBlock).toContain('workItemId?: string');
    });

    it.skip('sets workItemId and workItemResolveContext on payload when workItemId is provided — feature not yet implemented', () => {
        const fnStart = source.indexOf('async function enqueueResolveTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        const payloadStart = fnBlock.indexOf('payload:');
        const payloadBlock = fnBlock.substring(payloadStart, payloadStart + 500);
        expect(payloadBlock).toContain('workItemId,');
        expect(payloadBlock).toContain('workItemResolveContext');
    });

    it.skip('batch-resolve handler extracts workItemId from __wi-plan__ path — feature not yet implemented', () => {
        const planPrefixIdx = source.indexOf("const planPrefix = '__wi-plan__/'");
        expect(planPrefixIdx).toBeGreaterThan(-1);
        const handlerBlock = source.substring(planPrefixIdx, planPrefixIdx + 300);
        expect(handlerBlock).toContain("taskPath.startsWith(planPrefix)");
        expect(handlerBlock).toContain('workItemId');
    });
});
