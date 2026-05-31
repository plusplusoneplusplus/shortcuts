/**
 * commitDetection — scans shell tool call results for git commit output
 * and extracts structured commit metadata.
 */

export interface DetectedCommit {
    shortHash: string;
    subject: string;
    fullHash?: string;
    branch?: string;
    filesChanged?: number;
    insertions?: number;
    deletions?: number;
    toolCallId: string;
    /** True when the commit subject starts with fixup!, squash!, or amend!. */
    isFixup: boolean;
}

interface ToolCallLike {
    id: string;
    toolName: string;
    name?: string;
    args?: any;
    result?: string;
    status?: string;
}

const SHELL_TOOL_NAMES = new Set(['powershell', 'shell', 'bash']);
const AGENT_TOOL_NAMES = new Set(['task', 'general-purpose']);

/**
 * Standard git commit output pattern:
 *   [branch shortHash] subject line
 * Examples:
 *   [main a1b2c3d] Fix null check in parser
 *   [detached HEAD a1b2c3d] Initial commit
 *   [main (root-commit) a1b2c3d] Initial commit
 */
const GIT_COMMIT_RE = /\[(\S+?)(?:\s+\(root-commit\))?\s+([0-9a-f]{7,12})\]\s+(.+)/;

/**
 * Diffstat line pattern:
 *   N file(s) changed, M insertion(s)(+), K deletion(s)(-)
 * Any of the three parts may be absent.
 */
const DIFFSTAT_RE = /(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/;

/**
 * Commands that produce commits (vs read-only git commands).
 * We only scan results from these command patterns.
 */
const COMMIT_CREATING_PATTERNS = [
    /\bgit\s+commit\b/,
    /\bgit\s+merge\b/,
    /\bgit\s+cherry-pick\b/,
    /\bgit\s+revert\b/,
];

/**
 * Commands whose output mentions hashes but should NOT be treated as commit creation.
 * These are read-only commands.
 */
const READ_ONLY_GIT_PATTERNS = [
    /\bgit\s+log\b/,
    /\bgit\s+show\b/,
    /\bgit\s+diff\b/,
    /\bgit\s+blame\b/,
    /\bgit\s+reflog\b/,
    /\bgit\s+rev-parse\b/,
    /\bgit\s+describe\b/,
];

function getCommandString(args: any): string {
    if (!args) return '';
    if (typeof args === 'string') return args;
    if (typeof args.command === 'string') return args.command;
    if (typeof args.script === 'string') return args.script;
    return '';
}

function isCommitCreatingCommand(command: string): boolean {
    return COMMIT_CREATING_PATTERNS.some(re => re.test(command));
}

function isReadOnlyGitCommand(command: string): boolean {
    return READ_ONLY_GIT_PATTERNS.some(re => re.test(command));
}

/**
 * Scans tool calls in a tool group for git commit output and returns
 * structured commit metadata for each detected commit.
 *
 * Inspects shell-category tool calls whose command string matches a
 * commit-creating pattern, and also scans agent tool results (task,
 * general-purpose) directly — since those have no inspectable command,
 * only the result text is used as evidence.
 */
export function detectCommitsInToolGroup(toolCalls: ToolCallLike[]): DetectedCommit[] {
    const results: DetectedCommit[] = [];
    const seenHashes = new Set<string>();

    for (const tc of toolCalls) {
        const toolName = (tc.toolName || (tc as any).name || '').toLowerCase();
        if (!tc.result) continue;

        const isShell = SHELL_TOOL_NAMES.has(toolName);
        const isAgent = AGENT_TOOL_NAMES.has(toolName);

        if (!isShell && !isAgent) continue;

        if (isShell) {
            const command = getCommandString(tc.args);

            // Skip read-only git commands even if their output happens to match
            if (isReadOnlyGitCommand(command)) continue;

            // Only scan results from commit-creating commands, or when
            // we can't determine the command (e.g. missing args)
            if (command && !isCommitCreatingCommand(command)) continue;
        }
        // Agent tools: scan result directly — no command to inspect

        const lines = tc.result.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const match = GIT_COMMIT_RE.exec(lines[i]);
            if (!match) continue;

            const [, branch, shortHash, subject] = match;
            if (seenHashes.has(shortHash)) continue;
            seenHashes.add(shortHash);

            const trimmedSubject = subject.trim();
            const isFixup = /^(?:fixup|squash|amend)! /.test(trimmedSubject);

            const commit: DetectedCommit = {
                shortHash,
                subject: trimmedSubject,
                branch,
                toolCallId: tc.id,
                isFixup,
            };

            // Look for diffstat on subsequent lines
            for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                const statMatch = DIFFSTAT_RE.exec(lines[j]);
                if (statMatch) {
                    commit.filesChanged = parseInt(statMatch[1], 10);
                    if (statMatch[2]) commit.insertions = parseInt(statMatch[2], 10);
                    if (statMatch[3]) commit.deletions = parseInt(statMatch[3], 10);
                    break;
                }
            }

            results.push(commit);
        }
    }

    return results;
}
