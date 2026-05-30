/**
 * AC-05: Optimizer edit (bounded).
 *
 * Builds an optimizer prompt from the scored rollouts + current skill, calls the
 * Copilot CLI (optimizer model), and parses the response as exactly ONE bounded edit:
 *
 *   { "type": "add" | "delete" | "replace", "anchor": "...", "content": "..." }
 *
 * The applier produces a candidate skill document.
 * Malformed optimizer output → no-op candidate (run continues, reason logged).
 *
 * Optimizer prompt contract (documented here and in README):
 *   - Receives: current skill text, scored rollout summaries (diffs + scores)
 *   - Must return: a JSON code block containing exactly one OptimizerEdit object
 *   - type "add":     inserts `content` after the line matching `anchor`
 *   - type "delete":  removes the first line matching `anchor`
 *   - type "replace": replaces the first line matching `anchor` with `content`
 */

import { runCopilotCli, CopilotCliOptions } from './cli-driver';
import { ScoreResult } from './scoring';
import { RolloutResult } from './rollout';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OptimizerEdit {
    type: 'add' | 'delete' | 'replace';
    /** A substring of the line in the skill doc used as the anchor. */
    anchor: string;
    /** New content for "add" or "replace" operations. Not required for "delete". */
    content?: string;
}

export interface OptimizerResult {
    candidateSkill: string;
    edit: OptimizerEdit | null;
    /** Human-readable reason if the edit was skipped or malformed. */
    parseNote: string;
}

export interface ScoredRolloutSummary {
    taskId: string;
    score: number;
    diff: string;
    stdout: string;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

export function buildOptimizerPrompt(
    currentSkill: string,
    rolloutSummaries: ScoredRolloutSummary[]
): string {
    const rolloutText = rolloutSummaries
        .map((r, i) => [
            `### Rollout ${i + 1} — task: ${r.taskId} — score: ${r.score.toFixed(3)}`,
            'Diff:',
            '```diff',
            r.diff.trim() || '(no changes)',
            '```',
        ].join('\n'))
        .join('\n\n');

    return [
        'You are a skill-document optimizer. Your job is to propose exactly ONE small, targeted edit to the skill document below that will improve the target agent\'s performance on the coding tasks shown.',
        '',
        '## Current skill document',
        '```markdown',
        currentSkill.trim(),
        '```',
        '',
        '## Recent rollout results',
        rolloutText,
        '',
        '## Instructions',
        'Return ONLY a JSON code block (```json ... ```) containing a single object with these fields:',
        '  - "type": one of "add", "delete", or "replace"',
        '  - "anchor": a substring of the target line in the skill document',
        '  - "content": the new text (required for "add" and "replace"; omit for "delete")',
        '',
        'Edit semantics:',
        '  - "add": insert `content` as a new line immediately AFTER the line containing `anchor`',
        '  - "delete": remove the first line that contains `anchor`',
        '  - "replace": replace the first line that contains `anchor` with `content`',
        '',
        'The edit must be minimal and targeted. Do not restructure the whole document.',
        'Output ONLY the JSON code block, nothing else.',
    ].join('\n');
}

// ─── Edit parser ──────────────────────────────────────────────────────────────

/**
 * Parses the first ```json ... ``` block from the optimizer output.
 * Returns null and a note if parsing fails or the result is malformed.
 */
export function parseOptimizerEdit(output: string): { edit: OptimizerEdit | null; note: string } {
    const jsonMatch = output.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) {
        return { edit: null, note: 'No JSON code block found in optimizer output' };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonMatch[1].trim());
    } catch (err) {
        return { edit: null, note: `JSON parse error: ${(err as Error).message}` };
    }

    if (typeof parsed !== 'object' || parsed === null) {
        return { edit: null, note: 'Optimizer JSON is not an object' };
    }

    const obj = parsed as Record<string, unknown>;
    const type = obj.type;
    const anchor = obj.anchor;

    if (type !== 'add' && type !== 'delete' && type !== 'replace') {
        return { edit: null, note: `Invalid edit type: "${type}"` };
    }
    if (typeof anchor !== 'string' || anchor.trim().length === 0) {
        return { edit: null, note: 'Edit anchor must be a non-empty string' };
    }
    if ((type === 'add' || type === 'replace') && typeof obj.content !== 'string') {
        return { edit: null, note: `Edit type "${type}" requires a "content" string` };
    }

    const edit: OptimizerEdit = {
        type: type as OptimizerEdit['type'],
        anchor: anchor as string,
        content: obj.content as string | undefined,
    };

    return { edit, note: 'ok' };
}

// ─── Edit applier ─────────────────────────────────────────────────────────────

/**
 * Applies a single bounded edit to the skill document text.
 * Returns the modified document, or the original if anchor is not found.
 */
export function applyEdit(skillText: string, edit: OptimizerEdit): { result: string; applied: boolean } {
    const lines = skillText.split('\n');
    const anchorIdx = lines.findIndex(line => line.includes(edit.anchor));

    if (anchorIdx === -1) {
        return { result: skillText, applied: false };
    }

    const newLines = [...lines];
    switch (edit.type) {
        case 'add':
            newLines.splice(anchorIdx + 1, 0, edit.content ?? '');
            break;
        case 'delete':
            newLines.splice(anchorIdx, 1);
            break;
        case 'replace':
            newLines[anchorIdx] = edit.content ?? '';
            break;
    }

    return { result: newLines.join('\n'), applied: true };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Calls the optimizer model to produce one bounded edit, then applies it.
 * On any failure (parse error, anchor not found, CLI error) returns the
 * original skill as a no-op candidate so the loop can continue.
 */
export async function proposeOptimizedSkill(
    currentSkill: string,
    rollouts: Array<{ rollout: RolloutResult; score: ScoreResult }>,
    optimizerModel: string,
    optimizerWorkdir: string,
    options: CopilotCliOptions = {}
): Promise<OptimizerResult> {
    const summaries: ScoredRolloutSummary[] = rollouts.map(({ rollout, score }) => ({
        taskId: rollout.taskId,
        score: score.score,
        diff: rollout.diff,
        stdout: rollout.stdout,
    }));

    const prompt = buildOptimizerPrompt(currentSkill, summaries);

    let rawOutput = '';
    try {
        const cliResult = await runCopilotCli(prompt, optimizerWorkdir, optimizerModel, options);
        rawOutput = cliResult.stdout;
    } catch (err) {
        const note = `Optimizer CLI error: ${(err as Error).message}`;
        return { candidateSkill: currentSkill, edit: null, parseNote: note };
    }

    const { edit, note } = parseOptimizerEdit(rawOutput);
    if (!edit) {
        return { candidateSkill: currentSkill, edit: null, parseNote: note };
    }

    const { result: candidateSkill, applied } = applyEdit(currentSkill, edit);
    if (!applied) {
        return {
            candidateSkill: currentSkill,
            edit,
            parseNote: `Anchor "${edit.anchor}" not found in skill document; edit not applied`,
        };
    }

    return { candidateSkill, edit, parseNote: 'ok' };
}
