/**
 * Read-only history of one file on the current branch: `git log --follow`
 * from HEAD, newest first, with the file's path at each commit so renamed
 * revisions diff against the right paths.
 */

import { execGitAsync } from '@plusplusoneplusplus/forge';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { badRequest } from '../errors';
import { resolveWorkingTreePath, toRepoRelative } from './working-tree-file-content';

export interface FileHistoryCommit {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    authorEmail: string;
    date: string;
    /** The file's path in this commit. */
    path: string;
    /** The path before this commit when it renamed or copied the file. */
    oldPath?: string;
    /** Single-letter git status (A, M, D, R, C, ...); empty for a merge without a file diff. */
    status: string;
}

export interface FileHistoryPage {
    commits: FileHistoryCommit[];
    hasMore: boolean;
}

const RECORD_SEPARATOR = '\x1e';
const LOG_FORMAT = '--format=%x1e%H%x00%h%x00%an%x00%ae%x00%aI%x00%s';

function repoRelativePath(repoRoot: string, requestPath: string): string {
    const absPath = resolveWorkingTreePath(repoRoot, requestPath);
    if (!absPath || requestPath.includes('\0')) throw badRequest('Path is outside the workspace or invalid');
    return toRepoRelative(repoRoot, absPath);
}

/**
 * Parse `git log --follow --name-status -z` output. `filePath` is the newest
 * spelling; each rename moves the tracked path to its older name, so commits
 * without a file diff (merges) keep the path that was current at that point.
 */
export function parseFileHistory(output: string, filePath: string): FileHistoryCommit[] {
    const commits: FileHistoryCommit[] = [];
    let current = filePath;
    for (const record of output.split(RECORD_SEPARATOR).slice(1)) {
        const [hash = '', shortHash = '', author = '', authorEmail = '', date = '', subject = '', ...changes] = record.split('\0');
        const status = (changes[0] ?? '').trim().charAt(0);
        const commit: FileHistoryCommit = { hash, shortHash, subject, author, authorEmail, date, path: current, status };
        if ((status === 'R' || status === 'C') && changes[1] && changes[2]) {
            commit.oldPath = changes[1];
            commit.path = changes[2];
            current = changes[1];
        } else if (status && changes[1]) {
            commit.path = changes[1];
            current = changes[1];
        }
        commits.push(commit);
    }
    return commits;
}

export async function loadFileHistory(
    repoRoot: string,
    requestPath: string,
    page: { limit: number; skip: number },
): Promise<FileHistoryPage> {
    const filePath = repoRelativePath(repoRoot, requestPath);
    let output: string;
    try {
        output = await execGitAsync([
            '--literal-pathspecs', 'log', '--follow', '-M', '--name-status', '-z', LOG_FORMAT,
            // `--skip` would drop the rename tracking of the skipped commits, so
            // every page reads from HEAD and slices.
            `--max-count=${page.skip + page.limit + 1}`, 'HEAD', '--', filePath,
        ], repoRoot);
    } catch (err) {
        if (err instanceof NativeAddonLoadError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        // A repository without commits has no history yet.
        if (/bad revision 'HEAD'|unknown revision/.test(message)) return { commits: [], hasMore: false };
        throw badRequest(`Failed to load file history: ${message}`);
    }
    const commits = parseFileHistory(output, filePath);
    return {
        commits: commits.slice(page.skip, page.skip + page.limit),
        hasMore: commits.length > page.skip + page.limit,
    };
}

/**
 * Full-context patch for a commit that renamed or copied a file. Naming both
 * paths lets git pair them, where a single-path read shows an added file.
 */
export async function loadRenamedCommitFilePatch(
    repoRoot: string,
    hash: string,
    oldPath: string,
    filePath: string,
): Promise<{ diff: string }> {
    const diff = await execGitAsync([
        '--literal-pathspecs', 'show', '--format=', '--no-color', '--no-ext-diff', '-M', '--unified=99999',
        hash, '--', repoRelativePath(repoRoot, oldPath), repoRelativePath(repoRoot, filePath),
    ], repoRoot);
    return { diff };
}
