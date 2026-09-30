/**
 * The one server-side path that opens a pull request, for GitHub (`gh`) and
 * Azure DevOps (`az repos`). The LLM tool, the Work Item PR submission and the
 * other PR flows all call {@link createPullRequest}.
 *
 * - The provider comes only from the `origin` remote URL.
 * - Auth is the user's existing `gh` / `az` login; no tokens are stored.
 * - **commits mode** cherry-picks the given commits onto a fresh branch in a
 *   temporary linked worktree, so the caller's worktree may be dirty and its
 *   branch/HEAD never changes. Any cherry-pick or rebase conflict aborts the
 *   whole run: the worktree is removed, the branch deleted, and the error names
 *   the conflicting commit.
 * - **current-branch mode** pushes the current branch when needed and opens a
 *   PR from it.
 *
 * If the branch already has an open PR, that PR is returned instead.
 *
 * Every git/`gh`/`az` call goes through the injected {@link PrCliRunner}, so
 * tests drive the whole flow with a fake runner.
 */

import * as childProcess from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { execGitAsync } from '@plusplusoneplusplus/forge';

const COMMAND_MAX_BUFFER = 1024 * 1024 * 10;
const REMOTE = 'origin';

export type PullRequestProvider = 'github' | 'ado';
export type PullRequestMergeMethod = 'merge' | 'squash' | 'rebase';

export interface PrCliResult {
    stdout: string;
    stderr: string;
}

/**
 * Runs one CLI command. Must reject on a non-zero exit. A missing executable
 * should reject with `code: 'ENOENT'` (Node's `execFile` does this).
 */
export type PrCliRunner = (command: string, args: string[], options: { cwd: string }) => Promise<PrCliResult>;

export interface CreatePullRequestInput {
    /** The caller's checkout (the chat's workspace/working directory). */
    repoRoot: string;
    title: string;
    body?: string;
    /** Target branch. Defaults to the repo's default branch. */
    base?: string;
    draft?: boolean;
    /** Default false. */
    autoMerge?: boolean;
    /** Default `merge`. */
    mergeMethod?: PullRequestMergeMethod;
    /** A SHA, a list of SHAs, a comma-separated list, or an `A..B` range. Omit for current-branch mode. */
    commits?: string | string[];
    /**
     * commits mode only: the branch to create instead of `pr/<short-sha>-<slug>`.
     * A numeric suffix is still added when it already exists.
     */
    branch?: string;
}

export interface CreatePullRequestResult {
    url: string;
    id: number;
    provider: PullRequestProvider;
    branch: string;
    base: string;
    /** True when the branch already had an open PR and no new one was created. */
    existing: boolean;
    autoMerge: { requested: boolean; enabled: boolean; warning?: string };
}

export type CreatePullRequestErrorCode =
    | 'invalid-input'
    | 'unknown-remote'
    | 'cli-missing'
    | 'not-logged-in'
    | 'detached-head'
    | 'on-base-branch'
    | 'no-commits'
    | 'conflict'
    | 'command-failed';

export class CreatePullRequestError extends Error {
    constructor(
        readonly code: CreatePullRequestErrorCode,
        message: string,
        /** The commit whose cherry-pick conflicted (commits mode). */
        readonly commit?: string,
    ) {
        super(message);
        this.name = 'CreatePullRequestError';
    }
}

