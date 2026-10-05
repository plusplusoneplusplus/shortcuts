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
    result?: unknown;
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
// Providers qualify native/MCP names differently (mcp__server__, server., etc.).
const PR_CREATION_TOOL_NAME_RE = /(?:^|[_.:/-])create_pull_request$/;

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

function isReadOnlyPullRequestCommand(command: string): boolean {
    return READ_ONLY_PR_PATTERNS.some(re => re.test(command));
}

/**
 * Read only the creation result's identity fields, never args, bodies or prose.
 * CoC returns {success, url, id, provider}; GitHub returns {url, number} or
 * {html_url, number}. MCP/Claude may wrap either in structuredContent or JSON
 * text blocks. Reject error envelopes and conflicting identities as a whole.
 */
function creationToolPrUrl(result: unknown, toolCallId: string): string | null {
    const urls = new Set<string>();
    let failed = false;
    const visit = (value: unknown, depth: number): void => {
        if (depth > 6) { failed = true; return; }
        if (typeof value === 'string') {
            try { visit(JSON.parse(value), depth + 1); } catch { /* not structured output */ }
            return;
        }
        // Claude serializes tool_result.content as an array of text blocks.
        if (Array.isArray(value)) {
            for (const block of value) {
                if (isRecord(block) && block.type === 'text') visit(block.text, depth + 1);
            }
            return;
        }
        if (!isRecord(value)) return;
        if (('success' in value && value.success !== true) || value.isError === true || value.is_error === true
            || value.error != null || (typeof value.status === 'string'
                && UNSUCCESSFUL_TOOL_STATUSES.has(value.status.toLowerCase()))) {
            failed = true;
            return;
        }
        if ('structuredContent' in value) visit(value.structuredContent, depth + 1);
        if (Array.isArray(value.content)) visit(value.content, depth + 1);

        for (const key of ['url', 'html_url']) {
            if (!(key in value)) continue;
            const url = value[key];
            // GitHub REST carries an API `url` alongside its browser html_url.
            if (key === 'url' && typeof url === 'string' && url.startsWith('https://api.github.com/')
                && typeof value.html_url === 'string') continue;
            const pr = typeof url === 'string' ? parsePullRequestUrl(url, toolCallId) : null;
            if (!pr || !Number.isSafeInteger(pr.number) || pr.number <= 0
                || typeof url !== 'string' || !url.endsWith(`/${pr.number}`) || pr.owner === '.' || pr.owner === '..'
                || pr.repo === '.' || pr.repo === '..') {
                failed = true;
                continue;
            }
            // GitHub REST's `id` is a database id, not the PR number. CoC's `id`
            // is the PR number; its explicit success flag distinguishes it.
            if ('number' in value && value.number !== pr.number) failed = true;
            if (value.success === true && 'id' in value && value.id !== pr.number) failed = true;
            if (value.provider !== undefined && value.provider !== pr.provider
                && !(value.provider === 'ado' && pr.provider === 'azure-devops')) failed = true;
            urls.add(pr.url);
        }
    };
    visit(result, 0);
    return !failed && urls.size === 1 ? [...urls][0] : null;
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

/** The PR URL emitted by a successful direct provider creation command. */
function resolveCreatedPullRequestUrl(command: string, result: string): string | null {
    if (!isPullRequestCreatingCommand(command) || PR_ALREADY_EXISTS_RE.test(result)) return null;
    return lastPullRequestUrl(result);
}

/**
 * Scans tool calls in a tool group for pull requests **created by those calls**.
 *
 * A tool call yields at most one pull request, and only with positive evidence
 * that it created it: a `gh pr create` / `az repos pr create` invocation that
 * did not fail, or a structured create_pull_request result. Read-only PR commands,
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

        if (PR_CREATION_TOOL_NAME_RE.test(toolName)) {
            if (!tc.result || !isSuccessfulToolCall(tc)) continue;
            append(creationToolPrUrl(tc.result, tc.id), tc);
            continue;
        }

        if (!SHELL_TOOL_NAMES.has(toolName)) continue;
        if (typeof tc.result !== 'string' || !tc.result) continue;

        const command = getCommandString(tc.args);
        if (isReadOnlyPullRequestCommand(command)) continue;

        if (!isSuccessfulToolCall(tc)) continue;
        append(resolveCreatedPullRequestUrl(command, tc.result), tc);
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
 * `turn.toolCalls`. Within each turn, de-duplicates by tool-call id, merging
 * command arguments from the start with the result and status from completion.
 * Tool call ids may be reused by separate assistant turns, so they remain distinct.
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
            byId.set(tc.id, {
                ...prev,
                ...tc,
                name: tc.name || prev.name,
                toolName: tc.toolName || prev.toolName,
                args: getCommandString(tc.args) ? tc.args : getCommandString(prev.args) ? prev.args : tc.args ?? prev.args,
                result: tc.result || prev.result,
                status: (tc.status === 'running' || tc.status === 'pending') && prev.result ? prev.status : tc.status ?? prev.status,
            });
        };
        for (const item of turn.timeline ?? []) consider(item.toolCall);
        for (const tc of turn.toolCalls ?? []) consider(tc);
        collected.push(...order.map(id => byId.get(id)!));
    }
    return collected;
}
