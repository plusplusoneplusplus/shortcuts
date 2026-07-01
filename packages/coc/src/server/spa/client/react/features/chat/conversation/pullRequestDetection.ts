/**
 * pullRequestDetection — scans PR-creation tool call results and extracts
 * structured pull-request metadata.
 */

export interface DetectedPullRequest {
    number: number;
    url: string;
    provider: 'github' | 'azure-devops' | 'unknown';
    owner?: string;
    repo?: string;
    /** Azure DevOps organization name (for ADO PRs). */
    organization?: string;
    /** Azure DevOps project name (for ADO PRs). */
    project?: string;
    toolCallId: string;
}

interface ToolCallLike {
    id: string;
    toolName?: string;
    name?: string;
    args?: unknown;
    result?: string;
    status?: string;
}

const SHELL_TOOL_NAMES = new Set(['powershell', 'shell', 'bash']);
const GITHUB_PR_CREATION_TOOL_NAMES = new Set([
    'github_create_pull_request',
    'mcp__codex_apps__github___create_pull_request',
]);

const GITHUB_PR_URL_RE = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/g;

// Azure DevOps PR URLs:
//   https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}
//   https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}
const ADO_DEV_AZURE_PR_URL_RE = /https:\/\/dev\.azure\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_. %-]+)\/_git\/([A-Za-z0-9_.-]+)\/pullrequest\/(\d+)/g;
const ADO_VSTS_PR_URL_RE = /https:\/\/([A-Za-z0-9_.-]+)\.visualstudio\.com\/([A-Za-z0-9_. %-]+)\/_git\/([A-Za-z0-9_.-]+)\/pullrequest\/(\d+)/g;

const PR_CREATING_PATTERNS = [
    /(?:^|[;&|]\s*|\$\s*)gh\s+pr\s+create\b/,
    /(?:^|[;&|]\s*|\$\s*)az\s+repos\s+pr\s+create\b/,
];

const PR_CREATING_WRAPPER_PATTERNS = [
    /\bsubmit_commits_as_pr\.py\b/,
];

// The submit_commits_as_pr.py wrapper prints a machine-readable status line that
// starts with `JSON: {...}` (see its emit()). A successful run carries a
// non-empty `pr_url` together with `status: "done"`, e.g.
//   JSON: {... "pr_url": "https://...", "status": "done"}
//
// This line is the only reliable PR-creation evidence when the wrapper's own
// output is too large to keep: the captured result is truncated to a head preview
// (a big `git rev-list` dump) and the trailing success line is dropped, so the URL
// is recovered later by grepping/tailing the wrapper's persisted stdout. On an
// idempotent / resumed run (commits_count: 0) `gh pr create` is never re-run, so
// there is no command echo to fall back on either.
//
// We anchor on the `JSON:` line start so a genuine emit — or a faithful grep/tail
// of the wrapper's stdout — counts, while source-search output does not: there the
// same text appears indented inside a string literal or behind a `path:line:`
// prefix, never at the start of a line.
const WRAPPER_SUCCESS_LINE_RE = /^[ \t]*JSON:\s*\{.*\}\s*$/;
const WRAPPER_PR_URL_KEY_RE = /"pr_url"\s*:\s*"[^"]+"/;
const WRAPPER_STATUS_DONE_RE = /"status"\s*:\s*"done"/;

