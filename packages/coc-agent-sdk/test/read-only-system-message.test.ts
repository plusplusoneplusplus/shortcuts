import { describe, expect, it } from 'vitest';
import { READ_ONLY_SYSTEM_MESSAGE } from '../src/types';

describe('READ_ONLY_SYSTEM_MESSAGE', () => {
    it('allows approval only with an explicit user request for the specific PR', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain(
            'You may approve a pull request only when the user explicitly requests approval of that specific PR.',
        );
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain(
            'This permits submitting an approval review or vote only;',
        );
    });

    it('does not treat a review request as permission to approve', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain(
            'Reviewing a PR does not imply permission to approve it.',
        );
    });

    it('keeps approval authorization separate from other write actions', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain(
            'it does not permit edits, commits, pushes, merges, or other PR changes.',
        );
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain(
            'Otherwise, only read files, search code, and answer questions.',
        );
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain(
            'For repository changes, ask the user to switch to autopilot or plan mode.',
        );
    });

    it('preserves the tagged directive and existing file exceptions', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE.trim()).toMatch(
            /^<coc-read-only-mode>\n[\s\S]*\n<\/coc-read-only-mode>$/,
        );
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain(
            'You may edit the plan file, attached note file, explicitly requested .goal.md files, and files outside the repository, including temporary files.',
        );
    });
});
