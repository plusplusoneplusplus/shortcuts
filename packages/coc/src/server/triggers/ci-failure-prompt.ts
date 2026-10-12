/**
 * Builds the fixed template message the `ci-failure` condition monitor injects
 * into the originating conversation when it fires. The prompt names the PR
 * number and each failing check with its details URL, then asks the AI to
 * investigate and fix the failing CI.
 *
 * When available, a truncated excerpt of the failing checks' logs is injected as
 * a fenced block (AC-02) so the agent starts with the root-cause output already
 * in hand; the agent is still told it can fetch the full logs itself.
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
        `- Work ONLY on ${target} in an isolated PR worktree; verify the PR identity and head before editing and pushing.`,
        '- Validate, commit only the fix and push normally to that same branch. Preserve concurrent work and check for other PR writers.',
        '- Do NOT create a new pull request.',
        '- Do NOT switch branches: no `git checkout`, no `git switch`.',
        '- Do NOT run `git reset --hard`.',
        '- Do NOT commit to `main`.',
        '- Do NOT resolve merge conflicts unless this monitor explicitly authorizes conflicts; report them as a blocker.',
    ];
}

/**
 * Render a truncated failure-log excerpt as a fenced block (AC-02). Returns an
 * empty array when no excerpt is available so the prompt degrades to the
 * "fetch the logs yourself" behavior. The excerpt is fenced with a backtick run
 * long enough to survive any triple-backtick fences inside the logs themselves.
 */
export function buildLogExcerptBlock(logExcerpt?: string): string[] {
    const excerpt = logExcerpt?.replace(/\s+$/, '');
    if (!excerpt || !excerpt.trim()) return [];
    const fence = longestSafeFence(excerpt);
    return [
        'Recent failure log excerpt (truncated — fetch the full logs if you need more):',
        `${fence}text`,
        excerpt,
        fence,
    ];
}

/**
 * Pick a backtick fence at least 3 long that does not collide with any run of
 * backticks inside the content, so log lines containing ``` cannot break out of
 * the fenced block.
 */
function longestSafeFence(content: string): string {
    let longestRun = 0;
    const matches = content.match(/`+/g);
    if (matches) {
        for (const run of matches) longestRun = Math.max(longestRun, run.length);
    }
    return '`'.repeat(Math.max(3, longestRun + 1));
}

/**
 * Build the fix-CI prompt for a pull request and its failing checks.
 *
 * @param prNumber PR number/id (rendered as `#<n>`).
 * @param failingChecks The currently-failing checks to name in the prompt.
 * @param branch The PR's existing head branch, named in the delivery contract
 *   when known (AC-02 wires this through; omit to bind generically).
 * @param logExcerpt A truncated excerpt of the failing checks' logs, injected as
 *   a fenced block when present (AC-02; omit when logs could not be fetched).
 */
export function buildCiFailurePrompt(
    prNumber: string | number,
    failingChecks: CiFailingCheck[],
    branch?: string,
    logExcerpt?: string,
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
    const excerptBlock = buildLogExcerptBlock(logExcerpt);
    if (excerptBlock.length > 0) {
        lines.push('');
        lines.push(...excerptBlock);
    }
    lines.push('');
    lines.push(
        'Fetch the logs for each failing check yourself to diagnose the root cause, ' +
            'then make the code changes needed to make CI pass.',
    );
    lines.push('Also read and address any unresolved review comments on the PR.');
    lines.push('');
    lines.push(...buildBranchDeliveryContract(branch));
    return lines.join('\n');
}

export function buildConflictRepairPrompt(args: {
    prNumber: string | number; prKey: string; headRef: string; headSha: string;
    baseRef?: string; baseSha: string;
}): string {
    return [
        `PR #${args.prNumber} has a confirmed merge conflict. This existing-PR repair is explicitly authorized.`,
        `Provider-qualified PR: ${args.prKey}`,
        `Expected source branch: ${JSON.stringify(args.headRef)}; head: ${args.headSha}.`,
        `Expected target branch: ${JSON.stringify(args.baseRef ?? '')}; base: ${args.baseSha}.`,
        'Re-read the PR in this owning workspace/server before editing and before pushing. Stop if identity, head, base or permissions changed.',
        'Use an isolated PR worktree on the existing PR branch; never switch the active workspace branch or modify its unrelated work.',
        'Check for other PR writers first. If the branch is already being repaired, wait; do not race it.',
        'Inspect both sides and their commit history; preserve both sides\' intended behavior when merging the target into the source.',
        'No blind ours/theirs resolution, destructive resets, force pushes, weakened coverage, or unrelated commits.',
        'If intent is genuinely ambiguous, do not guess or push: report the exact ambiguity and request human resolution.',
        'Validate the resolved behavior with the existing targeted tests/build, add regression coverage, then commit only the resolution and push normally to this same PR branch.',
        'Do NOT create another PR or invoke create_pull_request or the submission workflow to resolve conflicts.',
        'Do not bypass provider policies, approvals or permission blockers. Report them.',
        'After pushing, report the new head SHA; this monitor must wait for fresh CI on that head, not stale green checks.',
    ].join('\n');
}
