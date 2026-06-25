import { describe, expect, it } from 'vitest';
import { classifyRalphProgressStagnation } from '../../src/ralph';

describe('classifyRalphProgressStagnation', () => {
    it('classifies explicit manual-only remaining work as manualVerificationOnly', () => {
        expect(classifyRalphProgressStagnation([
            'Files: src/a.ts, test/a.test.ts',
            'Decisions: automated tests and build pass.',
            'Remaining: manual verification only - user should run the product demo.',
        ].join('\n'))).toBe('manualVerificationOnly');
    });

    it('classifies unavailable credentials and manual demos as manualVerificationOnly', () => {
        expect(classifyRalphProgressStagnation([
            'Files: src/oauth.ts',
            'Decisions: local validation passed.',
            'Remaining: remote credentials are unavailable; needs user manual demo in staging.',
        ].join('\n'))).toBe('manualVerificationOnly');
    });

    it('classifies final-check-only remaining work as manualVerificationOnly', () => {
        expect(classifyRalphProgressStagnation([
            'Files: src/feature.ts',
            'Decisions: all autonomous validation is done.',
            'Remaining: final-check only.',
        ].join('\n'))).toBe('manualVerificationOnly');
    });

    it('continues when concrete autonomous implementation work remains', () => {
        expect(classifyRalphProgressStagnation([
            'Files: src/a.ts',
            'Decisions: parser started.',
            'Remaining: implement the edge-case parser branch and add unit tests.',
        ].join('\n'))).toBe('continue');
    });

    it('continues for ambiguous remaining text', () => {
        expect(classifyRalphProgressStagnation([
            'Files: src/a.ts',
            'Decisions: partial progress.',
            'Remaining: more follow-up work.',
        ].join('\n'))).toBe('continue');
    });

    it('continues when manual review is listed alongside concrete fixes', () => {
        expect(classifyRalphProgressStagnation([
            'Files: src/a.ts',
            'Decisions: partial progress.',
            'Remaining: manual review plus fix the failing build.',
        ].join('\n'))).toBe('continue');
    });

    it('warns on repeated final-validation-only RALPH_NEXT sections without stopping', () => {
        expect(classifyRalphProgressStagnation({
            progress: 'Remaining: more',
            recentSections: [
                { signal: 'RALPH_NEXT', body: 'Remaining: final validation pass.' },
                { signal: 'RALPH_NEXT', body: 'Remaining: final validation only.' },
            ],
        })).toBe('warn');
    });

    it('ignores Findings when classifying Remaining text', () => {
        expect(classifyRalphProgressStagnation([
            'Files: src/a.ts, test/a.test.ts',
            'Decisions: automated checks passed.',
            'Remaining: manual verification only - user should run the product demo.',
            'Findings: implement the future parser branch if requirements change.',
        ].join('\n'))).toBe('manualVerificationOnly');
    });
});
