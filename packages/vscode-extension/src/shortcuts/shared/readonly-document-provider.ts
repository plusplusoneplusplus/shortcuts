/**
 * Shared Read-Only Document Provider
 *
 * A flexible, generic read-only document provider with multiple content strategies.
 * Supports different methods of content retrieval:
 * - File-based (reading from filesystem)
 * - Memory-based (storing/retrieving from in-memory Map)
 * - Dynamic/reactive (callback-based with refresh support)
 * - Git command-based (executing git commands)
 *
 * Cross-platform compatible (Linux/macOS/Windows).
 */

import * as vscode from 'vscode';
import { getExtensionLogger, LogCategory } from './extension-logger';

/**
 * Content strategy interface for providing document content.
 * Implementations can be synchronous or asynchronous.
 */
export interface ContentStrategy {
    /**
     * Get the content for a given URI.
     * @param uri The URI of the document
     * @returns The content as a string, or a Promise resolving to the content
     */
    getContent(uri: vscode.Uri): string | Thenable<string>;

    /**
     * Optional: Event emitter for content changes.
     * When provided, the document will be refreshed when this event fires.
     */
    onDidChange?: vscode.Event<vscode.Uri>;

    /**
     * Optional: Dispose of any resources held by the strategy.
     */
    dispose?(): void;
}

/**
 * Options for FileContentStrategy
 */
export interface FileContentStrategyOptions {
    /**
     * Base path to prepend to URI paths (optional).
     * If provided, the full path will be: basePath + uri.path
     */
    basePath?: string;

    /**
     * Error message prefix for failed reads (optional).
     * Default: "Error loading file"
     */
    errorMessagePrefix?: string;

    /**
     * File encoding (optional).
     * Default: 'utf-8'
     */
    encoding?: BufferEncoding;
}

/**
 * Strategy that reads content from the filesystem.
 */
export class FileContentStrategy implements ContentStrategy {
    private readonly options: FileContentStrategyOptions;

    constructor(options: FileContentStrategyOptions = {}) {
        this.options = {
            errorMessagePrefix: 'Error loading file',
            encoding: 'utf-8',
            ...options,
        };
    }

    getContent(uri: vscode.Uri): string {
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');

        let filePath = uri.path;

        // Prepend base path if configured
        if (this.options.basePath) {
            filePath = path.join(this.options.basePath, filePath);
        }

        try {
            return fs.readFileSync(filePath, this.options.encoding!);
        } catch (error) {
            const errorMsg =
                error instanceof Error ? error.message : 'Unknown error';
            getExtensionLogger().error(
                LogCategory.FILESYSTEM,
                `${this.options.errorMessagePrefix}: ${filePath}`,
                error instanceof Error ? error : undefined
            );
            return `// ${this.options.errorMessagePrefix}: ${errorMsg}`;
        }
    }
}

/**
 * Options for MemoryContentStrategy
 */
export interface MemoryContentStrategyOptions {
    /**
     * Default content when URI is not found in storage.
     */
    defaultContent?: string;
}

/**
 * Strategy that stores and retrieves content from an in-memory Map.
 * Useful for storing dynamically generated content like pipeline results.
 */
export class MemoryContentStrategy implements ContentStrategy {
    private readonly storage: Map<string, string> = new Map();
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private readonly options: MemoryContentStrategyOptions;

    readonly onDidChange = this._onDidChange.event;

    constructor(options: MemoryContentStrategyOptions = {}) {
        this.options = {
            defaultContent: '// No content available',
            ...options,
        };
    }

    /**
     * Store content for a URI.
     * @param uri The URI to store content for
     * @param content The content to store
     */
    store(uri: vscode.Uri, content: string): void {
        this.storage.set(uri.toString(), content);
        this._onDidChange.fire(uri);
    }

    /**
     * Check if content exists for a URI.
     * @param uri The URI to check
     */
    has(uri: vscode.Uri): boolean {
        return this.storage.has(uri.toString());
    }

    /**
     * Remove content for a URI.
     * @param uri The URI to remove
     */
    delete(uri: vscode.Uri): boolean {
        return this.storage.delete(uri.toString());
    }

    /**
     * Clear all stored content.
     */
    clear(): void {
        this.storage.clear();
    }

    getContent(uri: vscode.Uri): string {
        return (
            this.storage.get(uri.toString()) ?? this.options.defaultContent!
        );
    }

    dispose(): void {
        this._onDidChange.dispose();
        this.storage.clear();
    }
}