export interface CreatePullRequestDeps {
    runCommand?: PrCliRunner;
    /** Parent directory for temporary worktrees and argument files. Defaults to `os.tmpdir()`. */
    tempDir?: string;
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

/**
 * Pick the provider from a remote URL: Azure DevOps hosts map to `ado`, any
 * other network remote to `github`. Local paths and unparseable values throw.
 */
export function detectPullRequestProvider(remoteUrl: string): PullRequestProvider {
    const url = remoteUrl.trim();
    if (/(^|[/@.])(dev\.azure\.com|visualstudio\.com)([:/]|$)/i.test(url)) {
        return 'ado';
    }
    if (/^(https?|ssh|git):\/\/[^/\s]+\/\S+/i.test(url) || /^[\w.-]+@[\w.-]+:\S+/.test(url)) {
        return 'github';
    }
    throw new CreatePullRequestError(
        'unknown-remote',
        `Cannot tell the pull request provider from the origin remote URL ${JSON.stringify(url)}. `
        + 'Expected a GitHub remote or an Azure DevOps (dev.azure.com / visualstudio.com) remote.',
    );
}

// ---------------------------------------------------------------------------
// Argument building and output parsing (pure, exported for tests)
// ---------------------------------------------------------------------------

export function buildGhCreateArgs(opts: { base: string; head: string; title: string; body: string; draft: boolean }): string[] {
    return [
        'pr', 'create',
        '--base', opts.base,
        '--head', opts.head,
        '--title', opts.title,
        '--body', opts.body,
        ...(opts.draft ? ['--draft'] : []),
    ];
}

export function buildGhListArgs(head: string): string[] {
    return ['pr', 'list', '--head', head, '--state', 'open', '--json', 'number,url', '--limit', '1'];
}

export function buildGhAutoMergeArgs(url: string, method: PullRequestMergeMethod): string[] {
    return ['pr', 'merge', url, '--auto', `--${method}`];
}

/**
 * `az` runs through `cmd.exe` on Windows, which would mangle free text, so the
 * title and description travel as `@file` arguments (az's built-in file expansion).
 */
export function buildAzCreateArgs(opts: { base: string; head: string; titleFile: string; descriptionFile: string; draft: boolean }): string[] {
    return [
        'repos', 'pr', 'create',
        '--source-branch', opts.head,
        '--target-branch', opts.base,
        '--title', `@${opts.titleFile}`,
        '--description', `@${opts.descriptionFile}`,
        '--draft', opts.draft ? 'true' : 'false',
        '--detect', 'true',
        '--output', 'json',
    ];
}

export function buildAzListArgs(head: string, base: string): string[] {
    return [
        'repos', 'pr', 'list',
        '--source-branch', head,
        '--target-branch', base,
        '--status', 'active',
        '--detect', 'true',
        '--output', 'json',
    ];
}

export function buildAzAutoMergeArgs(id: number, method: 'merge' | 'squash'): string[] {
    return [
        'repos', 'pr', 'update',
        '--id', String(id),
        '--auto-complete', 'true',
        '--squash', method === 'squash' ? 'true' : 'false',
        '--detect', 'true',
        '--output', 'json',
    ];
}

/** Parse a GitHub PR URL out of `gh pr create` output. */
export function parseGhCreateOutput(stdout: string): { url: string; id: number } | undefined {
    const url = stdout.split(/\s+/).reverse().find(token => /^https?:\/\/\S+\/pull\/\d+\/?$/.test(token));
    if (!url) return undefined;
    return { url, id: Number(url.match(/\/pull\/(\d+)\/?$/)![1]) };
}

/** Parse the first open PR out of `gh pr list --json number,url`. */
export function parseGhListOutput(stdout: string): { url: string; id: number } | undefined {
    const parsed = safeJson(stdout);
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    if (!first || typeof first.url !== 'string' || typeof first.number !== 'number') return undefined;
    return { url: first.url, id: first.number };
}

/** Parse one `az repos pr` JSON object (create output or a list entry). */
export function parseAzPullRequest(value: unknown): { url: string; id: number } | undefined {
    const pr = value as { pullRequestId?: unknown; repository?: { webUrl?: unknown } } | undefined;
    if (!pr || typeof pr.pullRequestId !== 'number' || typeof pr.repository?.webUrl !== 'string') return undefined;
    return {
        url: `${pr.repository.webUrl.replace(/\/+$/, '')}/pullrequest/${pr.pullRequestId}`,
        id: pr.pullRequestId,
    };
}

export function parseAzListOutput(stdout: string): { url: string; id: number } | undefined {
    const parsed = safeJson(stdout);
    return Array.isArray(parsed) ? parseAzPullRequest(parsed[0]) : undefined;
}

/** `pr/<short-sha>-<slug>` from the first commit's subject. */
export function branchBaseName(shortSha: string, subject: string): string {
    const slug = subject
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/, '');
    return `pr/${shortSha}${slug ? `-${slug}` : ''}`;
}

