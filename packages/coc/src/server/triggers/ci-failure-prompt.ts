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
 *
 * The prompt also carries a fixed "how to deliver the fix" contract: the agent
 * must work on the PR's existing branch only and push the fix there — never a
 * new PR, never `git checkout`/`git switch`, never `git reset --hard`, never a
 * commit to `main`. This removes the whole class of failures (duplicate PRs,
 * branch switching, hard resets, commits to main) that the cron auto-fix caused.
 */

/** Minimal shape of a failing check needed to render the fix prompt. */
export interface CiFailingCheck {
    /** Display name of the check (e.g. `build`, `lint`). */
    name: string;
    /** Web URL with full check details/logs, when the provider exposes it. */
    detailsUrl?: string;
}

/**
 * Render the fixed "how to deliver the fix" contract. The agent must stay on the
 * PR's existing branch and push there; it must not create new PRs, switch
 * branches, hard-reset, or commit to `main`. When the branch name is known it is
 * named explicitly; otherwise the contract still binds the agent to "the PR's
 * existing branch".
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
 * Build the fix-CI prompt for a pull request and its failing checks.
 *
 * @param prNumber PR number/id (rendered as `#<n>`).
 * @param failingChecks The currently-failing checks to name in the prompt.
 * @param branch The PR's existing head branch, named in the delivery contract
 *   when known (AC-02 wires this through; omit to bind generically).
 */
export function buildCiFailurePrompt(
    prNumber: string | number,
    failingChecks: CiFailingCheck[],
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