/**
 * Options for DynamicContentStrategy
 */
export interface DynamicContentStrategyOptions<T = unknown> {
    /**
     * Function to get content for a URI.
     * @param uri The URI of the document
     * @param context Optional context object passed to the strategy
     */
    getContent: (uri: vscode.Uri, context?: T) => string | Thenable<string>;

    /**
     * Optional: Event that triggers content refresh.
     */
    onChange?: vscode.Event<vscode.Uri>;

    /**
     * Optional: Context object to pass to getContent function.
     */
    context?: T;
}

/**
 * Strategy that uses a callback function to provide content.
 * Supports reactive updates via optional change event.
 */
export class DynamicContentStrategy<T = unknown> implements ContentStrategy {
    private readonly options: DynamicContentStrategyOptions<T>;
    readonly onDidChange?: vscode.Event<vscode.Uri>;

    constructor(options: DynamicContentStrategyOptions<T>) {
        this.options = options;
        this.onDidChange = options.onChange;
    }

    getContent(uri: vscode.Uri): string | Thenable<string> {
        return this.options.getContent(uri, this.options.context);
    }
}

/**
 * Options for GitContentStrategy
 */
export interface GitContentStrategyOptions {
    /**
     * Query parameter name for the commit hash.
     * Default: 'commit'
     */
    commitParam?: string;

    /**
     * Query parameter name for the repository root.
     * Default: 'repo'
     */
    repoParam?: string;

    /**
     * Query parameter name for the file path (alternative to URI path).
     * If provided, the file path will be read from this query parameter.
     */
    fileParam?: string;

    /**
     * Maximum buffer size for git command output in bytes.
     * Default: 10MB
     */
    maxBuffer?: number;

    /**
     * Timeout for git command execution in milliseconds.
     * Default: 30000 (30 seconds)
     */
    timeout?: number;

    /**
     * Empty tree hash for git (representing no content).
     * Default: '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
     */
    emptyTreeHash?: string;
}

/**
 * Strategy that retrieves file content from git at a specific commit.
 * Executes `git show <commit>:<path>` to get content.
 */
export class GitContentStrategy implements ContentStrategy {
    private readonly options: Required<GitContentStrategyOptions>;

    constructor(options: GitContentStrategyOptions = {}) {
        this.options = {
            commitParam: 'commit',
            repoParam: 'repo',
            fileParam: options.fileParam ?? '',
            maxBuffer: 10 * 1024 * 1024, // 10MB
            timeout: 30000, // 30 seconds
            emptyTreeHash: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
            ...options,
        };
    }

    getContent(uri: vscode.Uri): string | Thenable<string> {
        const params = new URLSearchParams(uri.query);
        const commit = params.get(this.options.commitParam);
        const repo = params.get(this.options.repoParam);

        // Get file path from query param or URI path
        const filePath = this.options.fileParam
            ? params.get(this.options.fileParam)
            : uri.path;

        if (!commit || !repo || !filePath) {
            getExtensionLogger().warn(
                LogCategory.GIT,
                'GitContentStrategy: Missing required parameters',
                { commit, repo, filePath }
            );
            return '';
        }

        // Handle empty tree hash - return empty content for new files
        if (commit === this.options.emptyTreeHash) {
            return '';
        }

        return this.getFileContentAtCommit(repo, commit, filePath);
    }

    private async getFileContentAtCommit(
        repoRoot: string,
        commit: string,
        filePath: string
    ): Promise<string> {
        try {
            const { execSync } = await import('child_process');

            // Normalize the file path:
            // 1. Remove leading slash if present
            // 2. Convert backslashes to forward slashes for git compatibility (Windows)
            let normalizedPath = filePath.startsWith('/')
                ? filePath.slice(1)
                : filePath;
            normalizedPath = normalizedPath.replace(/\\/g, '/');

            // Use git show to get file content at the specified commit
            const command = `git show "${commit}:${normalizedPath}"`;

            const output = execSync(command, {
                cwd: repoRoot,
                encoding: 'utf-8',
                maxBuffer: this.options.maxBuffer,
                timeout: this.options.timeout,
            });

            return output;
        } catch (error: unknown) {
            const err = error as { status?: number; message?: string };

            // File might not exist at this commit (e.g., newly added file)
            if (
                err.status === 128 ||
                (err.message && err.message.includes('does not exist'))
            ) {
                return '';
            }

            getExtensionLogger().error(
                LogCategory.GIT,
                `GitContentStrategy: Failed to get file content for ${filePath} at ${commit}`,
                error instanceof Error ? error : undefined
            );
            return '';
        }
    }
}

