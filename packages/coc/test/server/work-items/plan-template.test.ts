/**
 * Plan Template Tests
 */

import { describe, it, expect } from 'vitest';
import { WORK_ITEM_PLAN_TEMPLATE, buildPlanFromContext } from '../../../src/server/work-items/plan-template';

describe('WORK_ITEM_PLAN_TEMPLATE', () => {
    it('contains standard section headings', () => {
        expect(WORK_ITEM_PLAN_TEMPLATE).toContain('## Objective');
        expect(WORK_ITEM_PLAN_TEMPLATE).toContain('## Background');
        expect(WORK_ITEM_PLAN_TEMPLATE).toContain('## Steps');
        expect(WORK_ITEM_PLAN_TEMPLATE).toContain('## Acceptance Criteria');
        expect(WORK_ITEM_PLAN_TEMPLATE).toContain('## Notes');
    });

    it('includes checkbox placeholder for Steps', () => {
        expect(WORK_ITEM_PLAN_TEMPLATE).toContain('- [ ]');
    });

    it('is a non-empty string', () => {
        expect(typeof WORK_ITEM_PLAN_TEMPLATE).toBe('string');
        expect(WORK_ITEM_PLAN_TEMPLATE.length).toBeGreaterThan(50);
    });
});

describe('buildPlanFromContext', () => {
    it('includes the title as the objective', () => {
        const result = buildPlanFromContext('Fix login bug');
        expect(result).toContain('Fix login bug');
        expect(result).toContain('## Objective');
    });

    it('includes all standard sections', () => {
        const result = buildPlanFromContext('My task');
        expect(result).toContain('## Objective');
        expect(result).toContain('## Background');
        expect(result).toContain('## Steps');
        expect(result).toContain('## Acceptance Criteria');
        expect(result).toContain('## Notes');
    });

    it('uses description as background when provided', () => {
        const result = buildPlanFromContext('My task', 'This is needed to fix a performance regression.');
        expect(result).toContain('This is needed to fix a performance regression.');
    });

    it('uses placeholder background when description is empty', () => {
        const result = buildPlanFromContext('My task', '');
        expect(result).toContain('_Add context and motivation here._');
    });

    it('uses placeholder background when description is undefined', () => {
        const result = buildPlanFromContext('My task');
        expect(result).toContain('_Add context and motivation here._');
    });

    it('includes checkbox step placeholder', () => {
        const result = buildPlanFromContext('My task');
        expect(result).toContain('- [ ]');
    });

    it('trims whitespace in description', () => {
        const result = buildPlanFromContext('My task', '  context with whitespace  ');
        expect(result).toContain('context with whitespace');
    });

    it('returns a string', () => {
        const result = buildPlanFromContext('Title', 'Desc');
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });
});
