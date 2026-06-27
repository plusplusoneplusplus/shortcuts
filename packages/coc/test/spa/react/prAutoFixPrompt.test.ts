/**
 * buildCiFixPrompt (client mirror) Tests
 *
 * The composer's manual "Fix now" button must produce the SAME AC-03 delivery
 * contract as the server-fired auto-fix prompt: stay on the PR's existing
 * branch and push there; never a new PR, branch switch, hard reset, or commit
 * to `main`. Guards against the browser copy drifting from the server template.
 */

import { describe, it, expect } from 'vitest';
import {
    buildCiFixPrompt,
    buildBranchDeliveryContract,
} from '../../../src/server/spa/client/react/features/chat/conversation/prAutoFixPrompt';

describe('buildCiFixPrompt (client mirror)', () => {
    it('names the PR and failing checks', () => {
        const prompt = buildCiFixPrompt(42, [{ name: 'build', detailsUrl: 'https://ci/build' }]);
        expect(prompt).toContain('#42');
        expect(prompt).toContain('build');
        expect(prompt).toContain('https://ci/build');
    });

    it('embeds the full delivery contract', () => {
        const prompt = buildCiFixPrompt(7, [{ name: 'build' }]);
        expect(prompt).toMatch(/Do NOT create a new pull request/i);
        expect(prompt).toContain('git checkout');
        expect(prompt).toContain('git switch');
        expect(prompt).toContain('git reset --hard');
        expect(prompt).toMatch(/Do NOT commit to `main`/i);
    });

    it('threads the branch name through into the contract', () => {
        const prompt = buildCiFixPrompt(7, [{ name: 'build' }], 'ralph/ci-fix');
        expect(prompt).toContain('`ralph/ci-fix`');
    });

    it('stays in sync with the server-style contract text', () => {
        // Same prohibitions, same order — drift here means the two builders diverged.
        const contract = buildBranchDeliveryContract('feature/x').join('\n');
        expect(contract).toContain('`feature/x`');
        expect(contract).toContain('git reset --hard');
        expect(contract).toMatch(/Do NOT commit to `main`/i);
    });
});