/**
 * Configuration for registering a scheme with the provider.
 */
export interface SchemeConfig {
    /**
     * The URI scheme (e.g., 'bundled-pipeline', 'ai-process').
     */
    scheme: string;

    /**
     * The content strategy to use for this scheme.
     */
    strategy: ContentStrategy;
}

/**
 * Generic read-only document provider supporting multiple URI schemes.
 * Each scheme can have its own content retrieval strategy.
 */
export class ReadOnlyDocumentProvider
    implements vscode.TextDocumentContentProvider, vscode.Disposable
{
    private readonly strategies: Map<string, ContentStrategy> = new Map();
    private readonly changeEmitters: Map<
        string,
        vscode.EventEmitter<vscode.Uri>
    > = new Map();
    private readonly changeListenerDisposables: vscode.Disposable[] = [];
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    readonly onDidChange = this._onDidChange.event;

    /**
     * Register a content strategy for a URI scheme.
     * @param scheme The URI scheme to register
     * @param strategy The content strategy to use
     */
    registerScheme(scheme: string, strategy: ContentStrategy): void {
        this.strategies.set(scheme, strategy);

        // Subscribe to strategy's change events if available
        if (strategy.onDidChange) {
            const disposable = strategy.onDidChange((uri) => {
                this._onDidChange.fire(uri);
            });
            this.changeListenerDisposables.push(disposable);
        }
    }

    /**
     * Unregister a scheme.
     * @param scheme The URI scheme to unregister
     */
    unregisterScheme(scheme: string): void {
        const strategy = this.strategies.get(scheme);
        if (strategy?.dispose) {
            strategy.dispose();
        }
        this.strategies.delete(scheme);
    }

    /**
     * Get the strategy for a scheme.
     * @param scheme The URI scheme
     */
    getStrategy<T extends ContentStrategy>(scheme: string): T | undefined {
        return this.strategies.get(scheme) as T | undefined;
    }

    /**
     * Check if a scheme is registered.
     * @param scheme The URI scheme
     */
    hasScheme(scheme: string): boolean {
        return this.strategies.has(scheme);
    }

    /**
     * Manually trigger a refresh for a URI.
     * @param uri The URI to refresh
     */
    refresh(uri: vscode.Uri): void {
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string | Thenable<string> {
        const strategy = this.strategies.get(uri.scheme);

        if (!strategy) {
            getExtensionLogger().warn(
                LogCategory.EXTENSION,
                `ReadOnlyDocumentProvider: No strategy registered for scheme '${uri.scheme}'`
            );
            return `// No content provider registered for scheme: ${uri.scheme}`;
        }

        return strategy.getContent(uri);
    }

    dispose(): void {
        // Dispose of all strategies
        for (const strategy of this.strategies.values()) {
            if (strategy.dispose) {
                strategy.dispose();
            }
        }
        this.strategies.clear();

        // Dispose of change listeners
        for (const disposable of this.changeListenerDisposables) {
            disposable.dispose();
        }
        this.changeListenerDisposables.length = 0;

        // Dispose of change emitters
        for (const emitter of this.changeEmitters.values()) {
            emitter.dispose();
        }
        this.changeEmitters.clear();

        // Dispose of main change emitter
        this._onDidChange.dispose();
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a URI for a specific scheme.
 * @param scheme The URI scheme
 * @param path The path part of the URI
 * @param query Optional query parameters
 */
export function createSchemeUri(
    scheme: string,
    path: string,
    query?: Record<string, string>
): vscode.Uri {
    const queryString = query
        ? new URLSearchParams(query).toString()
        : undefined;

    return vscode.Uri.from({
        scheme,
        path,
        query: queryString,
    });
}

/**
 * Register multiple schemes with a provider and return a disposable
 * that cleans up all registrations.
 * @param context Extension context for subscription management
 * @param provider The document provider
 * @param schemes Array of scheme configurations
 */
export function registerSchemes(
    context: vscode.ExtensionContext,
    provider: ReadOnlyDocumentProvider,
    schemes: SchemeConfig[]
): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    for (const { scheme, strategy } of schemes) {
        provider.registerScheme(scheme, strategy);
        disposables.push(
            vscode.workspace.registerTextDocumentContentProvider(
                scheme,
                provider
            )
        );
    }

    const disposable = vscode.Disposable.from(...disposables);
    context.subscriptions.push(disposable);

    return disposable;
}
