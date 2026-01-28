/**
 * DiffContentProvider - Gets file content at different Git refs
 * 
 * Provides access to file content for:
 * - Staged files: old=HEAD, new=INDEX (:0)
 * - Unstaged files: old=INDEX (:0), new=working tree
 * - Committed files: old=parent commit, new=commit
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getExtensionLogger, LogCategory } from '../shared';
import { DiffGitContext } from './types';

/**
 * Result of getting diff content
 */
export interface DiffContentResult {
    /** Content of the old version */
    oldContent: string;
    /** Content of the new version */
    newContent: string;
    /** Whether the file is binary */
    isBinary: boolean;
    /** Error message if failed */
    error?: string;
}

/**
 * Normalize line endings to LF (Unix-style)
 * This prevents CRLF vs LF differences from causing entire files to appear as changed
 */
function normalizeLineEndings(content: string): string {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Execute a git command and return the output
 */
function execGit(args: string[], cwd: string): string {
    try {
        const result = execSync(`git ${args.join(' ')}`, {
            cwd,
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large files
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return result;
    } catch (error: any) {
        // Git returns non-zero exit code for various reasons
        // Check if we got output anyway
        if (error.stdout) {
            return error.stdout;
        }
        throw error;
    }
}

/**
 * Check if a file is binary
 */
function isBinaryFile(filePath: string, repositoryRoot: string): boolean {
    try {
        // Use git's binary detection
        const result = execGit(
            ['diff', '--numstat', '--', filePath],
            repositoryRoot
        );
        // Binary files show "-" for additions and deletions
        return result.startsWith('-\t-\t');
    } catch {
        // Fallback: check file content
        try {
            const absolutePath = path.isAbsolute(filePath) 
                ? filePath 
                : path.join(repositoryRoot, filePath);
            
            if (fs.existsSync(absolutePath)) {
                const buffer = fs.readFileSync(absolutePath);
                // Check for null bytes (common in binary files)
                for (let i = 0; i < Math.min(buffer.length, 8000); i++) {
                    if (buffer[i] === 0) {
                        return true;
                    }
                }
            }
        } catch {
            // Ignore errors
        }
        return false;
    }
}

/**
 * Get file content at a specific Git ref
 * Line endings are normalized to LF to prevent CRLF/LF differences from
 * causing entire files to appear as changed on Windows
 */
export function getFileAtRef(
    filePath: string,
    ref: string,
    repositoryRoot: string
): string {
    try {
        // Handle special refs
        if (ref === 'WORKING_TREE') {
            const absolutePath = path.isAbsolute(filePath)
                ? filePath
                : path.join(repositoryRoot, filePath);

            if (fs.existsSync(absolutePath)) {
                const content = fs.readFileSync(absolutePath, 'utf8');
                return normalizeLineEndings(content);
            }
            return '';
        }

        // Use git show for other refs
        // :0:path = index (staged)
        // HEAD:path = last commit
        // <commit>:path = specific commit
        const gitPath = filePath.replace(/\\/g, '/'); // Normalize path separators
        const result = execGit(
            ['show', `${ref}:${gitPath}`],
            repositoryRoot
        );
        return normalizeLineEndings(result);
    } catch (error: any) {
        // File might not exist at this ref (new file, deleted file, etc.)
        console.warn(`Could not get file at ref ${ref}:${filePath}:`, error.message);
        return '';
    }
}

/**
 * Get diff content for a staged file
 * Old = HEAD, New = INDEX
 */
export function getStagedDiffContent(
    filePath: string,
    repositoryRoot: string
): DiffContentResult {
    if (isBinaryFile(filePath, repositoryRoot)) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: true
        };
    }

    try {
        const oldContent = getFileAtRef(filePath, 'HEAD', repositoryRoot);
        const newContent = getFileAtRef(filePath, ':0', repositoryRoot);

        return {
            oldContent,
            newContent,
            isBinary: false
        };
    } catch (error: any) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: false,
            error: error.message
        };
    }
}

/**
 * Get diff content for an unstaged file
 * Old = INDEX, New = Working Tree
 */
export function getUnstagedDiffContent(
    filePath: string,
    repositoryRoot: string
): DiffContentResult {
    if (isBinaryFile(filePath, repositoryRoot)) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: true
        };
    }

    try {
        const oldContent = getFileAtRef(filePath, ':0', repositoryRoot);
        const newContent = getFileAtRef(filePath, 'WORKING_TREE', repositoryRoot);

        return {
            oldContent,
            newContent,
            isBinary: false
        };
    } catch (error: any) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: false,
            error: error.message
        };
    }
}

/**
 * Get diff content for an untracked file
 * Old = empty, New = Working Tree
 */
export function getUntrackedDiffContent(
    filePath: string,
    repositoryRoot: string
): DiffContentResult {
    if (isBinaryFile(filePath, repositoryRoot)) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: true
        };
    }

    try {
        const newContent = getFileAtRef(filePath, 'WORKING_TREE', repositoryRoot);

        return {
            oldContent: '',
            newContent,
            isBinary: false
        };
    } catch (error: any) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: false,
            error: error.message
        };
    }
}

/**
 * Get diff content for a committed file
 * Old = parent commit, New = commit
 */
