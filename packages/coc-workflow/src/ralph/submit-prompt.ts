export interface BuildRalphSubmitPromptInput {
    /** The original goal text or a path to goal.md. */
    originalGoal: string;
    /** Path to progress.md for this session. */
    progressPath: string;
    /** Session id for context. */
    sessionId: string;
    /** 1-based index of this submit within the session. */
    submitIndex: number;
    /** HEAD SHA recorded at session creation; absent on legacy sessions. */
    baselineSha?: string;
    /**
     * HEAD SHA recorded after the session's last completed iteration. Closes
     * the commit range so commits made on the branch after the session ended
     * are not swept in. Absent on legacy sessions.
     */
    endSha?: string;
    /** Commit SHAs already submitted by earlier submits of this session. */
    excludeShas?: string[];
    /** ISO timestamp of session creation (legacy commit-window fallback). */
    sessionStartedAt: string;
    /** ISO timestamp of session completion, if recorded. */
    sessionCompletedAt?: string;
}

const RESULT_CONTRACT = `## Result Contract

End your response with EXACTLY ONE RALPH_SUBMIT_RESULT JSON block using this structure (no trailing text after the block):

RALPH_SUBMIT_RESULT
\`\`\`json
{
  "status": "submitted" | "failed",
  "prUrl": "<pull request URL - required when status is submitted>",
  "prNumber": <pull request number when known>,
  "commitShas": ["<sha>", "..."],
  "error": "<failure or abort reason - required when status is failed>"
}
\`\`\`

Rules:
- "status" must be "submitted" when the pull request was created, "failed" otherwise.
- When submitted, include "prUrl" (and "prNumber" when known) and list the submitted commit SHAs oldest first in "commitShas".
- When failed, include a clear "error" explaining what went wrong (dirty worktree refusal, cherry-pick abort reason, push/gh failure, no commits found).`;

/**
 * Build the user-message prompt for one Ralph PR-submit task.
 */
export function buildRalphSubmitPrompt(input: BuildRalphSubmitPromptInput): string {
    const {
        originalGoal, progressPath, sessionId, submitIndex,
        baselineSha, endSha, excludeShas, sessionStartedAt, sessionCompletedAt,
    } = input;

    const goalSection = originalGoal.trim().startsWith('/')
        ? `Read the original goal from: ${originalGoal.trim()}`
        : `Original goal:\n${originalGoal.trim()}`;

    const excluded = (excludeShas ?? []).filter(sha => sha.trim().length > 0);

    let commitStrategy: string;
    if (baselineSha && endSha) {
        const parts = [
            `This session recorded baseline SHA ${baselineSha} at creation and end SHA ${endSha} after its last completed iteration.`,
            `The session's commits are exactly the closed range ${baselineSha}..${endSha} on the current branch`,
            `(run: git --no-pager log --format=%H ${baselineSha}..${endSha}).`,
            'Do NOT use HEAD as the upper bound — commits made after the session ended must not be included.',
        ];
        if (excluded.length > 0) {
            parts.push(
                `Earlier submits of this session already submitted these commits — OMIT them from this PR: ${excluded.join(', ')}.`,
            );
        }
        commitStrategy = parts.join(' ');
    } else if (baselineSha) {
        const parts = [
            `This session recorded baseline SHA ${baselineSha} at creation but no end SHA.`,
            `Candidate commits are the range ${baselineSha}..HEAD on the current branch`,
            `(run: git --no-pager log --format=%H ${baselineSha}..HEAD).`,
            'CAUTION: the upper bound is unverified — HEAD may include commits made after this session ended.',
            'Cross-check every candidate against the commit SHAs mentioned in the progress journal before submitting,',
            'submit only the verified list, and note any mismatches in your response.',
        ];
        if (excluded.length > 0) {
            parts.push(
                `Earlier submits of this session already submitted these commits — OMIT them from this PR: ${excluded.join(', ')}.`,
            );
        }
        commitStrategy = parts.join(' ');
    } else {
        commitStrategy = [
            'This legacy session has no recorded baseline SHA. Determine candidate commits from',
            `\`git log\` on the current branch between ${sessionStartedAt} and ${sessionCompletedAt ?? 'now'},`,
            'cross-check the candidates against commit SHAs mentioned in the progress journal,',
            'submit only the verified list, and note any mismatches in your response.',
        ].join(' ');
    }

    return [
        `Submit the commits produced by Ralph session ${sessionId} as a GitHub pull request. This is PR submit ${submitIndex} for the session.`,
        '',
        '## Goal Reference',
        goalSection,
        '',
        '## Progress Journal',
        `Read the Ralph progress journal from: ${progressPath}`,
        '',
        '## Determine the Session Commits',
        commitStrategy,
        '',
        'Scope: include the commits from ALL loops of this session — including gap-fix loops — not just the latest loop.',
        '',
        '## Submit the Pull Request',
        'Invoke the `submit-commits-as-pr` skill, passing the explicit comma-separated list of commit SHAs you determined above.',
        'Derive the PR title and body from the Ralph goal plus a short summary of what was accomplished per the progress journal.',
        'Leave auto-merge ON (the skill default — do not pass --no-auto-merge). Do not open the PR as a draft.',
        'If the worktree is dirty, the skill script refuses to run — do not commit, stash, or clean anything; report a failed result with a clear error message.',
        'If a cherry-pick or rebase conflict occurs, the skill aborts the entire submit and restores the original branch. Do NOT attempt to resolve conflicts — report a failed result with the abort reason.',
        '',
        RESULT_CONTRACT,
    ].join('\n');
}
