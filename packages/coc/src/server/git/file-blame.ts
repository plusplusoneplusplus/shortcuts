/**
 * Read-only blame of one file at HEAD: `git blame --porcelain`, one entry
 * per HEAD line naming the commit that last changed it. Whole-file renames
 * are followed, so each commit carries the file's path in that commit.
 */

import { execGitAsync } from '@plusplusoneplusplus/forge';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { badRequest } from '../errors';
import { resolveWorkingTreePath, toRepoRelative } from './working-tree-file-content';

export interface FileBlameCommit {
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    authorEmail: string;
    date: string;
    /** The file's path in this commit. */
    path: string;
}

export interface FileBlameLine {
    hash: string;
    /**
     * The line's text at HEAD, without its line ending. Git output is trimmed,
     * so the last line may lose trailing whitespace.
     */
    text: string;
}

export interface FileBlame {
    /** One entry per line of the file at HEAD; empty when HEAD has no such file. */
    lines: FileBlameLine[];
    commits: Record<string, FileBlameCommit>;
}

const HEADER = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) \d+ \d+/;

/** Parse `git blame --porcelain` output. */
export function parseFileBlame(output: string, filePath: string): FileBlame {
    const lines: FileBlameLine[] = [];
    const commits: Record<string, FileBlameCommit> = {};
    let current: FileBlameCommit | undefined;
    for (const line of output.split('\n')) {
        if (line.startsWith('\t')) {
            if (current) lines.push({ hash: current.hash, text: line.slice(1).replace(/\r$/, '') });
            continue;
        }
        const header = HEADER.exec(line);
        if (header) {
            const hash = header[1];
            current = commits[hash] ??= {
                hash, shortHash: hash.slice(0, 7), subject: '', author: '', authorEmail: '', date: '', path: filePath,
            };
            continue;
        }
        if (!current) continue;
        const space = line.indexOf(' ');
        const key = space < 0 ? line : line.slice(0, space);
        const value = space < 0 ? '' : line.slice(space + 1);
        if (key === 'summary') current.subject = value;
        else if (key === 'author') current.author = value;
        else if (key === 'author-mail') current.authorEmail = value.replace(/^<|>$/g, '');
        else if (key === 'author-time') current.date = new Date(Number(value) * 1000).toISOString();
        else if (key === 'filename') current.path = value;
    }
    return { lines, commits };
}

export async function loadFileBlame(repoRoot: string, requestPath: string): Promise<FileBlame> {
    const absPath = resolveWorkingTreePath(repoRoot, requestPath);
    if (!absPath || requestPath.includes('\0')) throw badRequest('Path is outside the workspace or invalid');
    const filePath = toRepoRelative(repoRoot, absPath);
    let output: string;
    try {
        output = await execGitAsync(['--literal-pathspecs', 'blame', '--porcelain', 'HEAD', '--', filePath], repoRoot);
    } catch (err) {
        if (err instanceof NativeAddonLoadError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        // No commits yet, or a file HEAD does not have: nothing is committed.
        if (/bad revision 'HEAD'|unknown revision|no such path/.test(message)) return { lines: [], commits: {} };
        throw badRequest(`Failed to load file blame: ${message}`);
    }
    return parseFileBlame(output, filePath);
}
