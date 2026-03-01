import { describe, it, expect } from 'vitest';
import { mapErrorsToPhases, getNodeErrors } from '../../../../src/server/spa/client/react/processes/dag/errorMapping';

describe('mapErrorsToPhases', () => {
    it('maps input-related errors to input phase', () => {
        const result = mapErrorsToPhases(['Missing input path']);
        expect(result.byPhase.input).toEqual(['Missing input path']);
        expect(result.unmapped).toEqual([]);
    });

    it('maps filter errors to filter phase', () => {
        const result = mapErrorsToPhases(['Invalid filter expression']);
        expect(result.byPhase.filter).toEqual(['Invalid filter expression']);
    });

    it('maps map errors to map phase', () => {
        const result = mapErrorsToPhases(['Missing prompt template']);
        expect(result.byPhase.map).toEqual(['Missing prompt template']);
    });

    it('maps reduce errors to reduce phase', () => {
        const result = mapErrorsToPhases(["Reduce type 'invalid' is not supported"]);
        expect(result.byPhase.reduce).toEqual(["Reduce type 'invalid' is not supported"]);
    });

    it('maps job errors to job phase', () => {
        const result = mapErrorsToPhases(['Job step failed']);
        expect(result.byPhase.job).toEqual(['Job step failed']);
    });

    it('puts unmapped errors in unmapped array', () => {
        const result = mapErrorsToPhases(['Pipeline name is required']);
        expect(result.unmapped).toEqual(['Pipeline name is required']);
        expect(Object.keys(result.byPhase)).toHaveLength(0);
    });

    it('handles multiple errors on same phase', () => {
        const result = mapErrorsToPhases(['Missing prompt template', 'Invalid model name']);
        expect(result.byPhase.map).toHaveLength(2);
        expect(result.byPhase.map).toEqual(['Missing prompt template', 'Invalid model name']);
    });

    it('matches case-insensitively', () => {
        const result = mapErrorsToPhases(['INPUT file not found']);
        expect(result.byPhase.input).toEqual(['INPUT file not found']);
    });

    it('returns empty result for empty errors array', () => {
        const result = mapErrorsToPhases([]);
        expect(result.byPhase).toEqual({});
        expect(result.unmapped).toEqual([]);
    });

    it('maps csv keyword to input phase', () => {
        const result = mapErrorsToPhases(['CSV file is malformed']);
        expect(result.byPhase.input).toEqual(['CSV file is malformed']);
    });

    it('maps source keyword to input phase', () => {
        const result = mapErrorsToPhases(['Invalid source configuration']);
        expect(result.byPhase.input).toEqual(['Invalid source configuration']);
    });

    it('maps concurrency keyword to map phase', () => {
        const result = mapErrorsToPhases(['Concurrency must be positive']);
        expect(result.byPhase.map).toEqual(['Concurrency must be positive']);
    });

    it('maps batch keyword to map phase', () => {
        const result = mapErrorsToPhases(['Batch size too large']);
        expect(result.byPhase.map).toEqual(['Batch size too large']);
    });

    it('handles mixed mapped and unmapped errors', () => {
        const result = mapErrorsToPhases([
            'Missing input path',
            'Invalid filter expression',
            'Pipeline name is required',
        ]);
        expect(result.byPhase.input).toEqual(['Missing input path']);
        expect(result.byPhase.filter).toEqual(['Invalid filter expression']);
        expect(result.unmapped).toEqual(['Pipeline name is required']);
    });
});

describe('getNodeErrors', () => {
    it('combines phase-specific and unmapped errors', () => {
        const phaseErrors = mapErrorsToPhases(['Missing prompt template', 'Pipeline name is required']);
        const errors = getNodeErrors(phaseErrors, 'map');
        expect(errors).toEqual(['Missing prompt template', 'Pipeline name is required']);
    });

    it('returns only unmapped for unmatched phase', () => {
        const phaseErrors = mapErrorsToPhases(['Missing prompt template', 'Pipeline name is required']);
        const errors = getNodeErrors(phaseErrors, 'filter');
        expect(errors).toEqual(['Pipeline name is required']);
    });

    it('returns empty array when no errors match phase and no unmapped', () => {
        const phaseErrors = mapErrorsToPhases(['Missing prompt template']);
        const errors = getNodeErrors(phaseErrors, 'filter');
        expect(errors).toEqual([]);
    });

    it('returns only phase-specific when no unmapped errors', () => {
        const phaseErrors = mapErrorsToPhases(['Invalid filter expression']);
        const errors = getNodeErrors(phaseErrors, 'filter');
        expect(errors).toEqual(['Invalid filter expression']);
    });
});

describe('getNodeErrors — previewMode', () => {
    it('unmapped errors only appear on first node in preview mode', () => {
        const phaseErrors = mapErrorsToPhases(['Pipeline name is required']);
        const opts = { previewMode: true, firstPhase: 'input' as const };
        expect(getNodeErrors(phaseErrors, 'input', opts)).toEqual(['Pipeline name is required']);
        expect(getNodeErrors(phaseErrors, 'map', opts)).toEqual([]);
        expect(getNodeErrors(phaseErrors, 'reduce', opts)).toEqual([]);
    });

    it('phase-specific errors still appear on their node in preview mode', () => {
        const phaseErrors = mapErrorsToPhases(['Missing prompt template', 'Pipeline name is required']);
        const opts = { previewMode: true, firstPhase: 'input' as const };
        expect(getNodeErrors(phaseErrors, 'map', opts)).toEqual(['Missing prompt template']);
        expect(getNodeErrors(phaseErrors, 'input', opts)).toEqual(['Pipeline name is required']);
    });

    it('first node gets both specific and unmapped in preview mode', () => {
        const phaseErrors = mapErrorsToPhases(['Missing input path', 'Pipeline name is required']);
        const opts = { previewMode: true, firstPhase: 'input' as const };
        expect(getNodeErrors(phaseErrors, 'input', opts)).toEqual(['Missing input path', 'Pipeline name is required']);
    });

    it('without previewMode option, unmapped errors appear on all nodes (default)', () => {
        const phaseErrors = mapErrorsToPhases(['Pipeline name is required']);
        expect(getNodeErrors(phaseErrors, 'input')).toEqual(['Pipeline name is required']);
        expect(getNodeErrors(phaseErrors, 'map')).toEqual(['Pipeline name is required']);
        expect(getNodeErrors(phaseErrors, 'reduce')).toEqual(['Pipeline name is required']);
    });

    it('previewMode with no unmapped errors returns only specific errors', () => {
        const phaseErrors = mapErrorsToPhases(['Missing prompt template']);
        const opts = { previewMode: true, firstPhase: 'input' as const };
        expect(getNodeErrors(phaseErrors, 'map', opts)).toEqual(['Missing prompt template']);
        expect(getNodeErrors(phaseErrors, 'input', opts)).toEqual([]);
    });
});
