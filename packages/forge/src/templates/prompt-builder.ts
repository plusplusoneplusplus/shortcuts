import { GitCommitFile } from '../git';
import { FileChange } from './types';

function mapGitStatus(s: GitCommitFile['status']): FileChange['status'] {
    switch (s) {
        case 'added': return 'new';
        case 'deleted': return 'deleted';
        default: return 'modified';
    }
}

export function buildReplicatePrompt(
    commit: { hash: string; shortHash: string; subject: string },
    diff: string,
    files: GitCommitFile[],
    instruction: string,
    hints?: string[],
): string {
    const parts: string[] = [];

    parts.push(
        'You are a code-generation assistant. You will be shown an example commit (the \'template\') and an instruction describing what analogous change to produce.',
    );

    // Template commit section
    parts.push('');
    parts.push('## Template Commit');
    parts.push('');
    parts.push(`**${commit.shortHash}** — ${commit.subject}`);
    parts.push('');

    if (diff) {
        parts.push('```diff');
        parts.push(diff);
        parts.push('```');
    } else {
        parts.push('(empty diff — this was likely an empty or merge commit)');
    }

    if (files.length > 0) {
        parts.push('');
        parts.push('Changed files:');
        for (const f of files) {
            parts.push(`- \`${f.path}\` (${mapGitStatus(f.status)})`);
        }
    }

    // Instruction section
    parts.push('');
    parts.push('## Instruction');
    parts.push('');
    parts.push(instruction);

    // Hints section
    if (hints && hints.length > 0) {
        parts.push('');
        parts.push('## Hints');
        parts.push('');
        for (let i = 0; i < hints.length; i++) {
            parts.push(`${i + 1}. ${hints[i]}`);
        }
    }

    // Output format section
    parts.push('');
    parts.push('## Output Format');
    parts.push('');
    parts.push('Emit each file as:');
    parts.push('');
    parts.push('```');
    parts.push('=== FILE: <relative-path> (<status>) ===');
    parts.push('<file content or diff>');
    parts.push('=== END FILE ===');
    parts.push('```');
    parts.push('');
    parts.push('where `<status>` is one of `new`, `modified`, `deleted`. For `deleted` files, content can be empty.');
    parts.push('');
    parts.push('After all file blocks, emit a line `=== SUMMARY ===` followed by a brief summary paragraph.');

    return parts.join('\n').trimEnd();
}
