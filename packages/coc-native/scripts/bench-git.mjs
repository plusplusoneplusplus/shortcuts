/**
 * Measure the native git capability against the TypeScript path it replaced.
 *
 * The move's stated driver is process-spawn overhead: every git call used to
 * fork a child from Node, often several per request and sometimes with the
 * event loop stopped. This script is the evidence for that claim. Each case
 * has two implementations of one operation the server really performs:
 *
 *   - `legacy` replays the child processes the deleted TypeScript ran — the
 *     same argv, in the same order, through the same Node API (`exec` behind a
 *     shell where the service used `execAsync`, `execFileSync` where it
 *     blocked), and parses the output the way the service parsed it. It is a
 *     reimplementation because the originals were deleted; the commit each one
 *     was lifted from is named above it, so a reader can diff them.
 *   - `native` calls the shipped addon export.
 *
 * Comparing the addon rather than the forge service is deliberate: forge
 * depends on this package, so importing it here would be a cycle, and what the
 * service adds over the addon is an `await` and a couple of `path.join`s.
 *
 * Run it against a small repository and a large one, because the two ends
 * disagree: a fixed per-call cost that dominates a 40-file fixture disappears
 * against 569 refs, and a per-ref cost that is invisible on the fixture is the
 * whole bill on this repository.
 *
 * No hashbang, for the reason `build-native.mjs` gives: `bench-git.test.ts`
 * imports these helpers, and Vitest inlines a project-local `.mjs` without an
 * esbuild pass, so a `#!` on a CRLF checkout lands inside the module wrapper.
 */

