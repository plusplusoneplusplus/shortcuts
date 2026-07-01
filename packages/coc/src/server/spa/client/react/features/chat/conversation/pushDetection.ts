/**
 * pushDetection — scans shell tool call results for successful `git push` output
 * and extracts structured push metadata without server-side persistence.
 *
 * Detection is keyed off the push output block itself — the `To <remote>` line
 * followed by `<local> -> <remote>` ref-update lines — which git prints
 * regardless of which CLI triggered the push (`git push`, `gh`, `az`, or the
 * `submit_commits_as_pr.py` wrapper). A `git push` command pattern is used as a
 * secondary signal (e.g. to attribute a forced push from a `--force` flag).
 *
 * Only successful pushes are surfaced: a result carrying a non-zero exit marker
 * or a failure marker (`! [rejected]`, `error:`, `fatal:`) is skipped entirely,
 * and individual rejected / up-to-date ref lines are ignored.
 */

export interface DetectedPush {
    /** Remote as printed on the `To` line — a URL or a bare name (e.g. "origin"). */
    remote: string;
    /** Remote branch / refspec target (right of `->`). */
    branch?: string;
    /** Local ref pushed (left of `->`). */
    localRef?: string;
    /** Ref-change summary: "abc123..def456" | "[new branch]" | "[new tag]". */
    summary?: string;
    /** True for a forced push (flag `+`, "(forced update)", or a --force command). */
    forced: boolean;
    /** True for "[new branch]" / "[new tag]" pushes. */
    isNewRef?: boolean;
    /** Derived https browse URL for the pushed branch, when derivable. */
    url?: string;
    provider?: 'github' | 'azure-devops' | 'unknown';
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

/** `To <remote>` header line that opens a push output block. */
const PUSH_TO_LINE_RE = /^To\s+(.+?)\s*$/;

/**
 * A single ref-update line within a push output block. We capture the prefix
 * (leading flag + summary), then the `<from> -> <to>` mapping and an optional
 * trailing `(reason)`. Examples:
 *      abc1234..def5678  main -> main
 *    + abc1234...def567  main -> main (forced update)
 *    * [new branch]      feature -> feature
 *    ! [rejected]        main -> main (non-fast-forward)
 */
const PUSH_REF_LINE_RE = /^(.*?)\s(\S+)\s+->\s+(\S+)(?:\s+\(([^)]*)\))?\s*$/;

const FORCE_FLAG_RE = /(?:^|\s)(?:--force-with-lease(?:=\S*)?|--force|-f)(?:\s|$)/;

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

function commandResultSucceeded(result: string): boolean {
    const exitMatch = /<exited with exit code (-?\d+)>/.exec(result);
    return !exitMatch || exitMatch[1] === '0';
}

/**
 * True when the result carries a strong push-failure signal: a non-zero exit
 * marker, or a failure marker line (`! [rejected]`, `error:`, `fatal:`). Such
 * results are skipped wholesale so an errored push is never counted.
 */
function resultHasPushFailure(result: string): boolean {
    if (!commandResultSucceeded(result)) return true;
    for (const rawLine of result.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (/^!\s+\[rejected\]/.test(line)) return true;
        if (/^\[remote rejected\]/.test(line)) return true;
        if (/^error:/.test(line)) return true;
        if (/^fatal:/.test(line)) return true;
    }
    return false;
}

/** Strips a trailing `.git` and any trailing slash from a repo path segment. */
function cleanRepoSegment(repo: string): string {
    return repo.replace(/\.git$/, '').replace(/\/$/, '');
}

