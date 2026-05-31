/**
 * Classification Prompt
 *
 * Keeps per-invocation target context in code while the `classify-diff` skill
 * owns all classification instructions, schema, categories, and tool contract.
 */

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

/**
 * Render the classification user prompt for the given target type.
 */
export function renderClassificationPrompt(
    type: 'pr' | 'commit' | 'branch-range',
    identifier: string,
    _repoId: string,
    _dataDir?: string,
): string {
    let target: ClassificationTarget;
    if (type === 'pr') {
        // identifier for PR: just the prId (not "prId:headSha")
        target = prTarget(identifier);
    } else if (type === 'commit') {
        target = commitTarget(identifier);
    } else {
        target = branchRangeTarget(identifier);
    }

    return [
        `Classify every hunk in ${target.target}.`,
        target.diffInstructions,
        'Use the `classify-diff` skill for classification instructions, schema, categories, intensity levels, anti-patterns, and persistence rules.',
    ].join('\n\n');
}