import { exec, execFile, execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Timeout the deleted services passed on every call. */
const GIT_TIMEOUT_MS = 30_000;

/** Output cap `GitLogService.getCommits` passed, and the runner's default. */
const GIT_MAX_BUFFER = 50 * 1024 * 1024;

/**
 * The shell the deleted services ran a command string through.
 *
 * `execGit`/`execGitSync` picked it exactly this way, and the pick is part of
 * what is being measured — the extra fork is the cost the move removed.
 */
const LEGACY_SHELL = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';

// ─────────────────────────────────────────────────────────────────────────────
// Legacy: the child processes the TypeScript spawned
// ─────────────────────────────────────────────────────────────────────────────

/** One git child through a shell — what `execAsync` did. */
async function legacyShell(command, repoRoot, timeout = GIT_TIMEOUT_MS) {
    const { stdout } = await execAsync(command, {
        cwd: repoRoot,
        timeout,
        maxBuffer: GIT_MAX_BUFFER,
        shell: LEGACY_SHELL,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
}

/** One git child with an argv array — what `execFileAsync` did. */
async function legacyArgv(args, repoRoot, timeout = GIT_TIMEOUT_MS) {
    const { stdout } = await execFileAsync('git', args, {
        cwd: repoRoot,
        timeout,
        maxBuffer: GIT_MAX_BUFFER,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout;
}

/** One git child with the event loop stopped — what `execGit`/`execGitSync` did. */
function legacyBlocking(args, repoRoot) {
    return execFileSync('git', args, {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 10_000,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
}

/** One shell command with the event loop stopped — what `execGitSync` did. */
function legacyBlockingShell(command, repoRoot) {
    return execSync(command, {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 30_000,
        shell: LEGACY_SHELL,
        stdio: ['pipe', 'pipe', 'pipe'],
    });
}

/**
 * `parsePorcelain`, verbatim from `working-tree-service.ts` at f51fb358d^.
 *
 * The absolute-path rebuild is kept because it is most of the per-line work.
 */
export function legacyParsePorcelain(output, repoRoot) {
    const repoName = path.basename(repoRoot);
    const changes = [];
    const charToStatus = c =>
        ({ M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict', '?': 'untracked', '!': 'ignored' })[c] ?? null;

    for (const rawLine of output.split('\n')) {
        const line = rawLine.replace(/\r$/, '');
        if (line.length < 4) continue;
        const X = line[0];
        const Y = line[1];
        const rest = line.slice(3);
        const arrowIdx = rest.indexOf(' -> ');
        const filePath = arrowIdx >= 0 ? rest.slice(arrowIdx + 4) : rest;
        const originalPath = arrowIdx >= 0 ? rest.slice(0, arrowIdx) : undefined;
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
        const absOriginalPath = originalPath
            ? path.isAbsolute(originalPath) ? originalPath : path.join(repoRoot, originalPath)
            : undefined;

        if (X === '?' && Y === '?') {
            changes.push({ filePath: absPath, status: 'untracked', stage: 'untracked', repositoryRoot: repoRoot, repositoryName: repoName });
            continue;
        }
        if (X === '!' && Y === '!') continue;

        if (X !== ' ' && X !== '?') {
            const status = charToStatus(X);
            if (status) {
                changes.push({ filePath: absPath, status, stage: 'staged', repositoryRoot: repoRoot, repositoryName: repoName, ...(absOriginalPath ? { originalPath: absOriginalPath } : {}) });
            }
        }
        if (Y !== ' ' && Y !== '?') {
            const status = charToStatus(Y);
            if (status) {
                changes.push({ filePath: absPath, status, stage: 'unstaged', repositoryRoot: repoRoot, repositoryName: repoName, ...(absOriginalPath ? { originalPath: absOriginalPath } : {}) });
            }
        }
    }
    return changes;
}

/** `parseCommitLine`'s field split, from `git-log-service.ts` at 46da994a3^. */
export function legacyParseCommitLine(line, repoRoot, repoName) {
    const [hash, shortHash, subject, authorName, authorEmail, date, relativeDate, parentHashes, refs] = line.split('|');
    return {
        hash,
        shortHash,
        subject,
        authorName,
        authorEmail,
        date,
        relativeDate,
        parentHashes: parentHashes ? parentHashes.split(' ').filter(Boolean) : [],
        refs: refs ? refs.split(', ').filter(Boolean) : [],
        repositoryRoot: repoRoot,
        repositoryName: repoName,
    };
}

/** The `--numstat` + `--name-status` merge from `git-range-service.ts` at e206cae5f^. */
export function legacyParseRangeFiles(numstatOutput, nameStatusOutput) {
    const statusMap = new Map();
    for (const line of nameStatusOutput.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        const code = parts[0]?.[0];
        const status = ({ A: 'added', D: 'deleted', R: 'renamed', C: 'copied' })[code] ?? 'modified';
        if ((code === 'R' || code === 'C') && parts.length >= 3) {
            statusMap.set(parts[2], { status, oldPath: parts[1] });
        } else if (parts.length >= 2) {
            statusMap.set(parts[1], { status });
        }
    }

    const files = [];
    for (const line of numstatOutput.split('\n')) {
        if (!line.trim()) continue;
        const [add, del, rawPath] = line.split('\t');
        if (!rawPath) continue;
        const match = rawPath.match(/(?:{[^}]*? => ([^}]+)}|.* => (.+))/);
        const filePath = match ? (match[1] ?? match[2]) : rawPath;
        const entry = statusMap.get(filePath) ?? { status: 'modified' };
        files.push({
            path: filePath,
            status: entry.status,
            additions: add === '-' ? 0 : parseInt(add, 10) || 0,
            deletions: del === '-' ? 0 : parseInt(del, 10) || 0,
            ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
        });
    }
    return files;
}

/**
 * `parseFileLine` + `getNumstatMap`, from `git-log-service.ts` at 46da994a3^.
 *
 * Deliberately not the range parser above: this one is driven by `--name-status`
 * and merges `--numstat` into it, where the range service does the opposite and
 * carries a different (broken) rename regex. Two parsers, on purpose.
 */
export function legacyParseCommitFiles(nameStatusOutput, numstatOutput) {
    const parseStatusCode = code => ({ M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict' })[code.charAt(0).toUpperCase()] ?? 'modified';

    const files = [];
    for (const line of nameStatusOutput.trim().split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        if (parts.length < 2) continue;
        const statusCode = parts[0];
        const status = parseStatusCode(statusCode);
        if ((statusCode.startsWith('R') || statusCode.startsWith('C')) && parts.length >= 3) {
            files.push({ path: parts[2], originalPath: parts[1], status });
        } else {
            files.push({ path: parts[1], status });
        }
    }

    const stats = new Map();
    for (const line of numstatOutput.trim().split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        if (parts.length < 3) continue;
        const [addStr, delStr] = parts;
        if (addStr === '-' || delStr === '-') continue;
        const additions = parseInt(addStr, 10);
        const deletions = parseInt(delStr, 10);
        if (Number.isNaN(additions) || Number.isNaN(deletions)) continue;
        let filePath = parts.slice(2).join('\t');
        const renameMatch = filePath.match(/^(.*)\{.* => (.*)\}(.*)$/) || filePath.match(/^.* => (.*)$/);
        if (renameMatch) filePath = renameMatch.length === 4 ? renameMatch[1] + renameMatch[2] + renameMatch[3] : renameMatch[1];
        stats.set(filePath, { additions, deletions });
    }

    for (const file of files) {
        const found = stats.get(file.path);
        if (found) {
            file.additions = found.additions;
            file.deletions = found.deletions;
        }
    }
    return files;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cases
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every measured operation.
 *
 * `children` is how many git child processes the legacy path forked, which is
 * the number that predicts the result: removing several is worth multiples,
 * removing only the shell around one is worth a few percent, and removing none
 * — moving the fork from Node to Rust — is worth the event loop, not the clock.
 *
 * `gated` cases are the ones AC-09's "no operation slower" bar applies to.
 * An ungated case is measured and printed but excluded from the verdict, with
 * `note` saying why.
 */
export const CASES = [
    {
        id: 'working-tree-status',
        title: 'working-tree status',
        children: 1,
        gated: true,
        // getAllChanges at f51fb358d^, `-C` and the 15 s timeout included.
        legacy: async repo => legacyParsePorcelain(await legacyArgv(['-C', repo.root, 'status', '--porcelain', '--untracked-files=all'], repo.root, 15_000), repo.root),
        native: (repo, git) => git.gitStatusEntries(repo.root),
    },
    {
        id: 'repository-status',
        title: 'repository status (branch + dirty + drift)',
        children: 1,
        gated: true,
        // getRepositoryStatus at 194aec6ae^.
        legacy: repo => legacyArgv(['status', '--porcelain=v2', '--branch', '--untracked-files=all'], repo.root, 15_000),
        native: (repo, git) => git.gitRepositoryStatus(repo.root),
    },
    {
        id: 'branch-status',
        title: 'branch status (HEAD + upstream + drift)',
        children: 5,
        gated: true,
        legacy: async repo => {
            // getBranchStatus at 194aec6ae^: head, detached, name, upstream, drift.
            const head = (await legacyShell('git rev-parse HEAD', repo.root)).trim();
            let detached = false;
            try {
                await legacyShell('git symbolic-ref -q HEAD', repo.root);
            } catch {
                detached = true;
            }
            if (detached) return { name: '', isDetached: true, detachedHash: head, ahead: 0, behind: 0 };
            const name = (await legacyShell('git rev-parse --abbrev-ref HEAD', repo.root)).trim();
            let trackingBranch;
            try {
                trackingBranch = (await legacyShell(`git rev-parse --abbrev-ref "${name}@{upstream}"`, repo.root)).trim();
            } catch {
                return { name, isDetached: false, ahead: 0, behind: 0 };
            }
            const counts = (await legacyShell(`git rev-list --left-right --count "${trackingBranch}...${name}"`, repo.root)).trim();
            const [behind = '', ahead = ''] = counts.split(/\s+/);
            return { name, isDetached: false, trackingBranch, ahead: parseInt(ahead, 10) || 0, behind: parseInt(behind, 10) || 0 };
        },
        native: (repo, git) => git.gitBranchStatus(repo.root),
    },
    {
        id: 'branch-list-100',
        title: 'branch list, one 100-branch page',
        children: 2,
        gated: true,
        blocking: true,
        legacy: repo => legacyBranchPage(repo, 100),
        native: (repo, git) => git.gitListBranches(repo.root, { remote: false, limit: 100, offset: 0 }),
    },
    {
        id: 'commit-log-1',
        title: 'commit log, 1 commit',
        children: 3,
        gated: true,
        legacy: repo => legacyGetCommits(repo, 1),
        native: (repo, git) => git.gitLogCommits(repo.root, { maxCount: 1, skip: 0 }),
    },
    {
        id: 'commit-log-50',
        title: 'commit log, 50-commit page',
        children: 3,
        gated: true,
        legacy: repo => legacyGetCommits(repo, 50),
        native: (repo, git) => git.gitLogCommits(repo.root, { maxCount: 50, skip: 0 }),
    },
    {
        id: 'commit-log-200',
        title: 'commit log, 200-commit page (the route\'s clamp)',
        children: 3,
        gated: true,
        legacy: repo => legacyGetCommits(repo, 200),
        native: (repo, git) => git.gitLogCommits(repo.root, { maxCount: 200, skip: 0 }),
    },
    {
        id: 'commit-log-500',
        title: 'commit log, 500-commit page',
        children: 3,
        gated: false,
        note: 'past the 200 the commits route clamps to; gix\'s per-commit %h overtakes the spawns it saves',
        legacy: repo => legacyGetCommits(repo, 500),
        native: (repo, git) => git.gitLogCommits(repo.root, { maxCount: 500, skip: 0 }),
    },
    {
        id: 'commit-files',
        title: 'commit detail, file list',
        children: 3,
        gated: true,
        legacy: async repo => {
            // getCommitFiles at 46da994a3^: parent, name-status, numstat.
            let parent = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
            try {
                parent = (await legacyShell(`git rev-parse ${repo.head}~1`, repo.root)).trim();
            } catch { /* root commit */ }
            const nameStatus = await legacyShell(`git diff-tree --no-commit-id --name-status -r -M -C ${repo.head}`, repo.root);
            const numstat = await legacyShell(`git diff-tree --no-commit-id --numstat -r -M -C ${repo.head}`, repo.root);
            return { parentHash: parent, files: legacyParseCommitFiles(nameStatus, numstat) };
        },
        native: (repo, git) => git.gitCommitFiles(repo.root, repo.head),
    },
    {
        id: 'range-refs',
        title: 'commit range, ref work only',
        children: 4,
        gated: true,
        blocking: true,
        legacy: async repo => {
            // detectCommitRange's ref half at e206cae5f^: one async branch read
            // and three blocking ref lookups.
            const branch = (await legacyArgv(['rev-parse', '--abbrev-ref', 'HEAD'], repo.root)).trim();
            let baseRef = null;
            for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
                try {
                    legacyBlocking(['rev-parse', '--verify', candidate], repo.root);
                    baseRef = candidate;
                    break;
                } catch { /* not this one */ }
            }
            if (!baseRef) return null;
            const mergeBase = legacyBlocking(['merge-base', 'HEAD', baseRef], repo.root).trim();
            const count = parseInt(legacyBlocking(['rev-list', '--count', `${baseRef}..HEAD`], repo.root).trim(), 10) || 0;
            return { branch, baseRef, mergeBase, commitCount: count };
        },
        native: async (repo, git) => {
            const resolved = await git.gitRangeResolveBaseRef(repo.root, 'default');
            if (!resolved.baseRef) return null;
            const [mergeBase, count] = await Promise.all([
                git.gitRangeMergeBase(repo.root, 'HEAD', resolved.baseRef),
                git.gitRangeCountAhead(repo.root, resolved.baseRef, 'HEAD'),
            ]);
            return { baseRef: resolved.baseRef, mergeBase, commitCount: count };
        },
    },
    {
        id: 'range-full',
        title: 'commit range, whole detectCommitRange',
        children: 7,
        gated: true,
        blocking: true,
        legacy: async repo => {
            const branch = (await legacyArgv(['rev-parse', '--abbrev-ref', 'HEAD'], repo.root)).trim();
            let baseRef = null;
            for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
                try {
                    legacyBlocking(['rev-parse', '--verify', candidate], repo.root);
                    baseRef = candidate;
                    break;
                } catch { /* not this one */ }
            }
            if (!baseRef) return null;
            const mergeBase = legacyBlocking(['merge-base', 'HEAD', baseRef], repo.root).trim();
            const count = parseInt(legacyBlocking(['rev-list', '--count', `${baseRef}..HEAD`], repo.root).trim(), 10) || 0;
            const numstat = legacyBlocking(['diff', '--numstat', `${baseRef}...HEAD`], repo.root);
            const nameStatus = legacyBlocking(['diff', '--name-status', '-M', '-C', `${baseRef}...HEAD`], repo.root);
            const shortstat = legacyBlocking(['diff', '--shortstat', `${baseRef}...HEAD`], repo.root);
            const stats = shortstat.match(/(\d+) insertions?\(\+\)|(\d+) deletions?\(-\)/g) ?? [];
            return { branch, baseRef, mergeBase, commitCount: count, files: legacyParseRangeFiles(numstat, nameStatus), stats: stats.length };
        },
        native: async (repo, git) => {
            const resolved = await git.gitRangeResolveBaseRef(repo.root, 'default');
            if (!resolved.baseRef) return null;
            const [mergeBase, count, files, stats] = await Promise.all([
                git.gitRangeMergeBase(repo.root, 'HEAD', resolved.baseRef),
                git.gitRangeCountAhead(repo.root, resolved.baseRef, 'HEAD'),
                git.gitRangeChangedFiles(repo.root, resolved.baseRef, 'HEAD'),
                git.gitRangeDiffStats(repo.root, resolved.baseRef, 'HEAD'),
            ]);
            return { baseRef: resolved.baseRef, mergeBase, commitCount: count, files, stats };
        },
    },
    {
        id: 'remote-url',
        title: 'primary remote URL',
        children: 2,
        gated: true,
        legacy: async repo => {
            // detectRemoteUrl at fe5e5924d^: try origin, then fall back to the
            // first configured remote.
            try {
                return (await legacyArgv(['remote', 'get-url', 'origin'], repo.root)).trim();
            } catch { /* no origin */ }
            const remotes = (await legacyArgv(['remote'], repo.root)).trim().split('\n').filter(Boolean);
            if (!remotes.length) return null;
            return (await legacyArgv(['remote', 'get-url', remotes[0]], repo.root)).trim();
        },
        native: (repo, git) => git.gitDetectRemoteUrl(repo.root),
    },
    {
        id: 'repo-root',
        title: 'repository discovery',
        children: 1,
        gated: true,
        blocking: true,
        legacy: repo => legacyBlocking(['rev-parse', '--show-toplevel'], repo.root).trim(),
        native: (repo, git) => git.gitDiscoverRepoRoot(repo.root),
    },
];

/**
 * `getLocalBranchesPaginated` at 194aec6ae^ — a blocking count, then a blocking
 * shell command.
 *
 * `useWindowsPipeline` is a parameter rather than a read of `process.platform`
 * so the branch a Linux box never takes still has coverage. It is a real
 * difference in the work, not a portability detail: cmd.exe has no `head`, so
 * that path asked git for every branch and paged in JavaScript.
 */
export function legacyBranchPage(repo, limit, useWindowsPipeline = process.platform === 'win32') {
    const total = legacyBlocking(['branch', '--list'], repo.root).split('\n').filter(l => l.trim()).length;
    if (total === 0) return { branches: [], totalCount: 0, hasMore: false };

    const format = '%(if)%(HEAD)%(then)*%(else) %(end)|%(refname:short)|%(subject)|%(committerdate:relative)';
    const command = `git branch --format="${format}"` + (useWindowsPipeline ? '' : ` | head -n ${limit}`);
    const output = legacyBlockingShell(command, repo.root);

    let lines = output.trim() ? output.trim().split('\n') : [];
    if (useWindowsPipeline) lines = lines.slice(0, limit);

    const branches = lines.map(line => {
        const parts = line.split('|');
        return { name: parts[1] || '', isCurrent: parts[0] === '*', isRemote: false, lastCommitSubject: parts[2] || '', lastCommitDate: parts[3] || '' };
    });
    return { branches, totalCount: total, hasMore: limit < total };
}

/** `GitLogService.getCommits` at 46da994a3^ — the page, then the unpushed set. */
async function legacyGetCommits(repo, maxCount) {
    const format = '%H|%h|%s|%an|%ae|%aI|%ar|%P|%D';
    const output = await legacyShell(`git log --pretty=format:"${format}" -n ${maxCount + 1} --skip 0`, repo.root);
    if (!output.trim()) return { commits: [], hasMore: false };
    const lines = output.trim().split('\n');
    const hasMore = lines.length > maxCount;
    const commitLines = hasMore ? lines.slice(0, maxCount) : lines;

    let ahead = new Set();
    try {
        const upstream = (await legacyShell('git rev-parse --abbrev-ref @{upstream}', repo.root)).trim();
        const unpushed = await legacyShell(`git log ${upstream}..HEAD --pretty=format:"%H"`, repo.root);
        ahead = new Set(unpushed.trim().split('\n').filter(Boolean));
    } catch { /* no upstream */ }

    const repoName = path.basename(repo.root);
    const commits = commitLines.map(line => {
        const commit = legacyParseCommitLine(line, repo.root, repoName);
        commit.isAheadOfRemote = ahead.has(commit.hash);
        return commit;
    });
    return { commits, hasMore };
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistics and the verdict
// ─────────────────────────────────────────────────────────────────────────────

/** Median, mean and range of a sample set, in milliseconds. */
export function summarize(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return {
        median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
        mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        samples: sorted.length,
    };
}

/**
 * Rule the bar in AC-09 on: no gated operation slower than the TypeScript path.
 *
 * `tolerance` is the fraction of the legacy median native may exceed before a
 * case counts as a regression. It is not slack in the bar — it is the width of
 * the measurement. Back-to-back runs of the *same* implementation differ by a
 * few percent on a loaded box, so a zero tolerance reports noise as a finding.
 */
export function verdict(results, tolerance = 0.05) {
    const gated = results.filter(result => result.case.gated);
    const regressions = gated.filter(result => result.native.median > result.legacy.median * (1 + tolerance));
    const improved = gated.filter(result => result.legacy.median / result.native.median >= 1.1);
    return {
        ok: regressions.length === 0,
        regressions,
        improved,
        gatedCount: gated.length,
    };
}

/** `legacy / native`, so above 1 means native is faster. */
export function speedup(legacyMs, nativeMs) {
    return nativeMs === 0 ? Infinity : legacyMs / nativeMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the small repository: enough history and refs to exercise every case,
 * small enough that per-call overhead is the only thing being measured.
 *
 * `origin/main` is a plain `update-ref` rather than a real clone — the base-ref
 * lookup reads a ref, and where the ref came from is not something either
 * implementation can tell.
 */
export function createSmallRepo(dir, { files = 40, commits = 30 } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const git = args => execFileSync('git', args, {
        cwd: dir,
        encoding: 'utf-8',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'Bench', GIT_AUTHOR_EMAIL: 'bench@example.invalid',
            GIT_COMMITTER_NAME: 'Bench', GIT_COMMITTER_EMAIL: 'bench@example.invalid',
            // Absent files, not /dev/null: git reads a missing config as empty
            // on every platform, and Windows has no /dev/null to point at.
            GIT_CONFIG_GLOBAL: path.join(dir, '.gitconfig-absent'),
            GIT_CONFIG_SYSTEM: path.join(dir, '.gitconfig-absent-system'),
        },
    });

    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.name', 'Bench']);
    git(['config', 'user.email', 'bench@example.invalid']);
    git(['config', 'core.autocrlf', 'false']);
    git(['remote', 'add', 'origin', 'https://example.invalid/bench.git']);

    // Renamed in the last commit, so the commit-detail and range cases both
    // have a row whose status is not `modified`. Without one, two file lists
    // agree on their paths whatever either side decides the statuses are.
    fs.writeFileSync(path.join(dir, 'stable.txt'), 'renamed later\n'.repeat(20));

    for (let c = 0; c < commits; c += 1) {
        for (let f = 0; f < Math.ceil(files / commits) + 1; f += 1) {
            const name = `file-${(c * 3 + f) % files}.txt`;
            fs.writeFileSync(path.join(dir, name), `commit ${c} line ${f}\n`.repeat(20));
        }
        if (c === commits - 1) git(['mv', 'stable.txt', 'renamed.txt']);
        git(['add', '-A']);
        git(['commit', '-q', '-m', `commit ${c}\n\nA body for commit ${c}.`]);
    }

    // A base to measure a range against, and an upstream to measure drift.
    const base = git(['rev-parse', `HEAD~${Math.min(10, commits - 1)}`]).trim();
    git(['update-ref', 'refs/remotes/origin/main', base]);
    git(['config', 'branch.main.remote', 'origin']);
    git(['config', 'branch.main.merge', 'refs/heads/main']);

    // Some branches for the list page to have rows.
    for (let b = 0; b < 12; b += 1) git(['branch', `feature/bench-${b}`]);

    // A dirty tree, so the status parse has lines to walk.
    fs.writeFileSync(path.join(dir, 'file-0.txt'), 'modified\n');
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'new\n');
    fs.writeFileSync(path.join(dir, 'staged.txt'), 'staged\n');
    git(['add', 'staged.txt']);

    return { root: dir, head: git(['rev-parse', 'HEAD']).trim() };
}

/** Describe a repository the way the report's header line does. */
export function describeRepo(root) {
    const git = args => {
        try {
            return execFileSync('git', args, { cwd: root, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        } catch {
            return '';
        }
    };
    const refs = git(['for-each-ref', '--format=%(refname)']).split('\n').filter(Boolean).length;
    const commits = git(['rev-list', '--count', 'HEAD']);
    return { refs, commits: parseInt(commits, 10) || 0, head: git(['rev-parse', 'HEAD']) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Running
// ─────────────────────────────────────────────────────────────────────────────

/** Time one implementation, discarding `warmup` runs first. */
async function time(run, repo, git, { warmup, iterations }) {
    for (let i = 0; i < warmup; i += 1) await run(repo, git);
    const samples = [];
    for (let i = 0; i < iterations; i += 1) {
        const started = performance.now();
        await run(repo, git);
        samples.push(performance.now() - started);
    }
    return summarize(samples);
}

/**
 * Count 1 ms timer ticks while a run happens, which is what a blocking child
 * process costs and a clock reading cannot show.
 *
 * A path that spends 90 ms forking children from Node and lets zero timers fire
 * has stopped the server for 90 ms; the same wall clock on a libuv worker has
 * not. Reported only for cases whose legacy path blocked.
 */
async function countTimerTicks(run, repo, git, rounds) {
    let ticks = 0;
    const timer = setInterval(() => { ticks += 1; }, 1);
    const started = performance.now();
    for (let i = 0; i < rounds; i += 1) await run(repo, git);
    const elapsed = performance.now() - started;
    clearInterval(timer);
    return { ticks, elapsed, rounds };
}

/** Run every selected case against one repository. */
export async function benchRepo(repo, git, options) {
    const results = [];
    for (const testCase of options.cases) {
        let legacy;
        let native;
        try {
            legacy = await time(testCase.legacy, repo, git, options);
            native = await time(testCase.native, repo, git, options);
        } catch (error) {
            results.push({ case: testCase, error: error instanceof Error ? error.message : String(error) });
            continue;
        }
        const result = { case: testCase, legacy, native, speedup: speedup(legacy.median, native.median) };
        if (testCase.blocking && options.eventLoop) {
            result.loop = {
                legacy: await countTimerTicks(testCase.legacy, repo, git, options.loopRounds),
                native: await countTimerTicks(testCase.native, repo, git, options.loopRounds),
            };
        }
        results.push(result);
        options.onResult?.(repo, result);
    }
    return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

/** Parse argv into the run's options. Exported so the suite can pin the flags. */
export function parseArgs(argv) {
    const options = {
        repos: [],
        iterations: 20,
        warmup: 3,
        loopRounds: 20,
        tolerance: 0.05,
        only: null,
        small: true,
        large: true,
        eventLoop: true,
        json: false,
        check: false,
        smallCommits: 250,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const next = () => {
            const value = argv[i + 1];
            if (value === undefined) throw new Error(`${arg} needs a value`);
            i += 1;
            return value;
        };
        switch (arg) {
            case '--repo': options.repos.push(path.resolve(next())); break;
            case '--iterations': options.iterations = Number(next()); break;
            case '--warmup': options.warmup = Number(next()); break;
            case '--tolerance': options.tolerance = Number(next()); break;
            case '--only': options.only = next().split(',').map(s => s.trim()).filter(Boolean); break;
            case '--small-commits': options.smallCommits = Number(next()); break;
            case '--no-small': options.small = false; break;
            case '--no-large': options.large = false; break;
            case '--no-event-loop': options.eventLoop = false; break;
            case '--json': options.json = true; break;
            case '--check': options.check = true; break;
            case '--help': case '-h': options.help = true; break;
            default: throw new Error(`unknown option ${arg}`);
        }
    }
    if (!Number.isFinite(options.iterations) || options.iterations < 1) throw new Error('--iterations must be a positive number');
    if (options.only) {
        const known = new Set(CASES.map(c => c.id));
        const unknown = options.only.filter(id => !known.has(id));
        if (unknown.length) throw new Error(`unknown case ${unknown.join(', ')} — known: ${[...known].join(', ')}`);
    }
    return options;
}

const USAGE = `Usage: node scripts/bench-git.mjs [options]

  --repo <path>        Benchmark this repository (repeatable). Defaults to a
                       generated small fixture and the repo this file is in.
  --iterations <n>     Timed runs per implementation (default 20).
  --warmup <n>         Discarded runs before timing (default 3).
  --tolerance <f>      Fraction native may exceed legacy before --check fails
                       (default 0.05 — the width of the measurement).
  --only <a,b>         Run only these case ids.
  --small-commits <n>  Commits in the generated fixture (default 250).
  --no-small           Skip the generated fixture.
  --no-large           Skip this repository.
  --no-event-loop      Skip the timer-tick measurement.
  --json               Emit machine-readable JSON instead of a table.
  --check              Exit non-zero if a gated case is slower than legacy.

Cases: ${CASES.map(c => c.id).join(', ')}`;

/** Render one repository's results as an aligned table. */
export function formatTable(label, results) {
    const rows = results.map(result => result.error
        ? [result.case.id, 'error', '', '', result.error]
        : [
            result.case.id,
            `${result.legacy.median.toFixed(2)} ms`,
            `${result.native.median.toFixed(2)} ms`,
            `${result.speedup.toFixed(2)}x`,
            `${result.case.children} child${result.case.children === 1 ? '' : 'ren'}${result.case.gated ? '' : ' — ungated'}`,
        ]);
    const header = ['case', 'legacy (TS)', 'native', 'speedup', 'legacy spawns'];
    const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
    const line = cells => cells.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd();
    return [
        '',
        label,
        line(header),
        line(widths.map(w => '─'.repeat(w))),
        ...rows.map(line),
    ].join('\n');
}

/** Render the timer-tick measurements, which only the blocking cases have. */
export function formatEventLoop(results) {
    const withLoop = results.filter(result => result.loop);
    if (!withLoop.length) return '';
    const rounds = withLoop[0].loop.legacy.rounds;
    return ['', `  event loop — 1 ms timer ticks during ${rounds} sequential calls`, ...withLoop.map(result =>
        `    ${result.case.id.padEnd(20)} legacy ${String(result.loop.legacy.ticks).padStart(4)} ticks / ${result.loop.legacy.elapsed.toFixed(0).padStart(4)} ms` +
        `    native ${String(result.loop.native.ticks).padStart(4)} ticks / ${result.loop.native.elapsed.toFixed(0).padStart(4)} ms`)].join('\n');
}

async function main(argv) {
    let options;
    try {
        options = parseArgs(argv);
    } catch (error) {
        process.stderr.write(`${error.message}\n\n${USAGE}\n`);
        return 2;
    }
    if (options.help) {
        process.stdout.write(`${USAGE}\n`);
        return 0;
    }

    let loadNativeGit;
    try {
        ({ loadNativeGit } = await import(path.join(packageRoot, 'dist', 'index.js')));
    } catch (error) {
        process.stderr.write(`Cannot load the addon: ${error.message}\nRun \`npm run build:native -w packages/coc-native && npm run build -w packages/coc-native\` first.\n`);
        return 2;
    }
    const git = loadNativeGit();

    const selected = options.only ? CASES.filter(c => options.only.includes(c.id)) : CASES;
    const runOptions = { ...options, cases: selected };

    const repos = [];
    let fixtureDir = null;
    if (options.repos.length) {
        for (const root of options.repos) repos.push({ label: root, repo: { root, head: describeRepo(root).head } });
    } else {
        if (options.small) {
            fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-bench-git-'));
            const repo = createSmallRepo(path.join(fixtureDir, 'repo'), { commits: options.smallCommits });
            repos.push({ label: 'small fixture', repo });
        }
        if (options.large) {
            const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: packageRoot, encoding: 'utf-8' }).trim();
            repos.push({ label: root, repo: { root, head: describeRepo(root).head } });
        }
    }

    const report = [];
    try {
        for (const { label, repo } of repos) {
            const stats = describeRepo(repo.root);
            const results = await benchRepo(repo, git, runOptions);
            report.push({ label, root: repo.root, stats, results });
        }
    } finally {
        if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
    }

    const all = report.flatMap(entry => entry.results);
    const outcome = verdict(all.filter(r => !r.error), options.tolerance);

    if (options.json) {
        process.stdout.write(`${JSON.stringify({
            host: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, node: process.version },
            iterations: options.iterations,
            tolerance: options.tolerance,
            repos: report.map(entry => ({
                label: entry.label,
                root: entry.root,
                refs: entry.stats.refs,
                commits: entry.stats.commits,
                results: entry.results.map(r => r.error
                    ? { id: r.case.id, error: r.error }
                    : { id: r.case.id, title: r.case.title, children: r.case.children, gated: r.case.gated, legacy: r.legacy, native: r.native, speedup: r.speedup, loop: r.loop }),
            })),
            verdict: { ok: outcome.ok, regressions: outcome.regressions.map(r => r.case.id), improved: outcome.improved.map(r => r.case.id) },
        }, null, 2)}\n`);
    } else {
        process.stdout.write(`git capability benchmark — ${process.platform}-${process.arch}, ${os.cpus().length} cpus, node ${process.version}, ${options.iterations} iterations, medians\n`);
        for (const entry of report) {
            process.stdout.write(formatTable(`${entry.label} — ${entry.stats.refs} refs, ${entry.stats.commits} commits`, entry.results));
            const loop = formatEventLoop(entry.results);
            if (loop) process.stdout.write(`${loop}\n`);
            process.stdout.write('\n');
        }
        const errors = all.filter(r => r.error);
        if (errors.length) process.stdout.write(`${errors.length} case(s) failed to run\n`);
        process.stdout.write(outcome.ok
            ? `PASS — no gated operation slower than the TypeScript path (${outcome.gatedCount} gated, ${outcome.improved.length} faster by 1.1x or more)\n`
            : `REGRESSION — ${outcome.regressions.map(r => r.case.id).join(', ')} slower than the TypeScript path\n`);
        for (const testCase of selected.filter(c => !c.gated && c.note)) {
            process.stdout.write(`note — ${testCase.id}: ${testCase.note}\n`);
        }
    }

    return options.check && !outcome.ok ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
