import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testCopilotToken } from './token-fixture';

describe('synthetic Copilot credential fixtures', () => {
    it.each(['gho', 'ghu', 'ghp', 'ghs', 'github_pat'] as const)('preserves the %s family with an explicitly non-secret body', family => {
        const token = testCopilotToken(family, 'selected');
        expect(token.startsWith(`${family}_`)).toBe(true);
        expect(token).toContain('_not_a_real_token_');
        expect(token).not.toBe(testCopilotToken(family, 'other'));
    });

    it.each(['credentials.test.ts', 'cli-credentials.test.ts', 'token-fixture.ts'])('keeps provider-shaped token literals out of %s', file => {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8');
        expect(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]+/.test(source)).toBe(false);
    });
});
