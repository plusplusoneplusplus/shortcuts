import { execSync } from 'child_process';
import * as vscode from 'vscode';

/**
 * URI scheme for git show content provider
 */
export const GIT_SHOW_SCHEME = 'git-show';

/**
 * Empty tree hash for git - represents an empty directory/file
 * Used for diffing newly added files (no parent content)
 */
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Text document content provider for viewing file content at a specific git commit.
 * 
 * URI format: git-show:/path/to/file?commit=abc123&repo=/path/to/repo
 * 
 * This provider is used to display file content in VSCode's diff viewer,
 * allowing side-by-side comparison of files at different commits.
 */
export class GitShowTextDocumentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    /**
     * Provides the text content for a git file at a specific commit.
     * 
     * @param uri URI in format: git-show:/path/to/file?commit=abc123&repo=/path/to/repo
     * @returns The file content at the specified commit, or empty string if not found
     */
    provideTextDocumentContent(uri: vscode.Uri): string {
        try {
            const params = new URLSearchParams(uri.query);
            const commit = params.get('commit');
            const repo = params.get('repo');
            const filePath = uri.path;

            if (!commit || !repo || !filePath) {
                console.warn('GitShowTextDocumentProvider: Missing required parameters', { commit, repo, filePath });
                return '';
            }

            // Handle empty tree hash - return empty content for new files
            if (commit === EMPTY_TREE_HASH) {
                return '';
            }

            return this.getFileContentAtCommit(repo, commit, filePath);
        } catch (error) {
            console.error('GitShowTextDocumentProvider: Error providing content', error);
            return '';
        }
    }

    /**
     * Get the content of a file at a specific commit using git show.
     * 
     * @param repoRoot Repository root path
     * @param commit Commit hash
     * @param filePath File path relative to repository root
     * @returns File content at the specified commit
     */
    private getFileContentAtCommit(repoRoot: string, commit: string, filePath: string): string {
        try {
            // Normalize the file path:
            // 1. Remove leading slash if present
            // 2. Convert backslashes to forward slashes for git compatibility (Windows)
            let normalizedPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
            normalizedPath = normalizedPath.replace(/\\/g, '/');
            
            // Use git show to get file content at the specified commit
            // Format: git show commit:path/to/file
            const command = `git show "${commit}:${normalizedPath}"`;
            
            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large files
                timeout: 30000 // 30 second timeout
            });

            return output;
        } catch (error: unknown) {
            // File might not exist at this commit (e.g., newly added file)
            // Return empty string in this case
            const err = error as { status?: number; message?: string };
            if (err.status === 128 || (err.message && err.message.includes('does not exist'))) {
                return '';
            }
            console.error(`GitShowTextDocumentProvider: Failed to get file content for ${filePath} at ${commit}:`, error);
            return '';
        }
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this._onDidChange.dispose();
    }
}

/**
 * Create a git-show URI for a file at a specific commit.
 * 
 * @param filePath Relative file path within the repository
 * @param commit Git commit hash
 * @param repoRoot Repository root path
 * @returns VSCode Uri for the file at the specified commit
 */
export function createGitShowUri(filePath: string, commit: string, repoRoot: string): vscode.Uri {
    const query = new URLSearchParams({
        commit,
        repo: repoRoot
    }).toString();

    return vscode.Uri.parse(`${GIT_SHOW_SCHEME}:${filePath}?${query}`);
}

