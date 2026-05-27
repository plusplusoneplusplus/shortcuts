/**
 * Classification Prompt Template
 *
 * Provides the default template and rendering logic for diff classification
 * prompts (PR, commit, branch-range). The template is registered as an
 * editable built-in prompt in the Admin > System Prompts UI so users can
 * tune instructions without changing code.
 *
 * Template variables:
 *   ${target}              — what to classify ("pull request #42 of this repository")
 *   ${diffInstructions}    — how to fetch the diff ("Use git/gh CLI …")
 *   ${classificationSchema} — per-hunk output schema (file, hunkIndex, category …)
 *   ${saveInstruction}     — call saveClassification exactly once
 */

import { getPromptOverride } from '../admin/ralph-prompt-overrides';

// ── Default template ─────────────────────────────────────────────────────────

export const DIFF_CLASSIFICATION_PROMPT_ID = 'diff-classification-user';

export const DIFF_CLASSIFICATION_TEMPLATE_VARS = [
    '${target}',
    '${diffInstructions}',
    '${classificationSchema}',
    '${saveInstruction}',
];

export const DIFF_CLASSIFICATION_DEFAULT_TEMPLATE = [
    'Classify every hunk in ${target}.',
    '',
    '${diffInstructions}',
    '',
    '${classificationSchema}',
    '',
    '${saveInstruction}',
].join('\n');

// ── Per-type variable values ─────────────────────────────────────────────────

const CLASSIFICATION_SCHEMA =
    'For each @@ hunk, produce a classification with: file, hunkIndex (0-based within the file), ' +
    'category (logic|mechanical|test|generated), intensity (high|low), and a one-sentence reason.';

const SAVE_INSTRUCTION =
    'When you have classified every hunk, persist the results by calling the `saveClassification` tool ' +
    'exactly once with the full array. Do NOT print the classifications as JSON in your response — ' +
    'the persistence layer reads them directly from the tool call.';

interface ClassificationTarget {
    target: string;
    diffInstructions: string;
}

function prTarget(prId: string): ClassificationTarget {
    return {
        target: `pull request #${prId} of this repository`,
        diffInstructions:
            'Use the available git and gh CLI tools to read the PR diff. ' +
            'Do NOT ask me for the diff — fetch it yourself.',
    };
}

function commitTarget(hash: string): ClassificationTarget {
    return {
        target: `commit ${hash} of this repository`,
        diffInstructions:
            'Use the available git CLI tools to read the commit diff. ' +
            'Do NOT ask me for the diff — fetch it yourself.',
    };
}

function branchRangeTarget(range: string): ClassificationTarget {
    return {
        target: `the branch range ${range} of this repository`,
        diffInstructions:
            'Use the available git CLI tools to read the diff (git diff). ' +
            'Do NOT ask me for the diff — fetch it yourself.',
    };
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderTemplate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replaceAll(key, value);
    }
    return result;
}

/**
 * Render the classification user prompt for the given target type.
 * Uses the admin override if one exists, otherwise the built-in default.
 */
export function renderClassificationPrompt(
    type: 'pr' | 'commit' | 'branch-range',
    identifier: string,
    _repoId: string,
    dataDir?: string,
): string {
    const template = (dataDir
        ? getPromptOverride(DIFF_CLASSIFICATION_PROMPT_ID, dataDir)
        : undefined) ?? DIFF_CLASSIFICATION_DEFAULT_TEMPLATE;

    let target: ClassificationTarget;
    if (type === 'pr') {
        // identifier for PR: just the prId (not "prId:headSha")
        target = prTarget(identifier);
    } else if (type === 'commit') {
        target = commitTarget(identifier);
    } else {
        target = branchRangeTarget(identifier);
    }

    return renderTemplate(template, {
        '${target}': target.target,
        '${diffInstructions}': target.diffInstructions,
        '${classificationSchema}': CLASSIFICATION_SCHEMA,
        '${saveInstruction}': SAVE_INSTRUCTION,
    });
}
