/**
 * Platform host abstraction for the Markdown Review Editor.
 *
 * Abstracts platform-specific operations that differ between
 * VS Code and a standalone HTTP server.
 */

/** Abstracts platform-specific operations that differ between VS Code and HTTP server */
export interface EditorHost {
    /** Show an informational notification */
    showInformation(message: string): void;

    /** Show a warning notification */
    showWarning(message: string): void;

    /** Show an error notification */
    showError(message: string): void;

    /** Show a confirmation dialog; resolves to the chosen option or undefined */
    showConfirmation(message: string, options: string[]): Promise<string | undefined>;

    /** Copy text to clipboard */
    copyToClipboard(text: string): Promise<void>;

    /** Open a file in the platform's editor / viewer */
    openFile(filePath: string): Promise<void>;

    /** Resolve a relative image path to a URI the webview can load */
    resolveImageUri(relativePath: string, documentUri: string): string | undefined;

    /** Get the workspace root path */
    getWorkspaceRoot(): string;
}
