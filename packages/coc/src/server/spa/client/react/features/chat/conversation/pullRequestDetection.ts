/**
 * pullRequestDetection — scans shell tool call results for pull-request creation
 * output and extracts structured pull-request metadata.
 */

export interface DetectedPullRequest {
    number: number;
    url: string;
    provider: 'github' | 'unknown';
    owner?: string;
    repo?: string;
    toolCallId: string;
}

interface ToolCallLike {
    id: string;
    toolName: string;
    name?: string;
    args?: unknown;
    result?: string;
    status?: string;
}

const SHELL_TOOL_NAMES = new Set(['powershell', 'shell', 'bash']);

const GITHUB_PR_URL_RE = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g;

const PR_CREATING_PATTERNS = [
    /\bgh\s+pr\s+create\b/,
];

const READ_ONLY_PR_PATTERNS = [
    /\bgh\s+pr\s+view\b/,
    /\bgh\s+pr\s+list\b/,
    /\bgh\s+pr\s+status\b/,
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getCommandString(args: unknown): string {
    if (!args) return '';
    if (typeof args === 'string') return args;
    if (!isRecord(args)) return '';
    if (typeof args.command === 'string') return args.command;
    if (typeof args.script === 'string') return args.script;
    return '';
}

function isPullRequestCreatingCommand(command: string): boolean {
    return PR_CREATING_PATTERNS.some(re => re.test(command));
}

function isReadOnlyPullRequestCommand(command: string): boolean {
    return READ_ONLY_PR_PATTERNS.some(re => re.test(command));
}

/**
 * Scans tool calls in a tool group for pull-request URLs emitted by shell tools.
 *
 * Only inspects PR creation commands, or shell output with no command metadata.
 * Read-only PR commands are ignored to avoid counting inspected pull requests.
 */
export function detectPullRequestsInToolGroup(toolCalls: ToolCallLike[]): DetectedPullRequest[] {
    const results: DetectedPullRequest[] = [];
    const seenUrls = new Set<string>();

    for (const tc of toolCalls) {
        const toolName = tc.toolName || tc.name || '';
        if (!SHELL_TOOL_NAMES.has(toolName)) continue;
        if (!tc.result) continue;

        const command = getCommandString(tc.args);
        if (isReadOnlyPullRequestCommand(command)) continue;
        if (command && !isPullRequestCreatingCommand(command)) continue;

        GITHUB_PR_URL_RE.lastIndex = 0;
        for (const match of tc.result.matchAll(GITHUB_PR_URL_RE)) {
            const [, owner, repo, numberText] = match;
            const url = match[0];
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);
            results.push({
                number: Number.parseInt(numberText, 10),
                url,
                provider: 'github',
                owner,
                repo,
                toolCallId: tc.id,
            });
        }
    }

    return results;
}
