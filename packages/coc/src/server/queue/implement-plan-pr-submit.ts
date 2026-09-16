import type { QueuedTask } from '@plusplusoneplusplus/forge';

const RESULT_MARKER = 'PR_SUBMIT_RESULT';

export interface BuildImplementPlanPrSubmitPromptInput {
    baselineSha: string;
    endSha: string;
    commitShas: string[];
    planReference: string;
}

export interface ImplementPlanPrSubmitResult {
    status: 'submitted' | 'failed';
    prUrl?: string;
    prNumber?: number;
    commitShas?: string[];
    error?: string;
}

export function buildImplementPlanPrSubmitPrompt(
    input: BuildImplementPlanPrSubmitPromptInput,
): string {
    return [
        'Submit the commits produced by this implement-plan run as a GitHub pull request.',
        '',
        '## Plan',
        input.planReference,
        '',
        '## Exact commits',
        `The closed implementation range is ${input.baselineSha}..${input.endSha}.`,
        'Cherry-pick exactly these commits, oldest first:',
        ...input.commitShas.map(sha => `- ${sha}`),
        'Do not derive the commit list from HEAD or include any other commit.',
        '',
        '## Required procedure',
        '1. Before making any change, verify the active worktree is clean, `gh` is installed and authenticated, and `origin` is a GitHub remote. On any failed check, stop without committing, stashing, cleaning, or changing the active worktree.',
        '2. Fetch the latest `origin/main`, create a fresh branch from it, and attach that branch only in a temporary linked git worktree. Never change the branch or HEAD of the active worktree.',
        '3. In the temporary worktree, cherry-pick exactly the commit SHAs listed above in their listed order. If any cherry-pick conflicts, abort it, do not resolve the conflict, and report failure.',
        '4. Push the fresh branch and use `gh` to open a non-draft pull request. Derive its title and body from the plan and the implemented changes.',
        '5. Enable squash auto-merge with `gh pr merge --auto --squash`.',
        '6. Clean up the temporary linked worktree. Never commit, stash, or clean the active worktree.',
        '',
        'Do not invoke or use the `submit-commits-as-pr` skill. Perform the procedure directly.',
        '',
        '## Result contract',
        `End your response with exactly one ${RESULT_MARKER} JSON block and no trailing text:`,
        '',
        RESULT_MARKER,
        '```json',
        '{',
        '  "status": "submitted" | "failed",',
        '  "prUrl": "<required when submitted>",',
        '  "prNumber": 123,',
        '  "commitShas": ["<sha>", "..."],',
        '  "error": "<required when failed>"',
        '}',
        '```',
    ].join('\n');
}

export function parseImplementPlanPrSubmitResult(response: string): ImplementPlanPrSubmitResult {
    const normalized = response.replace(/\r\n?/g, '\n');
    const markerIndex = normalized.indexOf(RESULT_MARKER);
    if (markerIndex < 0) {
        return failed(`Response does not contain ${RESULT_MARKER} marker`);
    }

    const raw = extractJson(normalized.slice(markerIndex + RESULT_MARKER.length));
    if (!raw) {
        return failed(`No JSON block found after ${RESULT_MARKER} marker`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return failed(`Malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return failed('JSON root must be an object');
    }

    const value = parsed as Record<string, unknown>;
    const status = value.status;
    const prUrl = nonEmptyString(value.prUrl);
    const error = nonEmptyString(value.error);
    if (status === 'submitted' && !prUrl) {
        return failed('Submitted result is missing prUrl');
    }
    if (status !== 'submitted' && status !== 'failed') {
        return failed('"status" must be "submitted" or "failed"');
    }

    const commitShas = Array.isArray(value.commitShas)
        ? value.commitShas.filter((sha): sha is string => typeof sha === 'string' && sha.trim().length > 0)
        : undefined;
    const prNumber = typeof value.prNumber === 'number' && Number.isInteger(value.prNumber)
        ? value.prNumber
        : undefined;
    return {
        status,
        ...(prUrl ? { prUrl } : {}),
        ...(prNumber !== undefined ? { prNumber } : {}),
        ...(commitShas?.length ? { commitShas } : {}),
        ...(status === 'failed' ? { error: error ?? 'PR submission failed' } : {}),
    };
}

export function getImplementPlanReference(task: QueuedTask): string {
    const context = task.payload.context;
    if (context && typeof context === 'object' && !Array.isArray(context)) {
        const files = (context as Record<string, unknown>).files;
        if (Array.isArray(files) && typeof files[0] === 'string') {
            return `Read the implementation plan at: ${files[0]}`;
        }
    }
    const prompt = typeof task.payload.prompt === 'string' ? task.payload.prompt.trim() : '';
    return prompt ? `Original plan instruction:\n${prompt}` : 'Review the listed commits to understand the implemented plan.';
}

function extractJson(text: string): string | undefined {
    const fenced = /```json\s*\n([\s\S]*?)\n```/m.exec(text);
    if (fenced) {
        return fenced[1].trim();
    }
    const start = text.indexOf('{');
    if (start < 0) {
        return undefined;
    }
    let depth = 0;
    for (let index = start; index < text.length; index++) {
        if (text[index] === '{') depth++;
        if (text[index] === '}' && --depth === 0) {
            return text.slice(start, index + 1);
        }
    }
    return undefined;
}

function nonEmptyString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function failed(error: string): ImplementPlanPrSubmitResult {
    return { status: 'failed', error };
}
