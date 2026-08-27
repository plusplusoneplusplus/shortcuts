/**
 * pull-request-detection — scans PR-creation tool call results and extracts
 * structured pull-request metadata.
 *
 * Shared by the dashboard SPA (live chip while a chat is open) and the server's
 * task-completion binding pass (backstop for chats nobody was watching). Pure
 * strings/regex — no React, no DOM, no Node built-ins — so it is safe in a
 * browser bundle.
 *
 * Detection is deliberately conservative: a chat's PR banner is persisted as a
 * `pull_request_chat_bindings` row, so a mis-detection is permanent. Every
 * detection therefore needs *positive* evidence that **this** tool call created
 * **that** pull request, and yields only the single URL that evidence points at
 * rather than every PR URL that happened to appear in the output.
 */
import { normalizeRemoteUrl } from './normalize-url';

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

/**
 * Structural shape of a tool call the detector reads. Both the SPA's
 * `ClientToolCall` (`toolName`) and forge's `ToolCall` (`name`) satisfy it.
 */
export interface ToolCallLike {
    id: string;
    toolName?: string;
    name?: string;
    args?: unknown;
    result?: string;
    status?: string;
}

export interface PullRequestDetectionOptions {
    /**
     * The chat workspace's git remote URL. When provided, detections are scoped
     * to that repo: a PR URL pointing at any other `owner/repo` (or ADO
     * `org/project/repo`) is dropped, so a PR merely *mentioned* in this chat's
     * output can never become a binding for it.
     */
    remoteUrl?: string | null;
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

// Matches positions where a command may legitimately start:
//   - start of string (^)
//   - after a shell separator/operator: ; & | newline ( ) { }
//   - after a shell control-flow keyword (then/else/elif/do) preceded by whitespace/operator
//   - after a command-substitution opener ($)
const PR_CREATE_BOUNDARY = String.raw`(?:^|[;&|\n(){}]\s*|[\s;&|(){}\n](?:then|else|elif|do)\s+|\$\s*)`;

const PR_CREATING_PATTERNS = [
    new RegExp(PR_CREATE_BOUNDARY + String.raw`gh\s+pr\s+create\b`),
    new RegExp(PR_CREATE_BOUNDARY + String.raw`az\s+repos\s+pr\s+create\b`),
];

const PR_CREATING_WRAPPER_PATTERNS = [
    /\bsubmit_commits_as_pr\.py\b/,
];

// `gh pr create` exits non-zero when the branch already has a pull request, and
// prints the *pre-existing* PR's URL:
//   a pull request for branch "X" into branch "main" already exists:
//   https://github.com/o/r/pull/123
// That URL was not created here, so the whole tool call is rejected. Harnesses
// routinely report a non-zero shell exit as a `completed` tool call with the
// error text in the result, so `status` alone does not catch this.
const PR_ALREADY_EXISTS_RE = /already exists:/i;

// Tool-call statuses that mean "this call did not succeed". A call that is still
// pending/running has no trustworthy output, and a failed one created nothing.
const UNSUCCESSFUL_TOOL_STATUSES = new Set(['failed', 'error', 'cancelled', 'canceled', 'aborted', 'timeout', 'pending', 'running']);

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
const WRAPPER_PR_URL_VALUE_RE = /"pr_url"\s*:\s*"([^"]+)"/;
const WRAPPER_STATUS_DONE_RE = /"status"\s*:\s*"done"/;

// Paths that a later grep/tail can legitimately recover a wrapper success line
// from — anything file-path shaped, as it appears in a shell command.
const PATH_TOKEN_RE = /(?:[A-Za-z]:)?[\w./\\~-]*[/\\][\w./\\-]+/g;

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

/**
 * False only when the tool call explicitly reports a non-successful status. An
 * absent status is treated as successful: several producers (and the GitHub
 * connector path) omit it entirely, and rejecting those would silence detection
 * wholesale. The `already exists:` guard below is what actually catches a failed
 * `gh pr create`, because a non-zero shell exit is commonly still reported as a
 * `completed` tool call.
 */
function isSuccessfulToolCall(tc: ToolCallLike): boolean {
    if (typeof tc.status !== 'string' || !tc.status) return true;
    return !UNSUCCESSFUL_TOOL_STATUSES.has(tc.status.toLowerCase());
}

// A shell interpreter invoked with a `-c`/`-lc` flag, e.g. `bash -lc '<cmd>'`,
// `/bin/bash -c "<cmd>"`, `sh -c '<cmd>'`. Some agent harnesses serialize every
// shell tool call this way, so the real command lives entirely inside the quoted
// payload. Without unwrapping, `stripQuotedShellText` erases that payload and a
// genuine `gh pr create` is never seen.
const SHELL_WRAPPER_RE = /^\s*(?:\S*\/)?(?:ba|z|k|da)?sh\s+-[a-z]*c\b\s*/i;

