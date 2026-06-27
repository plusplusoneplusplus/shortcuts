/**
 * buildCiFailurePrompt / buildBranchDeliveryContract Tests
 *
 * Locks the AC-03 "fix on the existing branch" contract into the auto-fix prompt:
 * the agent must stay on the PR's existing branch and push there, and must NOT
 * create a new PR, switch branches, hard-reset, or commit to `main`. Also covers
 * the existing prompt content (PR number, failing-check names + URLs) so the
 * additive contract does not regress AC-02's injected context.
 */

import { describe, it, expect } from 'vitest';
import {
    buildCiFailurePrompt,
    buildBranchDeliveryContract,
    buildLogExcerptBlock,
} from '../../../src/server/triggers/ci-failure-prompt';

describe('buildBranchDeliveryContract (AC-03)', () => {
    it('binds every prohibition when no branch name is known', () => {
        const text = buildBranchDeliveryContract().join('\n');
        expect(text).toContain("the PR's existing branch");
        expect(text).toMatch(/push it to that same branch/i);
        expect(text).toMatch(/Do NOT create a new pull request/i);
        expect(text).toContain('git checkout');
        expect(text).toContain('git switch');
        expect(text).toContain('git reset --hard');
        expect(text).toMatch(/Do NOT commit to `main`/i);
    });

    it('names the branch explicitly when known', () => {
        const text = buildBranchDeliveryContract('feature/fix-ci').join('\n');
        expect(text).toContain('`feature/fix-ci`');
        // still carries the full prohibition set
        expect(text).toContain('git reset --hard');
        expect(text).toMatch(/Do NOT commit to `main`/i);
    });

    it('treats a blank/whitespace branch as unknown', () => {
        const text = buildBranchDeliveryContract('   ').join('\n');
        expect(text).toContain("the PR's existing branch");
        expect(text).not.toContain('``');
    });
});

describe('buildCiFailurePrompt', () => {
    it('names the PR and each failing check with its details URL', () => {
        const prompt = buildCiFailurePrompt(42, [
            { name: 'build', detailsUrl: 'https://ci/build' },
            { name: 'lint', detailsUrl: 'https://ci/lint' },
        ]);
        expect(prompt).toContain('#42');
        expect(prompt).toContain('build');
        expect(prompt).toContain('https://ci/build');
        expect(prompt).toContain('lint');
        expect(prompt).toContain('https://ci/lint');
    });

    it('embeds the full delivery contract', () => {
        const prompt = buildCiFailurePrompt(7, [{ name: 'build' }]);
        expect(prompt).toMatch(/Do NOT create a new pull request/i);
        expect(prompt).toContain('git checkout');
        expect(prompt).toContain('git switch');
        expect(prompt).toContain('git reset --hard');
        expect(prompt).toMatch(/Do NOT commit to `main`/i);
    });

    it('threads the branch name through into the contract', () => {
        const prompt = buildCiFailurePrompt(7, [{ name: 'build' }], 'ralph/ci-fix');
        expect(prompt).toContain('`ralph/ci-fix`');
    });

    it('still renders with no failing checks', () => {
        const prompt = buildCiFailurePrompt(7, []);
        expect(prompt).toContain('(no check details available)');
        // contract is present even when checks are unavailable
        expect(prompt).toContain('git reset --hard');
    });

    it('injects a truncated log excerpt as a fenced block when provided (AC-02)', () => {
        const prompt = buildCiFailurePrompt(7, [{ name: 'build' }], undefined, 'error: boom\nstack frame');
        expect(prompt).toContain('Recent failure log excerpt');
        expect(prompt).toContain('error: boom');
        expect(prompt).toContain('stack frame');
        // fenced as a code block
        expect(prompt).toMatch(/```text\nerror: boom\nstack frame\n```/);
        // still binds the delivery contract after the excerpt
        expect(prompt).toContain('git reset --hard');
    });

    it('omits the excerpt block when no log excerpt is supplied', () => {
        const prompt = buildCiFailurePrompt(7, [{ name: 'build' }]);
        expect(prompt).not.toContain('Recent failure log excerpt');
        expect(prompt).not.toContain('```');
    });
});

describe('buildLogExcerptBlock (AC-02)', () => {
    it('returns an empty array for missing/blank excerpts', () => {
        expect(buildLogExcerptBlock()).toEqual([]);
        expect(buildLogExcerptBlock('')).toEqual([]);
        expect(buildLogExcerptBlock('   \n  \t ')).toEqual([]);
    });

    it('wraps the excerpt in a fenced block with a heading', () => {
        const block = buildLogExcerptBlock('line 1\nline 2').join('\n');
        expect(block).toContain('Recent failure log excerpt');
        expect(block).toMatch(/```text\nline 1\nline 2\n```/);
    });

    it('uses a longer fence when the excerpt itself contains triple backticks', () => {
        // A log line containing ``` must not break out of the fenced block.
        const block = buildLogExcerptBlock('before\n```\ncode\n```\nafter').join('\n');
        // opening/closing fence must be longer than any backtick run inside
        expect(block).toContain('````text');
        expect(block.endsWith('````')).toBe(true);
        expect(block).toContain('```\ncode');
    });
});