/** Strips a leading `refs/heads/` or `refs/tags/` so the branch reads cleanly. */
function cleanRef(ref: string): string {
    return ref.replace(/^refs\/(?:heads|tags)\//, '');
}

interface RemoteInfo {
    provider: 'github' | 'azure-devops' | 'unknown';
    url?: string;
}

/**
 * Derives an https browse URL for `branch` on `remote` when the remote is a
 * recognized GitHub or Azure DevOps URL (https or ssh). Named remotes (e.g.
 * "origin") and unknown hosts yield no URL.
 */
function deriveRemoteInfo(remote: string, branch?: string): RemoteInfo {
    const branchPart = branch ? encodeURIComponent(cleanRef(branch)) : '';

    // GitHub — https://github.com/owner/repo(.git) or git@github.com:owner/repo(.git)
    const githubHttps = /^https:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/.exec(remote);
    const githubSsh = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/.exec(remote);
    const github = githubHttps || githubSsh;
    if (github) {
        const owner = github[1];
        const repo = cleanRepoSegment(github[2]);
        const url = branchPart
            ? `https://github.com/${owner}/${repo}/tree/${branchPart}`
            : undefined;
        return { provider: 'github', url };
    }

    // Azure DevOps — https://dev.azure.com/{org}/{project}/_git/{repo}
    const adoDevAzure = /^https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?#]+?)(?:\.git)?\/?$/.exec(remote);
    // Azure DevOps — https://{org}.visualstudio.com/{project}/_git/{repo}
    const adoVsts = /^https:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/?#]+?)(?:\.git)?\/?$/.exec(remote);
    // Azure DevOps ssh — git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
    const adoSsh = /^(?:ssh:\/\/)?git@ssh\.dev\.azure\.com:(?:v3\/)?([^/]+)\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/.exec(remote);
    const ado = adoDevAzure || adoVsts || adoSsh;
    if (ado) {
        const org = ado[1];
        const project = ado[2];
        const repo = cleanRepoSegment(ado[3]);
        const base = adoVsts
            ? `https://${org}.visualstudio.com/${project}/_git/${repo}`
            : `https://dev.azure.com/${org}/${project}/_git/${repo}`;
        const url = branchPart ? `${base}?version=GB${branchPart}` : undefined;
        return { provider: 'azure-devops', url };
    }

    return { provider: 'unknown' };
}

interface ParsedRefLine {
    flag: string;
    summary: string;
    from: string;
    to: string;
    reason?: string;
}

function parseRefLine(line: string): ParsedRefLine | undefined {
    const match = PUSH_REF_LINE_RE.exec(line);
    if (!match) return undefined;
    const [, prefixRaw, from, to, reason] = match;
    const prefix = prefixRaw.trim();
    if (!prefix) return undefined;

    const flagChar = prefix[0];
    const isFlag = '+-*!='.includes(flagChar);
    const flag = isFlag ? flagChar : ' ';
    const summary = (isFlag ? prefix.slice(1) : prefix).trim();
    if (!summary) return undefined;

    return { flag, summary, from, to, reason };
}

/**
 * Scans tool calls in a tool group for successful git push output and returns
 * structured push metadata for each detected push.
 *
 * Only shell-category tool calls are inspected. Pushes are deduped within the
 * group by (remote, branch, summary). Failed / rejected pushes are excluded.
 */
export function detectPushesInToolGroup(toolCalls: ToolCallLike[]): DetectedPush[] {
    const results: DetectedPush[] = [];
    const seen = new Set<string>();

    for (const tc of toolCalls) {
        const toolName = (tc.toolName || tc.name || '').toLowerCase();
        if (!SHELL_TOOL_NAMES.has(toolName)) continue;
        if (!tc.result) continue;
        if (resultHasPushFailure(tc.result)) continue;

        const command = getCommandString(tc.args);
        const forcedByCommand = FORCE_FLAG_RE.test(command);

        let currentRemote: string | null = null;
        for (const rawLine of tc.result.split(/\r?\n/)) {
            const toMatch = PUSH_TO_LINE_RE.exec(rawLine);
            if (toMatch) {
                currentRemote = toMatch[1].trim();
                continue;
            }
            if (!currentRemote) continue;

            const parsed = parseRefLine(rawLine);
            if (!parsed) continue;

            // Skip non-push ref states: rejected (!), up-to-date (=), deleted (-).
            if (parsed.flag === '!' || parsed.flag === '=' || parsed.flag === '-') continue;

            const branch = cleanRef(parsed.to);
            const summary = parsed.summary;
            const dedupKey = `${currentRemote} ${branch} ${summary}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            const isNewRef = parsed.flag === '*' || /\[new (?:branch|tag)\]/.test(summary);
            const forced = forcedByCommand
                || parsed.flag === '+'
                || /forced update/i.test(parsed.reason ?? '');

            const { provider, url } = deriveRemoteInfo(currentRemote, branch);

            const push: DetectedPush = {
                remote: currentRemote,
                branch,
                localRef: cleanRef(parsed.from),
                summary,
                forced,
                toolCallId: tc.id,
                provider,
            };
            if (isNewRef) push.isNewRef = true;
            if (url) push.url = url;

            results.push(push);
        }
    }

    return results;
}
