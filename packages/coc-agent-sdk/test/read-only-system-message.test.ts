import { describe, expect, it } from 'vitest';
import { READ_ONLY_SYSTEM_MESSAGE } from '../src/types';

describe('READ_ONLY_SYSTEM_MESSAGE', () => {
    it('allows PR approval with a short exception', () => {
        expect(READ_ONLY_SYSTEM_MESSAGE).toContain('PR approval is allowed.');
    });

    it('preserves read-only restrictions for other repository changes', () => {
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
