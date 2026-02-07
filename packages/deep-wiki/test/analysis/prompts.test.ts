/**
 * Analysis Prompt Tests
 *
 * Tests for analysis prompt template generation, depth variants,
 * and template variable substitution.
 */

import { describe, it, expect } from 'vitest';
import {
    buildAnalysisPromptTemplate,
    getAnalysisOutputFields,
    getInvestigationSteps,
} from '../../src/analysis/prompts';

describe('Analysis Prompts', () => {
    // ========================================================================
    // Template variable placeholders
    // ========================================================================

    describe('buildAnalysisPromptTemplate', () => {
        it('should contain all required template variables', () => {
            const template = buildAnalysisPromptTemplate('normal');
            const requiredVars = [
                '{{moduleName}}', '{{moduleId}}', '{{modulePath}}',
                '{{purpose}}', '{{keyFiles}}', '{{dependencies}}',
                '{{dependents}}', '{{complexity}}', '{{category}}',
                '{{projectName}}', '{{architectureNotes}}',
            ];
            for (const v of requiredVars) {
                expect(template).toContain(v);
            }
        });

        it('should contain the JSON schema', () => {
            const template = buildAnalysisPromptTemplate('normal');
            expect(template).toContain('"moduleId"');
            expect(template).toContain('"overview"');
            expect(template).toContain('"keyConcepts"');
        });

        it('should contain JSON output instruction', () => {
            const template = buildAnalysisPromptTemplate('normal');
            expect(template).toContain('Return ONLY the JSON object');
        });
    });

    // ========================================================================
    // Depth variants
    // ========================================================================

    describe('depth variants', () => {
        it('should produce different prompts for each depth', () => {
            const shallow = buildAnalysisPromptTemplate('shallow');
            const normal = buildAnalysisPromptTemplate('normal');
            const deep = buildAnalysisPromptTemplate('deep');

            // All should have the base context
            for (const template of [shallow, normal, deep]) {
                expect(template).toContain('{{moduleName}}');
                expect(template).toContain('{{projectName}}');
            }

            // Shallow should be simpler
            expect(shallow).toContain('shallow analysis');
            expect(shallow).not.toContain('exhaustively investigate');

            // Normal has 7 steps
            expect(normal).toContain('deeply investigate');

            // Deep has 10 steps
            expect(deep).toContain('exhaustively investigate');
            expect(deep).toContain('performance characteristics');
        });

        it('shallow should mention limited code examples', () => {
            const shallow = buildAnalysisPromptTemplate('shallow');
            expect(shallow).toContain('1 example maximum');
        });

        it('deep should request 3-5 code examples', () => {
            const deep = buildAnalysisPromptTemplate('deep');
            expect(deep).toContain('3-5');
        });

        it('normal should request 2-3 code examples', () => {
            const normal = buildAnalysisPromptTemplate('normal');
            expect(normal).toContain('2-3');
        });
    });

    // ========================================================================
    // Investigation steps
    // ========================================================================

    describe('getInvestigationSteps', () => {
        it('should return different content for each depth', () => {
            const shallow = getInvestigationSteps('shallow');
            const normal = getInvestigationSteps('normal');
            const deep = getInvestigationSteps('deep');

            expect(shallow).not.toBe(normal);
            expect(normal).not.toBe(deep);
        });

        it('all depths should mention grep/glob/view tools', () => {
            for (const depth of ['shallow', 'normal', 'deep'] as const) {
                const steps = getInvestigationSteps(depth);
                expect(steps).toContain('grep');
                expect(steps).toContain('glob');
                expect(steps).toContain('view');
            }
        });
    });

    // ========================================================================
    // Output fields
    // ========================================================================

    describe('getAnalysisOutputFields', () => {
        it('should return all expected fields', () => {
            const fields = getAnalysisOutputFields();
            expect(fields).toContain('moduleId');
            expect(fields).toContain('overview');
            expect(fields).toContain('keyConcepts');
            expect(fields).toContain('publicAPI');
            expect(fields).toContain('internalArchitecture');
            expect(fields).toContain('dataFlow');
            expect(fields).toContain('patterns');
            expect(fields).toContain('errorHandling');
            expect(fields).toContain('codeExamples');
            expect(fields).toContain('dependencies');
            expect(fields).toContain('suggestedDiagram');
        });

        it('should return 11 fields', () => {
            expect(getAnalysisOutputFields()).toHaveLength(11);
        });
    });
});
