import type { PipelinePhase } from '@plusplusoneplusplus/pipeline-core';

export interface PhaseErrors {
    /** Errors mapped to specific phases, keyed by PipelinePhase */
    byPhase: Partial<Record<PipelinePhase, string[]>>;
    /** Errors that could not be mapped to any specific phase */
    unmapped: string[];
}

const phaseKeywords: Array<{ phase: PipelinePhase; keywords: string[] }> = [
    { phase: 'input',  keywords: ['input', 'csv', 'path', 'file', 'source'] },
    { phase: 'filter', keywords: ['filter'] },
    { phase: 'map',    keywords: ['map', 'prompt', 'output', 'model', 'parallel', 'concurrency', 'batch'] },
    { phase: 'reduce', keywords: ['reduce'] },
    { phase: 'job',    keywords: ['job'] },
];

/**
 * Map validation error strings to pipeline phases by keyword matching.
 * Each error is matched to the first phase whose keyword appears (case-insensitive).
 * Errors matching no phase go into `unmapped`.
 */
export function mapErrorsToPhases(errors: string[]): PhaseErrors {
    const result: PhaseErrors = { byPhase: {}, unmapped: [] };
    for (const error of errors) {
        const lower = error.toLowerCase();
        let matched = false;
        for (const { phase, keywords } of phaseKeywords) {
            if (keywords.some(kw => lower.includes(kw))) {
                if (!result.byPhase[phase]) result.byPhase[phase] = [];
                result.byPhase[phase]!.push(error);
                matched = true;
                break;
            }
        }
        if (!matched) {
            result.unmapped.push(error);
        }
    }
    return result;
}

/**
 * Get the list of validation errors that should be displayed on a specific node.
 * Returns the phase-specific errors plus any unmapped errors (shown on all nodes).
 */
export function getNodeErrors(phaseErrors: PhaseErrors, phase: PipelinePhase): string[] {
    const specific = phaseErrors.byPhase[phase] ?? [];
    return [...specific, ...phaseErrors.unmapped];
}
