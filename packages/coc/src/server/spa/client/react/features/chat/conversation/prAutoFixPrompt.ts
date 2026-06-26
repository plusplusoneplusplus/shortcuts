/**
 * prAutoFixPrompt — client-side CI-fix prompt builder for the manual "Fix now"
 * button (AC-05). Mirrors the server-side `buildCiFailurePrompt`
 * (packages/coc/src/server/triggers/ci-failure-prompt.ts) so a one-shot fix sent
 * from the composer reads identically to one fired by the auto-fix monitor.
 *
 * Kept as a tiny browser-side copy (rather than importing the server module)
 * to avoid pulling server code into the SPA bundle. The AI fetches the check
 * logs itself — logs are intentionally NOT pre-fetched into the prompt.
 */

/** Minimal shape of a failing check needed to render the fix prompt. */
export interface CiFixCheck {
    /** Display name of the check (e.g. `build`, `lint`). */
    name: string;
    /** Web URL with full check details/logs, when the provider exposes it. */
    detailsUrl?: string;
}

/**
 * Build the fix-CI prompt for a pull request and its failing checks. Names the
 * PR number and each failing check (with its details URL when known), then asks
 * the AI to investigate and fix the failing CI.
 */
export function buildCiFixPrompt(prNumber: string | number, failingChecks: readonly CiFixCheck[]): string {
    const lines: string[] = [];
    lines.push(`The CI for PR #${prNumber} is failing. Please investigate and fix the failing CI checks.`);
    lines.push('');
    lines.push('Failing checks:');
    if (failingChecks.length === 0) {
        lines.push('- (no check details available)');
    } else {
        for (const check of failingChecks) {
            const name = check.name?.trim() ? check.name.trim() : 'unnamed check';
            lines.push(check.detailsUrl ? `- ${name} — ${check.detailsUrl}` : `- ${name}`);
        }
    }
    lines.push('');
    lines.push(
        'Fetch the logs for each failing check yourself to diagnose the root cause, ' +
            'then make the code changes needed to make CI pass.',
    );
    return lines.join('\n');
}