function safeJson(text: string): any {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Default runner
// ---------------------------------------------------------------------------

/**
 * git runs in forge's native path; `gh`/`az` start a child process. On Windows
 * `az` is a `.cmd` shim, so it goes through `cmd.exe`.
 */
export async function defaultPrCliRunner(command: string, args: string[], options: { cwd: string }): Promise<PrCliResult> {
    if (command === 'git') {
        const stdout = await execGitAsync(args, options.cwd, { maxBuffer: COMMAND_MAX_BUFFER, timeout: 0 });
        return { stdout, stderr: '' };
    }
    const [file, fileArgs] = command === 'az' && process.platform === 'win32'
        ? [process.env.ComSpec?.trim() || 'cmd.exe', ['/d', '/s', '/c', 'az', ...args]]
        : [command, args];
    // Bound per call, not at module load: this module sits on the executor
    // import chain, and binding eagerly breaks partial `child_process` mocks.
    const execFileAsync = promisify(childProcess.execFile);
    const { stdout, stderr } = await execFileAsync(file, fileArgs, {
        cwd: options.cwd,
        encoding: 'utf8',
        maxBuffer: COMMAND_MAX_BUFFER,
        windowsHide: true,
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '' };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const CLI_INFO: Record<PullRequestProvider, { cli: string; install: string; login: string }> = {
    github: { cli: 'gh', install: 'https://cli.github.com', login: 'gh auth login' },
    ado: { cli: 'az', install: 'https://aka.ms/azure-cli', login: 'az login' },
};

function errorText(err: unknown): string {
    const e = err as { stderr?: unknown; message?: unknown };
    const stderr = typeof e?.stderr === 'string' ? e.stderr.trim() : '';
    return stderr || (typeof e?.message === 'string' ? e.message : String(err));
}

function isMissingExecutable(err: unknown): boolean {
    const e = err as { code?: unknown; stderr?: unknown };
    if (e?.code === 'ENOENT') return true;
    // cmd.exe reports a missing `az` as exit code 1 with this text.
    return typeof e?.stderr === 'string' && /is not recognized as an internal or external command/i.test(e.stderr);
}

class PullRequestRun {
    private readonly run: PrCliRunner;

    constructor(private readonly input: CreatePullRequestInput, private readonly deps: CreatePullRequestDeps) {
        this.run = deps.runCommand ?? defaultPrCliRunner;
    }

    private async git(cwd: string, ...args: string[]): Promise<string> {
        try {
            return (await this.run('git', args, { cwd })).stdout.trim();
        } catch (err) {
            throw new CreatePullRequestError('command-failed', `git ${args.join(' ')} failed: ${errorText(err)}`);
        }
    }

    /** True when the git command exits zero. */
    private async gitOk(cwd: string, ...args: string[]): Promise<boolean> {
        try {
            await this.run('git', args, { cwd });
            return true;
        } catch {
            return false;
        }
    }

    private async cli(provider: PullRequestProvider, cwd: string, args: string[]): Promise<string> {
        const { cli } = CLI_INFO[provider];
        try {
            return (await this.run(cli, args, { cwd })).stdout;
        } catch (err) {
            if (isMissingExecutable(err)) throw this.missingCli(provider);
            throw new CreatePullRequestError('command-failed', `${cli} ${args.slice(0, 3).join(' ')} failed: ${errorText(err)}`);
        }
    }

    private missingCli(provider: PullRequestProvider): CreatePullRequestError {
        const { cli, install, login } = CLI_INFO[provider];
        return new CreatePullRequestError('cli-missing', `The \`${cli}\` CLI was not found. Install it (${install}) and run \`${login}\`.`);
    }

    private async ensureCliReady(provider: PullRequestProvider, cwd: string): Promise<void> {
        const { cli, login } = CLI_INFO[provider];
        const probes: Array<{ args: string[]; failure: string }> = provider === 'github'
            ? [{ args: ['auth', 'status'], failure: `The \`${cli}\` CLI is not logged in. Run \`${login}\`.` }]
            : [
                { args: ['account', 'show', '--output', 'none'], failure: `The \`${cli}\` CLI is not logged in. Run \`${login}\`.` },
                {
                    args: ['extension', 'show', '--name', 'azure-devops', '--output', 'none'],
                    failure: 'The `az` azure-devops extension is not installed. Run `az extension add --name azure-devops`.',
                },
            ];
        for (const probe of probes) {
            try {
                await this.run(cli, probe.args, { cwd });
            } catch (err) {
                if (isMissingExecutable(err)) throw this.missingCli(provider);
                throw new CreatePullRequestError('not-logged-in', probe.failure);
            }
        }
    }

    private async resolveBase(repoRoot: string): Promise<string> {
        const explicit = this.input.base?.trim();
        if (explicit) return explicit;
        try {
            const head = (await this.run('git', ['symbolic-ref', '--quiet', '--short', `refs/remotes/${REMOTE}/HEAD`], { cwd: repoRoot })).stdout.trim();
            if (head.startsWith(`${REMOTE}/`)) return head.slice(REMOTE.length + 1);
        } catch {
            // Fall through to asking the remote.
        }
        try {
            const out = (await this.run('git', ['ls-remote', '--symref', REMOTE, 'HEAD'], { cwd: repoRoot })).stdout;
            const match = out.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
            if (match) return match[1];
        } catch {
            // Fall back to the common default.
        }
        return 'main';
    }

    async execute(): Promise<CreatePullRequestResult> {
        const { repoRoot } = this.input;
        const title = this.input.title?.trim();
        if (!title) throw new CreatePullRequestError('invalid-input', 'A pull request title is required.');
        const mergeMethod = this.input.mergeMethod ?? 'merge';
        if (!['merge', 'squash', 'rebase'].includes(mergeMethod)) {
            throw new CreatePullRequestError('invalid-input', `Invalid mergeMethod ${JSON.stringify(mergeMethod)}; use merge, squash, or rebase.`);
        }

        let remoteUrl: string;
        try {
            remoteUrl = (await this.run('git', ['config', '--get', `remote.${REMOTE}.url`], { cwd: repoRoot })).stdout.trim();
        } catch {
            throw new CreatePullRequestError('unknown-remote', `The repository at ${repoRoot} has no \`${REMOTE}\` remote.`);
        }
        const provider = detectPullRequestProvider(remoteUrl);
        await this.ensureCliReady(provider, repoRoot);
        const base = await this.resolveBase(repoRoot);

        const tempParent = await fs.mkdtemp(path.join(this.deps.tempDir ?? os.tmpdir(), 'coc-pr-'));
        try {
            return hasCommits(this.input.commits)
                ? await this.commitsMode(provider, base, title, mergeMethod, tempParent)
                : await this.currentBranchMode(provider, base, title, mergeMethod, tempParent);
        } finally {
            await fs.rm(tempParent, { recursive: true, force: true }).catch(() => {});
        }
    }

    private async resolveCommits(repoRoot: string): Promise<string[]> {
        const spec = this.input.commits!;
        const tokens = (Array.isArray(spec) ? spec : spec.split(','))
            .map(token => String(token).trim())
            .filter(Boolean);
        let commits: string[];
        if (tokens.length === 1 && tokens[0].includes('..')) {
            commits = (await this.git(repoRoot, 'rev-list', '--reverse', tokens[0])).split(/\s+/).filter(Boolean);
        } else {
            const shas: string[] = [];
            for (const token of tokens) {
                shas.push(await this.git(repoRoot, 'rev-parse', '--verify', `${token}^{commit}`));
            }
            if (shas.length === 1) {
                commits = shas;
            } else {
                // Topological, oldest-first order regardless of the order given.
                const wanted = new Set(shas);
                commits = (await this.git(repoRoot, 'rev-list', '--reverse', '--topo-order', ...shas))
                    .split(/\s+/)
                    .filter(sha => wanted.has(sha));
            }
        }
        if (commits.length === 0) {
            throw new CreatePullRequestError('no-commits', `The commit selection ${JSON.stringify(spec)} resolved to no commits.`);
        }
        return commits;
    }

    private async branchExists(repoRoot: string, name: string): Promise<boolean> {
        return await this.gitOk(repoRoot, 'rev-parse', '--verify', '--quiet', `refs/heads/${name}`)
            || await this.gitOk(repoRoot, 'rev-parse', '--verify', '--quiet', `refs/remotes/${REMOTE}/${name}`);
    }

    private async commitsMode(
        provider: PullRequestProvider,
        base: string,
        title: string,
        mergeMethod: PullRequestMergeMethod,
        tempParent: string,
    ): Promise<CreatePullRequestResult> {
        const { repoRoot } = this.input;
        const commits = await this.resolveCommits(repoRoot);
        await this.git(repoRoot, 'fetch', REMOTE, base);

        const baseName = this.input.branch?.trim() || branchBaseName(
            await this.git(repoRoot, 'rev-parse', '--short', commits[0]),
            await this.git(repoRoot, 'log', '-1', '--pretty=%s', commits[0]),
        );
        let branch = baseName;
        for (let i = 2; await this.branchExists(repoRoot, branch); i++) {
            branch = `${baseName}-${i}`;
        }

        const worktree = path.join(tempParent, 'worktree');
        await this.git(repoRoot, 'worktree', 'add', '-b', branch, worktree, `${REMOTE}/${base}`);
        let keepBranch = false;
        try {
            for (const sha of commits) {
                if (await this.gitOk(worktree, 'cherry-pick', sha)) continue;
                // An empty pick (change already on base) leaves CHERRY_PICK_HEAD and a clean tree.
                const pending = await this.gitOk(worktree, 'rev-parse', '--verify', '--quiet', 'CHERRY_PICK_HEAD');
                const status = pending ? await this.git(worktree, 'status', '--porcelain') : 'unknown';
                if (pending && !status) {
                    await this.git(worktree, 'cherry-pick', '--skip');
                    continue;
                }
                await this.gitOk(worktree, 'cherry-pick', '--abort');
                throw new CreatePullRequestError(
                    'conflict',
                    `Cherry-picking ${sha} onto ${REMOTE}/${base} conflicted. The run was aborted and cleaned up; `
                    + 'fix or rebase the source commits yourself, then try again.',
                    sha,
                );
            }

            await this.git(worktree, 'fetch', REMOTE, base);
            if (!await this.gitOk(worktree, 'rebase', `${REMOTE}/${base}`)) {
                await this.gitOk(worktree, 'rebase', '--abort');
                throw new CreatePullRequestError(
                    'conflict',
                    `Rebasing onto ${REMOTE}/${base} conflicted. The run was aborted and cleaned up; `
                    + 'fix or rebase the source commits yourself, then try again.',
                );
            }

            await this.git(worktree, 'push', '-u', REMOTE, branch);
            keepBranch = true;
            return await this.openPullRequest(provider, worktree, branch, base, title, mergeMethod, tempParent);
        } finally {
            await this.gitOk(repoRoot, 'worktree', 'remove', '--force', worktree);
            if (!keepBranch) {
                await this.gitOk(repoRoot, 'branch', '-D', branch);
            }
        }
    }

    private async currentBranchMode(
        provider: PullRequestProvider,
        base: string,
        title: string,
        mergeMethod: PullRequestMergeMethod,
        tempParent: string,
    ): Promise<CreatePullRequestResult> {
        const { repoRoot } = this.input;
        const branch = await this.git(repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD');
        if (!branch || branch === 'HEAD') {
            throw new CreatePullRequestError('detached-head', 'HEAD is detached; check out a branch or pass `commits`.');
        }
        if (branch === base) {
            throw new CreatePullRequestError(
                'on-base-branch',
                `The current branch is the base branch ${JSON.stringify(base)}. Pass \`commits\` to open a PR from specific commits instead.`,
            );
        }

        const localSha = await this.git(repoRoot, 'rev-parse', 'HEAD');
        const remoteLine = await this.git(repoRoot, 'ls-remote', '--heads', REMOTE, `refs/heads/${branch}`);
        const remoteSha = remoteLine.split(/\s+/)[0] ?? '';
        if (remoteSha !== localSha) {
            await this.git(repoRoot, 'push', '-u', REMOTE, branch);
        }
        return this.openPullRequest(provider, repoRoot, branch, base, title, mergeMethod, tempParent);
    }

    private async openPullRequest(
        provider: PullRequestProvider,
        cwd: string,
        branch: string,
        base: string,
        title: string,
        mergeMethod: PullRequestMergeMethod,
        tempParent: string,
    ): Promise<CreatePullRequestResult> {
        const body = this.input.body ?? '';
        const draft = this.input.draft === true;

        let pr = provider === 'github'
            ? parseGhListOutput(await this.cli(provider, cwd, buildGhListArgs(branch)))
            : parseAzListOutput(await this.cli(provider, cwd, buildAzListArgs(branch, base)));
        const existing = !!pr;

        if (!pr) {
            if (provider === 'github') {
                const out = await this.cli(provider, cwd, buildGhCreateArgs({ base, head: branch, title, body, draft }));
                pr = parseGhCreateOutput(out);
            } else {
                const titleFile = path.join(tempParent, 'title.txt');
                const descriptionFile = path.join(tempParent, 'description.txt');
                await fs.writeFile(titleFile, title, 'utf8');
                await fs.writeFile(descriptionFile, body, 'utf8');
                const out = await this.cli(provider, cwd, buildAzCreateArgs({ base, head: branch, titleFile, descriptionFile, draft }));
                pr = parseAzPullRequest(safeJson(out));
            }
            if (!pr) {
                throw new CreatePullRequestError('command-failed', `${CLI_INFO[provider].cli} did not return the created pull request.`);
            }
        }

        const autoMerge = await this.enableAutoMerge(provider, cwd, pr, mergeMethod);
        return { url: pr.url, id: pr.id, provider, branch, base, existing, autoMerge };
    }

    private async enableAutoMerge(
        provider: PullRequestProvider,
        cwd: string,
        pr: { url: string; id: number },
        mergeMethod: PullRequestMergeMethod,
    ): Promise<CreatePullRequestResult['autoMerge']> {
        if (this.input.autoMerge !== true) return { requested: false, enabled: false };
        if (provider === 'ado' && mergeMethod === 'rebase') {
            return { requested: true, enabled: false, warning: 'Azure DevOps auto-complete from the CLI supports only merge or squash; auto-merge was not enabled.' };
        }
        try {
            await this.cli(provider, cwd, provider === 'github'
                ? buildGhAutoMergeArgs(pr.url, mergeMethod)
                : buildAzAutoMergeArgs(pr.id, mergeMethod as 'merge' | 'squash'));
            return { requested: true, enabled: true };
        } catch (err) {
            return { requested: true, enabled: false, warning: `Pull request created, but auto-merge could not be enabled: ${(err as Error).message}` };
        }
    }
}

function hasCommits(commits: CreatePullRequestInput['commits']): boolean {
    if (Array.isArray(commits)) return commits.some(c => String(c).trim());
    return typeof commits === 'string' && commits.trim().length > 0;
}

/** Create (or find the existing) pull request. See the module comment. */
export function createPullRequest(input: CreatePullRequestInput, deps: CreatePullRequestDeps = {}): Promise<CreatePullRequestResult> {
    return new PullRequestRun(input, deps).execute();
}
