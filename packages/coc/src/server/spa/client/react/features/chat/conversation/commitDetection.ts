/**
 * commitDetection — scans SPA tool call results for git commit evidence
 * and extracts structured commit metadata without server-side persistence.
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

export interface ToolCallLike {
    id: string;
    toolName: string;
    name?: string;
    args?: any;
    result?: string;
    status?: string;
}

const SHELL_TOOL_NAMES = new Set(['powershell', 'shell', 'bash']);
const AGENT_TOOL_NAMES = new Set(['task', 'general-purpose']);
const POST_COMMIT_VERIFICATION_WINDOW = 8;

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
 * Compact one-line commit output, usually emitted by `git log --oneline -1`
 * after a commit command has already succeeded:
 *   shortHash subject line
 */
const GIT_ONELINE_COMMIT_RE = /^([0-9a-f]{7,40})\s+(.+)$/;

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
const COMMIT_CREATING_SUBCOMMANDS = ['commit', 'merge', 'cherry-pick', 'revert'];

/**
 * Commands whose output mentions hashes but should NOT be treated as commit creation.
 * These are read-only commands.
 */
const READ_ONLY_GIT_SUBCOMMANDS = ['log', 'show', 'diff', 'blame', 'reflog', 'rev-parse', 'describe'];

const GIT_GLOBAL_OPTION = String.raw`(?:--[\w-]+(?:=(?:"[^"]*"|'[^']*'|\S+))?|-\w(?:\s+\S+)?)`;

function getCommandString(args: any): string {
    if (!args) return '';
    if (typeof args === 'string') return args;
    if (typeof args.command === 'string') return args.command;
    if (typeof args.script === 'string') return args.script;
    return '';
}

function hasGitSubcommand(command: string, subcommand: string): boolean {
    return new RegExp(String.raw`\bgit(?:\s+${GIT_GLOBAL_OPTION})*\s+${subcommand}\b`).test(command);
}

function isCommitCreatingCommand(command: string): boolean {
    return COMMIT_CREATING_SUBCOMMANDS.some(cmd => hasGitSubcommand(command, cmd));
}

function isReadOnlyGitCommand(command: string): boolean {
    return READ_ONLY_GIT_SUBCOMMANDS.some(cmd => hasGitSubcommand(command, cmd));
}

function isPostCommitVerificationCommand(command: string): boolean {
    if (!hasGitSubcommand(command, 'log')) return false;
    return /(?:^|\s)(?:-1|-n\s*1|--max-count(?:=|\s+)1)\b/.test(command);
}

function commandResultSucceeded(result: string): boolean {
    const exitMatch = /<exited with exit code (-?\d+)>/.exec(result);
    return !exitMatch || exitMatch[1] === '0';
}

function normalizeCommitHash(hash: string): Pick<DetectedCommit, 'shortHash' | 'fullHash'> {
    if (hash.length === 40) {
        return { shortHash: hash.slice(0, 12), fullHash: hash };
    }
    return { shortHash: hash };
}

function hasSeenCommitHash(seenHashes: Set<string>, shortHash: string, fullHash?: string): boolean {
    const candidates = fullHash ? [shortHash, fullHash] : [shortHash];
    for (const seen of seenHashes) {
        for (const candidate of candidates) {
            if (seen.startsWith(candidate) || candidate.startsWith(seen)) return true;
        }
    }
    return false;
}

function rememberCommitHash(seenHashes: Set<string>, shortHash: string, fullHash?: string): void {
    seenHashes.add(shortHash);
    if (fullHash) seenHashes.add(fullHash);
}

function normalizeSubject(subject: string): string {
    return subject.trim().replace(/^\([^)]*\)\s+/, '');
}

function findNextSubjectLine(lines: string[], startIndex: number): string | undefined {
    for (let i = startIndex; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('## ')) continue;
        if (/^<exited with exit code -?\d+>$/.test(trimmed)) continue;
        return normalizeSubject(trimmed);
    }
    return undefined;
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
    let postCommitVerificationBudget = 0;

    for (const tc of toolCalls) {
        const toolName = (tc.toolName || (tc as any).name || '').toLowerCase();
        if (!tc.result) continue;

        const isShell = SHELL_TOOL_NAMES.has(toolName);
        const isAgent = AGENT_TOOL_NAMES.has(toolName);

        if (!isShell && !isAgent) continue;

        let allowCompactOneline = false;
        let allowVerificationOutput = false;
        if (isShell) {
            const command = getCommandString(tc.args);
            const createsCommit = isCommitCreatingCommand(command);
            const successfulResult = commandResultSucceeded(tc.result);

            // Skip read-only-only git commands even if their output happens to match.
            // Commit commands often chain read-only verification such as
            // `git log --oneline -1`, so those are still eligible.
            if (isReadOnlyGitCommand(command) && !createsCommit) {
                allowVerificationOutput = postCommitVerificationBudget > 0
                    && isPostCommitVerificationCommand(command)
                    && successfulResult;
                if (!allowVerificationOutput) {
                    if (postCommitVerificationBudget > 0) postCommitVerificationBudget--;
                    continue;
                }
            }

            // Only scan results from commit-creating commands, or when
            // we can't determine the command (e.g. missing args)
            if (command && !createsCommit && !allowVerificationOutput) {
                if (postCommitVerificationBudget > 0) postCommitVerificationBudget--;
                continue;
            }

            allowCompactOneline = createsCommit || allowVerificationOutput;
            if (createsCommit && successfulResult) {
                postCommitVerificationBudget = POST_COMMIT_VERIFICATION_WINDOW;
            } else if (postCommitVerificationBudget > 0) {
                postCommitVerificationBudget--;
            }
        }
        // Agent tools: scan result directly — no command to inspect

        const lines = tc.result.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const match = GIT_COMMIT_RE.exec(lines[i]);

            let branch: string | undefined;
            let hash: string;
            let subject: string;
            if (match) {
                [, branch, hash, subject] = match;
            } else if (allowCompactOneline) {
                const trimmedLine = lines[i].trim();
                const onelineMatch = GIT_ONELINE_COMMIT_RE.exec(trimmedLine);
                if (onelineMatch) {
                    [, hash, subject] = onelineMatch;
                } else if (allowVerificationOutput && /^[0-9a-f]{7,40}$/.test(trimmedLine)) {
                    hash = trimmedLine;
                    const nextSubject = findNextSubjectLine(lines, i + 1);
                    if (!nextSubject) continue;
                    subject = nextSubject;
                } else {
                    continue;
                }
            } else {
                continue;
            }

            const { shortHash, fullHash } = normalizeCommitHash(hash);
            if (hasSeenCommitHash(seenHashes, shortHash, fullHash)) continue;
            rememberCommitHash(seenHashes, shortHash, fullHash);

            const trimmedSubject = normalizeSubject(subject);
            const isFixup = /^(?:fixup|squash|amend)! /.test(trimmedSubject);

            const commit: DetectedCommit = {
                shortHash,
                subject: trimmedSubject,
                toolCallId: tc.id,
                isFixup,
            };
            if (branch) commit.branch = branch;
            if (fullHash) commit.fullHash = fullHash;

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

export function detectCommitsByToolCallId(toolCalls: ToolCallLike[]): Map<string, DetectedCommit[]> {
    const commits = detectCommitsInToolGroup(toolCalls);
    const byToolId = new Map<string, DetectedCommit[]>();
    for (const commit of commits) {
        const existing = byToolId.get(commit.toolCallId);
        if (existing) {
            existing.push(commit);
        } else {
            byToolId.set(commit.toolCallId, [commit]);
        }
    }
    return byToolId;
}
