/**
 * CI-Failure Fix Prompt Template
 *
 * Builds the fixed template message the `ci-failure` condition monitor injects
 * into the originating conversation when it fires. The prompt names the PR
 * number and each failing check with its details URL, then asks the AI to
 * investigate and fix the failing CI.
 *
 * The AI is expected to fetch the check logs itself — logs are intentionally
 * NOT pre-fetched into the prompt (keeps the message small and the work fresh).
 */

/** Minimal shape of a failing check needed to render the fix prompt. */
export interface CiFailingCheck {
    /** Display name of the check (e.g. `build`, `lint`). */
    name: string;
    /** Web URL with full check details/logs, when the provider exposes it. */
    detailsUrl?: string;
}

/**
 * Build the fix-CI prompt for a pull request and its failing checks.
 *
 * @param prNumber PR number/id (rendered as `#<n>`).
 * @param failingChecks The currently-failing checks to name in the prompt.
 */
export function buildCiFailurePrompt(prNumber: string | number, failingChecks: CiFailingCheck[]): string {
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
