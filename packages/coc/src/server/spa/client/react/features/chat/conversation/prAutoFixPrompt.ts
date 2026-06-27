/**
 * prAutoFixPrompt — client-side CI-fix prompt builder for the manual "Fix now"
 * button (AC-05). Mirrors the server-side `buildCiFailurePrompt`
 * (packages/coc/src/server/triggers/ci-failure-prompt.ts) so a one-shot fix sent
 * from the composer reads identically to one fired by the auto-fix monitor.
 *
 * Kept as a tiny browser-side copy (rather than importing the server module)
 * to avoid pulling server code into the SPA bundle. The AI fetches the check
 * logs itself — logs are intentionally NOT pre-fetched into the prompt.
 *
 * The prompt also mirrors the server's fixed "how to deliver the fix" contract:
 * stay on the PR's existing branch and push there — never a new PR, never
 * `git checkout`/`git switch`, never `git reset --hard`, never a commit to
 * `main` (keep in sync with `buildBranchDeliveryContract`).
 */

/** Minimal shape of a failing check needed to render the fix prompt. */
export interface CiFixCheck {
    /** Display name of the check (e.g. `build`, `lint`). */
    name: string;
    /** Web URL with full check details/logs, when the provider exposes it. */
    detailsUrl?: string;
}

/**
 * Render the fixed "how to deliver the fix" contract. Mirror of the server-side
 * `buildBranchDeliveryContract` — keep the two in sync.
 */
export function buildBranchDeliveryContract(branch?: string): string[] {
    const branchRef = branch?.trim();
    const target = branchRef ? `the PR's existing branch \`${branchRef}\`` : "the PR's existing branch";
    return [
        'How to deliver the fix (follow exactly):',
        `- Work ONLY on ${target}; it is already checked out.`,
        '- Commit the fix and push it to that same branch.',
        '- Do NOT create a new pull request.',
        '- Do NOT switch branches: no `git checkout`, no `git switch`.',
        '- Do NOT run `git reset --hard`.',
        '- Do NOT commit to `main`.',
    ];
}

/**
 * Build the fix-CI prompt for a pull request and its failing checks. Names the
 * PR number and each failing check (with its details URL when known), then asks
 * the AI to investigate and fix the failing CI.
 */
export function buildCiFixPrompt(
    prNumber: string | number,
    failingChecks: readonly CiFixCheck[],
    branch?: string,
): string {
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
    lines.push('');
    lines.push(...buildBranchDeliveryContract(branch));
    return lines.join('\n');
}