export function getCommittedDiffContent(
    filePath: string,
    commitHash: string,
    parentHash: string,
    repositoryRoot: string
): DiffContentResult {
    if (isBinaryFile(filePath, repositoryRoot)) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: true
        };
    }

    try {
        const oldContent = getFileAtRef(filePath, parentHash, repositoryRoot);
        const newContent = getFileAtRef(filePath, commitHash, repositoryRoot);

        return {
            oldContent,
            newContent,
            isBinary: false
        };
    } catch (error: any) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: false,
            error: error.message
        };
    }
}

/**
 * Get diff content based on git context
 */
export function getDiffContent(
    filePath: string,
    gitContext: DiffGitContext
): DiffContentResult {
    const { repositoryRoot, oldRef, newRef, commitHash } = gitContext;

    // Check for binary file
    if (isBinaryFile(filePath, repositoryRoot)) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: true
        };
    }

    try {
        const oldContent = getFileAtRef(filePath, oldRef, repositoryRoot);
        const newContent = getFileAtRef(filePath, newRef, repositoryRoot);

        return {
            oldContent,
            newContent,
            isBinary: false
        };
    } catch (error: any) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: false,
            error: error.message
        };
    }
}

/**
 * Create a git context for a staged change
 */
export function createStagedGitContext(
    repositoryRoot: string,
    repositoryName: string
): DiffGitContext {
    return {
        repositoryRoot,
        repositoryName,
        oldRef: 'HEAD',
        newRef: ':0',
        wasStaged: true
    };
}

/**
 * Create a git context for an unstaged change
 */
export function createUnstagedGitContext(
    repositoryRoot: string,
    repositoryName: string
): DiffGitContext {
    return {
        repositoryRoot,
        repositoryName,
        oldRef: ':0',
        newRef: 'WORKING_TREE',
        wasStaged: false
    };
}

/**
 * Create a git context for an untracked file
 */
export function createUntrackedGitContext(
    repositoryRoot: string,
    repositoryName: string
): DiffGitContext {
    return {
        repositoryRoot,
        repositoryName,
        oldRef: 'EMPTY',
        newRef: 'WORKING_TREE',
        wasStaged: false
    };
}

/**
 * Create a git context for a committed change
 */
export function createCommittedGitContext(
    repositoryRoot: string,
    repositoryName: string,
    commitHash: string,
    parentHash: string
): DiffGitContext {
    return {
        repositoryRoot,
        repositoryName,
        oldRef: parentHash,
        newRef: commitHash,
        wasStaged: true,
        commitHash
    };
}

/**
 * Create a git context for a commit range change
 * Uses three-dot notation for merge-base comparison
 */
export function createRangeGitContext(
    repositoryRoot: string,
    repositoryName: string,
    baseRef: string,
    headRef: string
): DiffGitContext {
    return {
        repositoryRoot,
        repositoryName,
        oldRef: baseRef,
        newRef: headRef,
        wasStaged: true
    };
}

/**
 * Get diff content for a file in a commit range
 * Uses three-dot notation to get the cumulative diff from merge base
 */
export function getRangeDiffContent(
    filePath: string,
    baseRef: string,
    headRef: string,
    repositoryRoot: string
): DiffContentResult {
    if (isBinaryFile(filePath, repositoryRoot)) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: true
        };
    }

    try {
        // Get the merge base first
        let mergeBase: string;
        try {
            // NOTE: Must trim the output as git commands return newlines at the end.
            // Without trimming, the newline causes `git show <hash>\n:path` to be interpreted
            // as showing the commit (not the file), leaking commit info into file content.
            mergeBase = execGit(['merge-base', baseRef, headRef], repositoryRoot).trim();
        } catch {
            // If merge-base fails, use baseRef directly
            mergeBase = baseRef;
        }

        // Get content at merge base (old version)
        const oldContent = getFileAtRef(filePath, mergeBase, repositoryRoot);
        // Get content at HEAD (new version)
        const newContent = getFileAtRef(filePath, headRef, repositoryRoot);

        return {
            oldContent,
            newContent,
            isBinary: false
        };
    } catch (error: any) {
        return {
            oldContent: '',
            newContent: '',
            isBinary: false,
            error: error.message
        };
    }
}

/**
 * Get the unified diff output for display
 */
export function getUnifiedDiff(
    filePath: string,
    gitContext: DiffGitContext
): string {
    const { repositoryRoot, oldRef, newRef } = gitContext;
    const gitPath = filePath.replace(/\\/g, '/');

    try {
        if (newRef === 'WORKING_TREE') {
            // Diff against working tree
            if (oldRef === ':0') {
                // Unstaged changes
                return execGit(['diff', '--', gitPath], repositoryRoot);
            } else if (oldRef === 'EMPTY') {
                // Untracked file - show as all additions
                const content = getFileAtRef(filePath, 'WORKING_TREE', repositoryRoot);
                const lines = content.split('\n');
                const diffLines = [
                    `diff --git a/${gitPath} b/${gitPath}`,
                    'new file mode 100644',
                    '--- /dev/null',
                    `+++ b/${gitPath}`,
                    `@@ -0,0 +1,${lines.length} @@`,
                    ...lines.map(line => `+${line}`)
                ];
                return diffLines.join('\n');
            }
        } else if (oldRef === 'HEAD' && newRef === ':0') {
            // Staged changes
            return execGit(['diff', '--cached', '--', gitPath], repositoryRoot);
        } else {
            // Committed changes
            return execGit(['diff', oldRef, newRef, '--', gitPath], repositoryRoot);
        }
    } catch (error: any) {
        getExtensionLogger().error(LogCategory.GIT, 'Error getting unified diff', error instanceof Error ? error : undefined);
        return '';
    }

    return '';
}