/**
 * If `command` is a shell-interpreter wrapper (`bash -lc '…'`, `sh -c "…"`, …),
 * returns the inner command payload — the first quoted argument after the
 * `-c`/`-lc` flag. Returns null for anything that is not such a wrapper, so a
 * quoted argument to an ordinary command (e.g. `rg "gh pr create" .`) is never
 * treated as a command to scan.
 */
function extractShellWrapperPayload(command: string): string | null {
    const match = SHELL_WRAPPER_RE.exec(command);
    if (!match) return null;
    const rest = command.slice(match[0].length);
    const quote = rest[0];
    if (quote !== '"' && quote !== "'") return null;

    let payload = '';
    let escaped = false;
    for (let i = 1; i < rest.length; i++) {
        const ch = rest[i];
        if (escaped) {
            payload += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\' && quote === '"') {
            escaped = true;
            payload += ch;
            continue;
        }
        if (ch === quote) return payload;
        payload += ch;
    }
    // Unterminated quote: treat the remainder as the payload.
    return payload;
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

function matchesPrCreatePattern(command: string): boolean {
    const commandOutsideQuotes = stripQuotedShellText(command);
    return PR_CREATING_PATTERNS.some(re => re.test(commandOutsideQuotes));
}

function isPullRequestCreatingCommand(command: string): boolean {
    if (matchesPrCreatePattern(command)) return true;
    // Also scan inside a shell-interpreter wrapper (`bash -lc 'gh pr create …'`),
    // where the real command is quoted and would otherwise be stripped away.
    const payload = extractShellWrapperPayload(command);
    return payload !== null && matchesPrCreatePattern(payload);
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
 * The `pr_url` carried by the wrapper's structured success line — a `JSON: {...}`
 * line (at line start) with a non-empty pr_url together with status: "done".
 * Returns the last such line's URL, or null when there is no success line.
 */
function wrapperSuccessPrUrl(result: string): string | null {
    let found: string | null = null;
    for (const line of result.split('\n')) {
        if (!WRAPPER_SUCCESS_LINE_RE.test(line)) continue;
        if (!WRAPPER_STATUS_DONE_RE.test(line)) continue;
        const match = WRAPPER_PR_URL_VALUE_RE.exec(line);
        if (match && match[1]) found = match[1];
    }
    return found;
}

/** File-path-shaped tokens in a shell command (`grep JSON: /tmp/x/y.txt`). */
function pathTokens(text: string): string[] {
    PATH_TOKEN_RE.lastIndex = 0;
    return text.match(PATH_TOKEN_RE) ?? [];
}

/**
 * Parses a single PR URL into a {@link DetectedPullRequest}. Returns null when the
 * URL is not a recognized GitHub / Azure DevOps pull-request URL.
 */
function parsePullRequestUrl(url: string, toolCallId: string): DetectedPullRequest | null {
    for (const re of [GITHUB_PR_URL_RE, ADO_DEV_AZURE_PR_URL_RE, ADO_VSTS_PR_URL_RE]) {
        re.lastIndex = 0;
        const match = re.exec(url);
        if (!match || match[0] !== url) continue;
        if (re === GITHUB_PR_URL_RE) {
            const [, owner, repo, numberText] = match;
            return { number: Number.parseInt(numberText, 10), url, provider: 'github', owner, repo, toolCallId };
        }
        const [, organization, project, repo, numberText] = match;
        return {
            number: Number.parseInt(numberText, 10),
            url,
            provider: 'azure-devops',
            organization,
            project,
            repo,
            toolCallId,
        };
    }
    return null;
}

/**
 * The **last** pull-request URL in a result. `gh pr create` prints the created
 * PR's URL as its final line, after any preamble (`git push` hints, a
 * `git rev-list` dump, unrelated PR URLs quoted from commit messages), so the
 * last match is the created one — the earlier ones rode along.
 */
function lastPullRequestUrl(result: string): string | null {
    let best: { url: string; index: number } | null = null;
    for (const re of [GITHUB_PR_URL_RE, ADO_DEV_AZURE_PR_URL_RE, ADO_VSTS_PR_URL_RE]) {
        re.lastIndex = 0;
        for (const match of result.matchAll(re)) {
            const index = match.index ?? 0;
            if (!best || index >= best.index) best = { url: match[0], index };
        }
    }
    return best ? best.url : null;
}

/**
 * The canonical `host/owner/repo` (or `dev.azure.com/org/project/repo`) key a
 * detected PR belongs to, for comparison against the chat's own remote.
 */
function repoKeyForDetectedPr(pr: DetectedPullRequest): string | null {
    if (pr.provider === 'github') {
        if (!pr.owner || !pr.repo) return null;
        return normalizeRemoteUrl(`https://github.com/${pr.owner}/${pr.repo}`).toLowerCase();
    }
    if (pr.provider === 'azure-devops') {
        if (!pr.organization || !pr.project || !pr.repo) return null;
        return normalizeRemoteUrl(
            `https://dev.azure.com/${pr.organization}/${pr.project}/_git/${pr.repo}`,
        ).toLowerCase();
    }
    return null;
}

/**
 * Builds the repo-scope predicate from the chat workspace's remote URL. Returns
 * null when there is no usable remote (no scoping — detection stays as strict as
 * its evidence rules make it, but cannot filter by repo).
 */
function buildRepoScope(remoteUrl: string | null | undefined): ((pr: DetectedPullRequest) => boolean) | null {
    if (typeof remoteUrl !== 'string' || !remoteUrl.trim()) return null;
    const chatKey = normalizeRemoteUrl(remoteUrl.trim()).toLowerCase();
    if (!chatKey) return null;
    return (pr: DetectedPullRequest): boolean => {
        const prKey = repoKeyForDetectedPr(pr);
        if (!prKey) return false;
        // ADO PR URLs carry org/project/repo; a chat remote may be recorded at
        // org/project granularity, so a prefix match on path segments is enough.
        return prKey === chatKey || prKey.startsWith(`${chatKey}/`) || chatKey.startsWith(`${prKey}/`);
    };
}

/**
 * The single pull-request URL this tool call is positive evidence of having
 * created, or null when there is no such evidence.
 *
 * `ownLogPaths` holds the file paths this chat's own PR-creation runs named (in
 * their command or their output, e.g. the harness's "full output at <path>"
 * truncation notice). It gates the grep/tail recovery path so a grep that
 * happens to hit *another* run's persisted stdout cannot pin that run's PR here.
 */
function resolveCreatedPullRequestUrl(
    command: string,
    result: string,
    ownLogPaths: ReadonlySet<string>,
): string | null {
    const wrapperUrl = wrapperSuccessPrUrl(result);
    if (wrapperUrl) {
        // The wrapper (or a PR-creating CLI) ran in this very tool call.
        if (isPullRequestCreatingWrapperCommand(command) || isPullRequestCreatingCommand(command)) {
            return wrapperUrl;
        }
        // Recovered afterwards by grepping/tailing the wrapper's persisted
        // stdout, because the original result was truncated under a large git
        // dump before the success line. Only trust it when the file being read
        // is one this chat's own PR-creation run named.
        if (command && commandReadsOwnLog(command, ownLogPaths)) return wrapperUrl;
        return null;
    }

    // A PR-creating CLI ran here: the created PR is the URL it printed last.
    // A `gh pr create` that failed because the branch already has a PR prints
    // the pre-existing PR's URL — that one was not created here.
    if (isPullRequestCreatingCommand(command)) {
        if (PR_ALREADY_EXISTS_RE.test(result)) return null;
        return lastPullRequestUrl(result);
    }

    // A known PR-creation wrapper whose (untruncated) result still echoes the
    // creating command counts even without the structured success line.
    if (isPullRequestCreatingWrapperCommand(command) && isPullRequestCreatingCommand(result)) {
        if (PR_ALREADY_EXISTS_RE.test(result)) return null;
        return lastPullRequestUrl(result);
    }

    // No positive evidence — including when there is no command metadata at all.
    // Attaching every PR URL in an unattributed shell result is exactly how a
    // foreign PR used to end up bound to this chat.
    return null;
}

/** Normalizes a path token for comparison (Windows separators, trailing slash). */
function normalizePathToken(token: string): string {
    return token.replace(/\\/g, '/').replace(/\/+$/, '');
}

function commandReadsOwnLog(command: string, ownLogPaths: ReadonlySet<string>): boolean {
    if (ownLogPaths.size === 0) return false;
    return pathTokens(command).some(token => ownLogPaths.has(normalizePathToken(token)));
}

/** Records the log/output paths a PR-creation run named, for the grep/tail gate. */
function collectOwnLogPaths(command: string, result: string, into: Set<string>): void {
    for (const token of pathTokens(command)) into.add(normalizePathToken(token));
    for (const token of pathTokens(result)) into.add(normalizePathToken(token));
}

/**
 * Scans tool calls in a tool group for pull requests **created by those calls**.
 *
 * A tool call yields at most one pull request, and only with positive evidence
 * that it created it: the wrapper's structured `JSON: {… pr_url … status:"done"}`
 * success line (from its own run, or from a later grep/tail of a log path this
 * chat's own run named), a `gh pr create` / `az repos pr create` invocation that
 * did not fail, or the GitHub connector's create tool. Read-only PR commands,
 * unsuccessful tool calls, and shell output with no command metadata are ignored.
 *
 * Pass `options.remoteUrl` to additionally scope results to the chat's own repo.
 */
export function detectPullRequestsInToolGroup(
    toolCalls: ToolCallLike[],
    options: PullRequestDetectionOptions = {},
): DetectedPullRequest[] {
    const results: DetectedPullRequest[] = [];
    const seenUrls = new Set<string>();
    const ownLogPaths = new Set<string>();
    const inScope = buildRepoScope(options.remoteUrl);

    const append = (url: string | null, tc: ToolCallLike): void => {
        if (!url || seenUrls.has(url)) return;
        const pr = parsePullRequestUrl(url, tc.id);
        if (!pr) return;
        if (inScope && !inScope(pr)) return;
        seenUrls.add(url);
        results.push(pr);
    };

    for (const tc of toolCalls) {
        const toolName = (tc.toolName || tc.name || '').toLowerCase();

        if (isGitHubConnectorPullRequestCreation(toolName)) {
            if (!tc.result || !isSuccessfulToolCall(tc)) continue;
            append(lastPullRequestUrl(tc.result), tc);
            continue;
        }

        if (!SHELL_TOOL_NAMES.has(toolName)) continue;
        if (!tc.result) continue;

        const command = getCommandString(tc.args);
        if (isReadOnlyPullRequestCommand(command)) continue;

        // Remember where this chat's own PR-creation runs wrote their output, so a
        // later grep/tail of that same file counts as recovery rather than a peek
        // at an unrelated run's log.
        if (isPullRequestCreatingWrapperCommand(command) || isPullRequestCreatingCommand(command)) {
            collectOwnLogPaths(command, tc.result, ownLogPaths);
        }

        if (!isSuccessfulToolCall(tc)) continue;
        append(resolveCreatedPullRequestUrl(command, tc.result, ownLogPaths), tc);
    }

    return results;
}

/**
 * Synthesizes the canonical remote URL of the repo a detected PR lives in, so
 * callers can resolve its origin id with the shared `resolveCanonicalOriginId`
 * instead of inventing a second provider→origin mapping. Returns null when the
 * provider/fields are insufficient.
 */
export function syntheticRemoteUrlForDetectedPr(pr: DetectedPullRequest): string | null {
    if (pr.provider === 'github') {
        if (!pr.owner || !pr.repo) return null;
        return `https://github.com/${pr.owner}/${pr.repo}`;
    }
    if (pr.provider === 'azure-devops') {
        if (!pr.organization || !pr.project) return null;
        return `https://dev.azure.com/${pr.organization}/${pr.project}`;
    }
    return null;
}

/**
 * Structural shape of a conversation turn the flattener reads. Satisfied by
 * both the SPA's `ClientConversationTurn` and forge's `ConversationTurn`, so
 * the client and the server flatten turns with the same code.
 */
export interface ToolCallBearingTurn<T extends ToolCallLike = ToolCallLike> {
    timeline?: ReadonlyArray<{ toolCall?: T }>;
    toolCalls?: ReadonlyArray<T>;
}

/**
 * Flattens every tool call across the given turns, preferring the structured
 * `timeline[].toolCall` entries and falling back to the legacy flat
 * `turn.toolCalls`. Within each turn, de-duplicates by tool-call id, keeping the
 * most complete record (the one carrying a `result`) so a tool that shows up as
 * both `tool-start` and `tool-complete` is scanned once with its output. Tool
 * call ids may be reused by separate assistant turns, so they remain distinct.
 */
export function collectToolCallsFromTurns<T extends ToolCallLike>(
    turns: readonly ToolCallBearingTurn<T>[] | undefined,
): T[] {
    const collected: T[] = [];
    for (const turn of turns ?? []) {
        const byId = new Map<string, T>();
        const order: string[] = [];
        const consider = (tc: T | undefined): void => {
            if (!tc || !tc.id) return;
            const prev = byId.get(tc.id);
            if (!prev) {
                byId.set(tc.id, tc);
                order.push(tc.id);
                return;
            }
            // Prefer the record that carries output.
            if (!prev.result && tc.result) byId.set(tc.id, tc);
        };
        for (const item of turn.timeline ?? []) consider(item.toolCall);
        for (const tc of turn.toolCalls ?? []) consider(tc);
        collected.push(...order.map(id => byId.get(id)!));
    }
    return collected;
}
