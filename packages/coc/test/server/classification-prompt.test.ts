/**
 * Tests for classification-prompt — target-specific context only.
 */

import { describe, it, expect } from 'vitest';
import { renderClassificationPrompt } from '../../src/server/repos/classification-prompt';

describe('classification-prompt', () => {
    it('renders a minimal PR prompt with a classify-diff skill pointer', () => {
        const result = renderClassificationPrompt('pr', '42', 'my-repo');

        expect(result).toContain('Classify every hunk in pull request #42 of this repository.');
        expect(result).toContain('Use the available git and gh CLI tools to read the PR diff.');
        expect(result).toContain('Use the `classify-diff` skill');
        expect(result).not.toContain('hunkIndex');
        expect(result).not.toContain('logic|mechanical|test|generated');
        expect(result).not.toContain('saveClassification');
        expect(result).not.toContain('${');
    });

    it('renders a minimal commit prompt with git CLI fetch instructions', () => {
        const result = renderClassificationPrompt('commit', 'abc1234', 'my-repo');

        expect(result).toContain('Classify every hunk in commit abc1234 of this repository.');
        expect(result).toContain('Use the available git CLI tools to read the commit diff.');
        expect(result).toContain('Do NOT ask me for the diff');
        expect(result).toContain('Use the `classify-diff` skill');
    });

    it('renders a minimal branch-range prompt with git diff fetch instructions', () => {
        const result = renderClassificationPrompt('branch-range', 'main..feature', 'my-repo');

        expect(result).toContain('Classify every hunk in the branch range main..feature of this repository.');
        expect(result).toContain('Use the available git CLI tools to read the diff (git diff).');
        expect(result).toContain('Use the `classify-diff` skill');
    });

    it('ignores dataDir because diff classification is no longer admin-overridable', () => {
        const withDataDir = renderClassificationPrompt('pr', '42', 'my-repo', '/data');
        const withoutDataDir = renderClassificationPrompt('pr', '42', 'my-repo');

        expect(withDataDir).toBe(withoutDataDir);
    });
});
