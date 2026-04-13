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
    __dirname, '..', '..', 'src', 'server', 'diff-comments-handler.ts',
);

const TASK_COMMENTS_HANDLER_PATH = path.join(
    __dirname, '..', '..', 'src', 'server', 'task-comments-handler.ts',
);

describe('diff-comments-handler sessionCategory', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(DIFF_COMMENTS_HANDLER_PATH, 'utf-8');
    });

    it('enqueueDiffResolveMultiTask sets sessionCategory to resolve-commit-comments', () => {
        const fnStart = source.indexOf('async function enqueueDiffResolveMultiTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        expect(fnBlock).toContain("sessionCategory: 'resolve-commit-comments'");
    });

    it('imports SessionCategory type', () => {
        expect(source).toContain('SessionCategory');
    });
});

describe('task-comments-handler sessionCategory', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(TASK_COMMENTS_HANDLER_PATH, 'utf-8');
    });

    it('enqueueResolveTask derives sessionCategory from taskPath', () => {
        const fnStart = source.indexOf('async function enqueueResolveTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        expect(fnBlock).toContain('sessionCategory');
        expect(fnBlock).toContain("'resolve-plan-comments'");
        expect(fnBlock).toContain("'resolve-commit-comments'");
    });

    it('uses __wi-plan__/ prefix to select resolve-plan-comments', () => {
        const fnStart = source.indexOf('async function enqueueResolveTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        expect(fnBlock).toContain("taskPath.startsWith('__wi-plan__/')");
        expect(fnBlock).toContain("'resolve-plan-comments'");
    });

    it('defaults to resolve-commit-comments for non-plan paths', () => {
        const fnStart = source.indexOf('async function enqueueResolveTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        const ternaryIdx = fnBlock.indexOf("taskPath.startsWith('__wi-plan__/')");
        expect(ternaryIdx).toBeGreaterThan(-1);
        const afterTernary = fnBlock.substring(ternaryIdx, ternaryIdx + 300);
        expect(afterTernary).toContain("'resolve-commit-comments'");
    });

    it('passes sessionCategory in the enqueued task payload', () => {
        const fnStart = source.indexOf('async function enqueueResolveTask');
        const fnBlock = source.substring(fnStart, fnStart + 1200);
        const payloadStart = fnBlock.indexOf('payload:');
        const payloadBlock = fnBlock.substring(payloadStart, payloadStart + 500);
        expect(payloadBlock).toContain('sessionCategory');
    });

    it('imports SessionCategory type', () => {
        expect(source).toContain('SessionCategory');
    });
});
