/**
 * pullRequestDetection — scans shell tool call results for pull-request creation
 * output and extracts structured pull-request metadata.
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
    toolName: string;
    name?: string;
    args?: unknown;
    result?: string;
    status?: string;
}

const SHELL_TOOL_NAMES = new Set(['powershell', 'shell', 'bash']);

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

// The submit_commits_as_pr.py wrapper emits a machine-readable success line on
// stdout: `JSON: {... "pr_url": "https://...", "status": "done"}`. On an
// idempotent / resumed run (commits_count: 0) it does not re-run `gh pr create`,
// and on the first run that echo can be truncated under a large git dump — so the
// structured success output is the only reliable PR-creation evidence.
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

/** True when the result carries the wrapper's structured success line (a non-empty pr_url plus status: done). */
function hasWrapperSuccessOutput(result: string): boolean {
    return WRAPPER_PR_URL_KEY_RE.test(result) && WRAPPER_STATUS_DONE_RE.test(result);
}

function hasPullRequestCreationEvidence(command: string, result: string): boolean {
    if (isPullRequestCreatingCommand(command)) return true;
    if (!command) return true;
    if (!isPullRequestCreatingWrapperCommand(command)) return false;
    return isPullRequestCreatingCommand(result) || hasWrapperSuccessOutput(result);
}

/**
 * Scans tool calls in a tool group for pull-request URLs emitted by shell tools.
 *
 * Only inspects PR creation commands, known PR-creation wrapper output that ran
 * a PR creation command, or shell output with no command metadata. Read-only PR
 * commands are ignored to avoid counting inspected pull requests.
 */
export function detectPullRequestsInToolGroup(toolCalls: ToolCallLike[]): DetectedPullRequest[] {
    const results: DetectedPullRequest[] = [];
    const seenUrls = new Set<string>();

    for (const tc of toolCalls) {
        const toolName = (tc.toolName || tc.name || '').toLowerCase();
        if (!SHELL_TOOL_NAMES.has(toolName)) continue;
        if (!tc.result) continue;

        const command = getCommandString(tc.args);
        if (isReadOnlyPullRequestCommand(command)) continue;
        if (!hasPullRequestCreationEvidence(command, tc.result)) continue;

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
