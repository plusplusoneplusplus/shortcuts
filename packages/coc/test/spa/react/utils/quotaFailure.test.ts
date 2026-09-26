import { describe, it, expect } from 'vitest';
import { isQuotaFailure } from '../../../../src/server/spa/client/react/utils/quotaFailure';

describe('isQuotaFailure', () => {
    it('detects the Codex usage-limit message', () => {
        expect(isQuotaFailure(
            "You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Oct 1st, 2026 9:00 AM.",
        )).toBe(true);
        expect(isQuotaFailure('stream error: usage_limit_reached')).toBe(true);
    });

    it('detects Claude and Copilot quota messages', () => {
        expect(isQuotaFailure('Claude AI usage limit reached|1790000000')).toBe(true);
        expect(isQuotaFailure('5-hour limit reached ∙ resets 3pm')).toBe(true);
        expect(isQuotaFailure('Your credit balance is too low to access the Anthropic API.')).toBe(true);
        expect(isQuotaFailure('You have exceeded your premium request allowance.')).toBe(true);
        expect(isQuotaFailure('CAPIError: 429 quota exceeded')).toBe(true);
        expect(isQuotaFailure('429 Too Many Requests')).toBe(true);
    });

    it('ignores unrelated failures and empty input', () => {
        expect(isQuotaFailure('ENOENT: no such file or directory')).toBe(false);
        expect(isQuotaFailure('Request timed out after 90000ms')).toBe(false);
        expect(isQuotaFailure('')).toBe(false);
        expect(isQuotaFailure(null)).toBe(false);
        expect(isQuotaFailure(undefined)).toBe(false);
    });
});
