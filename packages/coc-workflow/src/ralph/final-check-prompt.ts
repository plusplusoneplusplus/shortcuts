export interface BuildFinalCheckPromptInput {
    /** The original goal text or a path to goal.md. */
    originalGoal: string;
    /** Path to progress.md for this session. */
    progressPath: string;
    /** Session id for context. */
    sessionId: string;
    /** Workspace id for context. */
    workspaceId: string;
    /** 1-based loop index that just completed. */
    loopIndex: number;
    /** The last iteration number of the completed loop. */
    sourceIteration: number;
}

const READ_ONLY_INSTRUCTIONS = 'Load and follow the `ultra-ralph` skill, `final-check` section. The skill file is at ~/.coc/skills/ultra-ralph/SKILL.md.';

const EVALUATION_INSTRUCTIONS = `## Evaluation Steps

1. Read the original goal and any referenced spec files (look for goal.md and ac-NN-*.spec.md in the working directory).
2. Read the progress journal at the path provided below.
3. Inspect recent git commits and diffs (run: git --no-pager log --oneline -20 and git --no-pager diff HEAD~<n>..HEAD for the relevant range).
4. Run any validation commands referenced in the spec's "Definition of Done" sections or the progress journal (build, test, lint). These are read-only verification runs.
5. Check for missing test evidence, failing validation, unmet acceptance criteria, "Remaining:" entries in progress journal that were not resolved, or contradictions between progress.md and the actual diff.

## Gap Classification

Treat the following as gaps:
- An acceptance criterion has no recorded evidence it was tested/validated.
- A "Remaining:" entry in the journal was not addressed, unless it is explicitly manual-verification-only or final-check-only.
- Validation commands referenced in the spec fail or are missing.
- The diff contradicts a claim in progress.md (e.g., a file listed as created does not exist).
- A Definition of Done step is not satisfied with documented evidence.

Do not report gaps for manual demos, product review, unavailable credentials, human approval, or other user-only verification when the journal explicitly says no autonomous implementation or automatable validation work remains. Mention those manual follow-ups in the summary instead.

## Output Format

After your evaluation, output EXACTLY ONE JSON block using this structure (no trailing text after the block):

RALPH_FINAL_CHECK_RESULT
\`\`\`json
{
  "marker": "RALPH_FINAL_CHECK_RESULT",
  "hasGaps": <true|false>,
  "summary": "<one-paragraph assessment>",
  "gaps": [
    {
      "id": "GAP-01",
      "title": "<short title>",
      "evidence": "<what the gap is and why>",
      "recommendedAction": "<what to do to close it>",
      "validation": "<optional command to verify the fix>"
    }
  ],
  "gapFixGoal": "<required when hasGaps is true - focused goal text for a gap-fix loop>"
}
\`\`\`

Rules:
- When hasGaps is false, gaps must be an empty array and gapFixGoal must be absent or empty.
- When hasGaps is true, gaps must be non-empty and gapFixGoal must be a non-empty string.
- Do not include both hasGaps:false and a non-empty gaps array.`;

/**
 * Build the user-message prompt for one final-check task.
 */
export function buildFinalCheckPrompt(input: BuildFinalCheckPromptInput): string {
    const { originalGoal, progressPath, sessionId, workspaceId, loopIndex, sourceIteration } = input;
    const goalSection = originalGoal.trim().startsWith('/')
        ? `Read the original goal from: ${originalGoal.trim()}`
        : `Original goal:\n${originalGoal.trim()}`;

    return [
        READ_ONLY_INSTRUCTIONS,
        '',
        '---',
        '',
        '## Session Context',
        `Session ID: ${sessionId}`,
        `Workspace ID: ${workspaceId}`,
        `Loop just completed: ${loopIndex} (last iteration: ${sourceIteration})`,
        '',
        '## Goal Reference',
        goalSection,
        '',
        '## Progress Journal',
        `Read the Ralph progress journal from: ${progressPath}`,
        '',
        EVALUATION_INSTRUCTIONS,
    ].join('\n');
}