const READ_ONLY_PR_PATTERNS = [
    /\bgh\s+pr\s+view\b/,
    /\bgh\s+pr\s+list\b/,
    /\bgh\s+pr\s+status\b/,
    /\baz\s+repos\s+pr\s+show\b/,
    /\baz\s+repos\s+pr\s+list\b/,
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

function stripQuotedShellText(command: string): string {
    let quote: '"' | "'" | null = null;
    let escaped = false;
    let stripped = '';

    for (const ch of command) {
        if (quote) {
            if (escaped) {
                escaped = false;
            } else if (ch === '\\' && quote === '"') {
                escaped = true;
            } else if (ch === quote) {
                quote = null;
            }
            stripped += ' ';
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            stripped += ' ';
            continue;
        }
        stripped += ch;
    }

    return stripped;
}

function isPullRequestCreatingCommand(command: string): boolean {
    const commandOutsideQuotes = stripQuotedShellText(command);
    return PR_CREATING_PATTERNS.some(re => re.test(commandOutsideQuotes));
}

function isPullRequestCreatingWrapperCommand(command: string): boolean {
    return PR_CREATING_WRAPPER_PATTERNS.some(re => re.test(command));
}

function isReadOnlyPullRequestCommand(command: string): boolean {
    return READ_ONLY_PR_PATTERNS.some(re => re.test(command));
}

function isGitHubConnectorPullRequestCreation(toolName: string): boolean {
    return GITHUB_PR_CREATION_TOOL_NAMES.has(toolName);
}

/**
 * True when any line is the wrapper's structured success status — a `JSON: {...}`
 * line (at line start) carrying a non-empty pr_url together with status: "done".
 */
function hasWrapperSuccessOutput(result: string): boolean {
    for (const line of result.split('\n')) {
        if (!WRAPPER_SUCCESS_LINE_RE.test(line)) continue;
        if (WRAPPER_PR_URL_KEY_RE.test(line) && WRAPPER_STATUS_DONE_RE.test(line)) return true;
    }
    return false;
}

function hasPullRequestCreationEvidence(command: string, result: string): boolean {
    // The command itself runs a PR-creating CLI.
    if (isPullRequestCreatingCommand(command)) return true;
    // The wrapper's machine-readable success line is strong, specific evidence a
    // PR was created — including when it surfaces via a later grep/tail of the
    // wrapper's persisted stdout, because the original command's result is often
    // truncated under a large git dump before the success line is reached.
    if (hasWrapperSuccessOutput(result)) return true;
    // No command metadata: fall back to scanning the raw output.
    if (!command) return true;
    // A known PR-creation wrapper whose (untruncated) result still echoes the
    // creating command counts even without the structured success line.
    if (isPullRequestCreatingWrapperCommand(command)) return isPullRequestCreatingCommand(result);
    return false;
}

/**
 * Scans tool calls in a tool group for pull-request URLs emitted by shell tools.
 *
 * Only inspects PR creation commands, results carrying the wrapper's structured
 * success line (a `JSON: {... pr_url ... status: "done"}` line — recognized even
 * when surfaced by a later grep/tail of the wrapper's persisted stdout), known
 * PR-creation wrapper output that echoed a creating command, or shell output with
 * no command metadata. Read-only PR commands are ignored to avoid counting
 * inspected pull requests.
 */
export function detectPullRequestsInToolGroup(toolCalls: ToolCallLike[]): DetectedPullRequest[] {
    const results: DetectedPullRequest[] = [];
    const seenUrls = new Set<string>();

    const appendGitHubPullRequests = (tc: ToolCallLike): void => {
        if (!tc.result) return;
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
    };

    for (const tc of toolCalls) {
        const toolName = (tc.toolName || tc.name || '').toLowerCase();
        if (isGitHubConnectorPullRequestCreation(toolName)) {
            appendGitHubPullRequests(tc);
            continue;
        }

        if (!SHELL_TOOL_NAMES.has(toolName)) continue;
        if (!tc.result) continue;

        const command = getCommandString(tc.args);
        if (isReadOnlyPullRequestCommand(command)) continue;
        if (!hasPullRequestCreationEvidence(command, tc.result)) continue;

        appendGitHubPullRequests(tc);

        ADO_DEV_AZURE_PR_URL_RE.lastIndex = 0;
        for (const match of tc.result.matchAll(ADO_DEV_AZURE_PR_URL_RE)) {
            const [, org, project, repo, numberText] = match;
            const url = match[0];
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);
            results.push({
                number: Number.parseInt(numberText, 10),
                url,
                provider: 'azure-devops',
                organization: org,
                project,
                repo,
                toolCallId: tc.id,
            });
        }

        ADO_VSTS_PR_URL_RE.lastIndex = 0;
        for (const match of tc.result.matchAll(ADO_VSTS_PR_URL_RE)) {
            const [, org, project, repo, numberText] = match;
            const url = match[0];
            if (seenUrls.has(url)) continue;
            seenUrls.add(url);
            results.push({
                number: Number.parseInt(numberText, 10),
                url,
                provider: 'azure-devops',
                organization: org,
                project,
                repo,
                toolCallId: tc.id,
            });
        }
    }

    return results;
}
