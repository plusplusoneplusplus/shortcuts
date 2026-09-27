/**
 * Advisory check for "the provider ran out of quota" failures. Used only to
 * highlight the restart action and pre-select another provider — never to
 * gate it — so a missed pattern just falls back to the same-provider default.
 */
const QUOTA_FAILURE_PATTERNS: readonly RegExp[] = [
    // Codex: "You've hit your usage limit. Upgrade to Pro … or try again in 2 days."
    /hit your usage limit/i,
    /usage[_ ]limit[_ ]reached/i,
    // Claude: "Claude AI usage limit reached", "5-hour limit reached", low credits.
    /usage limit reached/i,
    /\b\d+-hour limit reached/i,
    /credit balance is too low/i,
    // Copilot: premium request allowance / quota exhaustion.
    /premium request(s)? (allowance|limit|quota)/i,
    /quota (exceeded|exhausted)/i,
    /exceeded your (current )?quota/i,
    /insufficient[_ ]quota/i,
    // Generic rate limiting.
    /rate[_ ]limit(ed|[_ ]exceeded|[_ ]error)?/i,
    /too many requests/i,
];

export function isQuotaFailure(error: string | null | undefined): boolean {
    if (!error) return false;
    return QUOTA_FAILURE_PATTERNS.some(pattern => pattern.test(error));
}
