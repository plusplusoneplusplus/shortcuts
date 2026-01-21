import * as vscode from 'vscode';
import {
    createSchemeUri,
    GitContentStrategy,
    ReadOnlyDocumentProvider,
} from '../shared';

/**
 * URI scheme for git show content provider
 */
export const GIT_SHOW_SCHEME = 'git-show';

/**
 * Text document content provider for viewing file content at a specific git commit.
 *
 * URI format: git-show:/path/to/file?commit=abc123&repo=/path/to/repo
 *
 * This provider is used to display file content in VSCode's diff viewer,
 * allowing side-by-side comparison of files at different commits.
 *
 * Refactored to use the shared ReadOnlyDocumentProvider with GitContentStrategy.
 */
export class GitShowTextDocumentProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private readonly provider: ReadOnlyDocumentProvider;

    readonly onDidChange: vscode.Event<vscode.Uri>;

    constructor() {
        this.provider = new ReadOnlyDocumentProvider();
        const strategy = new GitContentStrategy({
            commitParam: 'commit',
            repoParam: 'repo',
            // File path comes from URI path, not query param
        });
        this.provider.registerScheme(GIT_SHOW_SCHEME, strategy);
        this.onDidChange = this.provider.onDidChange;
    }

    /**
     * Provides the text content for a git file at a specific commit.
     *
     * @param uri URI in format: git-show:/path/to/file?commit=abc123&repo=/path/to/repo
     * @returns The file content at the specified commit, or empty string if not found
     */
    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
        return this.provider.provideTextDocumentContent(uri);
    }

    /**
     * Refresh the content of a document
     */
    refresh(uri: vscode.Uri): void {
        this.provider.refresh(uri);
    }

    /**
     * Dispose of resources
     */
    dispose(): void {
        this.provider.dispose();
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
export function createGitShowUri(
    filePath: string,
    commit: string,
    repoRoot: string
): vscode.Uri {
    return createSchemeUri(GIT_SHOW_SCHEME, filePath, {
        commit,
        repo: repoRoot,
    });
}

